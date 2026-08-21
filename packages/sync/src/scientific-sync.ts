import { ApiFootballError } from '@football-ai/api-football';
import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';
import { clamp } from '@football-ai/engine';
import { getApiFootballClient } from './client.js';
import { getFixtureHoursAhead } from './config.js';
import {
  SCIENTIFIC_FEATURE_NAMES,
  SCIENTIFIC_FEATURE_NAMES_V7,
  SCIENTIFIC_MODEL_KEY,
  SCIENTIFIC_MODEL_VERSION_V7,
  buildScientificArtifactV7,
  fitIsotonicRegression,
  opponentAdjustedPpg,
  poissonGoalMarkets,
  predictScientificModel,
  trainScientificArtifact,
  trainStackingWeights,
  type ScientificModelArtifact,
  type ScientificTrainingSample,
  type StackTrainingRow,
} from './scientific-model.js';
import {
  getFixturesMarketFeatureSets,
  type MarketFeatureSet,
} from './scientific-market-features.js';
import { saveScientificModelArtifact } from './scientific-model-registry.js';
import { fixtureTeamMetricSnapshotHash } from './scientific-snapshots.js';
import {
  saveFixtureContextCoverageSnapshot,
  saveFixtureInjurySnapshot,
} from './context-snapshots.js';
import { runTrackedSync, trackApiResult, type SyncSummary } from './tracking.js';

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
    isHome: boolean;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
    expectedGoalsFor: number;
    expectedGoalsAgainst: number;
    shotsOnGoal: number;
    /** PREDICTION_AI_V7: opponent Elo at that fixture (for opponent-adjusted form). */
    opponentRating: number | null;
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
  return (value ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
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

/** PREDICTION_AI_V7: Elo 1X2 probabilities matching the inference-time helper. */
function trainingEloProbabilities(
  homeRating: number,
  awayRating: number,
): Record<'HOME' | 'DRAW' | 'AWAY', number> {
  const homeAdvantage = numberEnvironment('ELO_HOME_ADVANTAGE', 60);
  const expectedHome = 1 / (1 + 10 ** ((awayRating - (homeRating + homeAdvantage)) / 400));
  const difference = Math.abs(homeRating + homeAdvantage - awayRating);
  const drawProbability = clamp(0.29 - difference / 2600, 0.16, 0.3);
  const decisiveMass = 1 - drawProbability;
  return {
    HOME: expectedHome * decisiveMass,
    DRAW: drawProbability,
    AWAY: (1 - expectedHome) * decisiveMass,
  };
}

/** PREDICTION_AI_V7: convex blend of 1-dimensional component probabilities. */
function blendComponentsForStack(components: number[][], weights: number[]): number {
  let total = 0;
  let weightSum = 0;
  for (let index = 0; index < components.length; index += 1) {
    const weight = weights[index] ?? 0;
    total += (components[index]?.[0] ?? 0.5) * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? total / weightSum : 0.5;
}

function teamAverages(
  state: TrainingTeamState,
  limit: number,
  asOf: Date,
): {
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
  const restDays = latest
    ? clamp((asOf.getTime() - latest.kickoffAt.getTime()) / 86_400_000, 2, 30)
    : 7;
  return {
    pointsPerGame: average(
      selected.map((row) => row.points),
      1.35,
    ),
    goalsFor: average(
      selected.map((row) => row.goalsFor),
      1.3,
    ),
    goalsAgainst: average(
      selected.map((row) => row.goalsAgainst),
      1.3,
    ),
    expectedGoalsFor: average(
      selected.map((row) => row.expectedGoalsFor),
      1.3,
    ),
    expectedGoalsAgainst: average(
      selected.map((row) => row.expectedGoalsAgainst),
      1.3,
    ),
    shotsOnGoal: average(
      selected.map((row) => row.shotsOnGoal),
      4.2,
    ),
    restDays,
  };
}

export async function syncScientificStatistics(): Promise<SyncSummary> {
  return runTrackedSync('sync-scientific-statistics', async () => {
    const days = Math.max(30, Math.floor(numberEnvironment('SCIENTIFIC_STATS_HISTORY_DAYS', 900)));
    const limit = Math.max(1, Math.floor(numberEnvironment('SCIENTIFIC_STATS_FIXTURE_LIMIT', 25)));
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
        ...(coveredFixtureIds.length > 0 ? { id: { notIn: coveredFixtureIds } } : {}),
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
        const result = await client.request<ApiFixtureStatisticsRow>('fixtures/statistics', {
          fixture: fixture.apiFixtureId,
        });
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
          const goals = team.id === fixture.homeTeamId ? fixture.homeGoals : fixture.awayGoals;
          const shots = findStatistic(row.statistics, ['Total Shots', 'Shots Total']);
          const shotsOnGoal = findStatistic(row.statistics, ['Shots on Goal', 'Shots On Target']);
          const corners = findStatistic(row.statistics, ['Corner Kicks', 'Corners']);
          const apiExpectedGoals = findStatistic(row.statistics, [
            'expected_goals',
            'Expected Goals',
            'Expected goals',
          ]);
          const expectedGoals =
            apiExpectedGoals ?? xgProxy({ shots, shotsOnGoal, corners, goals: goals ?? null });
          const existing = await prisma.fixtureTeamMetric.findUnique({
            where: {
              fixtureId_teamId: {
                fixtureId: fixture.id,
                teamId: team.id,
              },
            },
          });
          const expectedGoalsSource = apiExpectedGoals == null ? 'PROXY' : 'API';
          const roundedShots = shots == null ? null : Math.round(shots);
          const roundedShotsOnGoal = shotsOnGoal == null ? null : Math.round(shotsOnGoal);
          const possession = findStatistic(row.statistics, ['Ball Possession', 'Possession']);
          const roundedCorners = corners == null ? null : Math.round(corners);
          const fouls = Math.round(findStatistic(row.statistics, ['Fouls']) ?? 0);
          const yellowCards = Math.round(findStatistic(row.statistics, ['Yellow Cards']) ?? 0);
          const redCards = Math.round(findStatistic(row.statistics, ['Red Cards']) ?? 0);
          const rawPayload = row as unknown as InputJsonValue;
          const payloadHash = fixtureTeamMetricSnapshotHash({
            expectedGoals,
            expectedGoalsSource,
            shots: roundedShots,
            shotsOnGoal: roundedShotsOnGoal,
            possession,
            corners: roundedCorners,
            fouls,
            yellowCards,
            redCards,
          });

          await prisma.$transaction([
            prisma.fixtureTeamMetric.upsert({
              where: {
                fixtureId_teamId: {
                  fixtureId: fixture.id,
                  teamId: team.id,
                },
              },
              update: {
                expectedGoals,
                expectedGoalsSource,
                shots: roundedShots,
                shotsOnGoal: roundedShotsOnGoal,
                possession,
                corners: roundedCorners,
                fouls,
                yellowCards,
                redCards,
                capturedAt,
                rawPayload,
              },
              create: {
                fixtureId: fixture.id,
                teamId: team.id,
                expectedGoals,
                expectedGoalsSource,
                shots: roundedShots,
                shotsOnGoal: roundedShotsOnGoal,
                possession,
                corners: roundedCorners,
                fouls,
                yellowCards,
                redCards,
                capturedAt,
                rawPayload,
              },
            }),
            prisma.fixtureTeamMetricSnapshot.createMany({
              data: [
                {
                  fixtureId: fixture.id,
                  teamId: team.id,
                  expectedGoals,
                  expectedGoalsSource,
                  shots: roundedShots,
                  shotsOnGoal: roundedShotsOnGoal,
                  possession,
                  corners: roundedCorners,
                  fouls,
                  yellowCards,
                  redCards,
                  capturedAt,
                  rawPayload,
                  payloadHash,
                },
              ],
              skipDuplicates: true,
            }),
          ]);

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

export interface ScientificInjurySyncOptions {
  fixtureIds?: number[];
  now?: Date;
}

export async function syncScientificInjuries(
  options: ScientificInjurySyncOptions = {},
): Promise<SyncSummary> {
  return runTrackedSync('sync-scientific-injuries', async () => {
    const now = options.now ?? new Date();
    const maximum = new Date(now.getTime() + getFixtureHoursAhead() * 3_600_000);
    const limit = Math.max(1, Math.floor(numberEnvironment('SCIENTIFIC_INJURY_FIXTURE_LIMIT', 20)));
    const fixtures = await prisma.fixture.findMany({
      where: options.fixtureIds
        ? { id: { in: options.fixtureIds } }
        : {
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
        const snapshotRows: Array<{
          teamId: number;
          apiPlayerId: number;
          playerName: string;
          reason: string | null;
          injuryType: string | null;
          rawPayload: unknown;
        }> = [];

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
          snapshotRows.push({
            teamId: team.id,
            apiPlayerId,
            playerName,
            reason: row.reason?.trim() || null,
            injuryType: row.type?.trim() || null,
            rawPayload: row,
          });
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
        await saveFixtureInjurySnapshot({
          fixtureId: fixture.id,
          capturedAt,
          rows: snapshotRows,
          rawPayload: result.data,
        });
        await saveFixtureContextCoverageSnapshot({
          fixtureId: fixture.id,
          dataType: 'INJURY',
          capturedAt,
          responseCount: snapshotRows.length,
          metadata: {
            apiFixtureId: fixture.apiFixtureId,
            source: 'api-football:injuries',
          },
        });
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
      const expectedHome = 1 / (1 + 10 ** ((away.rating - (home.rating + homeAdvantage)) / 400));
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

export interface ScientificTrainingOptions {
  limit?: number;
  through?: Date;
  leagueId?: number;
  trainedAt?: Date;
  purpose?: string;
  noPromote?: boolean;
}

export async function trainScientificModel(
  options: ScientificTrainingOptions = {},
): Promise<SyncSummary> {
  return runTrackedSync('train-scientific-model', async () => {
    const limit = Math.max(
      100,
      Math.floor(options.limit ?? numberEnvironment('SCIENTIFIC_TRAINING_LIMIT', 4000)),
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
        ...(options.leagueId ? { leagueId: options.leagueId } : {}),
        ...(options.through ? { kickoffAt: { lte: options.through } } : {}),
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
    const metrics = (
      fixtures.length
        ? await prisma.fixtureTeamMetric.findMany({
            where: { fixtureId: { in: fixtures.map((fixture) => fixture.id) } },
            select: {
              fixtureId: true,
              teamId: true,
              expectedGoals: true,
              shotsOnGoal: true,
            },
          })
        : []
    ) as TrainingMetricRow[];
    const metricMap = new Map<string, TrainingMetricRow>(
      metrics.map((row) => [metricKey(row.fixtureId, row.teamId), row]),
    );
    const states = new Map<number, TrainingTeamState>();
    const samples: ScientificTrainingSample[] = [];
    const homeAdvantage = numberEnvironment('ELO_HOME_ADVANTAGE', 60);
    const kFactor = numberEnvironment('ELO_K_FACTOR', 24);
    // PREDICTION_AI_V7: per-fixture rich samples carry the component-model
    // outputs (poisson / elo / market) needed to fit the stacking meta-learner
    // on a chronological validation split.
    interface RichTrainingSample extends ScientificTrainingSample {
      fixtureId: number;
      homeXg: number;
      awayXg: number;
      homeRating: number;
      awayRating: number;
      market: MarketFeatureSet;
    }
    const richSamples: RichTrainingSample[] = [];
    const v7Enabled = booleanEnvironment('SCIENTIFIC_V7_ENABLED', true);

    const leagueHomePpg = average(
      fixtures
        .filter((fixture) => fixture.homeGoals != null && fixture.awayGoals != null)
        .map((fixture) =>
          fixture.homeGoals! > fixture.awayGoals!
            ? 3
            : fixture.homeGoals === fixture.awayGoals
              ? 1
              : 0,
        ),
      1.6,
    );
    const leagueAwayPpg = average(
      fixtures
        .filter((fixture) => fixture.homeGoals != null && fixture.awayGoals != null)
        .map((fixture) =>
          fixture.awayGoals! > fixture.homeGoals!
            ? 3
            : fixture.homeGoals === fixture.awayGoals
              ? 1
              : 0,
        ),
      1.2,
    );

    // PREDICTION_AI_V7: bulk point-in-time market features (odds captured at or
    // before each fixture's own kickoff — no look-ahead).
    const marketByFixture = v7Enabled
      ? await getFixturesMarketFeatureSets({
          fixtureIds: fixtures.map((fixture) => fixture.id),
          asOf: new Date(),
          asOfByFixture: new Map(fixtures.map((fixture) => [fixture.id, fixture.kickoffAt])),
          minimumBookmakers: Math.max(
            1,
            Math.floor(numberEnvironment('SCIENTIFIC_MARKET_MIN_BOOKMAKERS', 2)),
          ),
          maximumAgeHours: Math.max(1, numberEnvironment('SCIENTIFIC_MARKET_MAX_AGE_HOURS', 168)),
        })
      : new Map<number, MarketFeatureSet>();
    const emptyMarket: MarketFeatureSet = {
      available: false,
      homeConsensus: null,
      drawConsensus: null,
      awayConsensus: null,
      over25Consensus: null,
      bttsYesConsensus: null,
      homeMovement: null,
      drawMovement: null,
      awayMovement: null,
      over25Movement: null,
      oddsAgeHours: null,
      bookmakerCount: null,
      qualityScore: 0,
    };

    for (const fixture of fixtures) {
      if (fixture.homeGoals == null || fixture.awayGoals == null) continue;
      const homeState = states.get(fixture.homeTeamId) ?? createTrainingState();
      const awayState = states.get(fixture.awayTeamId) ?? createTrainingState();
      const home = teamAverages(homeState, historyLimit, fixture.kickoffAt);
      const away = teamAverages(awayState, historyLimit, fixture.kickoffAt);
      const homeExpectedGoals = clamp(
        1.45 * (home.expectedGoalsFor / 1.45) * (away.expectedGoalsAgainst / 1.2),
        0.2,
        4.5,
      );
      const awayExpectedGoals = clamp(
        1.2 * (away.expectedGoalsFor / 1.2) * (home.expectedGoalsAgainst / 1.45),
        0.15,
        4.2,
      );
      const market = marketByFixture.get(fixture.id) ?? emptyMarket;

      // PREDICTION_AI_V7: venue home advantage from each team's own home/away split.
      const teamHomePpg = (state: TrainingTeamState): number => {
        const homeMatches = state.matches.filter((match) => match.isHome);
        if (homeMatches.length < 2) return leagueHomePpg;
        return homeMatches.reduce((sum, match) => sum + match.points, 0) / homeMatches.length;
      };
      const teamAwayPpg = (state: TrainingTeamState): number => {
        const awayMatches = state.matches.filter((match) => !match.isHome);
        if (awayMatches.length < 2) return leagueAwayPpg;
        return awayMatches.reduce((sum, match) => sum + match.points, 0) / awayMatches.length;
      };
      const homeVenueAdvantage = clamp(
        teamHomePpg(homeState) - teamAwayPpg(homeState) - (leagueHomePpg - leagueAwayPpg),
        -0.8,
        0.8,
      );
      const awayVenueAdvantage = clamp(
        teamHomePpg(awayState) - teamAwayPpg(awayState) - (leagueHomePpg - leagueAwayPpg),
        -0.8,
        0.8,
      );
      const homeAdjPpg = opponentAdjustedPpg(homeState.matches);
      const awayAdjPpg = opponentAdjustedPpg(awayState.matches);
      const sevenDaysAgo = fixture.kickoffAt.getTime() - 7 * 86_400_000;
      const homeDensity7 = homeState.matches.filter(
        (match) => match.kickoffAt.getTime() >= sevenDaysAgo,
      ).length;
      const awayDensity7 = awayState.matches.filter(
        (match) => match.kickoffAt.getTime() >= sevenDaysAgo,
      ).length;
      const fourteenDaysAgo = fixture.kickoffAt.getTime() - 14 * 86_400_000;
      const homeDensity14 = homeState.matches.filter(
        (match) => match.kickoffAt.getTime() >= fourteenDaysAgo,
      ).length;
      const awayDensity14 = awayState.matches.filter(
        (match) => match.kickoffAt.getTime() >= fourteenDaysAgo,
      ).length;

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
        clamp(homeVenueAdvantage - awayVenueAdvantage, -0.8, 0.8),
        market.homeConsensus ?? 1 / 3,
        market.drawConsensus ?? 1 / 3,
        market.awayConsensus ?? 1 / 3,
        market.over25Consensus ?? 0.5,
        market.bttsYesConsensus ?? 0.5,
        clamp((market.homeMovement ?? 0) / 0.1, -1, 1),
        clamp((market.over25Movement ?? 0) / 0.1, -1, 1),
        market.available ? 1 : 0,
        clamp((market.oddsAgeHours ?? 30) / 72, 0, 1),
        clamp((market.bookmakerCount ?? 0) / 10, 0, 1),
        clamp((homeAdjPpg - awayAdjPpg) / 1.5, -1, 1),
        0,
        clamp((homeDensity7 - awayDensity7) / 3 + (homeDensity14 - awayDensity14) / 6, -1, 1),
      ];
      if (features.length !== SCIENTIFIC_FEATURE_NAMES_V7.length) {
        throw new Error('Scientific training feature width mismatch.');
      }

      if (homeState.matches.length >= 3 && awayState.matches.length >= 3) {
        const sample: RichTrainingSample = {
          features,
          matchWinnerClass:
            fixture.homeGoals > fixture.awayGoals
              ? 0
              : fixture.homeGoals === fixture.awayGoals
                ? 1
                : 2,
          over15: fixture.homeGoals + fixture.awayGoals > 1.5 ? 1 : 0,
          over25: fixture.homeGoals + fixture.awayGoals > 2.5 ? 1 : 0,
          over35: fixture.homeGoals + fixture.awayGoals > 3.5 ? 1 : 0,
          btts: fixture.homeGoals > 0 && fixture.awayGoals > 0 ? 1 : 0,
          kickoffAt: fixture.kickoffAt,
          fixtureId: fixture.id,
          homeXg: homeExpectedGoals,
          awayXg: awayExpectedGoals,
          homeRating: homeState.rating,
          awayRating: awayState.rating,
          market,
        };
        samples.push(sample);
        richSamples.push(sample);
      }

      const homeMetric = metricMap.get(metricKey(fixture.id, fixture.homeTeamId));
      const awayMetric = metricMap.get(metricKey(fixture.id, fixture.awayTeamId));
      const expectedHome =
        1 / (1 + 10 ** ((awayState.rating - (homeState.rating + homeAdvantage)) / 400));
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
        isHome: true,
        points:
          fixture.homeGoals > fixture.awayGoals
            ? 3
            : fixture.homeGoals === fixture.awayGoals
              ? 1
              : 0,
        goalsFor: fixture.homeGoals,
        goalsAgainst: fixture.awayGoals,
        expectedGoalsFor: homeMetric?.expectedGoals ?? fixture.homeGoals,
        expectedGoalsAgainst: awayMetric?.expectedGoals ?? fixture.awayGoals,
        shotsOnGoal: homeMetric?.shotsOnGoal ?? Math.max(1, fixture.homeGoals * 2),
        opponentRating: awayState.rating,
      });
      awayState.matches.push({
        kickoffAt: fixture.kickoffAt,
        isHome: false,
        points:
          fixture.awayGoals > fixture.homeGoals
            ? 3
            : fixture.homeGoals === fixture.awayGoals
              ? 1
              : 0,
        goalsFor: fixture.awayGoals,
        goalsAgainst: fixture.homeGoals,
        expectedGoalsFor: awayMetric?.expectedGoals ?? fixture.awayGoals,
        expectedGoalsAgainst: homeMetric?.expectedGoals ?? fixture.homeGoals,
        shotsOnGoal: awayMetric?.shotsOnGoal ?? Math.max(1, fixture.awayGoals * 2),
        opponentRating: homeState.rating,
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
    const baseArtifact = trainScientificArtifact({
      samples,
      epochs: numberEnvironment('SCIENTIFIC_TRAINING_EPOCHS', 360),
      learningRate: numberEnvironment('SCIENTIFIC_TRAINING_RATE', 0.018),
      l2: numberEnvironment('SCIENTIFIC_TRAINING_L2', 0.01),
      randomSeed: Math.floor(numberEnvironment('SCIENTIFIC_TRAINING_SEED', 20260722)),
      ensembleMembers: Math.max(1, Math.floor(numberEnvironment('SCIENTIFIC_ENSEMBLE_MEMBERS', 3))),
      trainedAt: options.trainedAt,
    });

    // PREDICTION_AI_V7_STACKING: fit the meta-learner on a chronological
    // validation split (the ML component comes from a model that never saw
    // those rows), then rebuild the base on the full sample set.
    let artifact: ScientificModelArtifact = baseArtifact;
    const stackingEnabled = v7Enabled && booleanEnvironment('SCIENTIFIC_STACKING_ENABLED', true);
    if (stackingEnabled && richSamples.length >= 60) {
      const validationSize = Math.max(
        15,
        Math.min(richSamples.length - 35, Math.floor(richSamples.length * 0.2)),
      );
      const validationSamples = richSamples.slice(-validationSize);
      const trainingOnly = richSamples.slice(0, richSamples.length - validationSize);

      const baseNoValidation = trainScientificArtifact({
        samples: trainingOnly,
        epochs: numberEnvironment('SCIENTIFIC_TRAINING_EPOCHS', 360),
        learningRate: numberEnvironment('SCIENTIFIC_TRAINING_RATE', 0.018),
        l2: numberEnvironment('SCIENTIFIC_TRAINING_L2', 0.01),
        randomSeed: Math.floor(numberEnvironment('SCIENTIFIC_TRAINING_SEED', 20260722)),
        ensembleMembers: Math.max(
          1,
          Math.floor(numberEnvironment('SCIENTIFIC_ENSEMBLE_MEMBERS', 3)),
        ),
        trainedAt: options.trainedAt,
      });

      const stackRows: StackTrainingRow[] = [];
      for (const row of validationSamples) {
        const mlPrediction = predictScientificModel(baseNoValidation, row.features);
        const poisson = poissonGoalMarkets(row.homeXg, row.awayXg, 2.5);
        const eloProbs = trainingEloProbabilities(row.homeRating, row.awayRating);
        const marketHome = row.market.homeConsensus ?? 1 / 3;
        const marketDraw = row.market.drawConsensus ?? 1 / 3;
        const marketAway = row.market.awayConsensus ?? 1 / 3;
        const marketOver25 = row.market.over25Consensus ?? poisson.total.overConditional;
        const marketBtts = row.market.bttsYesConsensus ?? poisson.btts.YES;
        stackRows.push({
          matchWinnerComponents: [
            [poisson.matchWinner.HOME, poisson.matchWinner.DRAW, poisson.matchWinner.AWAY],
            [eloProbs.HOME, eloProbs.DRAW, eloProbs.AWAY],
            [
              mlPrediction.matchWinner.HOME,
              mlPrediction.matchWinner.DRAW,
              mlPrediction.matchWinner.AWAY,
            ],
            [marketHome, marketDraw, marketAway],
          ],
          over25Components: [
            [poisson.total.overConditional],
            [mlPrediction.over25.OVER],
            [marketOver25],
          ],
          bttsComponents: [[poisson.btts.YES], [mlPrediction.btts.YES], [marketBtts]],
          matchWinnerClass: row.matchWinnerClass,
          over25: row.over25,
          btts: row.btts,
        });
      }

      const stacking = trainStackingWeights(stackRows, {
        epochs: Math.max(20, Math.floor(numberEnvironment('SCIENTIFIC_STACK_EPOCHS', 300))),
        learningRate: numberEnvironment('SCIENTIFIC_STACK_LR', 0.05),
        randomSeed: Math.floor(numberEnvironment('SCIENTIFIC_STACK_SEED', 20260821)),
      });

      // PREDICTION_AI_V7_ISOTONIC: calibrate the STACKED binary probabilities.
      const isotonicBins = Math.max(
        4,
        Math.min(100, Math.floor(numberEnvironment('SCIENTIFIC_ISOTONIC_BINS', 20))),
      );
      const over25Stacked = stackRows.map((row) =>
        blendComponentsForStack(
          row.over25Components.map((component) => [component[0] ?? 0.5]),
          stacking.over25,
        ),
      );
      const bttsStacked = stackRows.map((row) =>
        blendComponentsForStack(
          row.bttsComponents.map((component) => [component[0] ?? 0.5]),
          stacking.btts,
        ),
      );
      const isotonic = {
        over25: fitIsotonicRegression(
          over25Stacked,
          stackRows.map((row) => row.over25),
          isotonicBins,
        ),
        btts: fitIsotonicRegression(
          bttsStacked,
          stackRows.map((row) => row.btts),
          isotonicBins,
        ),
      };

      artifact = buildScientificArtifactV7({
        base: baseArtifact,
        stacking,
        isotonic,
      });
    }
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
    const purpose =
      options.purpose ?? process.env.SCIENTIFIC_TRAINING_PURPOSE ?? 'production-training';
    const noPromote =
      options.noPromote ??
      process.env.SCIENTIFIC_TRAINING_NO_PROMOTE?.trim().toLowerCase() === 'true';
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
