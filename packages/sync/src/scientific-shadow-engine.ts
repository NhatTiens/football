import { prisma, type InputJsonValue } from '@football-ai/database';

import { ML_MARKET_FEATURE_CONTRACT_HASH } from './ml-market-contract.js';
import { deterministicHash } from './scientific-evaluation-contract.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';
import {
  DEFAULT_SCIENTIFIC_SHADOW_EXPERIMENT_ID,
  SCIENTIFIC_SHADOW_FORMULA_VERSION,
  SCIENTIFIC_SHADOW_POLICY_VERSION,
  SCIENTIFIC_SHADOW_VERSION,
  buildFrozenShadowCandidateProbability,
  decideScientificShadowReview,
  normalizeShadowProbabilities,
  type FrozenShadowCandidateConfiguration,
  type ShadowBettingMetricSet,
  type ShadowMatchWinnerClass,
  type ShadowMatchWinnerProbabilities,
  type ShadowPredictionMetricSet,
} from './scientific-shadow-contract.js';

interface DevelopmentCandidateRow {
  id: number;
  diagnosticRunId: number;
  horizonMinutes: number;
  marketBranch: string;
  status: string;
  method: string;
  experimentId: string | null;
  sources: unknown;
  weights: unknown;
  temperature: number | null;
  maximumProbabilityShift: number | null;
  evaluationHoldoutUsed: boolean;
  payloadHash: string;
  createdAt: Date;
}

interface DiagnosticRunRow {
  id: number;
  status: string;
  baselineVersion: string;
  featureContractHash: string;
  diagnosticVersion: string;
  developmentPolicyVersion: string;
}

interface RegistryRow {
  id: number;
  registryKey: string;
  experimentId: string;
  sourceDiagnosticRunId: number;
  sourceDevelopmentCandidateId: number;
  candidateVersion: string;
  baselineVersion: string;
  featureContractHash: string;
  status: string;
  horizonMinutes: number;
  marketBranch: string;
  method: string;
  formulaVersion: string;
  sources: unknown;
  weights: unknown;
  temperature: number;
  maximumProbabilityShift: number;
  minimumFreshFixtures: number;
  minimumFreshBets: number;
  frozenAt: Date;
  sourcePayload: unknown;
  payloadHash: string;
  createdAt: Date;
}

interface FeatureCaptureRow {
  id: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  labelAvailableAt: Date;
  horizonMinutes: number;
  marketAvailable: boolean;
  featureNames: unknown;
  featureVector: unknown;
  featureContractHash: string;
  payloadHash: string;
  createdAt: Date;
}

interface FeatureLabelRow {
  payloadHash: string;
  fixtureId: number;
  labelMatchWinner: number;
  labelAvailableAt: Date;
}

interface BaselineCaptureRow {
  id: number;
  fixtureId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  horizonMinutes: number;
  baselineVersion: string;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  payloadHash: string;
  createdAt: Date;
}

interface ShadowPredictionWrite {
  registryId: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  labelAvailableAt: Date;
  horizonMinutes: number;
  marketAvailable: boolean;
  sourceFeatureCreatedAt: Date;
  sourceBaselineCreatedAt: Date;
  baselineHomeProbability: number;
  baselineDrawProbability: number;
  baselineAwayProbability: number;
  dixonHomeProbability: number;
  dixonDrawProbability: number;
  dixonAwayProbability: number;
  candidateHomeProbability: number;
  candidateDrawProbability: number;
  candidateAwayProbability: number;
  sourceFeaturePayloadHash: string;
  sourceBaselinePayloadHash: string;
  freshnessStatus: string;
  sourcePayload: InputJsonValue;
  payloadHash: string;
}

interface ShadowPredictionRow {
  id: number;
  registryId: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  labelAvailableAt: Date;
  horizonMinutes: number;
  marketAvailable: boolean;
  sourceFeatureCreatedAt: Date;
  sourceBaselineCreatedAt: Date;
  baselineHomeProbability: number;
  baselineDrawProbability: number;
  baselineAwayProbability: number;
  dixonHomeProbability: number;
  dixonDrawProbability: number;
  dixonAwayProbability: number;
  candidateHomeProbability: number;
  candidateDrawProbability: number;
  candidateAwayProbability: number;
  sourceFeaturePayloadHash: string;
  sourceBaselinePayloadHash: string;
  freshnessStatus: string;
  capturedAt: Date;
  payloadHash: string;
}

interface OddsRow {
  fixtureId: number;
  bookmakerId: number;
  selectionCode: string;
  decimalOdds: number;
  capturedAt: Date;
}

interface MatchWinnerOdds {
  HOME: number | null;
  DRAW: number | null;
  AWAY: number | null;
}

interface EvaluationRow {
  prediction: ShadowPredictionRow;
  actual: ShadowMatchWinnerClass;
  baseline: ShadowMatchWinnerProbabilities;
  candidate: ShadowMatchWinnerProbabilities;
  decisionOdds: MatchWinnerOdds | null;
  closingOdds: MatchWinnerOdds | null;
}

interface ShadowBetRow {
  fixtureId: number;
  horizonMinutes: number;
  source: 'BASELINE' | 'CANDIDATE';
  predictedAt: Date;
  kickoffAt: Date;
  selectionCode: ShadowMatchWinnerClass;
  decimalOdds: number;
  closingOdds: number | null;
  modelProbability: number;
  fairProbability: number | null;
  edge: number;
  expectedValue: number;
  stakeUnits: number;
  result: 'WIN' | 'LOSS';
  profitUnits: number;
  clv: number | null;
}

const CLASS_NAMES: ShadowMatchWinnerClass[] = ['HOME', 'DRAW', 'AWAY'];

const FRESHNESS_STATUS = 'PREMATCH_SOURCE_FROZEN';

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

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${label} must be a string array.`);
  }

  return value as string[];
}

function asNumberRecord(value: unknown, label: string): Record<string, number> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  const output: Record<string, number> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const numeric = Number(rawValue);

    if (!Number.isFinite(numeric)) {
      throw new TypeError(`${label}.${key} must be finite.`);
    }

    output[key] = numeric;
  }

  return output;
}

function asNumberArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }

  const output = value.map((entry) => Number(entry));

  if (output.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${label} contains a non-finite number.`);
  }

  return output;
}

function probabilityFromFields(
  home: number,
  draw: number,
  away: number,
): ShadowMatchWinnerProbabilities {
  return normalizeShadowProbabilities({
    HOME: home,
    DRAW: draw,
    AWAY: away,
  });
}

function featureValue(names: string[], vector: number[], name: string): number {
  const index = names.indexOf(name);

  if (index < 0) {
    throw new Error(`Missing feature ${name}.`);
  }

  const value = vector[index];

  if (value == null || !Number.isFinite(value)) {
    throw new Error(`Invalid feature ${name}.`);
  }

  return value;
}

function candidateConfiguration(registry: RegistryRow): FrozenShadowCandidateConfiguration {
  const weights = asNumberRecord(registry.weights, 'registry.weights');

  return {
    baselineWeight: weights.baseline ?? 0,
    dixonColesWeight: weights.dixonColes ?? 0,
    temperature: registry.temperature,
    maximumProbabilityShift: registry.maximumProbabilityShift,
  };
}

function latestRegistryWhere(): {
  status: string;
} {
  return {
    status: 'FROZEN_FOR_SHADOW',
  };
}

async function latestFrozenRegistry(): Promise<RegistryRow> {
  const registry = await prisma.scientificCandidateRegistry.findFirst({
    where: latestRegistryWhere(),
    orderBy: {
      frozenAt: 'desc',
    },
  });

  if (!registry) {
    throw new Error('No FROZEN_FOR_SHADOW candidate exists. Run scientific-shadow-freeze first.');
  }

  return registry as RegistryRow;
}

function validateFrozenRoute(development: DevelopmentCandidateRow): {
  sources: string[];
  weights: Record<string, number>;
  temperature: number;
  maximumProbabilityShift: number;
} {
  if (development.status !== 'DEVELOPMENT_CANDIDATE' || development.evaluationHoldoutUsed) {
    throw new Error('Development candidate is not safe to freeze.');
  }

  if (
    development.horizonMinutes !== 90 ||
    development.marketBranch !== 'NO_MARKET' ||
    development.method !== 'SAFE_CONVEX_BLEND'
  ) {
    throw new Error('Alpha.8 supports only the selected T-90 NO_MARKET SAFE_CONVEX_BLEND route.');
  }

  const sources = asStringArray(development.sources, 'development.sources');
  const weights = asNumberRecord(development.weights, 'development.weights');
  const allowedSources = new Set(['baseline', 'dixonColes']);

  if (
    sources.length !== 2 ||
    sources.some((source) => !allowedSources.has(source)) ||
    !sources.includes('baseline') ||
    !sources.includes('dixonColes')
  ) {
    throw new Error('Frozen alpha.8 candidate must contain only baseline and Dixon-Coles.');
  }

  const temperature = Number(development.temperature);
  const maximumProbabilityShift = Number(development.maximumProbabilityShift);
  const baselineWeight = weights.baseline ?? 0;
  const dixonColesWeight = weights.dixonColes ?? 0;
  const expectedBaselineWeight = envNumber('SCIENTIFIC_SHADOW_EXPECTED_BASELINE_WEIGHT', 0.95);
  const expectedDixonWeight = envNumber('SCIENTIFIC_SHADOW_EXPECTED_DIXON_WEIGHT', 0.05);
  const expectedTemperature = envNumber('SCIENTIFIC_SHADOW_EXPECTED_TEMPERATURE', 0.8);
  const expectedCap = envNumber('SCIENTIFIC_SHADOW_EXPECTED_MAX_SHIFT', 0.08);
  const tolerance = 1e-9;

  for (const [label, actual, expected] of [
    ['baselineWeight', baselineWeight, expectedBaselineWeight],
    ['dixonColesWeight', dixonColesWeight, expectedDixonWeight],
    ['temperature', temperature, expectedTemperature],
    ['maximumProbabilityShift', maximumProbabilityShift, expectedCap],
  ] as Array<[string, number, number]>) {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
      throw new Error(`${label} mismatch: expected ${expected}, received ${actual}.`);
    }
  }

  return {
    sources,
    weights,
    temperature,
    maximumProbabilityShift,
  };
}

export async function freezeScientificShadowCandidate(): Promise<SyncSummary> {
  return runTrackedSync('scientific-shadow-freeze', async () => {
    const experimentId =
      process.env.SCIENTIFIC_SHADOW_EXPERIMENT_ID?.trim() ||
      DEFAULT_SCIENTIFIC_SHADOW_EXPERIMENT_ID;
    const registryKey = `alpha8:t90:no-market:${experimentId}`;
    const existing = await prisma.scientificCandidateRegistry.findUnique({
      where: {
        registryKey,
      },
    });

    if (existing) {
      return {
        processed: 1,
        inserted: 0,
        updated: 0,
        metadata: jsonValue({
          registryId: existing.id,
          registryKey: existing.registryKey,
          candidateVersion: existing.candidateVersion,
          status: existing.status,
          frozenAt: existing.frozenAt,
          idempotent: true,
          productionModelChanged: false,
          automaticPromotion: false,
          apiCalled: false,
        }),
      };
    }

    const development = (await prisma.scientificDevelopmentCandidate.findFirst({
      where: {
        experimentId,
        status: 'DEVELOPMENT_CANDIDATE',
        evaluationHoldoutUsed: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })) as DevelopmentCandidateRow | null;

    if (!development) {
      throw new Error(`Development candidate ${experimentId} was not found.`);
    }

    const diagnostic = (await prisma.scientificDiagnosticRun.findUnique({
      where: {
        id: development.diagnosticRunId,
      },
    })) as DiagnosticRunRow | null;

    if (!diagnostic || diagnostic.status !== 'SUCCESS') {
      throw new Error('Source diagnostic run is not successful.');
    }

    if (diagnostic.featureContractHash !== ML_MARKET_FEATURE_CONTRACT_HASH) {
      throw new Error('Feature contract hash differs from the current alpha.6 contract.');
    }

    const validated = validateFrozenRoute(development);
    const minimumFreshFixtures = Math.max(
      1,
      Math.floor(envNumber('SCIENTIFIC_SHADOW_MIN_FRESH_FIXTURES', 150)),
    );
    const minimumFreshBets = Math.max(
      1,
      Math.floor(envNumber('SCIENTIFIC_SHADOW_MIN_FRESH_BETS', 30)),
    );
    const frozenAt = new Date();
    const sourcePayload = {
      shadowVersion: SCIENTIFIC_SHADOW_VERSION,
      formulaVersion: SCIENTIFIC_SHADOW_FORMULA_VERSION,
      policyVersion: SCIENTIFIC_SHADOW_POLICY_VERSION,
      experimentId,
      sourceDiagnosticRunId: diagnostic.id,
      sourceDevelopmentCandidateId: development.id,
      sourceDevelopmentPayloadHash: development.payloadHash,
      baselineVersion: diagnostic.baselineVersion,
      featureContractHash: diagnostic.featureContractHash,
      horizonMinutes: development.horizonMinutes,
      marketBranch: development.marketBranch,
      method: development.method,
      sources: validated.sources,
      weights: validated.weights,
      temperature: validated.temperature,
      maximumProbabilityShift: validated.maximumProbabilityShift,
      minimumFreshFixtures,
      minimumFreshBets,
      frozenAt: frozenAt.toISOString(),
      historicalEvaluationPolicy: 'OLD_ALPHA7_EVALUATION_QUARANTINED',
    };
    const payloadHash = deterministicHash('SCIENTIFIC_CANDIDATE_REGISTRY', sourcePayload);
    const candidateVersion = `${SCIENTIFIC_SHADOW_VERSION}-${experimentId}-${payloadHash.slice(0, 12)}`;
    const created = await prisma.scientificCandidateRegistry.create({
      data: {
        registryKey,
        experimentId,
        sourceDiagnosticRunId: diagnostic.id,
        sourceDevelopmentCandidateId: development.id,
        candidateVersion,
        baselineVersion: diagnostic.baselineVersion,
        featureContractHash: diagnostic.featureContractHash,
        status: 'FROZEN_FOR_SHADOW',
        horizonMinutes: development.horizonMinutes,
        marketBranch: development.marketBranch,
        method: development.method,
        formulaVersion: SCIENTIFIC_SHADOW_FORMULA_VERSION,
        sources: jsonValue(validated.sources),
        weights: jsonValue(validated.weights),
        temperature: validated.temperature,
        maximumProbabilityShift: validated.maximumProbabilityShift,
        minimumFreshFixtures,
        minimumFreshBets,
        frozenAt,
        sourcePayload: jsonValue(sourcePayload),
        payloadHash,
      },
    });

    return {
      processed: 1,
      inserted: 1,
      updated: 0,
      metadata: jsonValue({
        registryId: created.id,
        registryKey: created.registryKey,
        candidateVersion: created.candidateVersion,
        experimentId,
        baselineVersion: created.baselineVersion,
        horizonMinutes: created.horizonMinutes,
        marketBranch: created.marketBranch,
        sources: validated.sources,
        weights: validated.weights,
        temperature: validated.temperature,
        maximumProbabilityShift: validated.maximumProbabilityShift,
        minimumFreshFixtures,
        minimumFreshBets,
        frozenAt: created.frozenAt,
        oldEvaluationUsed: false,
        productionModelChanged: false,
        automaticPromotion: false,
        apiCalled: false,
      }),
    };
  });
}

function baselineKey(fixtureId: number, predictionAsOf: Date): string {
  return `${fixtureId}:${predictionAsOf.toISOString()}`;
}

export async function captureScientificShadowPredictions(): Promise<SyncSummary> {
  return runTrackedSync('scientific-shadow-capture', async () => {
    const registry = await latestFrozenRegistry();
    const features = (await prisma.mlFeatureSnapshot.findMany({
      where: {
        featureContractHash: registry.featureContractHash,
        horizonMinutes: registry.horizonMinutes,
        marketAvailable: false,
        createdAt: {
          gte: registry.frozenAt,
        },
        predictionAsOf: {
          gte: registry.frozenAt,
        },
      },
      select: {
        id: true,
        fixtureId: true,
        leagueId: true,
        predictionAsOf: true,
        kickoffAt: true,
        labelAvailableAt: true,
        horizonMinutes: true,
        marketAvailable: true,
        featureNames: true,
        featureVector: true,
        featureContractHash: true,
        payloadHash: true,
        createdAt: true,
      },
      orderBy: [
        {
          kickoffAt: 'asc',
        },
        {
          fixtureId: 'asc',
        },
      ],
    })) as FeatureCaptureRow[];

    if (features.length === 0) {
      return {
        processed: 0,
        inserted: 0,
        updated: 0,
        metadata: jsonValue({
          registryId: registry.id,
          candidateVersion: registry.candidateVersion,
          eligibleFeatureRows: 0,
          message: 'No fresh post-freeze T-90 NO_MARKET feature snapshots exist yet.',
          oldEvaluationRowsReused: 0,
          productionModelChanged: false,
          automaticPromotion: false,
          apiCalled: false,
        }),
      };
    }

    const fixtureIds = [...new Set(features.map((row) => row.fixtureId))];
    const baselines = (await prisma.scientificBaselineSnapshot.findMany({
      where: {
        fixtureId: {
          in: fixtureIds,
        },
        horizonMinutes: registry.horizonMinutes,
        baselineVersion: registry.baselineVersion,
        createdAt: {
          gte: registry.frozenAt,
        },
      },
      select: {
        id: true,
        fixtureId: true,
        predictionAsOf: true,
        kickoffAt: true,
        horizonMinutes: true,
        baselineVersion: true,
        homeProbability: true,
        drawProbability: true,
        awayProbability: true,
        payloadHash: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })) as BaselineCaptureRow[];
    const baselineMap = new Map<string, BaselineCaptureRow>();

    for (const baseline of baselines) {
      const key = baselineKey(baseline.fixtureId, baseline.predictionAsOf);

      if (!baselineMap.has(key)) {
        baselineMap.set(key, baseline);
      }
    }

    const existing = (await prisma.scientificShadowPrediction.findMany({
      where: {
        registryId: registry.id,
        sourceFeaturePayloadHash: {
          in: features.map((row) => row.payloadHash),
        },
      },
      select: {
        sourceFeaturePayloadHash: true,
      },
    })) as Array<{
      sourceFeaturePayloadHash: string;
    }>;
    const existingHashes = new Set(existing.map((row) => row.sourceFeaturePayloadHash));
    const configuration = candidateConfiguration(registry);
    const writes: ShadowPredictionWrite[] = [];
    let skippedExisting = 0;
    let skippedMissingBaseline = 0;
    let skippedFreshness = 0;

    for (const feature of features) {
      if (existingHashes.has(feature.payloadHash)) {
        skippedExisting += 1;
        continue;
      }

      const baseline = baselineMap.get(baselineKey(feature.fixtureId, feature.predictionAsOf));

      if (!baseline) {
        skippedMissingBaseline += 1;
        continue;
      }

      const fresh =
        feature.createdAt.getTime() >= registry.frozenAt.getTime() &&
        feature.predictionAsOf.getTime() >= registry.frozenAt.getTime() &&
        feature.predictionAsOf.getTime() < feature.kickoffAt.getTime() &&
        feature.createdAt.getTime() <= feature.kickoffAt.getTime() &&
        baseline.createdAt.getTime() <= feature.kickoffAt.getTime() &&
        baseline.predictionAsOf.getTime() === feature.predictionAsOf.getTime() &&
        feature.labelAvailableAt.getTime() > feature.createdAt.getTime() &&
        feature.labelAvailableAt.getTime() > baseline.createdAt.getTime();

      if (!fresh) {
        skippedFreshness += 1;
        continue;
      }

      const names = asStringArray(feature.featureNames, 'featureNames');
      const vector = asNumberArray(feature.featureVector, 'featureVector');
      const baselineProbability = probabilityFromFields(
        baseline.homeProbability,
        baseline.drawProbability,
        baseline.awayProbability,
      );
      const dixonColes = normalizeShadowProbabilities({
        HOME: featureValue(names, vector, 'dixon_coles_home_probability'),
        DRAW: featureValue(names, vector, 'dixon_coles_draw_probability'),
        AWAY: featureValue(names, vector, 'dixon_coles_away_probability'),
      });
      const candidate = buildFrozenShadowCandidateProbability(
        baselineProbability,
        dixonColes,
        configuration,
      );
      const sourcePayload = {
        shadowVersion: SCIENTIFIC_SHADOW_VERSION,
        formulaVersion: registry.formulaVersion,
        registryId: registry.id,
        candidateVersion: registry.candidateVersion,
        baselineVersion: registry.baselineVersion,
        fixtureId: feature.fixtureId,
        leagueId: feature.leagueId,
        predictionAsOf: feature.predictionAsOf.toISOString(),
        kickoffAt: feature.kickoffAt.toISOString(),
        labelAvailableAt: feature.labelAvailableAt.toISOString(),
        horizonMinutes: feature.horizonMinutes,
        marketAvailable: feature.marketAvailable,
        sourceFeaturePayloadHash: feature.payloadHash,
        sourceFeatureCreatedAt: feature.createdAt.toISOString(),
        sourceBaselinePayloadHash: baseline.payloadHash,
        sourceBaselineCreatedAt: baseline.createdAt.toISOString(),
        baseline: baselineProbability,
        dixonColes,
        candidate,
        freshnessStatus: FRESHNESS_STATUS,
      };
      const payloadHash = deterministicHash('SCIENTIFIC_SHADOW_PREDICTION', sourcePayload);

      writes.push({
        registryId: registry.id,
        fixtureId: feature.fixtureId,
        leagueId: feature.leagueId,
        predictionAsOf: feature.predictionAsOf,
        kickoffAt: feature.kickoffAt,
        labelAvailableAt: feature.labelAvailableAt,
        horizonMinutes: feature.horizonMinutes,
        marketAvailable: feature.marketAvailable,
        sourceFeatureCreatedAt: feature.createdAt,
        sourceBaselineCreatedAt: baseline.createdAt,
        baselineHomeProbability: baselineProbability.HOME,
        baselineDrawProbability: baselineProbability.DRAW,
        baselineAwayProbability: baselineProbability.AWAY,
        dixonHomeProbability: dixonColes.HOME,
        dixonDrawProbability: dixonColes.DRAW,
        dixonAwayProbability: dixonColes.AWAY,
        candidateHomeProbability: candidate.HOME,
        candidateDrawProbability: candidate.DRAW,
        candidateAwayProbability: candidate.AWAY,
        sourceFeaturePayloadHash: feature.payloadHash,
        sourceBaselinePayloadHash: baseline.payloadHash,
        freshnessStatus: FRESHNESS_STATUS,
        sourcePayload: jsonValue(sourcePayload),
        payloadHash,
      });
    }

    let inserted = 0;

    for (let index = 0; index < writes.length; index += 250) {
      const result = await prisma.scientificShadowPrediction.createMany({
        data: writes.slice(index, index + 250),
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    return {
      processed: features.length,
      inserted,
      updated: 0,
      metadata: jsonValue({
        registryId: registry.id,
        candidateVersion: registry.candidateVersion,
        featureRows: features.length,
        candidateRows: writes.length,
        inserted,
        skippedExisting,
        skippedMissingBaseline,
        skippedFreshness,
        oldEvaluationRowsReused: 0,
        labelsReadDuringCapture: false,
        freshnessRequirement:
          'feature and baseline snapshots must be created after freeze and no later than kickoff',
        productionModelChanged: false,
        automaticPromotion: false,
        apiCalled: false,
      }),
    };
  });
}

function actualClass(label: number): ShadowMatchWinnerClass {
  if (label === 0) {
    return 'HOME';
  }

  if (label === 1) {
    return 'DRAW';
  }

  if (label === 2) {
    return 'AWAY';
  }

  throw new Error(`Invalid match-winner label ${label}.`);
}

function probabilityForActual(
  probabilities: ShadowMatchWinnerProbabilities,
  actual: ShadowMatchWinnerClass,
): number {
  return normalizeShadowProbabilities(probabilities)[actual];
}

function predictionMetrics(
  rows: EvaluationRow[],
  key: 'baseline' | 'candidate',
): ShadowPredictionMetricSet {
  if (rows.length === 0) {
    return {
      rows: 0,
      accuracy: null,
      brier: null,
      logLoss: null,
      expectedCalibrationError: null,
    };
  }

  const bins = Math.max(2, Math.floor(envNumber('SCIENTIFIC_SHADOW_ECE_BINS', 10)));
  let brier = 0;
  let logLoss = 0;
  let correct = 0;
  const confidenceRows: Array<{
    confidence: number;
    correct: number;
  }> = [];

  for (const row of rows) {
    const probabilities = normalizeShadowProbabilities(row[key]);
    const actual = row.actual;
    const predicted = CLASS_NAMES.reduce(
      (best, current) => (probabilities[current] > probabilities[best] ? current : best),
      'HOME' as ShadowMatchWinnerClass,
    );
    correct += predicted === actual ? 1 : 0;
    brier +=
      (probabilities.HOME - (actual === 'HOME' ? 1 : 0)) ** 2 +
      (probabilities.DRAW - (actual === 'DRAW' ? 1 : 0)) ** 2 +
      (probabilities.AWAY - (actual === 'AWAY' ? 1 : 0)) ** 2;
    logLoss += -Math.log(Math.max(1e-12, probabilityForActual(probabilities, actual)));
    confidenceRows.push({
      confidence: Math.max(probabilities.HOME, probabilities.DRAW, probabilities.AWAY),
      correct: predicted === actual ? 1 : 0,
    });
  }

  let ece = 0;

  for (let bin = 0; bin < bins; bin += 1) {
    const lower = bin / bins;
    const upper = (bin + 1) / bins;
    const selected = confidenceRows.filter(
      (row) =>
        row.confidence >= lower &&
        (bin === bins - 1 ? row.confidence <= upper : row.confidence < upper),
    );

    if (selected.length === 0) {
      continue;
    }

    const meanConfidence = selected.reduce((sum, row) => sum + row.confidence, 0) / selected.length;
    const accuracy = selected.reduce((sum, row) => sum + row.correct, 0) / selected.length;
    ece += (selected.length / rows.length) * Math.abs(meanConfidence - accuracy);
  }

  return {
    rows: rows.length,
    accuracy: correct / rows.length,
    brier: brier / rows.length,
    logLoss: logLoss / rows.length,
    expectedCalibrationError: ece,
  };
}

function canonicalSelection(value: string): ShadowMatchWinnerClass | null {
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

    if (!selection || row.decimalOdds <= 1) {
      continue;
    }

    const existing = result[selection];

    if (existing == null || row.decimalOdds > existing) {
      result[selection] = row.decimalOdds;
    }
  }

  return result.HOME != null || result.DRAW != null || result.AWAY != null ? result : null;
}

function fairProbabilities(odds: MatchWinnerOdds | null): ShadowMatchWinnerProbabilities | null {
  if (
    odds == null ||
    odds.HOME == null ||
    odds.DRAW == null ||
    odds.AWAY == null ||
    odds.HOME <= 1 ||
    odds.DRAW <= 1 ||
    odds.AWAY <= 1
  ) {
    return null;
  }

  return normalizeShadowProbabilities({
    HOME: 1 / odds.HOME,
    DRAW: 1 / odds.DRAW,
    AWAY: 1 / odds.AWAY,
  });
}

function simulatePolicy(
  rows: EvaluationRow[],
  probabilityKey: 'baseline' | 'candidate',
  source: 'BASELINE' | 'CANDIDATE',
): {
  metrics: ShadowBettingMetricSet & Record<string, unknown>;
  bets: ShadowBetRow[];
} {
  const minimumProbability = envNumber('SCIENTIFIC_SHADOW_MIN_PROBABILITY', 0.35);
  const minimumEdge = envNumber('SCIENTIFIC_SHADOW_MIN_EDGE', 0.04);
  const minimumExpectedValue = envNumber('SCIENTIFIC_SHADOW_MIN_EXPECTED_VALUE', 0.03);
  const stakeUnits = Math.max(0.01, envNumber('SCIENTIFIC_SHADOW_STAKE_UNITS', 1));
  const bets: ShadowBetRow[] = [];
  const profits: number[] = [];
  const clvValues: number[] = [];
  let wins = 0;
  let losses = 0;

  const sortedRows = [...rows].sort(
    (left, right) =>
      left.prediction.kickoffAt.getTime() - right.prediction.kickoffAt.getTime() ||
      left.prediction.fixtureId - right.prediction.fixtureId,
  );

  for (const row of sortedRows) {
    const probabilities = normalizeShadowProbabilities(row[probabilityKey]);
    const fair = fairProbabilities(row.decisionOdds);
    const candidates: Array<{
      expectedValue: number;
      className: ShadowMatchWinnerClass;
      probability: number;
      edge: number;
      fairProbability: number | null;
      decimalOdds: number;
    }> = [];

    for (const className of CLASS_NAMES) {
      const decimalOdds = row.decisionOdds?.[className];

      if (decimalOdds == null || decimalOdds <= 1) {
        continue;
      }

      const probability = probabilities[className];
      const implied = fair?.[className] ?? 1 / decimalOdds;
      const edge = probability - implied;
      const expectedValue = probability * decimalOdds - 1;

      if (
        probability >= minimumProbability &&
        edge >= minimumEdge &&
        expectedValue >= minimumExpectedValue
      ) {
        candidates.push({
          expectedValue,
          className,
          probability,
          edge,
          fairProbability: implied,
          decimalOdds,
        });
      }
    }

    if (candidates.length === 0) {
      continue;
    }

    candidates.sort((left, right) => right.expectedValue - left.expectedValue);
    const selected = candidates[0]!;
    const isWin = selected.className === row.actual;
    const profit = isWin ? (selected.decimalOdds - 1) * stakeUnits : -stakeUnits;
    const closingOdds = row.closingOdds?.[selected.className] ?? null;
    const clv =
      closingOdds != null && closingOdds > 1 ? selected.decimalOdds / closingOdds - 1 : null;

    wins += isWin ? 1 : 0;
    losses += isWin ? 0 : 1;
    profits.push(profit);

    if (clv != null) {
      clvValues.push(clv);
    }

    bets.push({
      fixtureId: row.prediction.fixtureId,
      horizonMinutes: row.prediction.horizonMinutes,
      source,
      predictedAt: row.prediction.predictionAsOf,
      kickoffAt: row.prediction.kickoffAt,
      selectionCode: selected.className,
      decimalOdds: selected.decimalOdds,
      closingOdds,
      modelProbability: selected.probability,
      fairProbability: selected.fairProbability,
      edge: selected.edge,
      expectedValue: selected.expectedValue,
      stakeUnits,
      result: isWin ? 'WIN' : 'LOSS',
      profitUnits: profit,
      clv,
    });
  }

  let bankroll = 0;
  let peak = 0;
  let maximumDrawdownUnits = 0;

  for (const profit of profits) {
    bankroll += profit;
    peak = Math.max(peak, bankroll);
    maximumDrawdownUnits = Math.max(maximumDrawdownUnits, peak - bankroll);
  }

  const totalStake = bets.length * stakeUnits;
  const profitUnits = profits.reduce((sum, value) => sum + value, 0);
  const average = (values: number[]): number | null =>
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  return {
    metrics: {
      bets: bets.length,
      wins,
      losses,
      pushes: 0,
      stakeUnits: totalStake,
      profitUnits,
      roi: totalStake > 0 ? profitUnits / totalStake : null,
      hitRate: wins + losses > 0 ? wins / (wins + losses) : null,
      maximumDrawdownUnits,
      averageOdds: average(bets.map((bet) => bet.decimalOdds)),
      averageEdge: average(bets.map((bet) => bet.edge)),
      averageExpectedValue: average(bets.map((bet) => bet.expectedValue)),
      averageClv: average(clvValues),
      positiveClvRate:
        clvValues.length > 0
          ? clvValues.filter((value) => value > 0).length / clvValues.length
          : null,
    },
    bets,
  };
}

async function evaluationRows(registry: RegistryRow): Promise<{
  rows: EvaluationRow[];
  leakageViolations: number;
  freshnessViolations: number;
}> {
  const predictions = (await prisma.scientificShadowPrediction.findMany({
    where: {
      registryId: registry.id,
    },
    orderBy: [
      {
        kickoffAt: 'asc',
      },
      {
        fixtureId: 'asc',
      },
    ],
  })) as ShadowPredictionRow[];

  if (predictions.length === 0) {
    return {
      rows: [],
      leakageViolations: 0,
      freshnessViolations: 0,
    };
  }

  const now = new Date();
  const labels = (await prisma.mlFeatureSnapshot.findMany({
    where: {
      payloadHash: {
        in: predictions.map((row) => row.sourceFeaturePayloadHash),
      },
      labelAvailableAt: {
        lte: now,
      },
    },
    select: {
      payloadHash: true,
      fixtureId: true,
      labelMatchWinner: true,
      labelAvailableAt: true,
    },
  })) as FeatureLabelRow[];
  const labelMap = new Map(labels.map((row) => [row.payloadHash, row]));
  const settled = predictions.filter((row) => labelMap.has(row.sourceFeaturePayloadHash));
  const fixtureIds = [...new Set(settled.map((row) => row.fixtureId))];
  const maximumKickoff = settled.reduce<Date | null>(
    (maximum, row) =>
      maximum == null || row.kickoffAt.getTime() > maximum.getTime() ? row.kickoffAt : maximum,
    null,
  );
  const oddsRows =
    fixtureIds.length > 0 && maximumKickoff != null
      ? ((await prisma.oddsSnapshot.findMany({
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
          orderBy: [
            {
              fixtureId: 'asc',
            },
            {
              capturedAt: 'asc',
            },
          ],
        })) as OddsRow[])
      : [];
  const oddsByFixture = new Map<number, OddsRow[]>();

  for (const row of oddsRows) {
    const current = oddsByFixture.get(row.fixtureId) ?? [];
    current.push(row);
    oddsByFixture.set(row.fixtureId, current);
  }

  let leakageViolations = 0;
  let freshnessViolations = 0;
  const rows: EvaluationRow[] = [];

  for (const prediction of settled) {
    const label = labelMap.get(prediction.sourceFeaturePayloadHash)!;

    if (
      prediction.predictionAsOf.getTime() >= label.labelAvailableAt.getTime() ||
      prediction.predictionAsOf.getTime() >= prediction.kickoffAt.getTime()
    ) {
      leakageViolations += 1;
    }

    if (
      prediction.freshnessStatus !== FRESHNESS_STATUS ||
      prediction.sourceFeatureCreatedAt.getTime() < registry.frozenAt.getTime() ||
      prediction.sourceFeatureCreatedAt.getTime() > prediction.kickoffAt.getTime() ||
      prediction.sourceBaselineCreatedAt.getTime() > prediction.kickoffAt.getTime()
    ) {
      freshnessViolations += 1;
    }

    const fixtureOdds = oddsByFixture.get(prediction.fixtureId) ?? [];

    rows.push({
      prediction,
      actual: actualClass(label.labelMatchWinner),
      baseline: probabilityFromFields(
        prediction.baselineHomeProbability,
        prediction.baselineDrawProbability,
        prediction.baselineAwayProbability,
      ),
      candidate: probabilityFromFields(
        prediction.candidateHomeProbability,
        prediction.candidateDrawProbability,
        prediction.candidateAwayProbability,
      ),
      decisionOdds: bestPointInTimeOdds(fixtureOdds, prediction.predictionAsOf),
      closingOdds: bestPointInTimeOdds(fixtureOdds, prediction.kickoffAt),
    });
  }

  return {
    rows,
    leakageViolations,
    freshnessViolations,
  };
}

export async function evaluateScientificShadow(): Promise<SyncSummary> {
  return runTrackedSync('scientific-shadow-evaluate', async () => {
    const registry = await latestFrozenRegistry();
    const evaluation = await evaluationRows(registry);
    const freshFixtures = new Set(evaluation.rows.map((row) => row.prediction.fixtureId)).size;
    const baselinePrediction = predictionMetrics(evaluation.rows, 'baseline');
    const candidatePrediction = predictionMetrics(evaluation.rows, 'candidate');
    const baselineBetting = simulatePolicy(evaluation.rows, 'baseline', 'BASELINE');
    const candidateBetting = simulatePolicy(evaluation.rows, 'candidate', 'CANDIDATE');
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: baselinePrediction,
        betting: baselineBetting.metrics,
      },
      candidate: {
        prediction: candidatePrediction,
        betting: candidateBetting.metrics,
      },
      freshFixtures,
      leakageViolations: evaluation.leakageViolations,
      freshnessViolations: evaluation.freshnessViolations,
      minimumFreshFixtures: registry.minimumFreshFixtures,
      minimumFreshBets: registry.minimumFreshBets,
      minimumRelativeBrierImprovement: envNumber(
        'SCIENTIFIC_SHADOW_MIN_RELATIVE_BRIER_IMPROVEMENT',
        0.005,
      ),
      maximumLogLossRegression: envNumber('SCIENTIFIC_SHADOW_MAX_LOGLOSS_REGRESSION', 0),
      maximumEceRegression: envNumber('SCIENTIFIC_SHADOW_MAX_ECE_REGRESSION', 0.02),
      minimumRoiImprovement: envNumber('SCIENTIFIC_SHADOW_MIN_ROI_IMPROVEMENT', 0),
      maximumDrawdownRegressionUnits: envNumber('SCIENTIFIC_SHADOW_MAX_DRAWDOWN_REGRESSION', 2),
      requirePositiveClv: envBoolean('SCIENTIFIC_SHADOW_REQUIRE_POSITIVE_CLV', true),
    });
    const predictionMetricsPayload = {
      baseline: baselinePrediction,
      candidate: candidatePrediction,
    };
    const bettingMetricsPayload = {
      baseline: baselineBetting.metrics,
      candidate: candidateBetting.metrics,
      policyVersion: 'fixed-1x2-policy-v1',
    };
    const configuration = {
      minimumFreshFixtures: registry.minimumFreshFixtures,
      minimumFreshBets: registry.minimumFreshBets,
      minimumProbability: envNumber('SCIENTIFIC_SHADOW_MIN_PROBABILITY', 0.35),
      minimumEdge: envNumber('SCIENTIFIC_SHADOW_MIN_EDGE', 0.04),
      minimumExpectedValue: envNumber('SCIENTIFIC_SHADOW_MIN_EXPECTED_VALUE', 0.03),
      stakeUnits: envNumber('SCIENTIFIC_SHADOW_STAKE_UNITS', 1),
      minimumRelativeBrierImprovement: envNumber(
        'SCIENTIFIC_SHADOW_MIN_RELATIVE_BRIER_IMPROVEMENT',
        0.005,
      ),
      maximumLogLossRegression: envNumber('SCIENTIFIC_SHADOW_MAX_LOGLOSS_REGRESSION', 0),
      maximumEceRegression: envNumber('SCIENTIFIC_SHADOW_MAX_ECE_REGRESSION', 0.02),
      minimumRoiImprovement: envNumber('SCIENTIFIC_SHADOW_MIN_ROI_IMPROVEMENT', 0),
      maximumDrawdownRegressionUnits: envNumber('SCIENTIFIC_SHADOW_MAX_DRAWDOWN_REGRESSION', 2),
      requirePositiveClv: envBoolean('SCIENTIFIC_SHADOW_REQUIRE_POSITIVE_CLV', true),
      oldAlpha7EvaluationUsed: false,
      automaticPromotion: false,
    };
    const settledHashes = evaluation.rows.map((row) => row.prediction.payloadHash);
    const runPayload = {
      shadowVersion: SCIENTIFIC_SHADOW_VERSION,
      policyVersion: SCIENTIFIC_SHADOW_POLICY_VERSION,
      registryId: registry.id,
      candidateVersion: registry.candidateVersion,
      baselineVersion: registry.baselineVersion,
      freshFixtures,
      settledPredictionHashes: settledHashes,
      leakageViolations: evaluation.leakageViolations,
      freshnessViolations: evaluation.freshnessViolations,
      predictionMetrics: predictionMetricsPayload,
      bettingMetrics: bettingMetricsPayload,
      decision,
      configuration,
    };
    const payloadHash = deterministicHash('SCIENTIFIC_SHADOW_EVALUATION_RUN', runPayload);
    const existing = await prisma.scientificShadowEvaluationRun.findUnique({
      where: {
        payloadHash,
      },
    });

    if (existing) {
      return {
        processed: evaluation.rows.length,
        inserted: 0,
        updated: 0,
        metadata: jsonValue({
          runId: existing.id,
          registryId: registry.id,
          candidateVersion: registry.candidateVersion,
          freshFixtures,
          predictionRows: evaluation.rows.length,
          candidateBets: candidateBetting.metrics.bets,
          decisionStatus: existing.decisionStatus,
          idempotent: true,
          oldEvaluationRowsReused: 0,
          productionModelChanged: false,
          automaticPromotion: false,
          apiCalled: false,
        }),
      };
    }

    const dateFrom = evaluation.rows.length > 0 ? evaluation.rows[0]!.prediction.kickoffAt : null;
    const dateTo =
      evaluation.rows.length > 0
        ? evaluation.rows[evaluation.rows.length - 1]!.prediction.kickoffAt
        : null;
    const run = await prisma.scientificShadowEvaluationRun.create({
      data: {
        registryId: registry.id,
        candidateVersion: registry.candidateVersion,
        baselineVersion: registry.baselineVersion,
        status: 'SUCCESS',
        decisionStatus: decision.status,
        policyVersion: SCIENTIFIC_SHADOW_POLICY_VERSION,
        dateFrom,
        dateTo,
        freshFixtures,
        predictionRows: evaluation.rows.length,
        candidateBets: candidateBetting.metrics.bets,
        leakageViolations: evaluation.leakageViolations,
        freshnessViolations: evaluation.freshnessViolations,
        predictionMetrics: jsonValue(predictionMetricsPayload),
        bettingMetrics: jsonValue(bettingMetricsPayload),
        decision: jsonValue(decision),
        configuration: jsonValue(configuration),
        payloadHash,
        finishedAt: new Date(),
      },
    });

    const allBets = [...baselineBetting.bets, ...candidateBetting.bets];

    if (allBets.length > 0) {
      await prisma.scientificShadowBet.createMany({
        data: allBets.map((bet) => {
          const betPayload = {
            runId: run.id,
            registryId: registry.id,
            fixtureId: bet.fixtureId,
            source: bet.source,
            predictedAt: bet.predictedAt.toISOString(),
            selectionCode: bet.selectionCode,
            decimalOdds: bet.decimalOdds,
            modelProbability: bet.modelProbability,
            fairProbability: bet.fairProbability,
            edge: bet.edge,
            expectedValue: bet.expectedValue,
            result: bet.result,
            profitUnits: bet.profitUnits,
            clv: bet.clv,
          };

          return {
            runId: run.id,
            registryId: registry.id,
            fixtureId: bet.fixtureId,
            horizonMinutes: bet.horizonMinutes,
            source: bet.source,
            predictedAt: bet.predictedAt,
            kickoffAt: bet.kickoffAt,
            selectionCode: bet.selectionCode,
            decimalOdds: bet.decimalOdds,
            closingOdds: bet.closingOdds,
            modelProbability: bet.modelProbability,
            fairProbability: bet.fairProbability,
            edge: bet.edge,
            expectedValue: bet.expectedValue,
            stakeUnits: bet.stakeUnits,
            result: bet.result,
            profitUnits: bet.profitUnits,
            clv: bet.clv,
            payloadHash: deterministicHash('SCIENTIFIC_SHADOW_BET', betPayload),
          };
        }),
        skipDuplicates: true,
      });
    }

    const decisionPayload = {
      runId: run.id,
      registryId: registry.id,
      candidateVersion: registry.candidateVersion,
      baselineVersion: registry.baselineVersion,
      status: decision.status,
      passed: decision.passed,
      gates: decision.gates,
      reasons: decision.reasons,
      deltas: decision.deltas,
      freshFixtures,
      candidateBets: candidateBetting.metrics.bets,
    };
    const shadowDecision = await prisma.scientificShadowDecision.create({
      data: {
        runId: run.id,
        registryId: registry.id,
        candidateVersion: registry.candidateVersion,
        baselineVersion: registry.baselineVersion,
        status: decision.status,
        passed: decision.passed,
        gates: jsonValue(decision.gates),
        reasons: jsonValue(decision.reasons),
        deltas: jsonValue(decision.deltas),
        freshFixtures,
        candidateBets: candidateBetting.metrics.bets,
        payloadHash: deterministicHash('SCIENTIFIC_SHADOW_DECISION', decisionPayload),
      },
    });

    return {
      processed: evaluation.rows.length,
      inserted: 2 + allBets.length,
      updated: 0,
      metadata: jsonValue({
        runId: run.id,
        decisionId: shadowDecision.id,
        registryId: registry.id,
        candidateVersion: registry.candidateVersion,
        baselineVersion: registry.baselineVersion,
        freshFixtures,
        predictionRows: evaluation.rows.length,
        baselineBets: baselineBetting.metrics.bets,
        candidateBets: candidateBetting.metrics.bets,
        leakageViolations: evaluation.leakageViolations,
        freshnessViolations: evaluation.freshnessViolations,
        decisionStatus: decision.status,
        passed: decision.passed,
        oldEvaluationRowsReused: 0,
        productionModelChanged: false,
        automaticPromotion: false,
        apiCalled: false,
      }),
    };
  });
}

export async function getScientificShadowCoverage(): Promise<{
  registries: number;
  frozenRegistries: number;
  shadowPredictions: number;
  freshPredictions: number;
  evaluationRuns: number;
  reviewEligibleRuns: number;
  decisions: number;
  latestRegistry: unknown;
  latestRun: unknown;
  latestDecision: unknown;
}> {
  const [
    registries,
    frozenRegistries,
    shadowPredictions,
    freshPredictions,
    evaluationRuns,
    reviewEligibleRuns,
    decisions,
    latestRegistry,
    latestRun,
    latestDecision,
  ] = await Promise.all([
    prisma.scientificCandidateRegistry.count(),
    prisma.scientificCandidateRegistry.count({
      where: {
        status: 'FROZEN_FOR_SHADOW',
      },
    }),
    prisma.scientificShadowPrediction.count(),
    prisma.scientificShadowPrediction.count({
      where: {
        freshnessStatus: FRESHNESS_STATUS,
      },
    }),
    prisma.scientificShadowEvaluationRun.count(),
    prisma.scientificShadowEvaluationRun.count({
      where: {
        decisionStatus: 'ELIGIBLE_FOR_MANUAL_REVIEW',
      },
    }),
    prisma.scientificShadowDecision.count(),
    prisma.scientificCandidateRegistry.findFirst({
      orderBy: {
        frozenAt: 'desc',
      },
    }),
    prisma.scientificShadowEvaluationRun.findFirst({
      orderBy: {
        startedAt: 'desc',
      },
    }),
    prisma.scientificShadowDecision.findFirst({
      orderBy: {
        createdAt: 'desc',
      },
    }),
  ]);

  return {
    registries,
    frozenRegistries,
    shadowPredictions,
    freshPredictions,
    evaluationRuns,
    reviewEligibleRuns,
    decisions,
    latestRegistry,
    latestRun,
    latestDecision,
  };
}

export async function getScientificShadowReport(): Promise<{
  registry: unknown;
  latestEvaluation: unknown;
  latestDecision: unknown;
  routing: {
    candidate: string;
    fallback: string;
    productionChanged: false;
  };
} | null> {
  const registry = await prisma.scientificCandidateRegistry.findFirst({
    where: latestRegistryWhere(),
    orderBy: {
      frozenAt: 'desc',
    },
  });

  if (!registry) {
    return null;
  }

  const [latestEvaluation, latestDecision] = await Promise.all([
    prisma.scientificShadowEvaluationRun.findFirst({
      where: {
        registryId: registry.id,
      },
      orderBy: {
        startedAt: 'desc',
      },
    }),
    prisma.scientificShadowDecision.findFirst({
      where: {
        registryId: registry.id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    }),
  ]);

  return {
    registry,
    latestEvaluation,
    latestDecision,
    routing: {
      candidate: 'T-90 + NO_MARKET only',
      fallback: 'v6.2.3 baseline for T-30, T-5, WITH_MARKET and production output',
      productionChanged: false,
    },
  };
}
