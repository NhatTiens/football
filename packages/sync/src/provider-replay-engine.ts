import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';

import { deterministicHash } from './scientific-evaluation-contract.js';
import {
  buildFrozenShadowCandidateProbability,
  normalizeShadowProbabilities,
  type FrozenShadowCandidateConfiguration,
} from './scientific-shadow-contract.js';
import {
  BETA1A_PROVIDER_VERSION,
  BETA1A_REPLAY_EVIDENCE_CLASS,
  BETA1A_REPLAY_POLICY_VERSION,
  assertReplaySchedulerPlan,
  buildReplaySchedulerPlan,
  classifyMatchWinner,
  parseFootballProviderMode,
  pointInTimeSafe,
  replayBrierScore,
  replayEvidenceCanPromote,
  replayLogLoss,
  resultAvailableAt,
  type FootballDataProvider,
  type MatchWinnerProbabilities,
  type NormalizedProviderFixture,
  type ProviderCapabilities,
  type ProviderPrematchSnapshot,
  type ProviderResultSnapshot,
} from './provider-contract.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';

interface RegistryRow {
  id: number;
  candidateVersion: string;
  baselineVersion: string;
  featureContractHash: string;
  status: string;
  horizonMinutes: number;
  marketBranch: string;
  formulaVersion: string;
  weights: unknown;
  temperature: number;
  maximumProbabilityShift: number;
  frozenAt: Date;
}

interface FixtureRow {
  id: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
  homeGoals: number | null;
  awayGoals: number | null;
}

interface FeatureRow {
  id: number;
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  horizonMinutes: number;
  marketAvailable: boolean;
  featureNames: unknown;
  featureVector: unknown;
  featureContractHash: string;
  payloadHash: string;
}

interface BaselineRow {
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
}

interface ReplayPredictionWrite {
  fixtureId: number;
  leagueId: number;
  predictionAsOf: Date;
  kickoffAt: Date;
  resultAvailableAt: Date;
  horizonMinutes: number;
  marketAvailable: boolean;
  teamMetricSnapshotCount: number;
  oddsSnapshotCount: number;
  latestTeamMetricCapturedAt: Date | null;
  latestOddsCapturedAt: Date | null;
  sourceFeaturePayloadHash: string;
  sourceBaselinePayloadHash: string;
  baseline: MatchWinnerProbabilities;
  candidate: MatchWinnerProbabilities;
  actualClass: 'HOME' | 'DRAW' | 'AWAY';
  baselineBrier: number;
  candidateBrier: number;
  baselineLogLoss: number;
  candidateLogLoss: number;
  pitSafe: boolean;
  evidenceClass: string;
  payloadHash: string;
}

function jsonValue(value: unknown): InputJsonValue {
  return value as InputJsonValue;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);

  return Number.isFinite(parsed) ? parsed : fallback;
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
    process.env.BETA1A_REPLAY_ARTIFACT_DIRECTORY ?? 'artifacts/provider/v7-beta1a',
  );
}

function replayDate(name: string, fallback: string): Date {
  const value = new Date(process.env[name] ?? fallback);

  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${name} is not a valid date.`);
  }

  return value;
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

  const output = value.map((entry) => Number(entry));

  if (output.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${label} contains a non-finite number.`);
  }

  return output;
}

function asNumberRecord(value: unknown): Record<string, number> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Registry weights must be an object.');
  }

  const output: Record<string, number> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const numeric = Number(rawValue);

    if (!Number.isFinite(numeric)) {
      throw new TypeError(`Registry weight ${key} is not finite.`);
    }

    output[key] = numeric;
  }

  return output;
}

function featureValue(names: string[], vector: number[], name: string): number {
  const index = names.indexOf(name);

  if (index < 0) {
    throw new Error(`Missing feature ${name}.`);
  }

  const value = vector[index];

  if (value == null || !Number.isFinite(value)) {
    throw new Error(`Feature ${name} is not finite.`);
  }

  return value;
}

function probabilityFromBaseline(row: BaselineRow): MatchWinnerProbabilities {
  return normalizeShadowProbabilities({
    HOME: row.homeProbability,
    DRAW: row.drawProbability,
    AWAY: row.awayProbability,
  });
}

function candidateConfiguration(registry: RegistryRow): FrozenShadowCandidateConfiguration {
  const weights = asNumberRecord(registry.weights);

  return {
    baselineWeight: weights.baseline ?? 0,
    dixonColesWeight: weights.dixonColes ?? 0,
    temperature: registry.temperature,
    maximumProbabilityShift: registry.maximumProbabilityShift,
  };
}

class DatabaseReplayProvider implements FootballDataProvider {
  readonly key = 'database-historical-replay';

  readonly mode = 'REPLAY' as const;

  capabilities(): ProviderCapabilities {
    return {
      FIXTURES: true,
      RESULTS: true,
      TEAM_METRICS: true,
      ODDS: true,
      STANDINGS: false,
      INJURIES: false,
      LINEUPS: false,
      historicalFrom: process.env.BETA1A_REPLAY_DATE_FROM ?? '2022-01-01T00:00:00Z',
      historicalTo: process.env.BETA1A_REPLAY_DATE_TO ?? '2024-12-31T23:59:59Z',
      live: false,
    };
  }

  async health(): Promise<{
    status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
    details: Record<string, unknown>;
  }> {
    const [fixtures, metricSnapshots, oddsSnapshots, featureSnapshots, baselineSnapshots] =
      await Promise.all([
        prisma.fixture.count({
          where: {
            status: FixtureStatus.FINISHED,
          },
        }),
        prisma.fixtureTeamMetricSnapshot.count(),
        prisma.oddsSnapshot.count(),
        prisma.mlFeatureSnapshot.count(),
        prisma.scientificBaselineSnapshot.count(),
      ]);
    const status =
      fixtures > 0 && featureSnapshots > 0 && baselineSnapshots > 0
        ? 'HEALTHY'
        : fixtures > 0
          ? 'DEGRADED'
          : 'UNAVAILABLE';

    return {
      status,
      details: {
        fixtures,
        metricSnapshots,
        oddsSnapshots,
        featureSnapshots,
        baselineSnapshots,
        externalApiCalled: false,
      },
    };
  }

  async listFixtures(input: {
    dateFrom: Date;
    dateTo: Date;
    limit?: number;
  }): Promise<NormalizedProviderFixture[]> {
    const take = input.limit != null && input.limit > 0 ? Math.floor(input.limit) : undefined;
    const rows = (await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        homeGoals: {
          not: null,
        },
        awayGoals: {
          not: null,
        },
        kickoffAt: {
          gte: input.dateFrom,
          lte: input.dateTo,
        },
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
      orderBy: [
        {
          kickoffAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
      ...(take != null
        ? {
            take,
          }
        : {}),
    })) as FixtureRow[];

    return rows.map((row) => ({
      fixtureId: row.id,
      leagueId: row.leagueId,
      homeTeamId: row.homeTeamId,
      awayTeamId: row.awayTeamId,
      kickoffAt: row.kickoffAt,
    }));
  }

  async getPrematchSnapshot(input: {
    fixtureId: number;
    asOf: Date;
  }): Promise<ProviderPrematchSnapshot> {
    const [metricRows, oddsRows] = await Promise.all([
      prisma.fixtureTeamMetricSnapshot.findMany({
        where: {
          fixtureId: input.fixtureId,
          capturedAt: {
            lte: input.asOf,
          },
        },
        select: {
          capturedAt: true,
        },
        orderBy: {
          capturedAt: 'desc',
        },
      }),
      prisma.oddsSnapshot.findMany({
        where: {
          fixtureId: input.fixtureId,
          isLive: false,
          capturedAt: {
            lte: input.asOf,
          },
        },
        select: {
          capturedAt: true,
        },
        orderBy: {
          capturedAt: 'desc',
        },
      }),
    ]);

    return {
      fixtureId: input.fixtureId,
      asOf: input.asOf,
      teamMetricSnapshotCount: metricRows.length,
      oddsSnapshotCount: oddsRows.length,
      latestTeamMetricCapturedAt: metricRows[0]?.capturedAt ?? null,
      latestOddsCapturedAt: oddsRows[0]?.capturedAt ?? null,
    };
  }

  async getResult(input: {
    fixtureId: number;
    asOf: Date;
  }): Promise<ProviderResultSnapshot | null> {
    const fixture = (await prisma.fixture.findUnique({
      where: {
        id: input.fixtureId,
      },
      select: {
        id: true,
        kickoffAt: true,
        homeGoals: true,
        awayGoals: true,
      },
    })) as {
      id: number;
      kickoffAt: Date;
      homeGoals: number | null;
      awayGoals: number | null;
    } | null;

    if (!fixture || fixture.homeGoals == null || fixture.awayGoals == null) {
      return null;
    }

    const availableAt = resultAvailableAt(
      fixture.kickoffAt,
      Math.max(0, envNumber('RESULT_AVAILABILITY_LAG_MINUTES', 180)),
    );

    if (availableAt.getTime() > input.asOf.getTime()) {
      return null;
    }

    return {
      fixtureId: fixture.id,
      availableAt,
      homeGoals: fixture.homeGoals,
      awayGoals: fixture.awayGoals,
    };
  }
}

export function createFootballDataProvider(): FootballDataProvider {
  const mode = parseFootballProviderMode(process.env.FOOTBALL_PROVIDER_MODE);

  if (mode === 'LIVE') {
    throw new Error(
      'LIVE provider is intentionally unavailable in beta.1A. Complete replay validation first, then implement beta.1B live adapter.',
    );
  }

  return new DatabaseReplayProvider();
}

async function latestFrozenRegistry(): Promise<RegistryRow> {
  const registry = await prisma.scientificCandidateRegistry.findFirst({
    where: {
      status: 'FROZEN_FOR_SHADOW',
    },
    orderBy: {
      frozenAt: 'desc',
    },
  });

  if (!registry) {
    throw new Error('No FROZEN_FOR_SHADOW alpha.8 registry exists.');
  }

  const typed = registry as RegistryRow;

  if (typed.horizonMinutes !== 90 || typed.marketBranch !== 'NO_MARKET') {
    throw new Error('beta.1A currently validates only the frozen T-90 NO_MARKET route.');
  }

  return typed;
}

async function observeProviderHealth(provider: FootballDataProvider): Promise<{
  status: string;
  details: Record<string, unknown>;
}> {
  const health = await provider.health();
  const capabilities = provider.capabilities();
  const payload = {
    providerKey: provider.key,
    providerMode: provider.mode,
    status: health.status,
    capabilities,
    details: health.details,
  };

  await prisma.providerHealthObservation.create({
    data: {
      providerKey: provider.key,
      providerMode: provider.mode,
      status: health.status,
      capabilities: jsonValue(capabilities),
      details: jsonValue(health.details),
      payloadHash: deterministicHash('PROVIDER_HEALTH_OBSERVATION', payload),
    },
  });

  return {
    status: health.status,
    details: health.details,
  };
}

export async function runProviderHealthCheck(): Promise<SyncSummary> {
  return runTrackedSync('provider-health', async () => {
    const provider = createFootballDataProvider();
    const health = await observeProviderHealth(provider);

    return {
      processed: 1,
      inserted: 1,
      updated: 0,
      metadata: jsonValue({
        providerKey: provider.key,
        providerMode: provider.mode,
        status: health.status,
        capabilities: provider.capabilities(),
        details: health.details,
        apiCalled: false,
        productionModelChanged: false,
      }),
    };
  });
}

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function accuracy(rows: ReplayPredictionWrite[], key: 'baseline' | 'candidate'): number | null {
  if (rows.length === 0) {
    return null;
  }

  let correct = 0;

  for (const row of rows) {
    const probabilities = row[key];
    const predicted = (
      Object.entries(probabilities) as Array<['HOME' | 'DRAW' | 'AWAY', number]>
    ).sort((left, right) => right[1] - left[1])[0]![0];

    if (predicted === row.actualClass) {
      correct += 1;
    }
  }

  return correct / rows.length;
}

async function replayFeature(
  registry: RegistryRow,
  fixtureId: number,
  predictionAsOf: Date,
): Promise<FeatureRow | null> {
  return (await prisma.mlFeatureSnapshot.findFirst({
    where: {
      fixtureId,
      horizonMinutes: registry.horizonMinutes,
      predictionAsOf,
      featureContractHash: registry.featureContractHash,
      marketAvailable: false,
    },
    select: {
      id: true,
      fixtureId: true,
      leagueId: true,
      predictionAsOf: true,
      kickoffAt: true,
      horizonMinutes: true,
      marketAvailable: true,
      featureNames: true,
      featureVector: true,
      featureContractHash: true,
      payloadHash: true,
    },
    orderBy: {
      id: 'desc',
    },
  })) as FeatureRow | null;
}

async function replayBaseline(
  registry: RegistryRow,
  fixtureId: number,
  predictionAsOf: Date,
): Promise<BaselineRow | null> {
  return (await prisma.scientificBaselineSnapshot.findFirst({
    where: {
      fixtureId,
      horizonMinutes: registry.horizonMinutes,
      predictionAsOf,
      baselineVersion: registry.baselineVersion,
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
    },
    orderBy: {
      id: 'desc',
    },
  })) as BaselineRow | null;
}

export async function runBeta1AReplayPipeline(): Promise<SyncSummary> {
  return runTrackedSync('provider-replay-run', async () => {
    const provider = createFootballDataProvider();
    const health = await observeProviderHealth(provider);

    if (health.status === 'UNAVAILABLE') {
      throw new Error('Replay provider has no usable historical data.');
    }

    const registry = await latestFrozenRegistry();
    const replayStartedAt = new Date();
    const dateFrom = replayDate('BETA1A_REPLAY_DATE_FROM', '2022-01-01T00:00:00Z');
    const dateTo = replayDate('BETA1A_REPLAY_DATE_TO', '2024-12-31T23:59:59Z');
    const fixtureLimit = Math.max(0, Math.floor(envNumber('BETA1A_REPLAY_FIXTURE_LIMIT', 0)));
    const fixtures = await provider.listFixtures({
      dateFrom,
      dateTo,
      ...(fixtureLimit > 0
        ? {
            limit: fixtureLimit,
          }
        : {}),
    });
    const configuration = candidateConfiguration(registry);
    const shadowRowsBefore = await prisma.scientificShadowPrediction.count();
    let schedulerEvents = 0;
    let t90EligibleFixtures = 0;
    let missingFeatureRows = 0;
    let missingBaselineRows = 0;
    let pitViolations = 0;
    const replayRows: ReplayPredictionWrite[] = [];

    for (const fixture of fixtures) {
      const plan = buildReplaySchedulerPlan(
        fixture.kickoffAt,
        Math.max(0, envNumber('RESULT_AVAILABILITY_LAG_MINUTES', 180)),
      );
      assertReplaySchedulerPlan(fixture.kickoffAt, plan);
      schedulerEvents += plan.length;

      const t90 = plan.find((event) => event.type === 'T90_SHADOW_TRIGGER');

      if (!t90) {
        throw new Error(`Fixture ${fixture.fixtureId} has no T90 replay event.`);
      }

      const prematch = await provider.getPrematchSnapshot({
        fixtureId: fixture.fixtureId,
        asOf: t90.scheduledAt,
      });
      const feature = await replayFeature(registry, fixture.fixtureId, t90.scheduledAt);

      if (!feature) {
        missingFeatureRows += 1;
        continue;
      }

      t90EligibleFixtures += 1;
      const baseline = await replayBaseline(registry, fixture.fixtureId, t90.scheduledAt);

      if (!baseline) {
        missingBaselineRows += 1;
        continue;
      }

      const names = asStringArray(feature.featureNames, 'featureNames');
      const vector = asNumberArray(feature.featureVector, 'featureVector');
      const baselineProbability = probabilityFromBaseline(baseline);
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
      const resultAt = resultAvailableAt(
        fixture.kickoffAt,
        Math.max(0, envNumber('RESULT_AVAILABILITY_LAG_MINUTES', 180)),
      );
      const result = await provider.getResult({
        fixtureId: fixture.fixtureId,
        asOf: resultAt,
      });

      if (!result) {
        continue;
      }

      const pitSafe =
        pointInTimeSafe(prematch.latestTeamMetricCapturedAt, t90.scheduledAt) &&
        pointInTimeSafe(prematch.latestOddsCapturedAt, t90.scheduledAt) &&
        feature.predictionAsOf.getTime() === t90.scheduledAt.getTime() &&
        baseline.predictionAsOf.getTime() === t90.scheduledAt.getTime() &&
        feature.kickoffAt.getTime() === fixture.kickoffAt.getTime() &&
        baseline.kickoffAt.getTime() === fixture.kickoffAt.getTime();

      if (!pitSafe) {
        pitViolations += 1;
      }

      const actualClass = classifyMatchWinner(result.homeGoals, result.awayGoals);
      const sourcePayload = {
        replayVersion: BETA1A_PROVIDER_VERSION,
        evidenceClass: BETA1A_REPLAY_EVIDENCE_CLASS,
        providerKey: provider.key,
        registryId: registry.id,
        candidateVersion: registry.candidateVersion,
        fixtureId: fixture.fixtureId,
        leagueId: fixture.leagueId,
        predictionAsOf: t90.scheduledAt.toISOString(),
        kickoffAt: fixture.kickoffAt.toISOString(),
        resultAvailableAt: result.availableAt.toISOString(),
        sourceFeaturePayloadHash: feature.payloadHash,
        sourceBaselinePayloadHash: baseline.payloadHash,
        prematch,
        baseline: baselineProbability,
        candidate,
        actualClass,
        pitSafe,
      };
      const row: ReplayPredictionWrite = {
        fixtureId: fixture.fixtureId,
        leagueId: fixture.leagueId,
        predictionAsOf: t90.scheduledAt,
        kickoffAt: fixture.kickoffAt,
        resultAvailableAt: result.availableAt,
        horizonMinutes: registry.horizonMinutes,
        marketAvailable: feature.marketAvailable,
        teamMetricSnapshotCount: prematch.teamMetricSnapshotCount,
        oddsSnapshotCount: prematch.oddsSnapshotCount,
        latestTeamMetricCapturedAt: prematch.latestTeamMetricCapturedAt,
        latestOddsCapturedAt: prematch.latestOddsCapturedAt,
        sourceFeaturePayloadHash: feature.payloadHash,
        sourceBaselinePayloadHash: baseline.payloadHash,
        baseline: baselineProbability,
        candidate,
        actualClass,
        baselineBrier: replayBrierScore(baselineProbability, actualClass),
        candidateBrier: replayBrierScore(candidate, actualClass),
        baselineLogLoss: replayLogLoss(baselineProbability, actualClass),
        candidateLogLoss: replayLogLoss(candidate, actualClass),
        pitSafe,
        evidenceClass: BETA1A_REPLAY_EVIDENCE_CLASS,
        payloadHash: deterministicHash('PROVIDER_REPLAY_PREDICTION', sourcePayload),
      };

      replayRows.push(row);
    }

    const baselineBrier = average(replayRows.map((row) => row.baselineBrier));
    const candidateBrier = average(replayRows.map((row) => row.candidateBrier));
    const baselineLogLoss = average(replayRows.map((row) => row.baselineLogLoss));
    const candidateLogLoss = average(replayRows.map((row) => row.candidateLogLoss));
    const shadowRowsAfter = await prisma.scientificShadowPrediction.count();
    const freshShadowRowsWritten = shadowRowsAfter - shadowRowsBefore;

    if (freshShadowRowsWritten !== 0) {
      throw new Error(
        `Replay isolation violated: ScientificShadowPrediction changed by ${freshShadowRowsWritten} rows during replay.`,
      );
    }

    const metrics = {
      rows: replayRows.length,
      baseline: {
        accuracy: accuracy(replayRows, 'baseline'),
        brier: baselineBrier,
        logLoss: baselineLogLoss,
      },
      candidate: {
        accuracy: accuracy(replayRows, 'candidate'),
        brier: candidateBrier,
        logLoss: candidateLogLoss,
      },
      deltas: {
        relativeBrierImprovement:
          baselineBrier != null && candidateBrier != null && baselineBrier > 1e-12
            ? (baselineBrier - candidateBrier) / baselineBrier
            : null,
        logLossChange:
          baselineLogLoss != null && candidateLogLoss != null
            ? candidateLogLoss - baselineLogLoss
            : null,
      },
      promotional: replayEvidenceCanPromote(BETA1A_REPLAY_EVIDENCE_CLASS),
    };
    const coverage = {
      fixtures: fixtures.length,
      schedulerEvents,
      t90EligibleFixtures,
      predictions: replayRows.length,
      settledPredictions: replayRows.length,
      missingFeatureRows,
      missingBaselineRows,
      pitViolations,
      teamMetricCoverage:
        replayRows.length > 0
          ? replayRows.filter((row) => row.teamMetricSnapshotCount > 0).length / replayRows.length
          : null,
      oddsCoverage:
        replayRows.length > 0
          ? replayRows.filter((row) => row.oddsSnapshotCount > 0).length / replayRows.length
          : null,
      freshShadowRowsWritten,
      oldAlpha7EvaluationReclassifiedAsFresh: false,
    };
    const payload = {
      providerVersion: BETA1A_PROVIDER_VERSION,
      policyVersion: BETA1A_REPLAY_POLICY_VERSION,
      providerKey: provider.key,
      providerMode: provider.mode,
      registryId: registry.id,
      candidateVersion: registry.candidateVersion,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      fixtureIds: fixtures.map((fixture) => fixture.fixtureId),
      predictionHashes: replayRows.map((row) => row.payloadHash),
      metrics,
      coverage,
      configuration: {
        fixtureLimit,
        resultAvailabilityLagMinutes: Math.max(
          0,
          envNumber('RESULT_AVAILABILITY_LAG_MINUTES', 180),
        ),
        providerMode: provider.mode,
        evidenceClass: BETA1A_REPLAY_EVIDENCE_CLASS,
        liveApiEnabled: false,
      },
    };
    const payloadHash = deterministicHash('PROVIDER_REPLAY_RUN', payload);
    const existing = await prisma.providerReplayRun.findUnique({
      where: {
        payloadHash,
      },
    });

    if (existing) {
      return {
        processed: fixtures.length,
        inserted: 0,
        updated: 0,
        metadata: jsonValue({
          runId: existing.id,
          idempotent: true,
          providerKey: provider.key,
          providerMode: provider.mode,
          fixtures: fixtures.length,
          predictions: replayRows.length,
          pitViolations,
          freshShadowRowsWritten,
          apiCalled: false,
          productionModelChanged: false,
          automaticPromotion: false,
        }),
      };
    }

    const artifactDirectory = resolve(
      artifactRoot(),
      `${BETA1A_PROVIDER_VERSION}-${payloadHash.slice(0, 12)}`,
    );
    mkdirSync(artifactDirectory, {
      recursive: true,
    });
    writeFileSync(
      resolve(artifactDirectory, 'replay-report.json'),
      JSON.stringify(
        {
          ...payload,
          payloadHash,
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    writeFileSync(
      resolve(artifactDirectory, 'replay-predictions.jsonl'),
      replayRows
        .map((row) =>
          JSON.stringify({
            fixtureId: row.fixtureId,
            leagueId: row.leagueId,
            predictionAsOf: row.predictionAsOf.toISOString(),
            kickoffAt: row.kickoffAt.toISOString(),
            resultAvailableAt: row.resultAvailableAt.toISOString(),
            baseline: row.baseline,
            candidate: row.candidate,
            actualClass: row.actualClass,
            baselineBrier: row.baselineBrier,
            candidateBrier: row.candidateBrier,
            baselineLogLoss: row.baselineLogLoss,
            candidateLogLoss: row.candidateLogLoss,
            pitSafe: row.pitSafe,
            evidenceClass: row.evidenceClass,
            sourceFeaturePayloadHash: row.sourceFeaturePayloadHash,
            sourceBaselinePayloadHash: row.sourceBaselinePayloadHash,
          }),
        )
        .join('\n') + (replayRows.length > 0 ? '\n' : ''),
      'utf8',
    );

    const run = await prisma.providerReplayRun.create({
      data: {
        providerKey: provider.key,
        providerMode: provider.mode,
        providerVersion: BETA1A_PROVIDER_VERSION,
        policyVersion: BETA1A_REPLAY_POLICY_VERSION,
        status: 'SUCCESS',
        dateFrom,
        dateTo,
        fixturesPlanned: fixtures.length,
        fixturesProcessed: fixtures.length,
        schedulerEvents,
        t90EligibleFixtures,
        predictions: replayRows.length,
        settledPredictions: replayRows.length,
        missingFeatureRows,
        missingBaselineRows,
        pitViolations,
        freshShadowRowsWritten,
        apiCalled: false,
        metrics: jsonValue(metrics),
        coverage: jsonValue(coverage),
        configuration: jsonValue(payload.configuration),
        artifactDirectory: relative(repositoryRoot(), artifactDirectory).replaceAll('\\', '/'),
        payloadHash,
        startedAt: replayStartedAt,
        finishedAt: new Date(),
      },
    });

    if (replayRows.length > 0) {
      for (let index = 0; index < replayRows.length; index += 250) {
        await prisma.providerReplayPrediction.createMany({
          data: replayRows.slice(index, index + 250).map((row) => ({
            runId: run.id,
            fixtureId: row.fixtureId,
            leagueId: row.leagueId,
            predictionAsOf: row.predictionAsOf,
            kickoffAt: row.kickoffAt,
            resultAvailableAt: row.resultAvailableAt,
            horizonMinutes: row.horizonMinutes,
            marketAvailable: row.marketAvailable,
            teamMetricSnapshotCount: row.teamMetricSnapshotCount,
            oddsSnapshotCount: row.oddsSnapshotCount,
            latestTeamMetricCapturedAt: row.latestTeamMetricCapturedAt,
            latestOddsCapturedAt: row.latestOddsCapturedAt,
            sourceFeaturePayloadHash: row.sourceFeaturePayloadHash,
            sourceBaselinePayloadHash: row.sourceBaselinePayloadHash,
            baselineHomeProbability: row.baseline.HOME,
            baselineDrawProbability: row.baseline.DRAW,
            baselineAwayProbability: row.baseline.AWAY,
            candidateHomeProbability: row.candidate.HOME,
            candidateDrawProbability: row.candidate.DRAW,
            candidateAwayProbability: row.candidate.AWAY,
            actualClass: row.actualClass,
            baselineBrier: row.baselineBrier,
            candidateBrier: row.candidateBrier,
            baselineLogLoss: row.baselineLogLoss,
            candidateLogLoss: row.candidateLogLoss,
            pitSafe: row.pitSafe,
            evidenceClass: row.evidenceClass,
            payloadHash: row.payloadHash,
          })),
          skipDuplicates: true,
        });
      }
    }

    return {
      processed: fixtures.length,
      inserted: replayRows.length + 2,
      updated: 0,
      metadata: jsonValue({
        runId: run.id,
        providerKey: provider.key,
        providerMode: provider.mode,
        fixtures: fixtures.length,
        schedulerEvents,
        t90EligibleFixtures,
        predictions: replayRows.length,
        settledPredictions: replayRows.length,
        missingFeatureRows,
        missingBaselineRows,
        pitViolations,
        metrics,
        coverage,
        artifactDirectory: run.artifactDirectory,
        evidenceClass: BETA1A_REPLAY_EVIDENCE_CLASS,
        promotional: false,
        freshShadowRowsWritten,
        apiCalled: false,
        productionModelChanged: false,
        automaticPromotion: false,
      }),
    };
  });
}

export async function getProviderReplayCoverage(): Promise<{
  replayRuns: number;
  successfulRuns: number;
  replayPredictions: number;
  pitViolations: number;
  freshShadowRowsWritten: number;
  promotionalReplayRows: number;
  healthObservations: number;
  latestHealth: unknown;
  latestRun: unknown;
}> {
  const [
    replayRuns,
    successfulRuns,
    replayPredictions,
    pitAggregate,
    freshAggregate,
    promotionalReplayRows,
    healthObservations,
    latestHealth,
    latestRun,
  ] = await Promise.all([
    prisma.providerReplayRun.count(),
    prisma.providerReplayRun.count({
      where: {
        status: 'SUCCESS',
      },
    }),
    prisma.providerReplayPrediction.count(),
    prisma.providerReplayRun.aggregate({
      _sum: {
        pitViolations: true,
      },
    }),
    prisma.providerReplayRun.aggregate({
      _sum: {
        freshShadowRowsWritten: true,
      },
    }),
    prisma.providerReplayPrediction.count({
      where: {
        evidenceClass: {
          not: BETA1A_REPLAY_EVIDENCE_CLASS,
        },
      },
    }),
    prisma.providerHealthObservation.count(),
    prisma.providerHealthObservation.findFirst({
      orderBy: {
        observedAt: 'desc',
      },
    }),
    prisma.providerReplayRun.findFirst({
      orderBy: {
        startedAt: 'desc',
      },
    }),
  ]);

  return {
    replayRuns,
    successfulRuns,
    replayPredictions,
    pitViolations: pitAggregate._sum.pitViolations ?? 0,
    freshShadowRowsWritten: freshAggregate._sum.freshShadowRowsWritten ?? 0,
    promotionalReplayRows,
    healthObservations,
    latestHealth,
    latestRun,
  };
}

export async function getProviderReplayReport(): Promise<{
  run: unknown;
  samplePredictions: unknown[];
  safety: {
    evidenceClass: string;
    replayCanPromote: false;
    freshShadowRowsWritten: number;
    liveApiCalled: false;
    productionModelChanged: false;
  };
} | null> {
  const run = await prisma.providerReplayRun.findFirst({
    where: {
      status: 'SUCCESS',
    },
    orderBy: {
      startedAt: 'desc',
    },
  });

  if (!run) {
    return null;
  }

  const samplePredictions = await prisma.providerReplayPrediction.findMany({
    where: {
      runId: run.id,
    },
    orderBy: {
      kickoffAt: 'asc',
    },
    take: 5,
  });

  return {
    run,
    samplePredictions,
    safety: {
      evidenceClass: BETA1A_REPLAY_EVIDENCE_CLASS,
      replayCanPromote: false,
      freshShadowRowsWritten: run.freshShadowRowsWritten,
      liveApiCalled: false,
      productionModelChanged: false,
    },
  };
}
