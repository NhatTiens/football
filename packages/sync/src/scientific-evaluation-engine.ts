import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { prisma, type InputJsonValue } from '@football-ai/database';

import { ML_MARKET_FEATURE_CONTRACT_HASH, ML_MARKET_FEATURE_NAMES } from './ml-market-contract.js';
import { getScientificFixtureAnalysis } from './scientific-features.js';
import { SCIENTIFIC_MODEL_VERSION } from './scientific-model.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';
import {
  SCIENTIFIC_EVALUATION_VERSION,
  SCIENTIFIC_POLICY_VERSION,
  decidePromotion,
  deterministicHash,
  normalizeProbabilities,
  type BettingMetricSet,
  type EvaluationMetricSet,
  type MatchWinnerOdds,
  type MatchWinnerProbabilities,
  type PromotionDecision,
} from './scientific-evaluation-contract.js';

interface FeatureRow {
  id: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  labelAvailableAt: Date;
  horizonMinutes: number;
  labelMatchWinner: number;
  labelOver25: number;
  labelBtts: number;
  marketAvailable: boolean;
  bookmakerCount: number;
  marketHomeProbability: number | null;
  marketDrawProbability: number | null;
  marketAwayProbability: number | null;
  featureNames: unknown;
  featureVector: unknown;
  featureContractHash: string;
  sourcePayload: unknown;
  payloadHash: string;
}

interface BaselineRow {
  id: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  horizonMinutes: number;
  baselineVersion: string;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  over25Probability: number;
  bttsProbability: number;
  dataQualityScore: number | null;
  sourcePayload: unknown;
  payloadHash: string;
}

interface FixtureWithTeams {
  id: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
  homeTeam: {
    name: string;
  };
  awayTeam: {
    name: string;
  };
}

interface OddsRow {
  fixtureId: number;
  bookmakerId: number;
  selectionCode: string;
  decimalOdds: number;
  capturedAt: Date;
}

interface PythonEvaluationMetadata {
  evaluationVersion: string;
  candidateVersion: string;
  baselineVersion: string;
  featureContractHash: string;
  datasetFingerprint: string;
  policyVersion: string;
  dateFrom: string;
  dateTo: string;
  foldCount: number;
  oofRows: number;
  evaluationRows: number;
  promotionRows: number;
  promotionHorizonMinutes: number;
  leakageViolations: number;
  artifactDirectory: string;
  artifactSha256: Record<string, string>;
  predictionMetrics: {
    candidate: EvaluationMetricSet;
    baseline: EvaluationMetricSet;
    [key: string]: unknown;
  };
  bettingMetrics: {
    candidate: BettingMetricSet;
    baseline: BettingMetricSet;
    [key: string]: unknown;
  };
  configuration: Record<string, unknown>;
  paths: {
    oofPredictions: string;
    evaluationBets: string;
    [key: string]: string;
  };
  metadataPath: string;
}

interface PythonOofRow {
  fixtureId: number;
  leagueId: number;
  predictionAsOf: string;
  kickoffAt: string;
  horizonMinutes: number;
  foldNumber: number;
  splitRole: string;
  trainedThrough: string;
  labels: {
    matchWinner: number;
    over25: number;
    btts: number;
  };
  baseline: number[];
  dixonColes: number[];
  market: number[] | null;
  catBoost: number[];
  residualMarket: number[] | null;
  stacked: number[];
  calibrated: number[];
  decisionOdds: MatchWinnerOdds | null;
  closingOdds: MatchWinnerOdds | null;
  featurePayloadHash: string;
  [key: string]: unknown;
}

interface PythonBetRow {
  fixtureId: number;
  horizonMinutes: number;
  source: string;
  predictedAt: string;
  kickoffAt: string;
  selectionCode: string;
  decimalOdds: number;
  closingOdds: number | null;
  modelProbability: number;
  fairProbability: number | null;
  edge: number;
  expectedValue: number;
  stakeUnits: number;
  result: string;
  profitUnits: number;
  clv: number | null;
}

interface ScientificAnalysisShape {
  matchWinner: MatchWinnerProbabilities;
  over25: {
    OVER: number;
    UNDER: number;
  };
  btts: {
    YES: number;
    NO: number;
  };
  dataQualityScore?: number;
  [key: string]: unknown;
}

function jsonValue(value: unknown): InputJsonValue {
  return value as InputJsonValue;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function repositoryRoot(): string {
  let current = process.cwd();

  while (true) {
    if (
      existsSync(resolve(current, '.git')) &&
      existsSync(resolve(current, 'packages/database/prisma/schema.prisma'))
    ) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      throw new Error(`Cannot locate repository root from ${process.cwd()}.`);
    }

    current = parent;
  }
}

function artifactRoot(): string {
  return resolve(
    repositoryRoot(),
    process.env.SCIENTIFIC_EVALUATION_ARTIFACT_DIRECTORY ?? 'artifacts/evaluation/v7-alpha7',
  );
}

function pythonScriptPath(): string {
  return resolve(repositoryRoot(), 'scripts/ml/scientific_evaluate.py');
}

function pythonExecutable(): string {
  const configured = process.env.ML_PYTHON_EXECUTABLE;

  if (configured?.trim()) {
    return resolve(repositoryRoot(), configured.trim());
  }

  const candidates =
    process.platform === 'win32'
      ? [
          resolve(repositoryRoot(), '.venv-alpha6/Scripts/python.exe'),
          resolve(repositoryRoot(), '.venv-alpha7/Scripts/python.exe'),
          'python',
          'py',
        ]
      : [
          resolve(repositoryRoot(), '.venv-alpha6/bin/python'),
          resolve(repositoryRoot(), '.venv-alpha7/bin/python'),
          'python3',
          'python',
        ];

  return (
    candidates.find(
      (candidate) =>
        candidate === 'python' ||
        candidate === 'python3' ||
        candidate === 'py' ||
        existsSync(candidate),
    ) ?? 'python'
  );
}

function parseLastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index] ?? '') as Record<string, unknown>;
    } catch {
      // Python and CatBoost can write informational lines first.
    }
  }

  throw new Error(`Python did not return a JSON result.\n${stdout}`);
}

function runPython(args: string[]): Record<string, unknown> {
  const executable = pythonExecutable();
  const executableName = executable.toLowerCase();
  const commandArgs =
    executableName.endsWith('py') || executableName.endsWith('py.exe')
      ? ['-3', pythonScriptPath(), ...args]
      : [pythonScriptPath(), ...args];
  const result = spawnSync(executable, commandArgs, {
    cwd: repositoryRoot(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONUTF8: '1',
    },
    maxBuffer: 128 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      [
        `Python evaluation failed with exit code ${String(result.status)}.`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return parseLastJsonLine(result.stdout ?? '');
}

function baselineVersion(): string {
  return (
    process.env.SCIENTIFIC_EVAL_BASELINE_VERSION ?? `${SCIENTIFIC_MODEL_VERSION}-frozen-alpha7`
  );
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${label} must be a string array.`);
  }

  return value as string[];
}

function asNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  const result = value.map((entry) => Number(entry));

  if (result.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${label} contains a non-finite number.`);
  }

  return result;
}

function probabilityAtFeature(
  featureNames: string[],
  featureVector: number[],
  name: string,
): number {
  const index = featureNames.indexOf(name);

  if (index < 0) {
    throw new Error(`Missing ML feature ${name}.`);
  }

  const value = featureVector[index];

  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite ML feature ${name}.`);
  }

  return Number(value);
}

function canonicalSelection(value: string): 'HOME' | 'DRAW' | 'AWAY' | null {
  const normalized = value.trim().toUpperCase().replaceAll(' ', '_');

  if (['HOME', '1', 'HOME_WIN', 'LOCAL'].includes(normalized)) {
    return 'HOME';
  }

  if (['DRAW', 'X', 'TIE'].includes(normalized)) {
    return 'DRAW';
  }

  if (['AWAY', '2', 'AWAY_WIN', 'VISITOR'].includes(normalized)) {
    return 'AWAY';
  }

  return null;
}

function bestPointInTimeOdds(rows: OddsRow[], cutoff: Date): MatchWinnerOdds | null {
  const latestByBookmaker = new Map<string, OddsRow>();

  for (const row of rows) {
    if (row.capturedAt.getTime() > cutoff.getTime()) {
      continue;
    }

    const selection = canonicalSelection(row.selectionCode);

    if (!selection) {
      continue;
    }

    const key = `${row.bookmakerId}:${selection}`;
    const previous = latestByBookmaker.get(key);

    if (!previous || row.capturedAt.getTime() > previous.capturedAt.getTime()) {
      latestByBookmaker.set(key, row);
    }
  }

  const result: MatchWinnerOdds = {
    HOME: null,
    DRAW: null,
    AWAY: null,
  };

  for (const row of latestByBookmaker.values()) {
    const selection = canonicalSelection(row.selectionCode);

    if (!selection) {
      continue;
    }

    const existing = result[selection];

    if (row.decimalOdds > 1 && (existing == null || row.decimalOdds > existing)) {
      result[selection] = row.decimalOdds;
    }
  }

  return result.HOME != null || result.DRAW != null || result.AWAY != null ? result : null;
}

function arrayProbability(values: number[]): MatchWinnerProbabilities {
  if (values.length !== 3) {
    throw new Error(`Expected three probabilities, received ${values.length}.`);
  }

  return normalizeProbabilities({
    HOME: Number(values[0]),
    DRAW: Number(values[1]),
    AWAY: Number(values[2]),
  });
}

function oddsForPayload(value: MatchWinnerOdds | null): InputJsonValue | undefined {
  return value == null ? undefined : jsonValue(value);
}

function readJsonLines<T>(path: string): T[] {
  if (!existsSync(path)) {
    throw new Error(`Artifact file does not exist: ${path}`);
  }

  return (readFileSync(path, 'utf8') as string)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0)
    .map((line: string) => JSON.parse(line) as T);
}

async function loadFeatureRows(): Promise<FeatureRow[]> {
  return (await prisma.mlFeatureSnapshot.findMany({
    where: {
      featureContractHash: ML_MARKET_FEATURE_CONTRACT_HASH,
    },
    select: {
      id: true,
      fixtureId: true,
      leagueId: true,
      predictionAsOf: true,
      kickoffAt: true,
      labelAvailableAt: true,
      horizonMinutes: true,
      labelMatchWinner: true,
      labelOver25: true,
      labelBtts: true,
      marketAvailable: true,
      bookmakerCount: true,
      marketHomeProbability: true,
      marketDrawProbability: true,
      marketAwayProbability: true,
      featureNames: true,
      featureVector: true,
      featureContractHash: true,
      sourcePayload: true,
      payloadHash: true,
    },
    orderBy: [{ kickoffAt: 'asc' }, { fixtureId: 'asc' }, { horizonMinutes: 'desc' }],
  })) as FeatureRow[];
}

export async function freezeScientificBaseline(): Promise<SyncSummary> {
  return runTrackedSync('scientific-baseline-freeze', async () => {
    const version = baselineVersion();
    const features = await loadFeatureRows();

    if (features.length === 0) {
      throw new Error('No alpha.6 feature snapshots exist.');
    }

    const fixtureIds = [...new Set(features.map((row) => row.fixtureId))];
    const fixtures = (await prisma.fixture.findMany({
      where: {
        id: {
          in: fixtureIds,
        },
      },
      select: {
        id: true,
        leagueId: true,
        homeTeamId: true,
        awayTeamId: true,
        kickoffAt: true,
        homeTeam: {
          select: {
            name: true,
          },
        },
        awayTeam: {
          select: {
            name: true,
          },
        },
      },
    })) as FixtureWithTeams[];
    const fixtureMap = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

    let processed = 0;
    let inserted = 0;
    let skippedExisting = 0;
    let skippedMissingFixture = 0;

    for (const feature of features) {
      const fixture = fixtureMap.get(feature.fixtureId);

      if (!fixture) {
        skippedMissingFixture += 1;
        continue;
      }

      const existing = await prisma.scientificBaselineSnapshot.findFirst({
        where: {
          fixtureId: feature.fixtureId,
          horizonMinutes: feature.horizonMinutes,
          baselineVersion: version,
        },
        select: {
          id: true,
        },
      });

      if (existing && !envBoolean('SCIENTIFIC_EVAL_FORCE_BASELINE', false)) {
        skippedExisting += 1;
        continue;
      }

      const analysis = (await getScientificFixtureAnalysis({
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        homeTeamName: fixture.homeTeam.name,
        awayTeamName: fixture.awayTeam.name,
        kickoffAt: fixture.kickoffAt,
        asOf: feature.predictionAsOf,
        useMachineLearning: true,
      })) as unknown as ScientificAnalysisShape;
      const matchWinner = normalizeProbabilities(analysis.matchWinner);
      const sourcePayload = {
        evaluationVersion: SCIENTIFIC_EVALUATION_VERSION,
        baselineVersion: version,
        scientificModelVersion: SCIENTIFIC_MODEL_VERSION,
        fixtureId: feature.fixtureId,
        predictionAsOf: feature.predictionAsOf.toISOString(),
        horizonMinutes: feature.horizonMinutes,
        sourceFeatureId: feature.id,
        sourceFeaturePayloadHash: feature.payloadHash,
        matchWinner,
        over25Probability: analysis.over25.OVER,
        bttsProbability: analysis.btts.YES,
        dataQualityScore: analysis.dataQualityScore ?? null,
      };
      const payloadHash = deterministicHash('SCIENTIFIC_BASELINE_SNAPSHOT', sourcePayload);
      const result = await prisma.scientificBaselineSnapshot.createMany({
        data: [
          {
            fixtureId: feature.fixtureId,
            leagueId: feature.leagueId,
            predictionAsOf: feature.predictionAsOf,
            kickoffAt: feature.kickoffAt,
            horizonMinutes: feature.horizonMinutes,
            baselineVersion: version,
            homeProbability: matchWinner.HOME,
            drawProbability: matchWinner.DRAW,
            awayProbability: matchWinner.AWAY,
            over25Probability: analysis.over25.OVER,
            bttsProbability: analysis.btts.YES,
            dataQualityScore: analysis.dataQualityScore ?? null,
            sourcePayload: jsonValue(sourcePayload),
            payloadHash,
          },
        ],
        skipDuplicates: true,
      });

      processed += 1;
      inserted += result.count;

      if (processed % 50 === 0) {
        console.log(`[scientific-baseline-freeze] ${processed}/${features.length}`);
      }
    }

    return {
      processed,
      inserted,
      updated: 0,
      metadata: jsonValue({
        baselineVersion: version,
        featureRows: features.length,
        skippedExisting,
        skippedMissingFixture,
        apiCalled: false,
        productionModelChanged: false,
      }),
    };
  });
}

async function exportEvaluationDataset(): Promise<{
  path: string;
  rows: number;
  fixtures: number;
  baselineVersion: string;
}> {
  const version = baselineVersion();
  const [features, baselines] = await Promise.all([
    loadFeatureRows(),
    prisma.scientificBaselineSnapshot.findMany({
      where: {
        baselineVersion: version,
      },
      select: {
        id: true,
        fixtureId: true,
        leagueId: true,
        predictionAsOf: true,
        kickoffAt: true,
        horizonMinutes: true,
        baselineVersion: true,
        homeProbability: true,
        drawProbability: true,
        awayProbability: true,
        over25Probability: true,
        bttsProbability: true,
        dataQualityScore: true,
        sourcePayload: true,
        payloadHash: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    }) as Promise<BaselineRow[]>,
  ]);

  if (features.length === 0) {
    throw new Error('No alpha.6 feature snapshots exist.');
  }

  const baselineMap = new Map<string, BaselineRow>();

  for (const baseline of baselines) {
    const key = `${baseline.fixtureId}:${baseline.horizonMinutes}`;

    if (!baselineMap.has(key)) {
      baselineMap.set(key, baseline);
    }
  }

  const missingBaseline = features.filter(
    (feature) => !baselineMap.has(`${feature.fixtureId}:${feature.horizonMinutes}`),
  );

  if (missingBaseline.length > 0) {
    throw new Error(
      `${missingBaseline.length} feature rows have no frozen baseline. ` +
        'Run scientific-baseline-freeze first.',
    );
  }

  const fixtureIds = [...new Set(features.map((row) => row.fixtureId))];
  const maximumKickoff = features.reduce(
    (maximum, row) => (row.kickoffAt.getTime() > maximum.getTime() ? row.kickoffAt : maximum),
    features[0]!.kickoffAt,
  );
  const oddsRows = (await prisma.oddsSnapshot.findMany({
    where: {
      fixtureId: {
        in: fixtureIds,
      },
      isLive: false,
      capturedAt: {
        lte: maximumKickoff,
      },
      market: {
        marketCode: 'MATCH_WINNER',
      },
    },
    select: {
      fixtureId: true,
      bookmakerId: true,
      selectionCode: true,
      decimalOdds: true,
      capturedAt: true,
    },
    orderBy: [{ fixtureId: 'asc' }, { capturedAt: 'asc' }],
  })) as OddsRow[];
  const oddsByFixture = new Map<number, OddsRow[]>();

  for (const row of oddsRows) {
    const current = oddsByFixture.get(row.fixtureId) ?? [];
    current.push(row);
    oddsByFixture.set(row.fixtureId, current);
  }

  const outputRows = features.map((feature) => {
    const names = asStringArray(feature.featureNames, 'featureNames');
    const vector = asNumberArray(feature.featureVector, 'featureVector');

    if (
      names.length !== ML_MARKET_FEATURE_NAMES.length ||
      vector.length !== ML_MARKET_FEATURE_NAMES.length ||
      feature.featureContractHash !== ML_MARKET_FEATURE_CONTRACT_HASH
    ) {
      throw new Error(`Feature contract mismatch for feature row ${feature.id}.`);
    }

    const baseline = baselineMap.get(`${feature.fixtureId}:${feature.horizonMinutes}`)!;
    const fixtureOdds = oddsByFixture.get(feature.fixtureId) ?? [];
    const decisionOdds = bestPointInTimeOdds(fixtureOdds, feature.predictionAsOf);
    const closingOdds = bestPointInTimeOdds(fixtureOdds, feature.kickoffAt);
    const market =
      feature.marketAvailable &&
      feature.marketHomeProbability != null &&
      feature.marketDrawProbability != null &&
      feature.marketAwayProbability != null
        ? normalizeProbabilities({
            HOME: feature.marketHomeProbability,
            DRAW: feature.marketDrawProbability,
            AWAY: feature.marketAwayProbability,
          })
        : null;

    return {
      fixtureId: feature.fixtureId,
      leagueId: feature.leagueId,
      predictionAsOf: feature.predictionAsOf.toISOString(),
      kickoffAt: feature.kickoffAt.toISOString(),
      labelAvailableAt: feature.labelAvailableAt.toISOString(),
      horizonMinutes: feature.horizonMinutes,
      labels: {
        matchWinner: feature.labelMatchWinner,
        over25: feature.labelOver25,
        btts: feature.labelBtts,
      },
      featureNames: names,
      featureVector: vector,
      featureContractHash: feature.featureContractHash,
      featurePayloadHash: feature.payloadHash,
      baselineVersion: baseline.baselineVersion,
      baseline: {
        HOME: baseline.homeProbability,
        DRAW: baseline.drawProbability,
        AWAY: baseline.awayProbability,
      },
      baselinePayloadHash: baseline.payloadHash,
      dixonColes: {
        HOME: probabilityAtFeature(names, vector, 'dixon_coles_home_probability'),
        DRAW: probabilityAtFeature(names, vector, 'dixon_coles_draw_probability'),
        AWAY: probabilityAtFeature(names, vector, 'dixon_coles_away_probability'),
      },
      market: {
        probabilities: market == null ? null : [market.HOME, market.DRAW, market.AWAY],
        bookmakerCount: feature.bookmakerCount,
        qualityScore: probabilityAtFeature(names, vector, 'market_quality'),
      },
      decisionOdds,
      closingOdds,
    };
  });

  const outputPath = resolve(artifactRoot(), 'evaluation_input.jsonl');
  mkdirSync(dirname(outputPath), {
    recursive: true,
  });
  writeFileSync(outputPath, outputRows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');

  return {
    path: outputPath,
    rows: outputRows.length,
    fixtures: new Set(outputRows.map((row) => row.fixtureId)).size,
    baselineVersion: version,
  };
}

function parseEvaluationMetricSet(value: unknown, label: string): EvaluationMetricSet {
  if (value == null || typeof value !== 'object') {
    throw new Error(`${label} is missing.`);
  }

  const record = value as Record<string, unknown>;

  return {
    rows: Number(record.rows) || 0,
    brier: record.brier == null ? null : Number(record.brier),
    logLoss: record.logLoss == null ? null : Number(record.logLoss),
    accuracy: record.accuracy == null ? null : Number(record.accuracy),
    expectedCalibrationError:
      record.expectedCalibrationError == null ? null : Number(record.expectedCalibrationError),
  };
}

function parseBettingMetricSet(value: unknown, label: string): BettingMetricSet {
  if (value == null || typeof value !== 'object') {
    throw new Error(`${label} is missing.`);
  }

  const record = value as Record<string, unknown>;

  return {
    bets: Number(record.bets) || 0,
    wins: Number(record.wins) || 0,
    losses: Number(record.losses) || 0,
    pushes: Number(record.pushes) || 0,
    stakeUnits: Number(record.stakeUnits) || 0,
    profitUnits: Number(record.profitUnits) || 0,
    roi: record.roi == null ? null : Number(record.roi),
    hitRate: record.hitRate == null ? null : Number(record.hitRate),
    maximumDrawdownUnits: Number(record.maximumDrawdownUnits) || 0,
    averageOdds: record.averageOdds == null ? null : Number(record.averageOdds),
    averageEdge: record.averageEdge == null ? null : Number(record.averageEdge),
    averageExpectedValue:
      record.averageExpectedValue == null ? null : Number(record.averageExpectedValue),
    averageClv: record.averageClv == null ? null : Number(record.averageClv),
    positiveClvRate: record.positiveClvRate == null ? null : Number(record.positiveClvRate),
  };
}

function buildPromotionDecision(metadata: PythonEvaluationMetadata): PromotionDecision {
  const candidatePrediction = parseEvaluationMetricSet(
    metadata.predictionMetrics.candidate,
    'candidate prediction metrics',
  );
  const baselinePrediction = parseEvaluationMetricSet(
    metadata.predictionMetrics.baseline,
    'baseline prediction metrics',
  );
  const candidateBetting = parseBettingMetricSet(
    metadata.bettingMetrics.candidate,
    'candidate betting metrics',
  );
  const baselineBetting = parseBettingMetricSet(
    metadata.bettingMetrics.baseline,
    'baseline betting metrics',
  );

  return decidePromotion({
    candidate: {
      prediction: candidatePrediction,
      betting: candidateBetting,
    },
    baseline: {
      prediction: baselinePrediction,
      betting: baselineBetting,
    },
    leakageViolations: metadata.leakageViolations,
    minimumEvaluationRows: Math.floor(envNumber('SCIENTIFIC_PROMOTION_MIN_ROWS', 50)),
    minimumBets: Math.floor(envNumber('SCIENTIFIC_PROMOTION_MIN_BETS', 20)),
    minimumRelativeBrierImprovement: envNumber('SCIENTIFIC_PROMOTION_MIN_BRIER_IMPROVEMENT', 0.005),
    maximumLogLossRegression: envNumber('SCIENTIFIC_PROMOTION_MAX_LOGLOSS_REGRESSION', 0),
    minimumRoiImprovement: envNumber('SCIENTIFIC_PROMOTION_MIN_ROI_IMPROVEMENT', 0),
    maximumDrawdownRegressionUnits: envNumber('SCIENTIFIC_PROMOTION_MAX_DRAWDOWN_REGRESSION', 2),
    requirePositiveClv: envBoolean('SCIENTIFIC_PROMOTION_REQUIRE_POSITIVE_CLV', true),
  });
}

function chunk<T>(rows: T[], size = 250): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }

  return chunks;
}

export async function runScientificEvaluation(): Promise<SyncSummary> {
  return runTrackedSync('scientific-evaluate', async () => {
    const dataset = await exportEvaluationDataset();
    const outputRoot = artifactRoot();
    mkdirSync(outputRoot, {
      recursive: true,
    });

    const result = runPython([
      'evaluate',
      '--input',
      dataset.path,
      '--output-dir',
      outputRoot,
      '--fold-count',
      String(Math.floor(envNumber('SCIENTIFIC_EVAL_FOLD_COUNT', 5))),
      '--minimum-train-fixtures',
      String(Math.floor(envNumber('SCIENTIFIC_EVAL_MIN_TRAIN_FIXTURES', 150))),
      '--iterations',
      String(Math.floor(envNumber('SCIENTIFIC_EVAL_CATBOOST_ITERATIONS', 240))),
      '--depth',
      String(Math.floor(envNumber('SCIENTIFIC_EVAL_CATBOOST_DEPTH', 6))),
      '--learning-rate',
      String(envNumber('SCIENTIFIC_EVAL_CATBOOST_LEARNING_RATE', 0.035)),
      '--l2-leaf-reg',
      String(envNumber('SCIENTIFIC_EVAL_CATBOOST_L2', 6)),
      '--random-seed',
      String(Math.floor(envNumber('SCIENTIFIC_EVAL_RANDOM_SEED', 20260723))),
      '--stack-train-fraction',
      String(envNumber('SCIENTIFIC_EVAL_STACK_TRAIN_FRACTION', 0.6)),
      '--calibration-fraction',
      String(envNumber('SCIENTIFIC_EVAL_CALIBRATION_FRACTION', 0.2)),
      '--promotion-horizon',
      String(Math.floor(envNumber('SCIENTIFIC_EVAL_PROMOTION_HORIZON', 90))),
      '--minimum-probability',
      String(envNumber('SCIENTIFIC_POLICY_MIN_PROBABILITY', 0.35)),
      '--minimum-edge',
      String(envNumber('SCIENTIFIC_POLICY_MIN_EDGE', 0.04)),
      '--minimum-expected-value',
      String(envNumber('SCIENTIFIC_POLICY_MIN_EV', 0.03)),
      '--stake-units',
      String(envNumber('SCIENTIFIC_POLICY_STAKE_UNITS', 1)),
    ]) as unknown as PythonEvaluationMetadata;

    if (
      result.evaluationVersion !== SCIENTIFIC_EVALUATION_VERSION ||
      result.featureContractHash !== ML_MARKET_FEATURE_CONTRACT_HASH ||
      result.policyVersion !== SCIENTIFIC_POLICY_VERSION ||
      result.baselineVersion !== dataset.baselineVersion
    ) {
      throw new Error('Python returned an incompatible evaluation artifact.');
    }

    const decision = buildPromotionDecision(result);
    const artifactDirectory = relative(
      repositoryRoot(),
      resolve(result.artifactDirectory),
    ).replaceAll('\\', '/');
    const run = await prisma.scientificEvaluationRun.create({
      data: {
        evaluationVersion: result.evaluationVersion,
        candidateVersion: result.candidateVersion,
        baselineVersion: result.baselineVersion,
        status: 'RUNNING',
        promotionStatus: 'PENDING',
        featureContractHash: result.featureContractHash,
        policyVersion: result.policyVersion,
        dateFrom: new Date(result.dateFrom),
        dateTo: new Date(result.dateTo),
        foldCount: result.foldCount,
        oofRows: result.oofRows,
        evaluationRows: result.evaluationRows,
        leakageViolations: result.leakageViolations,
        artifactDirectory,
        artifactSha256: jsonValue(result.artifactSha256),
        configuration: jsonValue(result.configuration),
        predictionMetrics: jsonValue(result.predictionMetrics),
        bettingMetrics: jsonValue(result.bettingMetrics),
        promotionDecision: jsonValue(decision),
      },
      select: {
        id: true,
      },
    });

    try {
      const oofRows = readJsonLines<PythonOofRow>(resolve(result.paths.oofPredictions));
      const betRows = readJsonLines<PythonBetRow>(resolve(result.paths.evaluationBets));
      const oofWrites = oofRows.map((row) => {
        const baseline = arrayProbability(row.baseline);
        const dixon = arrayProbability(row.dixonColes);
        const market = row.market == null ? null : arrayProbability(row.market);
        const catBoost = arrayProbability(row.catBoost);
        const residual = row.residualMarket == null ? null : arrayProbability(row.residualMarket);
        const stacked = arrayProbability(row.stacked);
        const calibrated = arrayProbability(row.calibrated);
        const payloadHash = deterministicHash('SCIENTIFIC_OOF_PREDICTION', {
          runId: run.id,
          row,
        });

        return {
          runId: run.id,
          fixtureId: row.fixtureId,
          leagueId: row.leagueId,
          predictionAsOf: new Date(row.predictionAsOf),
          kickoffAt: new Date(row.kickoffAt),
          horizonMinutes: row.horizonMinutes,
          foldNumber: row.foldNumber,
          splitRole: row.splitRole,
          trainedThrough: new Date(row.trainedThrough),
          labelMatchWinner: row.labels.matchWinner,
          marketAvailable: market != null,
          baselineHomeProbability: baseline.HOME,
          baselineDrawProbability: baseline.DRAW,
          baselineAwayProbability: baseline.AWAY,
          dixonHomeProbability: dixon.HOME,
          dixonDrawProbability: dixon.DRAW,
          dixonAwayProbability: dixon.AWAY,
          marketHomeProbability: market?.HOME ?? null,
          marketDrawProbability: market?.DRAW ?? null,
          marketAwayProbability: market?.AWAY ?? null,
          catBoostHomeProbability: catBoost.HOME,
          catBoostDrawProbability: catBoost.DRAW,
          catBoostAwayProbability: catBoost.AWAY,
          residualHomeProbability: residual?.HOME ?? null,
          residualDrawProbability: residual?.DRAW ?? null,
          residualAwayProbability: residual?.AWAY ?? null,
          stackedHomeProbability: stacked.HOME,
          stackedDrawProbability: stacked.DRAW,
          stackedAwayProbability: stacked.AWAY,
          calibratedHomeProbability: calibrated.HOME,
          calibratedDrawProbability: calibrated.DRAW,
          calibratedAwayProbability: calibrated.AWAY,
          decisionOdds: oddsForPayload(row.decisionOdds),
          closingOdds: oddsForPayload(row.closingOdds),
          sourceFeaturePayloadHash: row.featurePayloadHash,
          evaluationPayload: jsonValue(row),
          payloadHash,
        };
      });

      for (const rows of chunk(oofWrites)) {
        await prisma.scientificOofPrediction.createMany({
          data: rows,
          skipDuplicates: true,
        });
      }

      const betWrites = betRows.map((row) => {
        const payloadHash = deterministicHash('SCIENTIFIC_EVALUATION_BET', {
          runId: run.id,
          row,
        });

        return {
          runId: run.id,
          fixtureId: row.fixtureId,
          horizonMinutes: row.horizonMinutes,
          source: row.source,
          predictedAt: new Date(row.predictedAt),
          kickoffAt: new Date(row.kickoffAt),
          selectionCode: row.selectionCode,
          decimalOdds: row.decimalOdds,
          closingOdds: row.closingOdds,
          modelProbability: row.modelProbability,
          fairProbability: row.fairProbability,
          edge: row.edge,
          expectedValue: row.expectedValue,
          stakeUnits: row.stakeUnits,
          result: row.result,
          profitUnits: row.profitUnits,
          clv: row.clv,
          payloadHash,
        };
      });

      for (const rows of chunk(betWrites)) {
        await prisma.scientificEvaluationBet.createMany({
          data: rows,
          skipDuplicates: true,
        });
      }

      const promotionPayload = {
        runId: run.id,
        candidateVersion: result.candidateVersion,
        baselineVersion: result.baselineVersion,
        decision,
        candidateMetrics: {
          prediction: result.predictionMetrics.candidate,
          betting: result.bettingMetrics.candidate,
        },
        baselineMetrics: {
          prediction: result.predictionMetrics.baseline,
          betting: result.bettingMetrics.baseline,
        },
      };
      const promotionHash = deterministicHash('SCIENTIFIC_PROMOTION_DECISION', promotionPayload);

      await prisma.scientificPromotionDecision.create({
        data: {
          runId: run.id,
          candidateVersion: result.candidateVersion,
          baselineVersion: result.baselineVersion,
          status: decision.status,
          passed: decision.passed,
          gates: jsonValue(decision.gates),
          reasons: jsonValue(decision.reasons),
          deltas: jsonValue(decision.deltas),
          candidateMetrics: jsonValue(promotionPayload.candidateMetrics),
          baselineMetrics: jsonValue(promotionPayload.baselineMetrics),
          payloadHash: promotionHash,
        },
      });

      await prisma.scientificEvaluationRun.update({
        where: {
          id: run.id,
        },
        data: {
          status: 'SUCCESS',
          promotionStatus: decision.status,
          finishedAt: new Date(),
          promotionDecision: jsonValue(decision),
        },
      });

      return {
        processed: oofRows.length,
        inserted: oofWrites.length + betWrites.length + 2,
        updated: 1,
        metadata: jsonValue({
          runId: run.id,
          candidateVersion: result.candidateVersion,
          baselineVersion: result.baselineVersion,
          oofRows: oofRows.length,
          evaluationRows: result.evaluationRows,
          promotionRows: result.promotionRows,
          bets: betRows.length,
          leakageViolations: result.leakageViolations,
          promotionDecision: decision,
          artifactDirectory,
          apiCalled: false,
          productionModelChanged: false,
          autoPromotion: false,
        }),
      };
    } catch (error) {
      await prisma.scientificEvaluationRun.update({
        where: {
          id: run.id,
        },
        data: {
          status: 'FAILED',
          promotionStatus: 'HOLD',
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });

      throw error;
    }
  });
}

export async function getScientificEvaluationCoverage(): Promise<{
  baselineVersion: string;
  baselineSnapshots: number;
  baselineFixtures: number;
  evaluationRuns: number;
  successfulRuns: number;
  oofPredictions: number;
  evaluationPredictions: number;
  evaluationBets: number;
  promotionDecisions: number;
  eligibleForManualPromotion: number;
  leakageViolations: number;
  byHorizon: Array<{
    horizonMinutes: number;
    oofPredictions: number;
    evaluationPredictions: number;
    bets: number;
  }>;
  latestRun: {
    id: number;
    candidateVersion: string;
    baselineVersion: string;
    status: string;
    promotionStatus: string;
    foldCount: number;
    oofRows: number;
    evaluationRows: number;
    leakageViolations: number;
    predictionMetrics: unknown;
    bettingMetrics: unknown;
    promotionDecision: unknown;
    startedAt: Date;
    finishedAt: Date | null;
  } | null;
}> {
  const version = baselineVersion();
  const [
    baselineSnapshots,
    baselineFixtures,
    evaluationRuns,
    successfulRuns,
    oofPredictions,
    evaluationPredictions,
    evaluationBets,
    promotionDecisions,
    eligibleForManualPromotion,
    predictionRows,
    oofGroups,
    evaluationGroups,
    betGroups,
    latestRun,
  ] = await Promise.all([
    prisma.scientificBaselineSnapshot.count({
      where: {
        baselineVersion: version,
      },
    }),
    prisma.scientificBaselineSnapshot.groupBy({
      by: ['fixtureId'],
      where: {
        baselineVersion: version,
      },
    }),
    prisma.scientificEvaluationRun.count(),
    prisma.scientificEvaluationRun.count({
      where: {
        status: 'SUCCESS',
      },
    }),
    prisma.scientificOofPrediction.count(),
    prisma.scientificOofPrediction.count({
      where: {
        splitRole: 'EVALUATION',
      },
    }),
    prisma.scientificEvaluationBet.count(),
    prisma.scientificPromotionDecision.count(),
    prisma.scientificPromotionDecision.count({
      where: {
        status: 'ELIGIBLE_FOR_MANUAL_PROMOTION',
      },
    }),
    prisma.scientificOofPrediction.findMany({
      select: {
        trainedThrough: true,
        predictionAsOf: true,
      },
    }),
    prisma.scientificOofPrediction.groupBy({
      by: ['horizonMinutes'],
      _count: {
        _all: true,
      },
      orderBy: {
        horizonMinutes: 'desc',
      },
    }),
    prisma.scientificOofPrediction.groupBy({
      by: ['horizonMinutes'],
      where: {
        splitRole: 'EVALUATION',
      },
      _count: {
        _all: true,
      },
      orderBy: {
        horizonMinutes: 'desc',
      },
    }),
    prisma.scientificEvaluationBet.groupBy({
      by: ['horizonMinutes'],
      _count: {
        _all: true,
      },
      orderBy: {
        horizonMinutes: 'desc',
      },
    }),
    prisma.scientificEvaluationRun.findFirst({
      orderBy: {
        startedAt: 'desc',
      },
      select: {
        id: true,
        candidateVersion: true,
        baselineVersion: true,
        status: true,
        promotionStatus: true,
        foldCount: true,
        oofRows: true,
        evaluationRows: true,
        leakageViolations: true,
        predictionMetrics: true,
        bettingMetrics: true,
        promotionDecision: true,
        startedAt: true,
        finishedAt: true,
      },
    }),
  ]);
  const leakageViolations = predictionRows.filter(
    (row: { trainedThrough: Date; predictionAsOf: Date }) =>
      row.trainedThrough.getTime() >= row.predictionAsOf.getTime(),
  ).length;
  const evaluationMap = new Map(
    evaluationGroups.map(
      (row: {
        horizonMinutes: number;
        _count: {
          _all: number;
        };
      }) => [row.horizonMinutes, row._count._all],
    ),
  );
  const betMap = new Map(
    betGroups.map(
      (row: {
        horizonMinutes: number;
        _count: {
          _all: number;
        };
      }) => [row.horizonMinutes, row._count._all],
    ),
  );

  return {
    baselineVersion: version,
    baselineSnapshots,
    baselineFixtures: baselineFixtures.length,
    evaluationRuns,
    successfulRuns,
    oofPredictions,
    evaluationPredictions,
    evaluationBets,
    promotionDecisions,
    eligibleForManualPromotion,
    leakageViolations,
    byHorizon: oofGroups.map(
      (row: {
        horizonMinutes: number;
        _count: {
          _all: number;
        };
      }) => ({
        horizonMinutes: row.horizonMinutes,
        oofPredictions: row._count._all,
        evaluationPredictions: evaluationMap.get(row.horizonMinutes) ?? 0,
        bets: betMap.get(row.horizonMinutes) ?? 0,
      }),
    ),
    latestRun,
  };
}

export async function getScientificPromotionReport(): Promise<{
  decision: unknown;
  run: unknown;
} | null> {
  const decision = await prisma.scientificPromotionDecision.findFirst({
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!decision) {
    return null;
  }

  const run = await prisma.scientificEvaluationRun.findUnique({
    where: {
      id: decision.runId,
    },
  });

  return {
    decision,
    run,
  };
}
