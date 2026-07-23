import { ApiFootballError } from '@football-ai/api-football';
import {
  FixtureStatus,
  prisma,
  type InputJsonValue,
} from '@football-ai/database';
import { clamp } from '@football-ai/engine';
import { getApiFootballClient } from './client.js';
import { getFixtureHoursAhead } from './config.js';
import {
  SCIENTIFIC_FEATURE_NAMES,
  SCIENTIFIC_MODEL_KEY,
  trainScientificArtifact,
  type ScientificTrainingSample,
} from './scientific-model.js';
import { saveScientificModelArtifact } from './scientific-model-registry.js';
import {
  runTrackedSync,
  trackApiResult,
  type SyncSummary,
} from './tracking.js';

interface ApiStatisticEntry {
  type?: string;
  value?: string | number | null;
}

interface ApiFixtureStatisticsRow {
  team?: { id?: number; name?: string };
  statistics?: ApiStatisticEntry[];
}

interface ApiInjuryRow {
  fixture?: { id?: number };
  team?: { id?: number; name?: string };
  player?: { id?: number; name?: string; photo?: string };
  type?: string;
  reason?: string;
}


interface TrainingMetricRow {
  fixtureId: number;
  teamId: number;
  expectedGoals: number | null;
  shotsOnGoal: number | null;
}

interface FinishedFixtureRow {
  id: number;
  leagueId: number;
  kickoffAt: Date;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number | null;
  awayGoals: number | null;
}

interface TrainingTeamState {
  rating: number;
  matches: Array<{
    kickoffAt: Date;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
    expectedGoalsFor: number;
    expectedGoalsAgainst: number;
    shotsOnGoal: number;
  }>;
}

function numberEnvironment(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanEnvironment(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  return value.trim().toLowerCase() === 'true';
}

function normalizeStatisticType(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function numericStatistic(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(String(value).replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function findStatistic(
  statistics: ApiStatisticEntry[] | undefined,
  names: string[],
): number | null {
  const normalizedNames = new Set(names.map(normalizeStatisticType));
  const entry = (statistics ?? []).find((item) =>
    normalizedNames.has(normalizeStatisticType(item.type)),
  );
  return numericStatistic(entry?.value);
}

function xgProxy(input: {
  shots: number | null;
  shotsOnGoal: number | null;
  corners: number | null;
  goals: number | null;
}): number {
  const value =
    (input.shots ?? 0) * 0.045 +
    (input.shotsOnGoal ?? 0) * 0.19 +
    (input.corners ?? 0) * 0.025 +
    (input.goals ?? 0) * 0.08;
  return clamp(value || input.goals || 1.05, 0.05, 6);
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricKey(fixtureId: number, teamId: number): string {
  return `${fixtureId}:${teamId}`;
}

function createTrainingState(): TrainingTeamState {
  return { rating: 1500, matches: [] };
}

function teamAverages(state: TrainingTeamState, limit: number): {
  pointsPerGame: number;
  goalsFor: number;
  goalsAgainst: number;
  expectedGoalsFor: number;
  expectedGoalsAgainst: number;
  shotsOnGoal: number;
  restDays: number;
} {
  const selected = state.matches.slice(-limit);
  const latest = selected[selected.length - 1];
  return {
    pointsPerGame: average(selected.map((row) => row.points), 1.35),
    goalsFor: average(selected.map((row) => row.goalsFor), 1.3),
    goalsAgainst: average(selected.map((row) => row.goalsAgainst), 1.3),
    expectedGoalsFor: average(
      selected.map((row) => row.expectedGoalsFor),
      1.3,
    ),
    expectedGoalsAgainst: average(
      selected.map((row) => row.expectedGoalsAgainst),
      1.3,
    ),
    shotsOnGoal: average(selected.map((row) => row.shotsOnGoal), 4.2),
    restDays: latest ? 7 : 7,
  };
}

export async function syncScientificStatistics(): Promise<SyncSummary> {
  return runTrackedSync('sync-scientific-statistics', async () => {
    const days = Math.max(
      30,
      Math.floor(numberEnvironment('SCIENTIFIC_STATS_HISTORY_DAYS', 900)),
    );
    const limit = Math.max(
      1,
      Math.floor(numberEnvironment('SCIENTIFIC_STATS_FIXTURE_LIMIT', 25)),
    );
    const now = new Date();
    const minimum = new Date(now.getTime() - days * 86_400_000);
    const coveredRows = await prisma.fixtureScientificCoverage.findMany({
      where: { statisticsFetchedAt: { not: null } },
      select: { fixtureId: true },
    });
    const coveredFixtureIds = coveredRows.map((row: { fixtureId: number }) => row.fixtureId);
    const fixtures = await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        kickoffAt: { gte: minimum, lt: now },
        homeGoals: { not: null },
        awayGoals: { not: null },
        ...(coveredFixtureIds.length > 0
          ? { id: { notIn: coveredFixtureIds } }
          : {}),
      },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { kickoffAt: 'desc' },
      take: limit,
    });
    const client = getApiFootballClient();
    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let rateLimited = false;

    for (const fixture of fixtures) {
      try {
        const result = await client.request<ApiFixtureStatisticsRow>(
          'fixtures/statistics',
          { fixture: fixture.apiFixtureId },
        );
        await trackApiResult('fixtures/statistics', result);
        const capturedAt = new Date();

        for (const row of result.data) {
          const apiTeamId = Number(row.team?.id);
          const team =
            apiTeamId === fixture.homeTeam.apiTeamId
              ? fixture.homeTeam
              : apiTeamId === fixture.awayTeam.apiTeamId
                ? fixture.awayTeam
                : null;
          if (!team) continue;
          const goals =
            team.id === fixture.homeTeamId ? fixture.homeGoals : fixture.awayGoals;
          const shots = findStatistic(row.statistics, [
            'Total Shots',
            'Shots Total',
          ]);
          const shotsOnGoal = findStatistic(row.statistics, [
            'Shots on Goal',
            'Shots On Target',
          ]);
          const corners = findStatistic(row.statistics, ['Corner Kicks', 'Corners']);
          const apiExpectedGoals = findStatistic(row.statistics, [
            'expected_goals',
            'Expected Goals',
            'Expected goals',
          ]);
          const expectedGoals =
            apiExpectedGoals ??
            xgProxy({ shots, shotsOnGoal, corners, goals: goals ?? null });
          const existing = await prisma.fixtureTeamMetric.findUnique({
            where: {
              fixtureId_teamId: { fixtureId: fixture.id, teamId: team.id },
            },
          });
          await prisma.fixtureTeamMetric.upsert({
            where: {
              fixtureId_teamId: { fixtureId: fixture.id, teamId: team.id },
            },
            update: {
              expectedGoals,
              expectedGoalsSource: apiExpectedGoals == null ? 'PROXY' : 'API',
              shots: shots == null ? null : Math.round(shots),
              shotsOnGoal: shotsOnGoal == null ? null : Math.round(shotsOnGoal),
              possession: findStatistic(row.statistics, ['Ball Possession', 'Possession']),
              corners: corners == null ? null : Math.round(corners),
              fouls: Math.round(findStatistic(row.statistics, ['Fouls']) ?? 0),
              yellowCards: Math.round(
                findStatistic(row.statistics, ['Yellow Cards']) ?? 0,
              ),
              redCards: Math.round(findStatistic(row.statistics, ['Red Cards']) ?? 0),
              capturedAt,
              rawPayload: row as unknown as InputJsonValue,
            },
            create: {
              fixtureId: fixture.id,
              teamId: team.id,
              expectedGoals,
              expectedGoalsSource: apiExpectedGoals == null ? 'PROXY' : 'API',
              shots: shots == null ? null : Math.round(shots),
              shotsOnGoal: shotsOnGoal == null ? null : Math.round(shotsOnGoal),
              possession: findStatistic(row.statistics, ['Ball Possession', 'Possession']),
              corners: corners == null ? null : Math.round(corners),
              fouls: Math.round(findStatistic(row.statistics, ['Fouls']) ?? 0),
              yellowCards: Math.round(
                findStatistic(row.statistics, ['Yellow Cards']) ?? 0,
              ),
              redCards: Math.round(findStatistic(row.statistics, ['Red Cards']) ?? 0),
              capturedAt,
              rawPayload: row as unknown as InputJsonValue,
            },
          });
          processed += 1;
          if (existing) updated += 1;
          else inserted += 1;
        }

        await prisma.fixtureScientificCoverage.upsert({
          where: { fixtureId: fixture.id },
          update: { statisticsFetchedAt: capturedAt },
          create: { fixtureId: fixture.id, statisticsFetchedAt: capturedAt },
        });
      } catch (error) {
        if (error instanceof ApiFootballError && error.status === 429) {
          rateLimited = true;
          break;
        }
        throw error;
      }
    }

    return {
      processed,
      inserted,
      updated,
      metadata: {
        fixturesRequested: fixtures.length,
        rateLimited,
        fixtureLimit: limit,
      },
    };
  });
}

export async function syncScientificInjuries(): Promise<SyncSummary> {
  return runTrackedSync('sync-scientific-injuries', async () => {
    const now = new Date();
    const maximum = new Date(
      now.getTime() + getFixtureHoursAhead() * 3_600_000,
    );
    const limit = Math.max(
      1,
      Math.floor(numberEnvironment('SCIENTIFIC_INJURY_FIXTURE_LIMIT', 20)),
    );
    const fixtures = await prisma.fixture.findMany({
      where: {
        status: { in: [FixtureStatus.UPCOMING, FixtureStatus.LIVE] },
        kickoffAt: { gte: now, lte: maximum },
      },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { kickoffAt: 'asc' },
      take: limit,
    });
    const client = getApiFootballClient();
    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let rateLimited = false;

    for (const fixture of fixtures) {
      try {
        const result = await client.request<ApiInjuryRow>('injuries', {
          fixture: fixture.apiFixtureId,
        });
        await trackApiResult('injuries', result);
        const capturedAt = new Date();
        const activeKeys = new Set<string>();

        for (const row of result.data) {
          const apiTeamId = Number(row.team?.id);
          const team =
            apiTeamId === fixture.homeTeam.apiTeamId
              ? fixture.homeTeam
              : apiTeamId === fixture.awayTeam.apiTeamId
                ? fixture.awayTeam
                : null;
          const apiPlayerId = Number(row.player?.id);
          const playerName = String(row.player?.name ?? '').trim();
          if (!team || !Number.isInteger(apiPlayerId) || apiPlayerId <= 0 || !playerName) {
            continue;
          }
          activeKeys.add(`${team.id}:${apiPlayerId}`);
          const existing = await prisma.fixtureInjury.findUnique({
            where: {
              fixtureId_teamId_apiPlayerId: {
                fixtureId: fixture.id,
                teamId: team.id,
                apiPlayerId,
              },
            },
          });
          await prisma.fixtureInjury.upsert({
            where: {
              fixtureId_teamId_apiPlayerId: {
                fixtureId: fixture.id,
                teamId: team.id,
                apiPlayerId,
              },
            },
            update: {
              playerName,
              reason: row.reason?.trim() || null,
              injuryType: row.type?.trim() || null,
              capturedAt,
              rawPayload: row as unknown as InputJsonValue,
            },
            create: {
              fixtureId: fixture.id,
              teamId: team.id,
              apiPlayerId,
              playerName,
              reason: row.reason?.trim() || null,
              injuryType: row.type?.trim() || null,
              capturedAt,
              rawPayload: row as unknown as InputJsonValue,
            },
          });
          processed += 1;
          if (existing) updated += 1;
          else inserted += 1;
        }

        const previous = await prisma.fixtureInjury.findMany({
          where: { fixtureId: fixture.id },
          select: { id: true, teamId: true, apiPlayerId: true },
        });
        const obsoleteIds = previous
          .filter(
            (row: { id: number; teamId: number; apiPlayerId: number }) =>
              !activeKeys.has(`${row.teamId}:${row.apiPlayerId}`),
          )
          .map((row: { id: number }) => row.id);
        if (obsoleteIds.length > 0) {
          await prisma.fixtureInjury.deleteMany({ where: { id: { in: obsoleteIds } } });
        }
        await prisma.fixtureScientificCoverage.upsert({
          where: { fixtureId: fixture.id },
          update: { injuriesFetchedAt: capturedAt },
          create: { fixtureId: fixture.id, injuriesFetchedAt: capturedAt },
        });
      } catch (error) {
        if (error instanceof ApiFootballError && error.status === 429) {
          rateLimited = true;
          break;
        }
        throw error;
      }
    }

    return {
      processed,
      inserted,
      updated,
      metadata: {
        fixturesRequested: fixtures.length,
        rateLimited,
        fixtureLimit: limit,
      },
    };
  });
}

export async function rebuildScientificElo(): Promise<SyncSummary> {
  return runTrackedSync('rebuild-scientific-elo', async () => {
    const fixtures = (await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        homeGoals: { not: null },
        awayGoals: { not: null },
      },
      select: {
        leagueId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeGoals: true,
        awayGoals: true,
      },
      orderBy: { kickoffAt: 'asc' },
    })) as Array<{
      leagueId: number;
      homeTeamId: number;
      awayTeamId: number;
      homeGoals: number | null;
      awayGoals: number | null;
    }>;
    const ratings = new Map<number, { rating: number; matches: number; leagueId: number }>();
    const kFactor = numberEnvironment('ELO_K_FACTOR', 24);
    const homeAdvantage = numberEnvironment('ELO_HOME_ADVANTAGE', 60);

    for (const fixture of fixtures) {
      if (fixture.homeGoals == null || fixture.awayGoals == null) continue;
      const home = ratings.get(fixture.homeTeamId) ?? {
        rating: 1500,
        matches: 0,
        leagueId: fixture.leagueId,
      };
      const away = ratings.get(fixture.awayTeamId) ?? {
        rating: 1500,
        matches: 0,
        leagueId: fixture.leagueId,
      };
      const expectedHome =
        1 /
        (1 +
          10 **
            ((away.rating - (home.rating + homeAdvantage)) / 400));
      const actualHome =
        fixture.homeGoals > fixture.awayGoals
          ? 1
          : fixture.homeGoals === fixture.awayGoals
            ? 0.5
            : 0;
      const movement = kFactor * (actualHome - expectedHome);
      ratings.set(fixture.homeTeamId, {
        rating: home.rating + movement,
        matches: home.matches + 1,
        leagueId: fixture.leagueId,
      });
      ratings.set(fixture.awayTeamId, {
        rating: away.rating - movement,
        matches: away.matches + 1,
        leagueId: fixture.leagueId,
      });
    }

    let inserted = 0;
    let updated = 0;
    for (const [teamId, value] of ratings) {
      const existing = await prisma.teamElo.findUnique({ where: { teamId } });
      await prisma.teamElo.upsert({
        where: { teamId },
        update: {
          leagueId: value.leagueId,
          rating: value.rating,
          matches: value.matches,
        },
        create: {
          teamId,
          leagueId: value.leagueId,
          rating: value.rating,
          matches: value.matches,
        },
      });
      if (existing) updated += 1;
      else inserted += 1;
    }

    return {
      processed: fixtures.length,
      inserted,
      updated,
      metadata: { teams: ratings.size, kFactor, homeAdvantage },
    };
  });
}

export async function trainScientificModel(): Promise<SyncSummary> {
  return runTrackedSync('train-scientific-model', async () => {
    const limit = Math.max(
      100,
      Math.floor(numberEnvironment('SCIENTIFIC_TRAINING_LIMIT', 4000)),
    );
    const minimumSamples = Math.max(
      30,
      Math.floor(numberEnvironment('SCIENTIFIC_MIN_TRAINING_SAMPLES', 80)),
    );
    const historyLimit = Math.max(
      3,
      Math.floor(numberEnvironment('SCIENTIFIC_HISTORY_MATCHES', 10)),
    );
    const fixtures = (await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
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
      orderBy: { kickoffAt: 'asc' },
      take: limit,
    })) as FinishedFixtureRow[];
    const metrics = (fixtures.length
      ? await prisma.fixtureTeamMetric.findMany({
          where: { fixtureId: { in: fixtures.map((fixture) => fixture.id) } },
          select: {
            fixtureId: true,
            teamId: true,
            expectedGoals: true,
            shotsOnGoal: true,
          },
        })
      : []) as TrainingMetricRow[];
    const metricMap = new Map<string, TrainingMetricRow>(
      metrics.map((row) => [metricKey(row.fixtureId, row.teamId), row]),
    );
    const states = new Map<number, TrainingTeamState>();
    const samples: ScientificTrainingSample[] = [];
    const homeAdvantage = numberEnvironment('ELO_HOME_ADVANTAGE', 60);
    const kFactor = numberEnvironment('ELO_K_FACTOR', 24);

    for (const fixture of fixtures) {
      if (fixture.homeGoals == null || fixture.awayGoals == null) continue;
      const homeState = states.get(fixture.homeTeamId) ?? createTrainingState();
      const awayState = states.get(fixture.awayTeamId) ?? createTrainingState();
      const home = teamAverages(homeState, historyLimit);
      const away = teamAverages(awayState, historyLimit);
      const homeExpectedGoals = clamp(
        1.45 *
          (home.expectedGoalsFor / 1.45) *
          (away.expectedGoalsAgainst / 1.2),
        0.2,
        4.5,
      );
      const awayExpectedGoals = clamp(
        1.2 *
          (away.expectedGoalsFor / 1.2) *
          (home.expectedGoalsAgainst / 1.45),
        0.15,
        4.2,
      );
      const features = [
        (homeState.rating - awayState.rating) / 400,
        (home.pointsPerGame - away.pointsPerGame) / 3,
        (home.goalsFor - home.goalsAgainst) / 3,
        (away.goalsFor - away.goalsAgainst) / 3,
        home.expectedGoalsFor / 3,
        away.expectedGoalsFor / 3,
        home.expectedGoalsAgainst / 3,
        away.expectedGoalsAgainst / 3,
        (homeExpectedGoals + awayExpectedGoals) / 4,
        (home.shotsOnGoal + away.shotsOnGoal) / 12,
        0,
        0,
        (home.restDays - away.restDays) / 14,
        0,
        0,
        1,
      ];
      if (features.length !== SCIENTIFIC_FEATURE_NAMES.length) {
        throw new Error('Scientific training feature width mismatch.');
      }

      if (
        homeState.matches.length >= 3 &&
        awayState.matches.length >= 3
      ) {
        samples.push({
          features,
          matchWinnerClass:
            fixture.homeGoals > fixture.awayGoals
              ? 0
              : fixture.homeGoals === fixture.awayGoals
                ? 1
                : 2,
          over25: fixture.homeGoals + fixture.awayGoals > 2.5 ? 1 : 0,
          btts: fixture.homeGoals > 0 && fixture.awayGoals > 0 ? 1 : 0,
          kickoffAt: fixture.kickoffAt,
        });
      }

      const homeMetric = metricMap.get(metricKey(fixture.id, fixture.homeTeamId));
      const awayMetric = metricMap.get(metricKey(fixture.id, fixture.awayTeamId));
      const expectedHome =
        1 /
        (1 +
          10 **
            ((awayState.rating - (homeState.rating + homeAdvantage)) / 400));
      const actualHome =
        fixture.homeGoals > fixture.awayGoals
          ? 1
          : fixture.homeGoals === fixture.awayGoals
            ? 0.5
            : 0;
      const movement = kFactor * (actualHome - expectedHome);
      homeState.rating += movement;
      awayState.rating -= movement;
      homeState.matches.push({
        kickoffAt: fixture.kickoffAt,
        points: fixture.homeGoals > fixture.awayGoals ? 3 : fixture.homeGoals === fixture.awayGoals ? 1 : 0,
        goalsFor: fixture.homeGoals,
        goalsAgainst: fixture.awayGoals,
        expectedGoalsFor: homeMetric?.expectedGoals ?? fixture.homeGoals,
        expectedGoalsAgainst: awayMetric?.expectedGoals ?? fixture.awayGoals,
        shotsOnGoal: homeMetric?.shotsOnGoal ?? Math.max(1, fixture.homeGoals * 2),
      });
      awayState.matches.push({
        kickoffAt: fixture.kickoffAt,
        points: fixture.awayGoals > fixture.homeGoals ? 3 : fixture.homeGoals === fixture.awayGoals ? 1 : 0,
        goalsFor: fixture.awayGoals,
        goalsAgainst: fixture.homeGoals,
        expectedGoalsFor: awayMetric?.expectedGoals ?? fixture.awayGoals,
        expectedGoalsAgainst: homeMetric?.expectedGoals ?? fixture.homeGoals,
        shotsOnGoal: awayMetric?.shotsOnGoal ?? Math.max(1, fixture.awayGoals * 2),
      });
      states.set(fixture.homeTeamId, homeState);
      states.set(fixture.awayTeamId, awayState);
    }

    if (samples.length < minimumSamples) {
      return {
        processed: fixtures.length,
        inserted: 0,
        updated: 0,
        metadata: {
          trained: false,
          samples: samples.length,
          minimumSamples,
          reason: 'Not enough point-in-time training samples.',
        },
      };
    }

    // PREDICTION_AI_V6_TRAINING_DEFAULTS: Adam + nonlinear ensemble cần learning rate thấp hơn và regularization cao hơn.
  const artifact = trainScientificArtifact({
      samples,
      epochs: numberEnvironment('SCIENTIFIC_TRAINING_EPOCHS', 360),
      learningRate: numberEnvironment('SCIENTIFIC_TRAINING_RATE', 0.018),
      l2: numberEnvironment('SCIENTIFIC_TRAINING_L2', 0.01),
    randomSeed: Math.floor(
      numberEnvironment('SCIENTIFIC_TRAINING_SEED', 20260722),
    ),
    ensembleMembers: Math.max(
      1,
      Math.floor(numberEnvironment('SCIENTIFIC_ENSEMBLE_MEMBERS', 3)),
    ),
    });
    const existing = await prisma.appSetting.findUnique({
      where: { key: SCIENTIFIC_MODEL_KEY },
    });
    await prisma.appSetting.upsert({
      where: { key: SCIENTIFIC_MODEL_KEY },
      update: { value: artifact as unknown as InputJsonValue },
      create: {
        key: SCIENTIFIC_MODEL_KEY,
        value: artifact as unknown as InputJsonValue,
      },
    });
    // PREDICTION_AI_V61_ARTIFACT_REGISTRY
    const purpose = process.env.SCIENTIFIC_TRAINING_PURPOSE ?? 'production-training';
    const noPromote =
      process.env.SCIENTIFIC_TRAINING_NO_PROMOTE?.trim().toLowerCase() ===
      'true';
    const registryMetadata = await saveScientificModelArtifact({
      artifact,
      purpose,
      trainingLimit: limit,
      aliases: noPromote ? ['latest'] : ['latest', 'champion'],
    });
    return {
      processed: fixtures.length,
      inserted: existing ? 0 : 1,
      updated: existing ? 1 : 0,
      metadata: {
        trained: true,
        samples: artifact.sampleSize,
        trainedThrough: artifact.trainedThrough,
                  version: artifact.version,
          artifactId: registryMetadata.artifactId,
          useMetrics: booleanEnvironment('SCIENTIFIC_USE_XG_METRICS', true),
      },
    };
  });
}
