import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { prisma } from '@football-ai/database';
import {
  CALIBRATION_UNCERTAINTY_VERSION,
  applyTemperature,
  fitTemperatureCalibrator,
  probabilityMetrics,
  temporalFixtureSplit,
  type CalibrationObservation,
  type CalibrationSplit,
  type ProbabilityMetrics,
  type TemperatureCalibrator,
} from './calibration-uncertainty-contract.js';
import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';
import {
  loadHybridModelRuntime,
  type HybridModelArtifactRow,
} from './hybrid-model-engine.js';
import type { HybridMarketPrediction } from './hybrid-model-contract.js';

export type CalibrationReadiness =
  | 'READY_FOR_DECISION_ENGINE'
  | 'BLOCKED_STAGE4'
  | 'BLOCKED_TEMPORAL_SPLIT'
  | 'BLOCKED_CALIBRATION_INTEGRITY';

interface FixtureOutcome {
  id: number;
  kickoffAt: Date;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface CalibratedMarketPrediction {
  marketKey: string;
  rawProbability: Record<string, number>;
  calibratedProbability: Record<string, number>;
  outcome: string;
  calibratorHash: string;
  calibrationScope: TemperatureCalibrator['scope'];
  reliability: number;
  uncertainty: number;
  uncertaintyPenalty: number;
  outOfDistribution: boolean;
  outOfDistributionReasons: string[];
  componentDisagreement: number;
}

export interface CalibratedFixturePrediction {
  fixtureId: number;
  leagueId: number;
  horizonMinutes: number;
  predictionAsOf: string;
  kickoffAt: string;
  split: CalibrationSplit;
  markets: CalibratedMarketPrediction[];
  stage4RowHash: string;
  rowHash: string;
}

export interface CalibrationRuntimeResult {
  version: string;
  status: CalibrationReadiness;
  rows: CalibratedFixturePrediction[];
  calibrators: TemperatureCalibrator[];
  stage4DatasetFingerprint: string;
  datasetFingerprint: string;
  fixtures: number;
  labelledRows: number;
  splitFixtures: Record<CalibrationSplit, number>;
  splitRows: Record<CalibrationSplit, number>;
  missingOutcomeRows: number;
  temporalLeakageViolations: number;
  normalizationViolations: number;
  acceptedCalibrators: number;
  identityCalibrators: number;
  rawTestMetrics: ProbabilityMetrics;
  calibratedTestMetrics: ProbabilityMetrics;
  logLossRegression: number | null;
  eceImprovement: number | null;
  configuration: {
    artifactDirectory: string;
    minimumGlobalSamples: number;
    minimumLeagueSamples: number;
    maximumLogLossRegression: number;
  };
}

export interface CalibrationArtifactResult {
  directory: string;
  manifestPath: string;
  calibratorsPath: string;
  predictionsPath: string;
  hashesPath: string;
  runtime: CalibrationRuntimeResult;
}

function repositoryRoot(): string {
  let current = process.cwd();
  while (true) {
    if (
      existsSync(resolve(current, 'package.json')) &&
      existsSync(resolve(current, 'packages/database/prisma/schema.prisma'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error('Unable to locate repository root.');
    current = parent;
  }
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function configuration() {
  const root = repositoryRoot();
  return {
    artifactDirectory: resolve(
      root,
      process.env.HYBRID_CALIBRATION_ARTIFACT_DIRECTORY ??
        'artifacts/hybrid/v8-stage5-calibration-uncertainty',
    ),
    minimumGlobalSamples: Math.max(
      30,
      Math.floor(envNumber('HYBRID_CALIBRATION_MIN_GLOBAL_SAMPLES', 60)),
    ),
    minimumLeagueSamples: Math.max(
      20,
      Math.floor(envNumber('HYBRID_CALIBRATION_MIN_LEAGUE_SAMPLES', 40)),
    ),
    maximumLogLossRegression: Math.max(
      0,
      envNumber('HYBRID_CALIBRATION_MAX_LOG_LOSS_REGRESSION', 0.01),
    ),
  };
}

function marketKey(market: HybridMarketPrediction): string {
  return market.market === 'TOTAL_GOALS' ? `TOTAL_GOALS:${market.line}` : market.market;
}

function outcomeForMarket(
  market: HybridMarketPrediction,
  homeGoals: number,
  awayGoals: number,
): string {
  if (market.market === 'HDA') {
    return homeGoals > awayGoals ? 'HOME' : homeGoals < awayGoals ? 'AWAY' : 'DRAW';
  }
  if (market.market === 'BTTS') return homeGoals > 0 && awayGoals > 0 ? 'YES' : 'NO';
  const line = market.line;
  if (line == null) throw new Error('TOTAL_GOALS market is missing its line.');
  const total = homeGoals + awayGoals;
  return total < line ? 'BELOW' : total > line ? 'ABOVE' : 'PUSH';
}

function groupKey(market: string, horizonMinutes: number, leagueId?: number | null): string {
  return `${leagueId == null ? 'GLOBAL' : `LEAGUE:${leagueId}`}:${market}:T-${horizonMinutes}`;
}

function buildObservations(input: {
  rows: readonly HybridModelArtifactRow[];
  outcomes: Map<number, FixtureOutcome>;
}): { observations: CalibrationObservation[]; missingOutcomeRows: number } {
  const observations: CalibrationObservation[] = [];
  let missingOutcomeRows = 0;
  for (const row of input.rows) {
    const outcome = input.outcomes.get(row.fixtureId);
    if (outcome?.homeGoals == null || outcome.awayGoals == null) {
      missingOutcomeRows += 1;
      continue;
    }
    for (const market of row.markets) {
      observations.push({
        fixtureId: row.fixtureId,
        leagueId: row.leagueId,
        horizonMinutes: row.horizonMinutes,
        kickoffAt: row.kickoffAt,
        marketKey: marketKey(market),
        probabilities: market.rawProbability,
        outcome: outcomeForMarket(market, outcome.homeGoals, outcome.awayGoals),
        componentDisagreement: market.componentDisagreement,
      });
    }
  }
  return { observations, missingOutcomeRows };
}

function fitCalibrators(input: {
  observations: CalibrationObservation[];
  split: Map<number, CalibrationSplit>;
  minimumGlobalSamples: number;
  minimumLeagueSamples: number;
  maximumLogLossRegression: number;
}): TemperatureCalibrator[] {
  const calibrationRows = input.observations
    .filter((row) => input.split.get(row.fixtureId) === 'CALIBRATION')
    .sort(
      (left, right) =>
        new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime() ||
        left.fixtureId - right.fixtureId,
    );
  const groups = new Map<string, CalibrationObservation[]>();
  for (const row of calibrationRows) {
    for (const key of [
      groupKey(row.marketKey, row.horizonMinutes),
      groupKey(row.marketKey, row.horizonMinutes, row.leagueId),
    ]) {
      const rows = groups.get(key) ?? [];
      rows.push(row);
      groups.set(key, rows);
    }
  }
  const calibrators: TemperatureCalibrator[] = [];
  for (const rows of groups.values()) {
    const first = rows[0]!;
    const isLeague = rows.every((row) => row.leagueId === first.leagueId) &&
      groups.has(groupKey(first.marketKey, first.horizonMinutes));
    calibrators.push(
      fitTemperatureCalibrator({
        observations: rows,
        scope: isLeague ? 'LEAGUE_MARKET_HORIZON' : 'MARKET_HORIZON',
        marketKey: first.marketKey,
        horizonMinutes: first.horizonMinutes,
        leagueId: isLeague ? first.leagueId : null,
        minimumSamples: isLeague ? input.minimumLeagueSamples : input.minimumGlobalSamples,
        maximumLogLossRegression: input.maximumLogLossRegression,
      }),
    );
  }
  return calibrators.sort(
    (left, right) =>
      left.marketKey.localeCompare(right.marketKey) ||
      right.horizonMinutes - left.horizonMinutes ||
      (left.leagueId ?? -1) - (right.leagueId ?? -1),
  );
}

function selectCalibrator(
  calibrators: Map<string, TemperatureCalibrator>,
  observation: CalibrationObservation,
): TemperatureCalibrator {
  const league = calibrators.get(
    groupKey(observation.marketKey, observation.horizonMinutes, observation.leagueId),
  );
  if (league?.accepted) return league;
  const global = calibrators.get(groupKey(observation.marketKey, observation.horizonMinutes));
  if (!global) {
    throw new Error(
      `Missing global calibrator for ${observation.marketKey} at T-${observation.horizonMinutes}.`,
    );
  }
  return global;
}

function finiteNormalized(probabilities: Record<string, number>): boolean {
  const values = Object.values(probabilities);
  return (
    values.length > 0 &&
    values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= 1e-10
  );
}

function gitHead(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export async function loadCalibrationRuntime(): Promise<CalibrationRuntimeResult> {
  const config = configuration();
  const stage4 = await loadHybridModelRuntime();
  const emptyMetrics = probabilityMetrics([]);
  const blocked = (status: CalibrationReadiness): CalibrationRuntimeResult => ({
    version: CALIBRATION_UNCERTAINTY_VERSION,
    status,
    rows: [],
    calibrators: [],
    stage4DatasetFingerprint: stage4.datasetFingerprint,
    datasetFingerprint: sha256(''),
    fixtures: 0,
    labelledRows: 0,
    splitFixtures: { TRAIN: 0, CALIBRATION: 0, TEST: 0 },
    splitRows: { TRAIN: 0, CALIBRATION: 0, TEST: 0 },
    missingOutcomeRows: 0,
    temporalLeakageViolations: 0,
    normalizationViolations: 0,
    acceptedCalibrators: 0,
    identityCalibrators: 0,
    rawTestMetrics: emptyMetrics,
    calibratedTestMetrics: emptyMetrics,
    logLossRegression: null,
    eceImprovement: null,
    configuration: config,
  });
  if (stage4.status !== 'READY_FOR_CALIBRATION') return blocked('BLOCKED_STAGE4');

  const fixtureIds = [...new Set(stage4.rows.map((row) => row.fixtureId))];
  const fixtures = (await prisma.fixture.findMany({
    where: { id: { in: fixtureIds } },
    select: { id: true, kickoffAt: true, homeGoals: true, awayGoals: true },
  })) as FixtureOutcome[];
  const outcomeMap = new Map(fixtures.map((row) => [row.id, row]));
  const { observations, missingOutcomeRows } = buildObservations({
    rows: stage4.rows,
    outcomes: outcomeMap,
  });
  const split = temporalFixtureSplit({
    fixtures: stage4.rows.map((row) => ({ fixtureId: row.fixtureId, kickoffAt: row.kickoffAt })),
  });
  const splitFixtures = { TRAIN: 0, CALIBRATION: 0, TEST: 0 } satisfies Record<
    CalibrationSplit,
    number
  >;
  for (const value of split.values()) splitFixtures[value] += 1;
  if (Object.values(splitFixtures).some((value) => value === 0)) return blocked('BLOCKED_TEMPORAL_SPLIT');

  const calibrators = fitCalibrators({
    observations,
    split,
    minimumGlobalSamples: config.minimumGlobalSamples,
    minimumLeagueSamples: config.minimumLeagueSamples,
    maximumLogLossRegression: config.maximumLogLossRegression,
  });
  const calibratorMap = new Map(
    calibrators.map((row) => [groupKey(row.marketKey, row.horizonMinutes, row.leagueId), row]),
  );
  const observationsByRow = new Map<string, CalibrationObservation>();
  for (const observation of observations) {
    observationsByRow.set(
      `${observation.fixtureId}:${observation.horizonMinutes}:${observation.marketKey}`,
      observation,
    );
  }
  let temporalLeakageViolations = 0;
  let normalizationViolations = 0;
  const rows: CalibratedFixturePrediction[] = [];
  for (const row of stage4.rows) {
    const rowSplit = split.get(row.fixtureId)!;
    const markets: CalibratedMarketPrediction[] = [];
    for (const market of row.markets) {
      const key = marketKey(market);
      const observation = observationsByRow.get(`${row.fixtureId}:${row.horizonMinutes}:${key}`);
      if (!observation) continue;
      const calibrator = selectCalibrator(calibratorMap, observation);
      if (rowSplit === 'TEST' && new Date(calibrator.trainedThrough).getTime() >= new Date(row.kickoffAt).getTime()) {
        temporalLeakageViolations += 1;
      }
      const calibratedProbability = applyTemperature(
        observation.probabilities,
        calibrator.temperature,
      );
      if (!finiteNormalized(calibratedProbability)) normalizationViolations += 1;
      const calibrationEce = calibrator.calibratedCalibrationMetrics.ece ?? 0.25;
      const reliability = Math.max(0, Math.min(1, 1 - calibrationEce));
      const outOfDistributionReasons: string[] = [];
      if (calibrator.scope !== 'LEAGUE_MARKET_HORIZON') {
        outOfDistributionReasons.push('LEAGUE_CALIBRATOR_SAMPLE_GUARD');
      }
      if (!calibrator.accepted) outOfDistributionReasons.push(calibrator.rejectionReason!);
      if (market.fallbackReason.length > 0) outOfDistributionReasons.push(...market.fallbackReason);
      const uncertaintyPenalty = Math.max(
        0,
        Math.min(
          0.75,
          market.componentDisagreement * 2.5 +
            (1 - reliability) * 0.5 +
            (outOfDistributionReasons.length > 0 ? 0.05 : 0),
        ),
      );
      markets.push({
        marketKey: key,
        rawProbability: observation.probabilities,
        calibratedProbability,
        outcome: observation.outcome,
        calibratorHash: calibrator.artifactHash,
        calibrationScope: calibrator.scope,
        reliability,
        uncertainty: Math.min(1, market.componentDisagreement + calibrationEce),
        uncertaintyPenalty,
        outOfDistribution: outOfDistributionReasons.length > 0,
        outOfDistributionReasons: [...new Set(outOfDistributionReasons)],
        componentDisagreement: market.componentDisagreement,
      });
    }
    if (markets.length === 0) continue;
    const content = {
      fixtureId: row.fixtureId,
      leagueId: row.leagueId,
      horizonMinutes: row.horizonMinutes,
      predictionAsOf: row.predictionAsOf,
      kickoffAt: row.kickoffAt,
      split: rowSplit,
      markets,
      stage4RowHash: row.rowHash,
    };
    rows.push({ ...content, rowHash: sha256(stableStringify(content)) });
  }
  const splitRows = { TRAIN: 0, CALIBRATION: 0, TEST: 0 } satisfies Record<
    CalibrationSplit,
    number
  >;
  for (const row of rows) splitRows[row.split] += 1;
  const testRaw: CalibrationObservation[] = [];
  const testCalibrated: CalibrationObservation[] = [];
  for (const row of rows.filter((candidate) => candidate.split === 'TEST')) {
    for (const market of row.markets) {
      const base = {
        fixtureId: row.fixtureId,
        leagueId: row.leagueId,
        horizonMinutes: row.horizonMinutes,
        kickoffAt: row.kickoffAt,
        marketKey: market.marketKey,
        outcome: market.outcome,
        componentDisagreement: market.componentDisagreement,
      };
      testRaw.push({ ...base, probabilities: market.rawProbability });
      testCalibrated.push({ ...base, probabilities: market.calibratedProbability });
    }
  }
  const rawTestMetrics = probabilityMetrics(testRaw);
  const calibratedTestMetrics = probabilityMetrics(testCalibrated);
  const logLossRegression =
    calibratedTestMetrics.logLoss != null && rawTestMetrics.logLoss != null
      ? calibratedTestMetrics.logLoss - rawTestMetrics.logLoss
      : null;
  const eceImprovement =
    calibratedTestMetrics.ece != null && rawTestMetrics.ece != null
      ? rawTestMetrics.ece - calibratedTestMetrics.ece
      : null;
  const datasetFingerprint = sha256(
    stableStringify({
      stage4: stage4.datasetFingerprint,
      calibrators: calibrators.map((row) => row.artifactHash),
      rows: rows.map((row) => row.rowHash),
    }),
  );
  const status: CalibrationReadiness =
    temporalLeakageViolations === 0 && normalizationViolations === 0
      ? 'READY_FOR_DECISION_ENGINE'
      : 'BLOCKED_CALIBRATION_INTEGRITY';
  return {
    version: CALIBRATION_UNCERTAINTY_VERSION,
    status,
    rows,
    calibrators,
    stage4DatasetFingerprint: stage4.datasetFingerprint,
    datasetFingerprint,
    fixtures: split.size,
    labelledRows: rows.length,
    splitFixtures,
    splitRows,
    missingOutcomeRows,
    temporalLeakageViolations,
    normalizationViolations,
    acceptedCalibrators: calibrators.filter((row) => row.accepted).length,
    identityCalibrators: calibrators.filter((row) => !row.accepted).length,
    rawTestMetrics,
    calibratedTestMetrics,
    logLossRegression,
    eceImprovement,
    configuration: config,
  };
}

export function calibrationSummary(runtime: CalibrationRuntimeResult): Record<string, unknown> {
  return {
    version: runtime.version,
    status: runtime.status,
    fixtures: runtime.fixtures,
    labelledRows: runtime.labelledRows,
    splitFixtures: runtime.splitFixtures,
    splitRows: runtime.splitRows,
    missingOutcomeRows: runtime.missingOutcomeRows,
    calibrators: runtime.calibrators.length,
    acceptedCalibrators: runtime.acceptedCalibrators,
    identityCalibrators: runtime.identityCalibrators,
    temporalLeakageViolations: runtime.temporalLeakageViolations,
    normalizationViolations: runtime.normalizationViolations,
    rawTestMetrics: runtime.rawTestMetrics,
    calibratedTestMetrics: runtime.calibratedTestMetrics,
    logLossRegression: runtime.logLossRegression,
    eceImprovement: runtime.eceImprovement,
    stage4DatasetFingerprint: runtime.stage4DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    configuration: runtime.configuration,
    splitPolicy: 'CHRONOLOGICAL_FIXTURE_LEVEL_TRAIN_60_CALIBRATION_20_TEST_20',
    apiCalled: false,
    schemaChanged: false,
    currentChampionChanged: false,
  };
}

export async function writeCalibrationArtifacts(): Promise<CalibrationArtifactResult> {
  const runtime = await loadCalibrationRuntime();
  if (runtime.status !== 'READY_FOR_DECISION_ENGINE') {
    throw new Error(`Stage 5 artifact export blocked: ${runtime.status}.`);
  }
  const root = repositoryRoot();
  const generatedAt = new Date();
  const runKey = `${generatedAt.toISOString().replace(/[-:.]/g, '')}-${runtime.datasetFingerprint.slice(0, 12)}`;
  const directory = resolve(runtime.configuration.artifactDirectory, runKey);
  mkdirSync(directory, { recursive: true });
  const calibratorsContent = JSON.stringify(runtime.calibrators, null, 2) + '\n';
  const calibratorsPath = resolve(directory, 'calibrators.json');
  writeFileSync(calibratorsPath, calibratorsContent, 'utf8');
  const predictionsContent = runtime.rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const predictionsPath = resolve(directory, 'calibrated-predictions.jsonl');
  writeFileSync(predictionsPath, predictionsContent, 'utf8');
  const manifest = {
    version: runtime.version,
    generatedAt: generatedAt.toISOString(),
    gitHead: gitHead(root),
    status: runtime.status,
    stage4DatasetFingerprint: runtime.stage4DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    splitPolicy: 'CHRONOLOGICAL_FIXTURE_LEVEL_TRAIN_60_CALIBRATION_20_TEST_20',
    summary: calibrationSummary(runtime),
    configuration: {
      ...runtime.configuration,
      artifactDirectory: relative(root, runtime.configuration.artifactDirectory).replaceAll('\\', '/'),
    },
    files: {
      calibrators: 'calibrators.json',
      predictions: 'calibrated-predictions.jsonl',
      hashes: 'sha256.json',
    },
    safety: {
      pointInTime: true,
      apiCalled: false,
      schemaChanged: false,
      currentChampionChanged: false,
    },
  };
  const manifestContent = JSON.stringify(manifest, null, 2) + '\n';
  const manifestPath = resolve(directory, 'manifest.json');
  writeFileSync(manifestPath, manifestContent, 'utf8');
  const hashes = {
    'manifest.json': sha256(manifestContent),
    'calibrators.json': sha256(calibratorsContent),
    'calibrated-predictions.jsonl': sha256(predictionsContent),
  };
  const hashesPath = resolve(directory, 'sha256.json');
  writeFileSync(hashesPath, JSON.stringify(hashes, null, 2) + '\n', 'utf8');
  return { directory, manifestPath, calibratorsPath, predictionsPath, hashesPath, runtime };
}
