import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { FixtureStatus, prisma } from '@football-ai/database';
import {
  BAYESIAN_TEAM_STRENGTH_SEED,
  BAYESIAN_TEAM_STRENGTH_VERSION,
  bayesianTeamStrengthPredictionHash,
  fitBayesianHierarchicalTeamStrength,
  type BayesianTeamStrengthPrediction,
  type BayesianTrainingMatch,
} from './bayesian-team-strength-contract.js';
import {
  sha256,
  stableStringify,
} from './hybrid-data-foundation-contract.js';
import { loadHybridDataFoundation } from './hybrid-data-foundation-engine.js';

export const BAYESIAN_TEAM_STRENGTH_AVAILABILITY_POLICY =
  'KICKOFF_PLUS_CONFIGURED_RESULT_LAG_STRICTLY_BEFORE_PREDICTION';

export type BayesianTeamStrengthReadiness =
  | 'READY_FOR_PREDICTIVE_MARKETS'
  | 'BLOCKED_STAGE1'
  | 'BLOCKED_LEAKAGE_OR_NON_FINITE';

interface TargetFixtureRow {
  id: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
}

interface HistoricalFixtureRow extends TargetFixtureRow {
  homeGoals: number | null;
  awayGoals: number | null;
}

interface DixonComparisonRow {
  id: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  trainedThrough: Date;
  predictionAsOf: Date;
}

export interface BayesianTeamStrengthArtifactRow {
  fixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  horizonMinutes: number;
  predictionAsOf: string;
  kickoffAt: string;
  trainedFrom: string | null;
  trainedThrough: string | null;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  homeAttackPosterior: number;
  homeDefencePosterior: number;
  awayAttackPosterior: number;
  awayDefencePosterior: number;
  homeAdvantagePosterior: number;
  posteriorUncertainty: number;
  prediction: Omit<
    BayesianTeamStrengthPrediction,
    'predictionAsOf' | 'trainedFrom' | 'trainedThrough'
  > & {
    predictionAsOf: string;
    trainedFrom: string | null;
    trainedThrough: string | null;
  };
  comparison: {
    dixonSnapshotId: number | null;
    dixonHomeExpectedGoals: number | null;
    dixonAwayExpectedGoals: number | null;
    homeExpectedGoalsDelta: number | null;
    awayExpectedGoalsDelta: number | null;
  };
  lineage: {
    stage1RowId: number;
    stage1PayloadHash: string;
    stage1DatasetFingerprint: string;
    sourceDixonSnapshotId: number | null;
    availabilityPolicy: string;
  };
  rowHash: string;
}

export interface BayesianTeamStrengthRuntimeResult {
  version: string;
  status: BayesianTeamStrengthReadiness;
  generatedRows: number;
  finiteRows: number;
  priorOnlyRows: number;
  leakageViolations: number;
  missingFixtureRows: number;
  missingDixonComparisons: number;
  meanAbsoluteHomeXgDeltaVsDixon: number | null;
  meanAbsoluteAwayXgDeltaVsDixon: number | null;
  datasetFingerprint: string;
  stage1DatasetFingerprint: string;
  rows: BayesianTeamStrengthArtifactRow[];
  configuration: {
    seed: number;
    halfLifeDays: number;
    globalPriorMatches: number;
    teamPriorStrength: number;
    resultAvailabilityLagMinutes: number;
    artifactDirectory: string;
  };
}

export interface BayesianTeamStrengthArtifactResult {
  directory: string;
  manifestPath: string;
  predictionsPath: string;
  hashesPath: string;
  runtime: BayesianTeamStrengthRuntimeResult;
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
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

function configuration() {
  const root = repositoryRoot();
  return {
    seed: Math.trunc(envNumber('BAYESIAN_TEAM_STRENGTH_SEED', BAYESIAN_TEAM_STRENGTH_SEED)),
    halfLifeDays: Math.max(1, envNumber('BAYESIAN_TEAM_STRENGTH_HALF_LIFE_DAYS', 240)),
    globalPriorMatches: Math.max(
      0.1,
      envNumber('BAYESIAN_TEAM_STRENGTH_GLOBAL_PRIOR_MATCHES', 8),
    ),
    teamPriorStrength: Math.max(
      0.1,
      envNumber('BAYESIAN_TEAM_STRENGTH_TEAM_PRIOR_STRENGTH', 6),
    ),
    resultAvailabilityLagMinutes: Math.max(
      0,
      envNumber('RESULT_AVAILABILITY_LAG_MINUTES', 180),
    ),
    artifactDirectory: resolve(
      root,
      process.env.BAYESIAN_TEAM_STRENGTH_ARTIFACT_DIRECTORY ??
        'artifacts/hybrid/v8-stage2-bayesian-team-strength',
    ),
  };
}

function finitePrediction(prediction: BayesianTeamStrengthPrediction): boolean {
  const values = [
    prediction.expectedHomeGoals,
    prediction.expectedAwayGoals,
    prediction.homeAttackPosterior,
    prediction.homeDefencePosterior,
    prediction.awayAttackPosterior,
    prediction.awayDefencePosterior,
    prediction.homeAdvantagePosterior,
    prediction.posteriorUncertainty,
    prediction.leaguePrior.homeGoalRate,
    prediction.leaguePrior.awayGoalRate,
  ];
  return values.every(Number.isFinite) && values.slice(0, 2).every((value) => value > 0);
}

function isoPrediction(prediction: BayesianTeamStrengthPrediction) {
  return {
    ...prediction,
    predictionAsOf: prediction.predictionAsOf.toISOString(),
    trainedFrom: prediction.trainedFrom?.toISOString() ?? null,
    trainedThrough: prediction.trainedThrough?.toISOString() ?? null,
  };
}

function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function gitHead(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

export async function loadBayesianTeamStrengthRuntime(): Promise<BayesianTeamStrengthRuntimeResult> {
  const config = configuration();
  const stage1 = await loadHybridDataFoundation();
  if (stage1.audit.status !== 'READY_FOR_BAYESIAN') {
    return {
      version: BAYESIAN_TEAM_STRENGTH_VERSION,
      status: 'BLOCKED_STAGE1',
      generatedRows: 0,
      finiteRows: 0,
      priorOnlyRows: 0,
      leakageViolations: 0,
      missingFixtureRows: stage1.audit.safeRows,
      missingDixonComparisons: 0,
      meanAbsoluteHomeXgDeltaVsDixon: null,
      meanAbsoluteAwayXgDeltaVsDixon: null,
      datasetFingerprint: sha256(''),
      stage1DatasetFingerprint: stage1.audit.datasetFingerprint,
      rows: [],
      configuration: config,
    };
  }

  const fixtureIds = [...new Set(stage1.rows.map((row) => row.fixtureId))];
  const targetFixtures = (await prisma.fixture.findMany({
    where: { id: { in: fixtureIds } },
    select: {
      id: true,
      leagueId: true,
      homeTeamId: true,
      awayTeamId: true,
      kickoffAt: true,
    },
  })) as TargetFixtureRow[];
  const targetMap = new Map(targetFixtures.map((row) => [row.id, row]));
  const leagueIds = [...new Set(targetFixtures.map((row) => row.leagueId))];
  const maximumPredictionAsOf = new Date(
    Math.max(...stage1.rows.map((row) => row.predictionAsOf.getTime())),
  );
  const historyRows = (await prisma.fixture.findMany({
    where: {
      leagueId: { in: leagueIds },
      status: FixtureStatus.FINISHED,
      kickoffAt: { lt: maximumPredictionAsOf },
      homeGoals: { not: null },
      awayGoals: { not: null },
    },
    select: {
      id: true,
      leagueId: true,
      homeTeamId: true,
      awayTeamId: true,
      kickoffAt: true,
      homeGoals: true,
      awayGoals: true,
    },
    orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
  })) as HistoricalFixtureRow[];

  const historyByLeague = new Map<number, BayesianTrainingMatch[]>();
  for (const row of historyRows) {
    if (row.homeGoals == null || row.awayGoals == null) continue;
    const rows = historyByLeague.get(row.leagueId) ?? [];
    rows.push({
      fixtureId: row.id,
      leagueId: row.leagueId,
      kickoffAt: row.kickoffAt,
      availableAt: new Date(
        row.kickoffAt.getTime() + config.resultAvailabilityLagMinutes * 60_000,
      ),
      homeTeamId: row.homeTeamId,
      awayTeamId: row.awayTeamId,
      homeGoals: row.homeGoals,
      awayGoals: row.awayGoals,
    });
    historyByLeague.set(row.leagueId, rows);
  }

  const dixonIds = [
    ...new Set(
      stage1.rows
        .map((row) => row.source.dixonSnapshotId)
        .filter((value): value is number => value != null),
    ),
  ];
  const dixonRows = dixonIds.length
    ? ((await prisma.dixonColesPredictionSnapshot.findMany({
        where: { id: { in: dixonIds } },
        select: {
          id: true,
          homeExpectedGoals: true,
          awayExpectedGoals: true,
          trainedThrough: true,
          predictionAsOf: true,
        },
      })) as DixonComparisonRow[])
    : [];
  const dixonMap = new Map(dixonRows.map((row) => [row.id, row]));

  let missingFixtureRows = 0;
  const rows: BayesianTeamStrengthArtifactRow[] = [];
  for (const stage1Row of [...stage1.rows].sort(
    (left, right) =>
      left.predictionAsOf.getTime() - right.predictionAsOf.getTime() ||
      left.fixtureId - right.fixtureId ||
      right.horizonMinutes - left.horizonMinutes,
  )) {
    const fixture = targetMap.get(stage1Row.fixtureId);
    if (!fixture) {
      missingFixtureRows += 1;
      continue;
    }
    const prediction = fitBayesianHierarchicalTeamStrength({
      fixtureId: fixture.id,
      leagueId: fixture.leagueId,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      predictionAsOf: stage1Row.predictionAsOf,
      matches: historyByLeague.get(fixture.leagueId) ?? [],
      datasetFingerprint: stage1.audit.datasetFingerprint,
      options: {
        seed: config.seed,
        halfLifeDays: config.halfLifeDays,
        globalPriorMatches: config.globalPriorMatches,
        teamPriorStrength: config.teamPriorStrength,
      },
    });
    const dixonId = stage1Row.source.dixonSnapshotId;
    const dixon = dixonId == null ? undefined : dixonMap.get(dixonId);
    const serializedPrediction = isoPrediction(prediction);
    const content = {
      fixtureId: fixture.id,
      leagueId: fixture.leagueId,
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      horizonMinutes: stage1Row.horizonMinutes,
      predictionAsOf: stage1Row.predictionAsOf.toISOString(),
      kickoffAt: stage1Row.kickoffAt.toISOString(),
      trainedFrom: prediction.trainedFrom?.toISOString() ?? null,
      trainedThrough: prediction.trainedThrough?.toISOString() ?? null,
      expectedHomeGoals: prediction.expectedHomeGoals,
      expectedAwayGoals: prediction.expectedAwayGoals,
      homeAttackPosterior: prediction.homeAttackPosterior,
      homeDefencePosterior: prediction.homeDefencePosterior,
      awayAttackPosterior: prediction.awayAttackPosterior,
      awayDefencePosterior: prediction.awayDefencePosterior,
      homeAdvantagePosterior: prediction.homeAdvantagePosterior,
      posteriorUncertainty: prediction.posteriorUncertainty,
      prediction: serializedPrediction,
      comparison: {
        dixonSnapshotId: dixonId,
        dixonHomeExpectedGoals: dixon?.homeExpectedGoals ?? null,
        dixonAwayExpectedGoals: dixon?.awayExpectedGoals ?? null,
        homeExpectedGoalsDelta:
          dixon == null ? null : prediction.expectedHomeGoals - dixon.homeExpectedGoals,
        awayExpectedGoalsDelta:
          dixon == null ? null : prediction.expectedAwayGoals - dixon.awayExpectedGoals,
      },
      lineage: {
        stage1RowId: stage1Row.id,
        stage1PayloadHash: stage1Row.payloadHash,
        stage1DatasetFingerprint: stage1.audit.datasetFingerprint,
        sourceDixonSnapshotId: dixonId,
        availabilityPolicy: BAYESIAN_TEAM_STRENGTH_AVAILABILITY_POLICY,
      },
    };
    rows.push({
      ...content,
      rowHash: sha256(
        stableStringify({
          content,
          predictionHash: bayesianTeamStrengthPredictionHash(prediction),
        }),
      ),
    });
  }

  const finiteRows = rows.filter((row) =>
    finitePrediction({
      ...row.prediction,
      predictionAsOf: new Date(row.prediction.predictionAsOf),
      trainedFrom:
        row.prediction.trainedFrom == null ? null : new Date(row.prediction.trainedFrom),
      trainedThrough:
        row.prediction.trainedThrough == null ? null : new Date(row.prediction.trainedThrough),
    }),
  ).length;
  const leakageViolations = rows.filter(
    (row) =>
      row.trainedThrough != null &&
      new Date(row.trainedThrough).getTime() >= new Date(row.predictionAsOf).getTime(),
  ).length;
  const priorOnlyRows = rows.filter((row) => row.prediction.priorOnly).length;
  const homeDeltas = rows
    .map((row) => row.comparison.homeExpectedGoalsDelta)
    .filter((value): value is number => value != null)
    .map(Math.abs);
  const awayDeltas = rows
    .map((row) => row.comparison.awayExpectedGoalsDelta)
    .filter((value): value is number => value != null)
    .map(Math.abs);
  const datasetFingerprint = sha256(
    stableStringify(rows.map((row) => ({ rowHash: row.rowHash }))),
  );
  const status: BayesianTeamStrengthReadiness =
    finiteRows === rows.length && leakageViolations === 0 && missingFixtureRows === 0
      ? 'READY_FOR_PREDICTIVE_MARKETS'
      : 'BLOCKED_LEAKAGE_OR_NON_FINITE';

  return {
    version: BAYESIAN_TEAM_STRENGTH_VERSION,
    status,
    generatedRows: rows.length,
    finiteRows,
    priorOnlyRows,
    leakageViolations,
    missingFixtureRows,
    missingDixonComparisons: rows.filter(
      (row) => row.comparison.dixonSnapshotId == null || row.comparison.dixonHomeExpectedGoals == null,
    ).length,
    meanAbsoluteHomeXgDeltaVsDixon: mean(homeDeltas),
    meanAbsoluteAwayXgDeltaVsDixon: mean(awayDeltas),
    datasetFingerprint,
    stage1DatasetFingerprint: stage1.audit.datasetFingerprint,
    rows,
    configuration: config,
  };
}

export function bayesianTeamStrengthSummary(
  runtime: BayesianTeamStrengthRuntimeResult,
): Record<string, unknown> {
  return {
    version: runtime.version,
    status: runtime.status,
    generatedRows: runtime.generatedRows,
    finiteRows: runtime.finiteRows,
    priorOnlyRows: runtime.priorOnlyRows,
    leakageViolations: runtime.leakageViolations,
    missingFixtureRows: runtime.missingFixtureRows,
    missingDixonComparisons: runtime.missingDixonComparisons,
    meanAbsoluteHomeXgDeltaVsDixon: runtime.meanAbsoluteHomeXgDeltaVsDixon,
    meanAbsoluteAwayXgDeltaVsDixon: runtime.meanAbsoluteAwayXgDeltaVsDixon,
    datasetFingerprint: runtime.datasetFingerprint,
    stage1DatasetFingerprint: runtime.stage1DatasetFingerprint,
    configuration: runtime.configuration,
    seed: runtime.configuration.seed,
    inferenceMethod: 'CONJUGATE_GAMMA_POISSON_EMPIRICAL_BAYES',
    apiCalled: false,
    schemaChanged: false,
    currentChampionChanged: false,
  };
}

export async function writeBayesianTeamStrengthArtifacts(): Promise<BayesianTeamStrengthArtifactResult> {
  const runtime = await loadBayesianTeamStrengthRuntime();
  if (runtime.status !== 'READY_FOR_PREDICTIVE_MARKETS') {
    throw new Error(`Stage 2 artifact export blocked: ${runtime.status}.`);
  }
  const root = repositoryRoot();
  const generatedAt = new Date();
  const runKey = `${generatedAt.toISOString().replace(/[-:.]/g, '')}-${runtime.datasetFingerprint.slice(0, 12)}`;
  const directory = resolve(runtime.configuration.artifactDirectory, runKey);
  mkdirSync(directory, { recursive: true });

  const predictionsContent = runtime.rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const predictionsPath = resolve(directory, 'team-strength-predictions.jsonl');
  writeFileSync(predictionsPath, predictionsContent, 'utf8');

  const manifest = {
    version: runtime.version,
    generatedAt: generatedAt.toISOString(),
    gitHead: gitHead(root),
    status: runtime.status,
    stage1DatasetFingerprint: runtime.stage1DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    availabilityPolicy: BAYESIAN_TEAM_STRENGTH_AVAILABILITY_POLICY,
    configuration: {
      ...runtime.configuration,
      artifactDirectory: relative(root, runtime.configuration.artifactDirectory).replaceAll('\\', '/'),
    },
    summary: {
      generatedRows: runtime.generatedRows,
      finiteRows: runtime.finiteRows,
      priorOnlyRows: runtime.priorOnlyRows,
      leakageViolations: runtime.leakageViolations,
      missingFixtureRows: runtime.missingFixtureRows,
      missingDixonComparisons: runtime.missingDixonComparisons,
      meanAbsoluteHomeXgDeltaVsDixon: runtime.meanAbsoluteHomeXgDeltaVsDixon,
      meanAbsoluteAwayXgDeltaVsDixon: runtime.meanAbsoluteAwayXgDeltaVsDixon,
    },
    files: {
      predictions: 'team-strength-predictions.jsonl',
      hashes: 'sha256.json',
    },
    safety: {
      strictPit: true,
      deterministic: true,
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
    'team-strength-predictions.jsonl': sha256(predictionsContent),
  };
  const hashesPath = resolve(directory, 'sha256.json');
  writeFileSync(hashesPath, JSON.stringify(hashes, null, 2) + '\n', 'utf8');
  return { directory, manifestPath, predictionsPath, hashesPath, runtime };
}
