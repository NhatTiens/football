import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  BAYESIAN_PREDICTIVE_MARKETS_VERSION,
  bayesianPredictiveMarketsHash,
  buildBayesianPredictiveMarkets,
  type BayesianPredictiveMarkets,
} from './bayesian-predictive-markets-contract.js';
import {
  loadBayesianTeamStrengthRuntime,
  type BayesianTeamStrengthArtifactRow,
} from './bayesian-team-strength-engine.js';
import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';

export type BayesianPredictiveMarketsReadiness =
  | 'READY_FOR_HYBRID_MODEL'
  | 'BLOCKED_STAGE2'
  | 'BLOCKED_MARKET_IDENTITIES';

export interface BayesianPredictiveMarketsArtifactRow {
  fixtureId: number;
  leagueId: number;
  horizonMinutes: number;
  predictionAsOf: string;
  kickoffAt: string;
  markets: Omit<BayesianPredictiveMarkets, 'predictionAsOf'> & { predictionAsOf: string };
  lineage: {
    stage1DatasetFingerprint: string;
    stage2DatasetFingerprint: string;
    stage2RowHash: string;
    stage2ModelVersion: string;
  };
  rowHash: string;
}

export interface BayesianPredictiveMarketsRuntimeResult {
  version: string;
  status: BayesianPredictiveMarketsReadiness;
  rows: BayesianPredictiveMarketsArtifactRow[];
  generatedRows: number;
  finiteRows: number;
  normalizationViolations: number;
  integerPushViolations: number;
  maximumIdentityError: number;
  stage1DatasetFingerprint: string;
  stage2DatasetFingerprint: string;
  datasetFingerprint: string;
  configuration: {
    maximumGoals: number;
    artifactDirectory: string;
  };
}

export interface BayesianPredictiveMarketsArtifactResult {
  directory: string;
  manifestPath: string;
  predictionsPath: string;
  hashesPath: string;
  runtime: BayesianPredictiveMarketsRuntimeResult;
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
    maximumGoals: Math.max(
      7,
      Math.min(16, Math.trunc(envNumber('BAYESIAN_PREDICTIVE_MAXIMUM_GOALS', 12))),
    ),
    artifactDirectory: resolve(
      root,
      process.env.BAYESIAN_PREDICTIVE_ARTIFACT_DIRECTORY ??
        'artifacts/hybrid/v8-stage3-bayesian-predictive-markets',
    ),
  };
}

function finiteMarket(markets: BayesianPredictiveMarkets): boolean {
  const values = [
    markets.expectedHomeGoals,
    markets.expectedAwayGoals,
    ...markets.homeGoalDistribution,
    ...markets.awayGoalDistribution,
    ...markets.scoreMatrix.flat(),
    markets.hda.HOME,
    markets.hda.DRAW,
    markets.hda.AWAY,
    markets.btts.YES,
    markets.btts.NO,
    ...markets.totalGoals.flatMap((row) => [
      row.OVER.WIN,
      row.OVER.PUSH,
      row.OVER.LOSS,
      row.UNDER.WIN,
      row.UNDER.PUSH,
      row.UNDER.LOSS,
    ]),
  ];
  return values.every(Number.isFinite);
}

function identityErrors(markets: BayesianPredictiveMarkets): number[] {
  return [
    Math.abs(markets.hda.HOME + markets.hda.DRAW + markets.hda.AWAY - 1),
    Math.abs(markets.btts.YES + markets.btts.NO - 1),
    Math.abs(markets.homeGoalDistribution.reduce((sum, value) => sum + value, 0) - 1),
    Math.abs(markets.awayGoalDistribution.reduce((sum, value) => sum + value, 0) - 1),
    Math.abs(markets.scoreMatrix.flat().reduce((sum, value) => sum + value, 0) - 1),
    ...markets.totalGoals.flatMap((row) => [
      Math.abs(row.OVER.WIN + row.OVER.PUSH + row.OVER.LOSS - 1),
      Math.abs(row.UNDER.WIN + row.UNDER.PUSH + row.UNDER.LOSS - 1),
    ]),
  ];
}

function gitHead(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function serializeMarkets(markets: BayesianPredictiveMarkets) {
  return { ...markets, predictionAsOf: markets.predictionAsOf.toISOString() };
}

function buildRow(input: {
  stage2Row: BayesianTeamStrengthArtifactRow;
  stage1DatasetFingerprint: string;
  stage2DatasetFingerprint: string;
  maximumGoals: number;
}): BayesianPredictiveMarketsArtifactRow {
  const stage2 = input.stage2Row;
  const markets = buildBayesianPredictiveMarkets({
    fixtureId: stage2.fixtureId,
    horizonMinutes: stage2.horizonMinutes,
    predictionAsOf: new Date(stage2.predictionAsOf),
    expectedHomeGoals: stage2.expectedHomeGoals,
    expectedAwayGoals: stage2.expectedAwayGoals,
    homeGoalsVarianceLog: stage2.prediction.expectedHomeGoalsInterval.varianceLog,
    awayGoalsVarianceLog: stage2.prediction.expectedAwayGoalsInterval.varianceLog,
    sourceTeamStrengthVersion: stage2.prediction.modelVersion,
    sourceTeamStrengthHash: stage2.rowHash,
    maximumGoals: input.maximumGoals,
  });
  const content = {
    fixtureId: stage2.fixtureId,
    leagueId: stage2.leagueId,
    horizonMinutes: stage2.horizonMinutes,
    predictionAsOf: stage2.predictionAsOf,
    kickoffAt: stage2.kickoffAt,
    markets: serializeMarkets(markets),
    lineage: {
      stage1DatasetFingerprint: input.stage1DatasetFingerprint,
      stage2DatasetFingerprint: input.stage2DatasetFingerprint,
      stage2RowHash: stage2.rowHash,
      stage2ModelVersion: stage2.prediction.modelVersion,
    },
  };
  return {
    ...content,
    rowHash: sha256(
      stableStringify({ content, marketsHash: bayesianPredictiveMarketsHash(markets) }),
    ),
  };
}

export async function loadBayesianPredictiveMarketsRuntime(): Promise<BayesianPredictiveMarketsRuntimeResult> {
  const config = configuration();
  const stage2 = await loadBayesianTeamStrengthRuntime();
  if (stage2.status !== 'READY_FOR_PREDICTIVE_MARKETS') {
    return {
      version: BAYESIAN_PREDICTIVE_MARKETS_VERSION,
      status: 'BLOCKED_STAGE2',
      rows: [],
      generatedRows: 0,
      finiteRows: 0,
      normalizationViolations: 0,
      integerPushViolations: 0,
      maximumIdentityError: 0,
      stage1DatasetFingerprint: stage2.stage1DatasetFingerprint,
      stage2DatasetFingerprint: stage2.datasetFingerprint,
      datasetFingerprint: sha256(''),
      configuration: config,
    };
  }

  const rows = stage2.rows.map((stage2Row) =>
    buildRow({
      stage2Row,
      stage1DatasetFingerprint: stage2.stage1DatasetFingerprint,
      stage2DatasetFingerprint: stage2.datasetFingerprint,
      maximumGoals: config.maximumGoals,
    }),
  );
  const finiteRows = rows.filter((row) =>
    finiteMarket({ ...row.markets, predictionAsOf: new Date(row.markets.predictionAsOf) }),
  ).length;
  const errors = rows.flatMap((row) =>
    identityErrors({ ...row.markets, predictionAsOf: new Date(row.markets.predictionAsOf) }),
  );
  const tolerance = 1e-10;
  const normalizationViolations = errors.filter((error) => error > tolerance).length;
  const integerPushViolations = rows.filter((row) =>
    row.markets.totalGoals
      .filter((market) => Number.isInteger(market.line))
      .some((market) => market.OVER.PUSH <= 0 || market.UNDER.PUSH <= 0),
  ).length;
  const maximumIdentityError = errors.length > 0 ? Math.max(...errors) : 0;
  const datasetFingerprint = sha256(
    stableStringify(rows.map((row) => ({ rowHash: row.rowHash }))),
  );
  const status: BayesianPredictiveMarketsReadiness =
    finiteRows === rows.length && normalizationViolations === 0 && integerPushViolations === 0
      ? 'READY_FOR_HYBRID_MODEL'
      : 'BLOCKED_MARKET_IDENTITIES';

  return {
    version: BAYESIAN_PREDICTIVE_MARKETS_VERSION,
    status,
    rows,
    generatedRows: rows.length,
    finiteRows,
    normalizationViolations,
    integerPushViolations,
    maximumIdentityError,
    stage1DatasetFingerprint: stage2.stage1DatasetFingerprint,
    stage2DatasetFingerprint: stage2.datasetFingerprint,
    datasetFingerprint,
    configuration: config,
  };
}

export function bayesianPredictiveMarketsSummary(
  runtime: BayesianPredictiveMarketsRuntimeResult,
): Record<string, unknown> {
  return {
    version: runtime.version,
    status: runtime.status,
    generatedRows: runtime.generatedRows,
    finiteRows: runtime.finiteRows,
    normalizationViolations: runtime.normalizationViolations,
    integerPushViolations: runtime.integerPushViolations,
    maximumIdentityError: runtime.maximumIdentityError,
    stage1DatasetFingerprint: runtime.stage1DatasetFingerprint,
    stage2DatasetFingerprint: runtime.stage2DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    configuration: runtime.configuration,
    apiCalled: false,
    schemaChanged: false,
    currentChampionChanged: false,
  };
}

export async function writeBayesianPredictiveMarketsArtifacts(): Promise<BayesianPredictiveMarketsArtifactResult> {
  const runtime = await loadBayesianPredictiveMarketsRuntime();
  if (runtime.status !== 'READY_FOR_HYBRID_MODEL') {
    throw new Error(`Stage 3 artifact export blocked: ${runtime.status}.`);
  }
  const root = repositoryRoot();
  const generatedAt = new Date();
  const runKey = `${generatedAt.toISOString().replace(/[-:.]/g, '')}-${runtime.datasetFingerprint.slice(0, 12)}`;
  const directory = resolve(runtime.configuration.artifactDirectory, runKey);
  mkdirSync(directory, { recursive: true });
  const predictionsContent = runtime.rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const predictionsPath = resolve(directory, 'predictive-markets.jsonl');
  writeFileSync(predictionsPath, predictionsContent, 'utf8');

  const manifest = {
    version: runtime.version,
    generatedAt: generatedAt.toISOString(),
    gitHead: gitHead(root),
    status: runtime.status,
    stage1DatasetFingerprint: runtime.stage1DatasetFingerprint,
    stage2DatasetFingerprint: runtime.stage2DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    configuration: {
      ...runtime.configuration,
      artifactDirectory: relative(root, runtime.configuration.artifactDirectory).replaceAll('\\', '/'),
    },
    summary: {
      generatedRows: runtime.generatedRows,
      finiteRows: runtime.finiteRows,
      normalizationViolations: runtime.normalizationViolations,
      integerPushViolations: runtime.integerPushViolations,
      maximumIdentityError: runtime.maximumIdentityError,
    },
    files: { predictions: 'predictive-markets.jsonl', hashes: 'sha256.json' },
    safety: {
      strictPitInherited: true,
      integerPushModeled: true,
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
    'predictive-markets.jsonl': sha256(predictionsContent),
  };
  const hashesPath = resolve(directory, 'sha256.json');
  writeFileSync(hashesPath, JSON.stringify(hashes, null, 2) + '\n', 'utf8');
  return { directory, manifestPath, predictionsPath, hashesPath, runtime };
}
