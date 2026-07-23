import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';

import {
  buildTeamFundamentals,
  fitDynamicDixonColes,
  predictDixonColes,
  unavailableFundamentalsPrediction,
  type DixonColesTrainingMatch,
  type FundamentalsFixturePrediction,
  type HistoricalFixture,
  type HistoricalTeamMetric,
  type TeamFundamentals,
} from './fundamentals-core.js';
import { selectLatestSnapshotsAsOf, stableSnapshotHash } from './scientific-snapshots.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';

export type { FundamentalsFixturePrediction } from './fundamentals-core.js';

interface FixtureInput {
  fixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
  predictionAsOf: Date;
  horizonMinutes?: number;
  persist?: boolean;
}

interface HistoryFixtureRow {
  id: number;
  leagueId: number;
  kickoffAt: Date;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number | null;
  awayGoals: number | null;
}

interface MetricSnapshotRow {
  id: number;
  fixtureId: number;
  teamId: number;
  expectedGoals: number | null;
  shots: number | null;
  shotsOnGoal: number | null;
  possession: number | null;
  corners: number | null;
  capturedAt: Date;
}

interface CurrentMetricRow {
  fixtureId: number;
  teamId: number;
  expectedGoals: number | null;
  shots: number | null;
  shotsOnGoal: number | null;
  possession: number | null;
  corners: number | null;
  capturedAt: Date;
}

function jsonValue(value: unknown): InputJsonValue {
  return value as InputJsonValue;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseHorizons(
  value = process.env.FUNDAMENTALS_BACKFILL_HORIZONS_MINUTES ?? '90,30,5',
): number[] {
  const horizons = value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry >= 0);

  if (horizons.length === 0) {
    throw new Error('FUNDAMENTALS_BACKFILL_HORIZONS_MINUTES cannot be empty.');
  }

  return [...new Set(horizons)].sort((left, right) => right - left);
}

function metricKey(fixtureId: number, teamId: number): string {
  return `${fixtureId}:${teamId}`;
}

function resultAvailableAt(kickoffAt: Date): Date {
  const lagMinutes = Math.max(0, envNumber('RESULT_AVAILABILITY_LAG_MINUTES', 180));

  return new Date(kickoffAt.getTime() + lagMinutes * 60_000);
}

function toMetric(
  row: MetricSnapshotRow | CurrentMetricRow | undefined,
): HistoricalTeamMetric | null {
  return row
    ? {
        expectedGoals: row.expectedGoals,
        shots: row.shots,
        shotsOnGoal: row.shotsOnGoal,
        possession: row.possession,
        corners: row.corners,
        capturedAt: row.capturedAt,
      }
    : null;
}

function parseStoredTeamFundamentals(value: unknown): TeamFundamentals | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }

  const row = value as Record<string, unknown>;
  const windows = row.windows as TeamFundamentals['windows'] | undefined;
  const venueSummary = row.venueSummary as TeamFundamentals['venueSummary'] | undefined;

  if (
    typeof row.teamId !== 'number' ||
    typeof row.leagueId !== 'number' ||
    typeof row.fixtureId !== 'number' ||
    typeof row.predictionAsOf !== 'string' ||
    (row.venueRole !== 'HOME' && row.venueRole !== 'AWAY') ||
    windows == null ||
    venueSummary == null
  ) {
    return null;
  }

  const predictionAsOf = new Date(row.predictionAsOf);
  const latestSourceKickoffAt =
    typeof row.latestSourceKickoffAt === 'string' ? new Date(row.latestSourceKickoffAt) : null;
  const latestSourceAvailableAt =
    typeof row.latestSourceAvailableAt === 'string' ? new Date(row.latestSourceAvailableAt) : null;

  if (!Number.isFinite(predictionAsOf.getTime())) {
    return null;
  }

  return {
    teamId: row.teamId,
    leagueId: row.leagueId,
    targetFixtureId: row.fixtureId,
    predictionAsOf,
    venueRole: row.venueRole,
    windows,
    venueSummary,
    sampleSize: typeof row.sampleSize === 'number' ? row.sampleSize : 0,
    venueSampleSize: typeof row.venueSampleSize === 'number' ? row.venueSampleSize : 0,
    restDays: typeof row.restDays === 'number' ? row.restDays : 7,
    dataQualityScore: typeof row.dataQualityScore === 'number' ? row.dataQualityScore : 0,
    latestSourceFixtureId:
      typeof row.latestSourceFixtureId === 'number' ? row.latestSourceFixtureId : null,
    latestSourceKickoffAt:
      latestSourceKickoffAt && Number.isFinite(latestSourceKickoffAt.getTime())
        ? latestSourceKickoffAt
        : null,
    latestSourceAvailableAt:
      latestSourceAvailableAt && Number.isFinite(latestSourceAvailableAt.getTime())
        ? latestSourceAvailableAt
        : null,
    sourceFixtureIds: Array.isArray(row.sourceFixtureIds)
      ? row.sourceFixtureIds.filter((entry): entry is number => typeof entry === 'number')
      : [],
  };
}

async function readStoredPrediction(input: {
  fixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  predictionAsOf: Date;
  horizonMinutes: number;
}): Promise<FundamentalsFixturePrediction | null> {
  const dixon = await prisma.dixonColesPredictionSnapshot.findFirst({
    where: {
      fixtureId: input.fixtureId,
      leagueId: input.leagueId,
      horizonMinutes: input.horizonMinutes,
      predictionAsOf: {
        lte: input.predictionAsOf,
      },
      trainedThrough: {
        lte: input.predictionAsOf,
      },
    },
    select: {
      predictionAsOf: true,
      trainedFrom: true,
      trainedThrough: true,
      sampleSize: true,
      teamCount: true,
      halfLifeDays: true,
      rho: true,
      intercept: true,
      homeAdvantage: true,
      homeExpectedGoals: true,
      awayExpectedGoals: true,
      homeProbability: true,
      drawProbability: true,
      awayProbability: true,
      over25Probability: true,
      bttsProbability: true,
      dataQualityScore: true,
      modelPayload: true,
    },
    orderBy: [{ predictionAsOf: 'desc' }, { id: 'desc' }],
  });

  if (!dixon) return null;

  const teamRows = await prisma.teamFundamentalSnapshot.findMany({
    where: {
      fixtureId: input.fixtureId,
      horizonMinutes: input.horizonMinutes,
      predictionAsOf: dixon.predictionAsOf,
      teamId: {
        in: [input.homeTeamId, input.awayTeamId],
      },
    },
    select: {
      teamId: true,
      rawPayload: true,
    },
    orderBy: {
      id: 'desc',
    },
  });

  const parsed = new Map<number, TeamFundamentals>();

  for (const row of teamRows) {
    if (parsed.has(row.teamId)) continue;
    const fundamentals = parseStoredTeamFundamentals(row.rawPayload);
    if (fundamentals) {
      parsed.set(row.teamId, fundamentals);
    }
  }

  const home = parsed.get(input.homeTeamId);
  const away = parsed.get(input.awayTeamId);

  if (!home || !away) return null;

  const payload = dixon.modelPayload as Record<string, unknown>;
  const attacks =
    payload && typeof payload.attacks === 'object' && payload.attacks != null
      ? (payload.attacks as Record<string, number>)
      : {};
  const defenses =
    payload && typeof payload.defenses === 'object' && payload.defenses != null
      ? (payload.defenses as Record<string, number>)
      : {};

  return {
    available: true,
    fixtureId: input.fixtureId,
    leagueId: input.leagueId,
    predictionAsOf: dixon.predictionAsOf,
    horizonMinutes: input.horizonMinutes,
    home,
    away,
    dixonColes: {
      leagueId: input.leagueId,
      trainedFrom: dixon.trainedFrom,
      trainedThrough: dixon.trainedThrough,
      sampleSize: dixon.sampleSize,
      teamCount: dixon.teamCount,
      halfLifeDays: dixon.halfLifeDays,
      rho: dixon.rho,
      intercept: dixon.intercept,
      homeAdvantage: dixon.homeAdvantage,
      attacks,
      defenses,
    },
    homeExpectedGoals: dixon.homeExpectedGoals,
    awayExpectedGoals: dixon.awayExpectedGoals,
    matchWinner: {
      HOME: dixon.homeProbability,
      DRAW: dixon.drawProbability,
      AWAY: dixon.awayProbability,
    },
    over25: {
      OVER: dixon.over25Probability,
      UNDER: 1 - dixon.over25Probability,
    },
    btts: {
      YES: dixon.bttsProbability,
      NO: 1 - dixon.bttsProbability,
    },
    dataQualityScore: dixon.dataQualityScore,
    reasons: [
      `Đọc snapshot Fundamentals/Dixon–Coles đã backfill tại ${dixon.predictionAsOf.toISOString()}.`,
      `Model được huấn luyện đến ${dixon.trainedThrough.toISOString()}, mẫu ${dixon.sampleSize} trận.`,
    ],
  };
}

async function loadHistoricalData(input: {
  leagueId: number;
  targetFixtureId: number;
  targetKickoffAt: Date;
  predictionAsOf: Date;
}): Promise<HistoricalFixture[]> {
  const historyLimit = Math.max(
    50,
    Math.floor(envNumber('FUNDAMENTALS_HISTORY_FIXTURE_LIMIT', 2400)),
  );
  const fixtures = (await prisma.fixture.findMany({
    where: {
      leagueId: input.leagueId,
      status: FixtureStatus.FINISHED,
      id: { not: input.targetFixtureId },
      kickoffAt: {
        lt: input.targetKickoffAt,
      },
      homeGoals: { not: null },
      awayGoals: { not: null },
    },
    select: {
      id: true,
      leagueId: true,
      kickoffAt: true,
      homeTeamId: true,
      awayTeamId: true,
      homeGoals: true,
      awayGoals: true,
    },
    orderBy: {
      kickoffAt: 'desc',
    },
    take: historyLimit,
  })) as HistoryFixtureRow[];

  const fixtureIds = fixtures.map((fixture) => fixture.id);

  if (fixtureIds.length === 0) return [];

  const snapshots = (await prisma.fixtureTeamMetricSnapshot.findMany({
    where: {
      fixtureId: { in: fixtureIds },
      capturedAt: {
        lte: input.predictionAsOf,
      },
    },
    select: {
      id: true,
      fixtureId: true,
      teamId: true,
      expectedGoals: true,
      shots: true,
      shotsOnGoal: true,
      possession: true,
      corners: true,
      capturedAt: true,
    },
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
  })) as MetricSnapshotRow[];

  const selectedSnapshots = selectLatestSnapshotsAsOf(snapshots, input.predictionAsOf, (row) =>
    metricKey(row.fixtureId, row.teamId),
  );
  const metricMap = new Map<string, MetricSnapshotRow | CurrentMetricRow>(
    selectedSnapshots.map((row) => [metricKey(row.fixtureId, row.teamId), row]),
  );

  const currentRows = (await prisma.fixtureTeamMetric.findMany({
    where: {
      fixtureId: { in: fixtureIds },
      capturedAt: {
        lte: input.predictionAsOf,
      },
    },
    select: {
      fixtureId: true,
      teamId: true,
      expectedGoals: true,
      shots: true,
      shotsOnGoal: true,
      possession: true,
      corners: true,
      capturedAt: true,
    },
  })) as CurrentMetricRow[];

  for (const row of currentRows) {
    const key = metricKey(row.fixtureId, row.teamId);
    if (!metricMap.has(key)) {
      metricMap.set(key, row);
    }
  }

  return fixtures
    .map((fixture) => ({
      fixtureId: fixture.id,
      leagueId: fixture.leagueId,
      kickoffAt: fixture.kickoffAt,
      availableAt: resultAvailableAt(fixture.kickoffAt),
      homeTeamId: fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      homeGoals: fixture.homeGoals ?? 0,
      awayGoals: fixture.awayGoals ?? 0,
      homeMetric: toMetric(metricMap.get(metricKey(fixture.id, fixture.homeTeamId))),
      awayMetric: toMetric(metricMap.get(metricKey(fixture.id, fixture.awayTeamId))),
    }))
    .filter((fixture) => fixture.availableAt.getTime() <= input.predictionAsOf.getTime())
    .sort(
      (left, right) =>
        left.kickoffAt.getTime() - right.kickoffAt.getTime() || left.fixtureId - right.fixtureId,
    );
}

function teamSnapshotPayload(input: {
  fundamentals: TeamFundamentals;
  horizonMinutes: number;
}): Record<string, unknown> {
  const { fundamentals } = input;
  return {
    fixtureId: fundamentals.targetFixtureId,
    teamId: fundamentals.teamId,
    leagueId: fundamentals.leagueId,
    predictionAsOf: fundamentals.predictionAsOf.toISOString(),
    horizonMinutes: input.horizonMinutes,
    venueRole: fundamentals.venueRole,
    sampleSize: fundamentals.sampleSize,
    venueSampleSize: fundamentals.venueSampleSize,
    restDays: fundamentals.restDays,
    dataQualityScore: fundamentals.dataQualityScore,
    windows: fundamentals.windows,
    venueSummary: fundamentals.venueSummary,
    latestSourceFixtureId: fundamentals.latestSourceFixtureId,
    latestSourceKickoffAt: fundamentals.latestSourceKickoffAt?.toISOString() ?? null,
    latestSourceAvailableAt: fundamentals.latestSourceAvailableAt?.toISOString() ?? null,
    sourceFixtureIds: fundamentals.sourceFixtureIds,
  };
}

function teamSnapshotData(input: {
  fundamentals: TeamFundamentals;
  horizonMinutes: number;
  payloadHash: string;
}) {
  const w5 = input.fundamentals.windows[5];
  const w10 = input.fundamentals.windows[10];
  const w20 = input.fundamentals.windows[20];
  const venue = input.fundamentals.venueSummary;

  return {
    fixtureId: input.fundamentals.targetFixtureId,
    teamId: input.fundamentals.teamId,
    leagueId: input.fundamentals.leagueId,
    predictionAsOf: input.fundamentals.predictionAsOf,
    horizonMinutes: input.horizonMinutes,
    venueRole: input.fundamentals.venueRole,
    sampleSize: input.fundamentals.sampleSize,
    venueSampleSize: input.fundamentals.venueSampleSize,
    matches5: w5.matches,
    matches10: w10.matches,
    matches20: w20.matches,
    pointsPerGame5: w5.pointsPerGame,
    pointsPerGame10: w10.pointsPerGame,
    pointsPerGame20: w20.pointsPerGame,
    goalsFor5: w5.goalsFor,
    goalsFor10: w10.goalsFor,
    goalsFor20: w20.goalsFor,
    goalsAgainst5: w5.goalsAgainst,
    goalsAgainst10: w10.goalsAgainst,
    goalsAgainst20: w20.goalsAgainst,
    expectedGoalsFor10: w10.expectedGoalsFor,
    expectedGoalsAgainst10: w10.expectedGoalsAgainst,
    shots10: w10.shots,
    shotsOnGoal10: w10.shotsOnGoal,
    possession10: w10.possession,
    corners10: w10.corners,
    winRate10: w10.winRate,
    drawRate10: w10.drawRate,
    lossRate10: w10.lossRate,
    cleanSheetRate10: w10.cleanSheetRate,
    bttsRate10: w10.bttsRate,
    over25Rate10: w10.over25Rate,
    metricCoverage10: w10.metricCoverage,
    venuePointsPerGame10: venue.pointsPerGame,
    venueGoalsFor10: venue.goalsFor,
    venueGoalsAgainst10: venue.goalsAgainst,
    restDays: input.fundamentals.restDays,
    dataQualityScore: input.fundamentals.dataQualityScore,
    latestSourceFixtureId: input.fundamentals.latestSourceFixtureId,
    latestSourceKickoffAt: input.fundamentals.latestSourceKickoffAt,
    latestSourceAvailableAt: input.fundamentals.latestSourceAvailableAt,
    rawPayload: jsonValue(teamSnapshotPayload(input)),
    payloadHash: input.payloadHash,
  };
}

async function persistPrediction(prediction: FundamentalsFixturePrediction): Promise<{
  teamSnapshots: number;
  dixonColesSnapshots: number;
}> {
  const homePayload = teamSnapshotPayload({
    fundamentals: prediction.home,
    horizonMinutes: prediction.horizonMinutes,
  });
  const awayPayload = teamSnapshotPayload({
    fundamentals: prediction.away,
    horizonMinutes: prediction.horizonMinutes,
  });
  const homeHash = stableSnapshotHash('TEAM_FUNDAMENTAL', homePayload);
  const awayHash = stableSnapshotHash('TEAM_FUNDAMENTAL', awayPayload);

  const teamWrite = await prisma.teamFundamentalSnapshot.createMany({
    data: [
      teamSnapshotData({
        fundamentals: prediction.home,
        horizonMinutes: prediction.horizonMinutes,
        payloadHash: homeHash,
      }),
      teamSnapshotData({
        fundamentals: prediction.away,
        horizonMinutes: prediction.horizonMinutes,
        payloadHash: awayHash,
      }),
    ],
    skipDuplicates: true,
  });

  if (!prediction.available || !prediction.dixonColes) {
    return {
      teamSnapshots: teamWrite.count,
      dixonColesSnapshots: 0,
    };
  }

  const model = prediction.dixonColes;
  const dixonPayload = {
    fixtureId: prediction.fixtureId,
    leagueId: prediction.leagueId,
    predictionAsOf: prediction.predictionAsOf.toISOString(),
    horizonMinutes: prediction.horizonMinutes,
    trainedFrom: model.trainedFrom.toISOString(),
    trainedThrough: model.trainedThrough.toISOString(),
    sampleSize: model.sampleSize,
    teamCount: model.teamCount,
    halfLifeDays: model.halfLifeDays,
    rho: model.rho,
    intercept: model.intercept,
    homeAdvantage: model.homeAdvantage,
    attacks: model.attacks,
    defenses: model.defenses,
    homeExpectedGoals: prediction.homeExpectedGoals,
    awayExpectedGoals: prediction.awayExpectedGoals,
    matchWinner: prediction.matchWinner,
    over25: prediction.over25,
    btts: prediction.btts,
    dataQualityScore: prediction.dataQualityScore,
  };
  const payloadHash = stableSnapshotHash('DIXON_COLES_PREDICTION', dixonPayload);
  const dixonWrite = await prisma.dixonColesPredictionSnapshot.createMany({
    data: [
      {
        fixtureId: prediction.fixtureId,
        leagueId: prediction.leagueId,
        predictionAsOf: prediction.predictionAsOf,
        horizonMinutes: prediction.horizonMinutes,
        trainedFrom: model.trainedFrom,
        trainedThrough: model.trainedThrough,
        sampleSize: model.sampleSize,
        teamCount: model.teamCount,
        halfLifeDays: model.halfLifeDays,
        rho: model.rho,
        intercept: model.intercept,
        homeAdvantage: model.homeAdvantage,
        homeExpectedGoals: prediction.homeExpectedGoals,
        awayExpectedGoals: prediction.awayExpectedGoals,
        homeProbability: prediction.matchWinner.HOME,
        drawProbability: prediction.matchWinner.DRAW,
        awayProbability: prediction.matchWinner.AWAY,
        over25Probability: prediction.over25.OVER,
        bttsProbability: prediction.btts.YES,
        dataQualityScore: prediction.dataQualityScore,
        modelPayload: jsonValue(dixonPayload),
        payloadHash,
      },
    ],
    skipDuplicates: true,
  });

  return {
    teamSnapshots: teamWrite.count,
    dixonColesSnapshots: dixonWrite.count,
  };
}

export async function getFundamentalsFixturePrediction(
  input: FixtureInput,
): Promise<FundamentalsFixturePrediction> {
  const horizonMinutes =
    input.horizonMinutes ??
    Math.max(0, Math.round((input.kickoffAt.getTime() - input.predictionAsOf.getTime()) / 60_000));
  if (!input.persist) {
    const stored = await readStoredPrediction({
      fixtureId: input.fixtureId,
      leagueId: input.leagueId,
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
      predictionAsOf: input.predictionAsOf,
      horizonMinutes,
    });

    if (stored) return stored;
  }

  const history = await loadHistoricalData({
    leagueId: input.leagueId,
    targetFixtureId: input.fixtureId,
    targetKickoffAt: input.kickoffAt,
    predictionAsOf: input.predictionAsOf,
  });
  const home = buildTeamFundamentals({
    fixtures: history,
    teamId: input.homeTeamId,
    leagueId: input.leagueId,
    targetFixtureId: input.fixtureId,
    targetKickoffAt: input.kickoffAt,
    predictionAsOf: input.predictionAsOf,
    venueRole: 'HOME',
  });
  const away = buildTeamFundamentals({
    fixtures: history,
    teamId: input.awayTeamId,
    leagueId: input.leagueId,
    targetFixtureId: input.fixtureId,
    targetKickoffAt: input.kickoffAt,
    predictionAsOf: input.predictionAsOf,
    venueRole: 'AWAY',
  });
  const trainingMatches: DixonColesTrainingMatch[] = history.map((fixture) => ({
    fixtureId: fixture.fixtureId,
    kickoffAt: fixture.kickoffAt,
    availableAt: fixture.availableAt,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    homeGoals: fixture.homeGoals,
    awayGoals: fixture.awayGoals,
  }));
  const model = fitDynamicDixonColes({
    leagueId: input.leagueId,
    matches: trainingMatches,
    predictionAsOf: input.predictionAsOf,
    options: {
      halfLifeDays: Math.max(30, envNumber('DIXON_COLES_HALF_LIFE_DAYS', 240)),
      iterations: Math.max(25, Math.floor(envNumber('DIXON_COLES_ITERATIONS', 220))),
      learningRate: envNumber('DIXON_COLES_LEARNING_RATE', 0.012),
      l2: envNumber('DIXON_COLES_L2', 0.018),
    },
  });

  let prediction: FundamentalsFixturePrediction;

  if (!model) {
    prediction = unavailableFundamentalsPrediction({
      fixtureId: input.fixtureId,
      leagueId: input.leagueId,
      predictionAsOf: input.predictionAsOf,
      horizonMinutes,
      home,
      away,
      reason: 'Dixon–Coles chưa đủ tối thiểu 12 trận lịch sử hợp lệ trước predictionAsOf.',
    });
  } else {
    const probabilities = predictDixonColes({
      model,
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
      maximumGoals: Math.max(7, Math.floor(envNumber('DIXON_COLES_MAXIMUM_GOALS', 10))),
    });
    const dataQualityScore = Math.min(
      1,
      Math.max(
        0,
        ((home.dataQualityScore + away.dataQualityScore) / 2) * 0.65 +
          Math.min(1, model.sampleSize / 300) * 0.35,
      ),
    );

    prediction = {
      available: true,
      fixtureId: input.fixtureId,
      leagueId: input.leagueId,
      predictionAsOf: new Date(input.predictionAsOf),
      horizonMinutes,
      home,
      away,
      dixonColes: model,
      homeExpectedGoals: probabilities.homeExpectedGoals,
      awayExpectedGoals: probabilities.awayExpectedGoals,
      matchWinner: probabilities.matchWinner,
      over25: probabilities.over25,
      btts: probabilities.btts,
      dataQualityScore,
      reasons: [
        `Fundamentals 5/10/20 trận: mẫu ${home.sampleSize} - ${away.sampleSize}.`,
        `Dynamic Dixon–Coles: ${model.sampleSize} trận, ${model.teamCount} đội, half-life ${model.halfLifeDays.toFixed(0)} ngày.`,
        `Dixon–Coles xG: ${probabilities.homeExpectedGoals.toFixed(2)} - ${probabilities.awayExpectedGoals.toFixed(2)}, rho ${model.rho.toFixed(3)}.`,
        `Nguồn mới nhất khả dụng: ${model.trainedThrough.toISOString()}; predictionAsOf ${input.predictionAsOf.toISOString()}.`,
      ],
    };
  }

  if (input.persist) {
    await persistPrediction(prediction);
  }

  return prediction;
}

export async function backfillFundamentals(): Promise<SyncSummary> {
  return runTrackedSync('fundamentals-backfill', async () => {
    const horizons = parseHorizons();
    const configuredLimit = Math.floor(envNumber('FUNDAMENTALS_BACKFILL_LIMIT', 0));
    const dateFromRaw = process.env.FUNDAMENTALS_BACKFILL_DATE_FROM;
    const dateToRaw = process.env.FUNDAMENTALS_BACKFILL_DATE_TO;
    const dateFrom = dateFromRaw ? new Date(dateFromRaw) : undefined;
    const dateTo = dateToRaw ? new Date(dateToRaw) : undefined;
    const fixtures = await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        homeGoals: { not: null },
        awayGoals: { not: null },
        ...(dateFrom || dateTo
          ? {
              kickoffAt: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
      },
      select: {
        id: true,
        leagueId: true,
        homeTeamId: true,
        awayTeamId: true,
        kickoffAt: true,
      },
      orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
      ...(configuredLimit > 0 ? { take: configuredLimit } : {}),
    });

    let processed = 0;
    let inserted = 0;
    let unavailable = 0;
    let skippedExisting = 0;

    for (const fixture of fixtures) {
      for (const horizonMinutes of horizons) {
        const existingTeamSnapshots = await prisma.teamFundamentalSnapshot.count({
          where: {
            fixtureId: fixture.id,
            horizonMinutes,
          },
        });

        if (existingTeamSnapshots >= 2 && process.env.FUNDAMENTALS_BACKFILL_FORCE !== 'true') {
          skippedExisting += 1;
          continue;
        }

        const predictionAsOf = new Date(fixture.kickoffAt.getTime() - horizonMinutes * 60_000);
        const prediction = await getFundamentalsFixturePrediction({
          fixtureId: fixture.id,
          leagueId: fixture.leagueId,
          homeTeamId: fixture.homeTeamId,
          awayTeamId: fixture.awayTeamId,
          kickoffAt: fixture.kickoffAt,
          predictionAsOf,
          horizonMinutes,
          persist: true,
        });

        processed += 1;
        if (prediction.available) inserted += 1;
        else unavailable += 1;
      }
    }

    return {
      processed,
      inserted,
      updated: 0,
      metadata: jsonValue({
        fixtures: fixtures.length,
        horizons,
        unavailable,
        skippedExisting,
        apiCalled: false,
      }),
    };
  });
}

export async function getFundamentalsCoverage(): Promise<{
  teamSnapshots: number;
  dixonColesSnapshots: number;
  fixturesWithFundamentals: number;
  byHorizon: Array<{
    horizonMinutes: number;
    predictions: number;
    minimumTrainedThrough: Date | null;
    maximumTrainedThrough: Date | null;
    averageSampleSize: number;
    averageDataQuality: number;
  }>;
  leakageViolations: number;
}> {
  const [teamSnapshots, dixonColesSnapshots, groups, violations] = await Promise.all([
    prisma.teamFundamentalSnapshot.count(),
    prisma.dixonColesPredictionSnapshot.count(),
    prisma.dixonColesPredictionSnapshot.groupBy({
      by: ['horizonMinutes'],
      _count: { _all: true },
      _min: { trainedThrough: true },
      _max: { trainedThrough: true },
      _avg: {
        sampleSize: true,
        dataQualityScore: true,
      },
      orderBy: {
        horizonMinutes: 'desc',
      },
    }),
    prisma.dixonColesPredictionSnapshot.findMany({
      select: {
        trainedThrough: true,
        predictionAsOf: true,
      },
    }),
  ]);

  const leakageViolations = violations.filter(
    (row: { trainedThrough: Date; predictionAsOf: Date }) =>
      row.trainedThrough.getTime() > row.predictionAsOf.getTime(),
  ).length;

  const fixtureGroups = await prisma.dixonColesPredictionSnapshot.groupBy({
    by: ['fixtureId'],
  });

  return {
    teamSnapshots,
    dixonColesSnapshots,
    fixturesWithFundamentals: fixtureGroups.length,
    byHorizon: groups.map(
      (group: {
        horizonMinutes: number;
        _count: { _all: number };
        _min: { trainedThrough: Date | null };
        _max: { trainedThrough: Date | null };
        _avg: {
          sampleSize: number | null;
          dataQualityScore: number | null;
        };
      }) => ({
        horizonMinutes: group.horizonMinutes,
        predictions: group._count._all,
        minimumTrainedThrough: group._min.trainedThrough,
        maximumTrainedThrough: group._max.trainedThrough,
        averageSampleSize: group._avg.sampleSize ?? 0,
        averageDataQuality: group._avg.dataQualityScore ?? 0,
      }),
    ),
    leakageViolations,
  };
}
