import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { prisma } from '@football-ai/database';
import {
  buildBayesianPredictiveMarkets,
  type BayesianPredictiveMarkets,
} from './bayesian-predictive-markets-contract.js';
import {
  loadBayesianPredictiveMarketsRuntime,
  type BayesianPredictiveMarketsArtifactRow,
} from './bayesian-predictive-markets-engine.js';
import { loadBayesianTeamStrengthRuntime } from './bayesian-team-strength-engine.js';
import {
  DEFAULT_HYBRID_WEIGHT_REGISTRY,
  HYBRID_MODEL_VERSION,
  buildHybridMarketPrediction,
  hybridMarketPredictionHash,
  type HybridMarketPrediction,
  type HybridModelComponent,
  type HybridWeightRegistry,
} from './hybrid-model-contract.js';
import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';

export type HybridModelReadiness =
  | 'READY_FOR_CALIBRATION'
  | 'BLOCKED_STAGE3'
  | 'BLOCKED_HYBRID_IDENTITIES';

interface DixonModelRow {
  id: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  over25Probability: number;
  bttsProbability: number;
  payloadHash: string;
}

interface MlModelRow {
  id: number;
  fixtureId: number;
  horizonMinutes: number;
  predictionAsOf: Date;
  trainedThrough: Date;
  modelVersion: string;
  finalHomeProbability: number;
  finalDrawProbability: number;
  finalAwayProbability: number;
  over25Probability: number;
  bttsProbability: number;
  payloadHash: string;
}

export interface HybridModelArtifactRow {
  fixtureId: number;
  leagueId: number;
  horizonMinutes: number;
  predictionAsOf: string;
  kickoffAt: string;
  markets: HybridMarketPrediction[];
  selectedModels: string[];
  fallbackReasons: string[];
  lineage: {
    stage1DatasetFingerprint: string;
    stage2DatasetFingerprint: string;
    stage3DatasetFingerprint: string;
    stage3RowHash: string;
    dixonSnapshotId: number | null;
    mlPredictionSnapshotId: number | null;
  };
  rowHash: string;
}

export interface HybridModelRuntimeResult {
  version: string;
  registryVersion: string;
  status: HybridModelReadiness;
  rows: HybridModelArtifactRow[];
  generatedRows: number;
  generatedMarkets: number;
  finiteRows: number;
  normalizationViolations: number;
  leakageViolations: number;
  dixonCoverageRows: number;
  mlCoverageRows: number;
  bayesianOnlyMarkets: number;
  weightedEnsembleMarkets: number;
  stage1DatasetFingerprint: string;
  stage2DatasetFingerprint: string;
  stage3DatasetFingerprint: string;
  registryFingerprint: string;
  datasetFingerprint: string;
  configuration: {
    artifactDirectory: string;
    registry: HybridWeightRegistry;
  };
}

export interface HybridModelArtifactResult {
  directory: string;
  manifestPath: string;
  predictionsPath: string;
  registryPath: string;
  hashesPath: string;
  runtime: HybridModelRuntimeResult;
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

function parseLeagueMultipliers(): HybridWeightRegistry['leagueMultipliers'] {
  const raw = process.env.HYBRID_MODEL_LEAGUE_MULTIPLIERS_JSON?.trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('HYBRID_MODEL_LEAGUE_MULTIPLIERS_JSON must be a JSON object.');
  }
  return parsed as HybridWeightRegistry['leagueMultipliers'];
}

function configuration() {
  const root = repositoryRoot();
  const registry: HybridWeightRegistry = {
    ...DEFAULT_HYBRID_WEIGHT_REGISTRY,
    leagueMultipliers: parseLeagueMultipliers(),
  };
  return {
    artifactDirectory: resolve(
      root,
      process.env.HYBRID_MODEL_ARTIFACT_DIRECTORY ?? 'artifacts/hybrid/v8-stage4-hybrid-model',
    ),
    registry,
  };
}

function rowKey(fixtureId: number, horizonMinutes: number, predictionAsOf: string | Date): string {
  return `${fixtureId}:${horizonMinutes}:${new Date(predictionAsOf).toISOString()}`;
}

function probabilityTriple(input: { WIN: number; PUSH: number; LOSS: number }) {
  return { BELOW: input.LOSS, PUSH: input.PUSH, ABOVE: input.WIN };
}

function findMlPrediction(
  rows: MlModelRow[] | undefined,
  predictionAsOf: Date,
): MlModelRow | null {
  if (!rows) return null;
  return (
    rows.find(
      (row) =>
        row.predictionAsOf.getTime() <= predictionAsOf.getTime() &&
        row.trainedThrough.getTime() < predictionAsOf.getTime(),
    ) ?? null
  );
}

function buildDixonMarkets(
  source: DixonModelRow,
  fixtureId: number,
  horizonMinutes: number,
  predictionAsOf: Date,
): BayesianPredictiveMarkets {
  return buildBayesianPredictiveMarkets({
    fixtureId,
    horizonMinutes,
    predictionAsOf,
    expectedHomeGoals: source.homeExpectedGoals,
    expectedAwayGoals: source.awayExpectedGoals,
    homeGoalsVarianceLog: 0,
    awayGoalsVarianceLog: 0,
    sourceTeamStrengthVersion: 'DIXON_COLES_BASELINE_V7_5',
    sourceTeamStrengthHash: source.payloadHash,
  });
}

function marketIdentityError(market: HybridMarketPrediction): number {
  return Math.abs(Object.values(market.rawProbability).reduce((sum, value) => sum + value, 0) - 1);
}

function finiteMarket(market: HybridMarketPrediction): boolean {
  return [
    ...Object.values(market.rawProbability),
    ...Object.values(market.componentWeights),
    market.componentDisagreement,
  ].every(Number.isFinite);
}

function buildFixtureHybridMarkets(input: {
  stage3: BayesianPredictiveMarketsArtifactRow;
  dixon: DixonModelRow | null;
  ml: MlModelRow | null;
  registry: HybridWeightRegistry;
}): HybridMarketPrediction[] {
  const bayesian = input.stage3.markets;
  const dixon = input.dixon
    ? buildDixonMarkets(
        input.dixon,
        input.stage3.fixtureId,
        input.stage3.horizonMinutes,
        new Date(input.stage3.predictionAsOf),
      )
    : null;
  const common = {
    leagueId: input.stage3.leagueId,
    horizonMinutes: input.stage3.horizonMinutes,
    registry: input.registry,
  };

  const hda: HybridModelComponent[] = [
    {
      component: 'BAYESIAN',
      modelVersion: bayesian.modelVersion,
      probabilities: { HOME: bayesian.hda.HOME, DRAW: bayesian.hda.DRAW, AWAY: bayesian.hda.AWAY },
    },
  ];
  if (input.dixon) {
    hda.push({
      component: 'DIXON_COLES',
      modelVersion: 'DIXON_COLES_BASELINE_V7_5',
      probabilities: {
        HOME: input.dixon.homeProbability,
        DRAW: input.dixon.drawProbability,
        AWAY: input.dixon.awayProbability,
      },
    });
  }
  if (input.ml) {
    hda.push({
      component: 'ML_SPECIALIST',
      modelVersion: input.ml.modelVersion,
      probabilities: {
        HOME: input.ml.finalHomeProbability,
        DRAW: input.ml.finalDrawProbability,
        AWAY: input.ml.finalAwayProbability,
      },
    });
  }

  const btts: HybridModelComponent[] = [
    {
      component: 'BAYESIAN',
      modelVersion: bayesian.modelVersion,
      probabilities: { YES: bayesian.btts.YES, NO: bayesian.btts.NO },
    },
  ];
  if (input.dixon) {
    btts.push({
      component: 'DIXON_COLES',
      modelVersion: 'DIXON_COLES_BASELINE_V7_5',
      probabilities: { YES: input.dixon.bttsProbability, NO: 1 - input.dixon.bttsProbability },
    });
  }
  if (input.ml) {
    btts.push({
      component: 'ML_SPECIALIST',
      modelVersion: input.ml.modelVersion,
      probabilities: { YES: input.ml.bttsProbability, NO: 1 - input.ml.bttsProbability },
    });
  }

  const markets: HybridMarketPrediction[] = [
    buildHybridMarketPrediction({ market: 'HDA', components: hda, ...common }),
    buildHybridMarketPrediction({ market: 'BTTS', components: btts, ...common }),
  ];
  for (const bayesianTotal of bayesian.totalGoals) {
    const components: HybridModelComponent[] = [
      {
        component: 'BAYESIAN',
        modelVersion: bayesian.modelVersion,
        probabilities: probabilityTriple(bayesianTotal.OVER),
      },
    ];
    const dixonTotal = dixon?.totalGoals.find((row) => row.line === bayesianTotal.line);
    if (dixonTotal) {
      components.push({
        component: 'DIXON_COLES',
        modelVersion: 'DIXON_COLES_BASELINE_V7_5',
        probabilities:
          bayesianTotal.line === 2.5 && input.dixon
            ? {
                BELOW: 1 - input.dixon.over25Probability,
                PUSH: 0,
                ABOVE: input.dixon.over25Probability,
              }
            : probabilityTriple(dixonTotal.OVER),
      });
    }
    if (input.ml && bayesianTotal.line === 2.5) {
      components.push({
        component: 'ML_SPECIALIST',
        modelVersion: input.ml.modelVersion,
        probabilities: {
          BELOW: 1 - input.ml.over25Probability,
          PUSH: 0,
          ABOVE: input.ml.over25Probability,
        },
      });
    }
    markets.push(
      buildHybridMarketPrediction({
        market: 'TOTAL_GOALS',
        line: bayesianTotal.line,
        components,
        ...common,
      }),
    );
  }
  return markets;
}

function gitHead(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export async function loadHybridModelRuntime(): Promise<HybridModelRuntimeResult> {
  const config = configuration();
  const [stage3, stage2] = await Promise.all([
    loadBayesianPredictiveMarketsRuntime(),
    loadBayesianTeamStrengthRuntime(),
  ]);
  const registryFingerprint = sha256(stableStringify(config.registry));
  if (stage3.status !== 'READY_FOR_HYBRID_MODEL') {
    return {
      version: HYBRID_MODEL_VERSION,
      registryVersion: config.registry.version,
      status: 'BLOCKED_STAGE3',
      rows: [],
      generatedRows: 0,
      generatedMarkets: 0,
      finiteRows: 0,
      normalizationViolations: 0,
      leakageViolations: 0,
      dixonCoverageRows: 0,
      mlCoverageRows: 0,
      bayesianOnlyMarkets: 0,
      weightedEnsembleMarkets: 0,
      stage1DatasetFingerprint: stage3.stage1DatasetFingerprint,
      stage2DatasetFingerprint: stage3.stage2DatasetFingerprint,
      stage3DatasetFingerprint: stage3.datasetFingerprint,
      registryFingerprint,
      datasetFingerprint: sha256(''),
      configuration: config,
    };
  }

  const stage2Map = new Map(
    stage2.rows.map((row) => [rowKey(row.fixtureId, row.horizonMinutes, row.predictionAsOf), row]),
  );
  const dixonIds = [
    ...new Set(
      stage2.rows
        .map((row) => row.comparison.dixonSnapshotId)
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
          homeProbability: true,
          drawProbability: true,
          awayProbability: true,
          over25Probability: true,
          bttsProbability: true,
          payloadHash: true,
        },
      })) as DixonModelRow[])
    : [];
  const dixonMap = new Map(dixonRows.map((row) => [row.id, row]));
  const fixtureIds = [...new Set(stage3.rows.map((row) => row.fixtureId))];
  const mlRows = (await prisma.mlPredictionSnapshot.findMany({
    where: { fixtureId: { in: fixtureIds } },
    select: {
      id: true,
      fixtureId: true,
      horizonMinutes: true,
      predictionAsOf: true,
      trainedThrough: true,
      modelVersion: true,
      finalHomeProbability: true,
      finalDrawProbability: true,
      finalAwayProbability: true,
      over25Probability: true,
      bttsProbability: true,
      payloadHash: true,
    },
    orderBy: [{ predictionAsOf: 'desc' }, { id: 'desc' }],
  })) as MlModelRow[];
  const mlByFixtureHorizon = new Map<string, MlModelRow[]>();
  for (const row of mlRows) {
    const key = `${row.fixtureId}:${row.horizonMinutes}`;
    const rows = mlByFixtureHorizon.get(key) ?? [];
    rows.push(row);
    mlByFixtureHorizon.set(key, rows);
  }

  let dixonCoverageRows = 0;
  let mlCoverageRows = 0;
  let leakageViolations = 0;
  const rows: HybridModelArtifactRow[] = [];
  for (const stage3Row of stage3.rows) {
    const stage2Row = stage2Map.get(
      rowKey(stage3Row.fixtureId, stage3Row.horizonMinutes, stage3Row.predictionAsOf),
    );
    const dixonId = stage2Row?.comparison.dixonSnapshotId ?? null;
    const dixon = dixonId == null ? null : (dixonMap.get(dixonId) ?? null);
    if (dixon) dixonCoverageRows += 1;
    const predictionAsOf = new Date(stage3Row.predictionAsOf);
    const ml = findMlPrediction(
      mlByFixtureHorizon.get(`${stage3Row.fixtureId}:${stage3Row.horizonMinutes}`),
      predictionAsOf,
    );
    if (ml) {
      mlCoverageRows += 1;
      if (ml.trainedThrough.getTime() >= predictionAsOf.getTime()) leakageViolations += 1;
    }
    const markets = buildFixtureHybridMarkets({
      stage3: stage3Row,
      dixon,
      ml,
      registry: config.registry,
    });
    const content = {
      fixtureId: stage3Row.fixtureId,
      leagueId: stage3Row.leagueId,
      horizonMinutes: stage3Row.horizonMinutes,
      predictionAsOf: stage3Row.predictionAsOf,
      kickoffAt: stage3Row.kickoffAt,
      markets,
      selectedModels: [...new Set(markets.map((market) => market.selectedModel))],
      fallbackReasons: [...new Set(markets.flatMap((market) => market.fallbackReason))],
      lineage: {
        stage1DatasetFingerprint: stage3.stage1DatasetFingerprint,
        stage2DatasetFingerprint: stage3.stage2DatasetFingerprint,
        stage3DatasetFingerprint: stage3.datasetFingerprint,
        stage3RowHash: stage3Row.rowHash,
        dixonSnapshotId: dixonId,
        mlPredictionSnapshotId: ml?.id ?? null,
      },
    };
    rows.push({
      ...content,
      rowHash: sha256(
        stableStringify({
          content,
          marketHashes: markets.map(hybridMarketPredictionHash),
          registryFingerprint,
        }),
      ),
    });
  }

  const finiteRows = rows.filter((row) => row.markets.every(finiteMarket)).length;
  const normalizationViolations = rows
    .flatMap((row) => row.markets)
    .filter((market) => marketIdentityError(market) > 1e-10).length;
  const bayesianOnlyMarkets = rows
    .flatMap((row) => row.markets)
    .filter((market) => market.selectedModel === 'BAYESIAN').length;
  const weightedEnsembleMarkets = rows
    .flatMap((row) => row.markets)
    .filter((market) => market.selectedModel === 'WEIGHTED_ENSEMBLE').length;
  const datasetFingerprint = sha256(
    stableStringify(rows.map((row) => ({ rowHash: row.rowHash }))),
  );
  const status: HybridModelReadiness =
    finiteRows === rows.length && normalizationViolations === 0 && leakageViolations === 0
      ? 'READY_FOR_CALIBRATION'
      : 'BLOCKED_HYBRID_IDENTITIES';

  return {
    version: HYBRID_MODEL_VERSION,
    registryVersion: config.registry.version,
    status,
    rows,
    generatedRows: rows.length,
    generatedMarkets: rows.reduce((sum, row) => sum + row.markets.length, 0),
    finiteRows,
    normalizationViolations,
    leakageViolations,
    dixonCoverageRows,
    mlCoverageRows,
    bayesianOnlyMarkets,
    weightedEnsembleMarkets,
    stage1DatasetFingerprint: stage3.stage1DatasetFingerprint,
    stage2DatasetFingerprint: stage3.stage2DatasetFingerprint,
    stage3DatasetFingerprint: stage3.datasetFingerprint,
    registryFingerprint,
    datasetFingerprint,
    configuration: config,
  };
}

export function hybridModelSummary(runtime: HybridModelRuntimeResult): Record<string, unknown> {
  return {
    version: runtime.version,
    registryVersion: runtime.registryVersion,
    status: runtime.status,
    generatedRows: runtime.generatedRows,
    generatedMarkets: runtime.generatedMarkets,
    finiteRows: runtime.finiteRows,
    normalizationViolations: runtime.normalizationViolations,
    leakageViolations: runtime.leakageViolations,
    dixonCoverageRows: runtime.dixonCoverageRows,
    mlCoverageRows: runtime.mlCoverageRows,
    bayesianOnlyMarkets: runtime.bayesianOnlyMarkets,
    weightedEnsembleMarkets: runtime.weightedEnsembleMarkets,
    stage1DatasetFingerprint: runtime.stage1DatasetFingerprint,
    stage2DatasetFingerprint: runtime.stage2DatasetFingerprint,
    stage3DatasetFingerprint: runtime.stage3DatasetFingerprint,
    registryFingerprint: runtime.registryFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    configuration: runtime.configuration,
    marketOddsUsedAsCoreFeature: false,
    apiCalled: false,
    schemaChanged: false,
    currentChampionChanged: false,
  };
}

export async function writeHybridModelArtifacts(): Promise<HybridModelArtifactResult> {
  const runtime = await loadHybridModelRuntime();
  if (runtime.status !== 'READY_FOR_CALIBRATION') {
    throw new Error(`Stage 4 artifact export blocked: ${runtime.status}.`);
  }
  const root = repositoryRoot();
  const generatedAt = new Date();
  const runKey = `${generatedAt.toISOString().replace(/[-:.]/g, '')}-${runtime.datasetFingerprint.slice(0, 12)}`;
  const directory = resolve(runtime.configuration.artifactDirectory, runKey);
  mkdirSync(directory, { recursive: true });
  const predictionsContent = runtime.rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const predictionsPath = resolve(directory, 'hybrid-predictions.jsonl');
  writeFileSync(predictionsPath, predictionsContent, 'utf8');
  const registryContent = JSON.stringify(runtime.configuration.registry, null, 2) + '\n';
  const registryPath = resolve(directory, 'model-registry.json');
  writeFileSync(registryPath, registryContent, 'utf8');

  const manifest = {
    version: runtime.version,
    generatedAt: generatedAt.toISOString(),
    gitHead: gitHead(root),
    status: runtime.status,
    registryVersion: runtime.registryVersion,
    registryFingerprint: runtime.registryFingerprint,
    stage1DatasetFingerprint: runtime.stage1DatasetFingerprint,
    stage2DatasetFingerprint: runtime.stage2DatasetFingerprint,
    stage3DatasetFingerprint: runtime.stage3DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    configuration: {
      artifactDirectory: relative(root, runtime.configuration.artifactDirectory).replaceAll('\\', '/'),
    },
    summary: {
      generatedRows: runtime.generatedRows,
      generatedMarkets: runtime.generatedMarkets,
      finiteRows: runtime.finiteRows,
      normalizationViolations: runtime.normalizationViolations,
      leakageViolations: runtime.leakageViolations,
      dixonCoverageRows: runtime.dixonCoverageRows,
      mlCoverageRows: runtime.mlCoverageRows,
      bayesianOnlyMarkets: runtime.bayesianOnlyMarkets,
      weightedEnsembleMarkets: runtime.weightedEnsembleMarkets,
    },
    files: {
      predictions: 'hybrid-predictions.jsonl',
      registry: 'model-registry.json',
      hashes: 'sha256.json',
    },
    safety: {
      marketOddsUsedAsCoreFeature: false,
      currentChampionChanged: false,
      apiCalled: false,
      schemaChanged: false,
    },
  };
  const manifestContent = JSON.stringify(manifest, null, 2) + '\n';
  const manifestPath = resolve(directory, 'manifest.json');
  writeFileSync(manifestPath, manifestContent, 'utf8');
  const hashes = {
    'manifest.json': sha256(manifestContent),
    'hybrid-predictions.jsonl': sha256(predictionsContent),
    'model-registry.json': sha256(registryContent),
  };
  const hashesPath = resolve(directory, 'sha256.json');
  writeFileSync(hashesPath, JSON.stringify(hashes, null, 2) + '\n', 'utf8');
  return { directory, manifestPath, predictionsPath, registryPath, hashesPath, runtime };
}
