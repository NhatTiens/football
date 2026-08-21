import { clamp, normalizeProbabilities, type LineupAdjustment } from '@football-ai/engine';
import { FixtureStatus, prisma } from '@football-ai/database';
import { getLineupAnalysisRules } from './config.js';
import { getFixtureLineupAnalysis } from './lineup-analysis.js';
import {
  getFixtureContextCoverageAsOf,
  getFixtureInjurySnapshotAsOf,
} from './context-snapshots.js';
import {
  PointInTimeAudit,
  createPredictionContext,
  estimateFixtureResultAvailableAt,
  isAvailableAtOrBefore,
  type PointInTimeAuditSummary,
  type PredictionMode,
} from './point-in-time.js';
import {
  getExternalPredictionSnapshotAsOf,
  getFixtureTeamMetricSnapshotsAsOf,
  type SnapshotStorage,
} from './scientific-snapshots.js';
import {
  getMatchWinnerOddsMovement,
  type MatchWinnerOddsMovementAnalysis,
} from './odds-movement.js';
import {
  getFundamentalsFixturePrediction,
  type FundamentalsFixturePrediction,
} from './fundamentals-engine.js';
import {
  SCIENTIFIC_FEATURE_NAMES,
  SCIENTIFIC_FEATURE_NAMES_V7,
  SCIENTIFIC_MODEL_KEY,
  adaptFeatureWidth,
  applyStackingBinary,
  applyStackingMatchWinner,
  calibrateTotalProbability,
  isScientificModelArtifact,
  opponentAdjustedPpg,
  poissonGoalMarkets,
  predictScientificModel,
  predictScientificModelV7,
  type ScientificModelArtifact,
  type ScientificModelPrediction,
} from './scientific-model.js';
import { getFixtureMarketFeatureSet, type MarketFeatureSet } from './scientific-market-features.js';
import { buildThreeMarketProjection, type ThreeMarketProjection } from './three-market-core.js';

interface HistoryFixtureRow {
  id: number;
  kickoffAt: Date;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number | null;
  awayGoals: number | null;
}

interface MetricRow {
  fixtureId: number;
  teamId: number;
  expectedGoals: number | null;
  shotsOnGoal: number | null;
  capturedAt: Date;
  storage: SnapshotStorage;
}

interface TeamMatchRecord {
  fixtureId: number;
  kickoffAt: Date;
  isHome: boolean;
  goalsFor: number;
  goalsAgainst: number;
  expectedGoalsFor: number;
  expectedGoalsAgainst: number;
  shotsOnGoal: number;
  points: number;
  /** Opponent Elo at that fixture (PREDICTION_AI_V7 opponent-adjusted form). */
  opponentRating: number | null;
}

interface TeamSummary {
  matches: number;
  pointsPerGame: number;
  goalsFor: number;
  goalsAgainst: number;
  expectedGoalsFor: number;
  expectedGoalsAgainst: number;
  shotsOnGoal: number;
  restDays: number;
  metricMatches: number;
}

export interface ScientificFixtureAnalysis {
  fixtureId: number;
  /** @deprecated Use predictionAsOf. */
  asOf: Date;
  predictionAsOf: Date;
  pointInTimeAudit: PointInTimeAuditSummary;
  marketMovement: MatchWinnerOddsMovementAnalysis;
  /** PREDICTION_AI_V7: three-market (1X2 / O2.5 / BTTS) PIT consensus features. */
  marketFeatures: MarketFeatureSet;
  fundamentals: FundamentalsFixturePrediction;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  featureVector: number[];
  featureNames: readonly string[];
  matchWinner: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  over25: Record<'OVER' | 'UNDER', number>;
  btts: Record<'YES' | 'NO', number>;
  threeMarket: ThreeMarketProjection;
  modelPrediction: ScientificModelPrediction | null;
  modelArtifact: ScientificModelArtifact | null;
  historySampleSize: number;
  dataQualityScore: number;
  confidenceScore: number;
  lineupAnalysis: LineupAdjustment;
  injuries: {
    home: number;
    away: number;
    homeRegulars: number;
    awayRegulars: number;
    coverageAvailable: boolean;
  };
  elo: {
    home: number;
    away: number;
  };
  form: {
    homePointsPerGame: number;
    awayPointsPerGame: number;
  };
  tactical: {
    homeFormation: string | null;
    awayFormation: string | null;
    homeScore: number;
    awayScore: number;
  };
  reasons: string[];
}

function numberEnvironment(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricKey(fixtureId: number, teamId: number): string {
  return `${fixtureId}:${teamId}`;
}

function buildTeamRecords(
  fixtures: HistoryFixtureRow[],
  metrics: Map<string, MetricRow>,
  teamId: number,
  ratingsByFixture?: Map<number, { home: number; away: number }>,
): TeamMatchRecord[] {
  const records: TeamMatchRecord[] = [];

  for (const fixture of fixtures) {
    if (fixture.homeGoals == null || fixture.awayGoals == null) continue;
    if (fixture.homeTeamId !== teamId && fixture.awayTeamId !== teamId) continue;

    const isHome = fixture.homeTeamId === teamId;
    const opponentId = isHome ? fixture.awayTeamId : fixture.homeTeamId;
    const goalsFor = isHome ? fixture.homeGoals : fixture.awayGoals;
    const goalsAgainst = isHome ? fixture.awayGoals : fixture.homeGoals;
    const ownMetric = metrics.get(metricKey(fixture.id, teamId));
    const opponentMetric = metrics.get(metricKey(fixture.id, opponentId));
    const fixtureRatings = ratingsByFixture?.get(fixture.id);

    records.push({
      fixtureId: fixture.id,
      kickoffAt: fixture.kickoffAt,
      isHome,
      goalsFor,
      goalsAgainst,
      expectedGoalsFor: ownMetric?.expectedGoals ?? goalsFor,
      expectedGoalsAgainst: opponentMetric?.expectedGoals ?? goalsAgainst,
      shotsOnGoal: ownMetric?.shotsOnGoal ?? Math.max(1, Math.round(goalsFor * 2.4)),
      points: goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0,
      opponentRating: fixtureRatings ? (isHome ? fixtureRatings.away : fixtureRatings.home) : null,
    });
  }

  return records.sort((left, right) => right.kickoffAt.getTime() - left.kickoffAt.getTime());
}

/**
 * PREDICTION_AI_V7: online Elo series — final ratings plus the rating of every
 * team at the time of each historical fixture (used for opponent-adjusted form
 * and injury/lineup context weighting without look-ahead bias).
 */
function calculateEloSeries(
  fixtures: HistoryFixtureRow[],
): Map<number, { home: number; away: number }> {
  const kFactor = numberEnvironment('ELO_K_FACTOR', 24);
  const homeAdvantage = numberEnvironment('ELO_HOME_ADVANTAGE', 60);
  const ratings = new Map<number, number>();
  const series = new Map<number, { home: number; away: number }>();
  const chronological = [...fixtures].sort(
    (left, right) => left.kickoffAt.getTime() - right.kickoffAt.getTime(),
  );

  for (const fixture of chronological) {
    const homeRating = ratings.get(fixture.homeTeamId) ?? 1500;
    const awayRating = ratings.get(fixture.awayTeamId) ?? 1500;
    series.set(fixture.id, { home: homeRating, away: awayRating });
    if (fixture.homeGoals == null || fixture.awayGoals == null) continue;
    const expectedHome = 1 / (1 + 10 ** ((awayRating - (homeRating + homeAdvantage)) / 400));
    const actualHome =
      fixture.homeGoals > fixture.awayGoals ? 1 : fixture.homeGoals === fixture.awayGoals ? 0.5 : 0;
    const movement = kFactor * (actualHome - expectedHome);
    ratings.set(fixture.homeTeamId, homeRating + movement);
    ratings.set(fixture.awayTeamId, awayRating - movement);
  }

  return series;
}

/** PREDICTION_AI_V7: matches played in the last `days` before kickoff (fatigue density). */
function recentMatchDensity(records: TeamMatchRecord[], kickoffAt: Date, days: number): number {
  const cutoff = kickoffAt.getTime() - days * 86_400_000;
  return records.filter((record) => record.kickoffAt.getTime() >= cutoff).length;
}

/** PREDICTION_AI_V7: team-specific home advantage vs league venue split. */
function teamHomeAdvantage(
  records: TeamMatchRecord[],
  leagueHomePpg: number,
  leagueAwayPpg: number,
): number {
  const homeMatches = records.filter((record) => record.isHome);
  const awayMatches = records.filter((record) => !record.isHome);
  if (homeMatches.length < 2 || awayMatches.length < 2) return 0;
  const homePpg = homeMatches.reduce((sum, record) => sum + record.points, 0) / homeMatches.length;
  const awayPpg = awayMatches.reduce((sum, record) => sum + record.points, 0) / awayMatches.length;
  return clamp(homePpg - awayPpg - (leagueHomePpg - leagueAwayPpg), -0.8, 0.8);
}

function summarizeTeam(
  records: TeamMatchRecord[],
  historyLimit: number,
  kickoffAt: Date,
  fallbackHomeXg: number,
): TeamSummary {
  const selected = records.slice(0, historyLimit);
  const latest = selected[0];
  const restDays = latest
    ? clamp((kickoffAt.getTime() - latest.kickoffAt.getTime()) / 86_400_000, 1, 30)
    : 7;

  return {
    matches: selected.length,
    pointsPerGame: average(
      selected.map((row) => row.points),
      1.35,
    ),
    goalsFor: average(
      selected.map((row) => row.goalsFor),
      fallbackHomeXg,
    ),
    goalsAgainst: average(
      selected.map((row) => row.goalsAgainst),
      1.25,
    ),
    expectedGoalsFor: average(
      selected.map((row) => row.expectedGoalsFor),
      fallbackHomeXg,
    ),
    expectedGoalsAgainst: average(
      selected.map((row) => row.expectedGoalsAgainst),
      1.25,
    ),
    shotsOnGoal: average(
      selected.map((row) => row.shotsOnGoal),
      4.2,
    ),
    restDays,
    metricMatches: selected.filter((row) => metricsAreInformative(row)).length,
  };
}

function metricsAreInformative(record: TeamMatchRecord): boolean {
  return (
    Math.abs(record.expectedGoalsFor - record.goalsFor) > 0.0001 ||
    record.shotsOnGoal !== Math.max(1, Math.round(record.goalsFor * 2.4))
  );
}

function calculateEloAsOf(
  fixtures: HistoryFixtureRow[],
  homeTeamId: number,
  awayTeamId: number,
): { home: number; away: number } {
  const kFactor = numberEnvironment('ELO_K_FACTOR', 24);
  const homeAdvantage = numberEnvironment('ELO_HOME_ADVANTAGE', 60);
  const ratings = new Map<number, number>();
  const chronological = [...fixtures].sort(
    (left, right) => left.kickoffAt.getTime() - right.kickoffAt.getTime(),
  );

  for (const fixture of chronological) {
    if (fixture.homeGoals == null || fixture.awayGoals == null) continue;
    const homeRating = ratings.get(fixture.homeTeamId) ?? 1500;
    const awayRating = ratings.get(fixture.awayTeamId) ?? 1500;
    const expectedHome = 1 / (1 + 10 ** ((awayRating - (homeRating + homeAdvantage)) / 400));
    const actualHome =
      fixture.homeGoals > fixture.awayGoals ? 1 : fixture.homeGoals === fixture.awayGoals ? 0.5 : 0;
    const movement = kFactor * (actualHome - expectedHome);
    ratings.set(fixture.homeTeamId, homeRating + movement);
    ratings.set(fixture.awayTeamId, awayRating - movement);
  }

  return {
    home: ratings.get(homeTeamId) ?? 1500,
    away: ratings.get(awayTeamId) ?? 1500,
  };
}

function eloMatchWinnerProbabilities(
  homeElo: number,
  awayElo: number,
): Record<'HOME' | 'DRAW' | 'AWAY', number> {
  const homeAdvantage = numberEnvironment('ELO_HOME_ADVANTAGE', 60);
  const expectedHome = 1 / (1 + 10 ** ((awayElo - (homeElo + homeAdvantage)) / 400));
  const difference = Math.abs(homeElo + homeAdvantage - awayElo);
  const drawProbability = clamp(0.29 - difference / 2600, 0.16, 0.3);
  const decisiveMass = 1 - drawProbability;

  return normalizeProbabilities({
    HOME: expectedHome * decisiveMass,
    DRAW: drawProbability,
    AWAY: (1 - expectedHome) * decisiveMass,
  });
}

function formationScore(formation: string | null | undefined): number {
  if (!formation) return 0;
  const numbers = formation
    .split('-')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
  if (numbers.length < 2) return 0;
  const defenders = numbers[0] ?? 4;
  const attackers = numbers[numbers.length - 1] ?? 2;
  return clamp((attackers - 2.2) * 0.025 - (defenders - 4) * 0.012, -0.06, 0.06);
}

async function countRegularInjuries(input: {
  teamId: number;
  apiPlayerIds: number[];
  asOf: Date;
}): Promise<number> {
  if (input.apiPlayerIds.length === 0) return 0;
  const players = await prisma.player.findMany({
    where: { apiPlayerId: { in: input.apiPlayerIds } },
    select: { id: true },
  });
  if (players.length === 0) return 0;
  const playerIds = players.map((player: { id: number }) => player.id);
  const entries = await prisma.fixtureLineupPlayer.findMany({
    where: {
      playerId: { in: playerIds },
      isStarter: true,
      lineupSnapshot: {
        teamId: input.teamId,
        isConfirmed: true,
        capturedAt: { lt: input.asOf },
      },
    },
    select: {
      playerId: true,
      lineupSnapshot: { select: { fixtureId: true } },
    },
    take: 1000,
  });
  const starts = new Map<number, Set<number>>();
  for (const entry of entries) {
    const fixtureIds = starts.get(entry.playerId) ?? new Set<number>();
    fixtureIds.add(entry.lineupSnapshot.fixtureId);
    starts.set(entry.playerId, fixtureIds);
  }
  return [...starts.values()].filter((fixtureIds) => fixtureIds.size >= 3).length;
}

function weightedRecordBlend<K extends string>(
  components: Array<{ probabilities: Record<K, number>; weight: number }>,
): Record<K, number> {
  const result = {} as Record<K, number>;
  let totalWeight = 0;

  for (const component of components) {
    if (component.weight <= 0) continue;
    totalWeight += component.weight;
    for (const [key, probability] of Object.entries(component.probabilities) as Array<
      [K, number]
    >) {
      result[key] = (result[key] ?? 0) + probability * component.weight;
    }
  }

  if (totalWeight <= 0) {
    throw new Error('At least one probability component is required.');
  }

  for (const key of Object.keys(result) as K[]) {
    result[key] = (result[key] ?? 0) / totalWeight;
  }
  return normalizeProbabilities(result);
}

function externalPredictionRecord(
  external: {
    homeProbability: number | null;
    drawProbability: number | null;
    awayProbability: number | null;
  } | null,
): Record<'HOME' | 'DRAW' | 'AWAY', number> | null {
  if (
    external?.homeProbability == null ||
    external.drawProbability == null ||
    external.awayProbability == null
  ) {
    return null;
  }
  return normalizeProbabilities({
    HOME: external.homeProbability,
    DRAW: external.drawProbability,
    AWAY: external.awayProbability,
  });
}

function parseStoredArtifact(value: unknown): ScientificModelArtifact | null {
  return isScientificModelArtifact(value) ? value : null;
}

export async function getScientificFixtureAnalysis(input: {
  fixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: Date;
  predictionAsOf?: Date;
  /** @deprecated Use predictionAsOf. */
  asOf?: Date;
  mode?: PredictionMode;
  useMachineLearning?: boolean;
}): Promise<ScientificFixtureAnalysis> {
  const predictionAsOf = input.predictionAsOf ?? input.asOf;
  if (!predictionAsOf) {
    throw new TypeError('getScientificFixtureAnalysis requires predictionAsOf.');
  }

  const context = createPredictionContext({
    fixtureId: input.fixtureId,
    kickoffAt: input.kickoffAt,
    predictionAsOf,
    mode: input.mode ?? 'LIVE',
  });
  const audit = new PointInTimeAudit(context);
  const resultAvailabilityLagMinutes = Math.max(
    0,
    numberEnvironment('POINT_IN_TIME_RESULT_LAG_MINUTES', 180),
  );
  const historyAvailableBefore = new Date(
    predictionAsOf.getTime() - resultAvailabilityLagMinutes * 60_000,
  );

  const historyLimit = Math.max(3, Math.floor(numberEnvironment('SCIENTIFIC_HISTORY_MATCHES', 10)));
  const historyPool = Math.max(120, historyLimit * 35);

  const history = (await prisma.fixture.findMany({
    where: {
      leagueId: input.leagueId,
      status: FixtureStatus.FINISHED,
      kickoffAt: { lt: historyAvailableBefore },
      homeGoals: { not: null },
      awayGoals: { not: null },
    },
    select: {
      id: true,
      kickoffAt: true,
      homeTeamId: true,
      awayTeamId: true,
      homeGoals: true,
      awayGoals: true,
    },
    orderBy: { kickoffAt: 'desc' },
    take: historyPool,
  })) as HistoryFixtureRow[];

  const fixtureIds = history.map((fixture) => fixture.id);
  const metricRows: MetricRow[] = fixtureIds.length
    ? await getFixtureTeamMetricSnapshotsAsOf({
        fixtureIds,
        predictionAsOf,
      })
    : [];
  const metricMap = new Map<string, MetricRow>(
    metricRows.map((row) => [metricKey(row.fixtureId, row.teamId), row]),
  );

  const leagueHomeXg = average(
    history
      .map(
        (fixture) =>
          metricMap.get(metricKey(fixture.id, fixture.homeTeamId))?.expectedGoals ??
          fixture.homeGoals,
      )
      .filter((value): value is number => value != null),
    1.45,
  );
  const leagueAwayXg = average(
    history
      .map(
        (fixture) =>
          metricMap.get(metricKey(fixture.id, fixture.awayTeamId))?.expectedGoals ??
          fixture.awayGoals,
      )
      .filter((value): value is number => value != null),
    1.2,
  );

  const eloSeries = calculateEloSeries(history);
  const homeRecords = buildTeamRecords(history, metricMap, input.homeTeamId, eloSeries);
  const awayRecords = buildTeamRecords(history, metricMap, input.awayTeamId, eloSeries);
  const homeSummary = summarizeTeam(homeRecords, historyLimit, input.kickoffAt, leagueHomeXg);
  const awaySummary = summarizeTeam(awayRecords, historyLimit, input.kickoffAt, leagueAwayXg);

  const [
    lineupAnalysis,
    legacyInjuryRows,
    coverage,
    currentLineups,
    external,
    setting,
    injurySnapshot,
    injuryCoverageSnapshot,
    lineupCoverageSnapshot,
    marketFeatures,
  ] = await Promise.all([
    getFixtureLineupAnalysis({
      fixtureId: input.fixtureId,
      homeTeamId: input.homeTeamId,
      homeTeamName: input.homeTeamName,
      awayTeamId: input.awayTeamId,
      awayTeamName: input.awayTeamName,
      kickoffAt: input.kickoffAt,
      asOf: predictionAsOf,
      historyLookback: Math.max(3, Math.floor(numberEnvironment('LINEUP_HISTORY_LOOKBACK', 10))),
      rules: getLineupAnalysisRules(),
    }),
    prisma.fixtureInjury.findMany({
      where: { fixtureId: input.fixtureId, capturedAt: { lte: predictionAsOf } },
      select: { teamId: true, apiPlayerId: true, capturedAt: true },
    }),
    prisma.fixtureScientificCoverage.findUnique({
      where: { fixtureId: input.fixtureId },
    }),
    prisma.fixtureLineupSnapshot.findMany({
      where: {
        fixtureId: input.fixtureId,
        teamId: { in: [input.homeTeamId, input.awayTeamId] },
        capturedAt: { lte: predictionAsOf },
      },
      select: { teamId: true, formation: true, capturedAt: true },
      orderBy: { capturedAt: 'desc' },
    }),
    getExternalPredictionSnapshotAsOf({
      fixtureId: input.fixtureId,
      predictionAsOf,
    }),
    prisma.appSetting.findUnique({ where: { key: SCIENTIFIC_MODEL_KEY } }),
    getFixtureInjurySnapshotAsOf({
      fixtureId: input.fixtureId,
      predictionAsOf,
    }),
    getFixtureContextCoverageAsOf({
      fixtureId: input.fixtureId,
      dataType: 'INJURY',
      predictionAsOf,
    }),
    getFixtureContextCoverageAsOf({
      fixtureId: input.fixtureId,
      dataType: 'LINEUP',
      predictionAsOf,
    }),
    getFixtureMarketFeatureSet({
      fixtureId: input.fixtureId,
      predictionAsOf,
      minimumBookmakers: Math.max(
        1,
        Math.floor(numberEnvironment('SCIENTIFIC_MARKET_MIN_BOOKMAKERS', 2)),
      ),
      maximumAgeHours: Math.max(1, numberEnvironment('SCIENTIFIC_MARKET_MAX_AGE_HOURS', 168)),
    }),
  ]);

  const injuryRows = injurySnapshot?.players ?? legacyInjuryRows;
  const marketMovement = await getMatchWinnerOddsMovement({
    fixtureId: input.fixtureId,
    kickoffAt: input.kickoffAt,
    predictionAsOf,
  });

  audit.registerMany('ODDS', marketMovement.auditObservations);

  const injuriesCoverageAvailable =
    injuryCoverageSnapshot != null ||
    (coverage?.injuriesFetchedAt != null &&
      isAvailableAtOrBefore(coverage.injuriesFetchedAt, predictionAsOf));
  const statisticsCoverageAvailable =
    coverage?.statisticsFetchedAt != null &&
    isAvailableAtOrBefore(coverage.statisticsFetchedAt, predictionAsOf);

  audit.registerMany(
    'FIXTURE_RESULT',
    history.map((fixture) => ({
      key: `fixture:${fixture.id}`,
      availableAt: estimateFixtureResultAvailableAt(
        fixture.kickoffAt,
        resultAvailabilityLagMinutes,
      ),
    })),
  );
  audit.registerMany(
    'TEAM_METRIC',
    metricRows.map((metric) => ({
      key: `fixture:${metric.fixtureId}:team:${metric.teamId}`,
      availableAt: metric.capturedAt,
      metadata: { storage: metric.storage },
    })),
  );
  audit.registerMany(
    'INJURY',
    injuryRows.map((injury: { teamId: number; apiPlayerId: number; capturedAt: Date }) => ({
      key: `fixture:${input.fixtureId}:team:${injury.teamId}:player:${injury.apiPlayerId}`,
      availableAt: injury.capturedAt,
    })),
  );
  audit.registerMany(
    'LINEUP',
    currentLineups.map((lineup: { teamId: number; capturedAt: Date }) => ({
      key: `fixture:${input.fixtureId}:team:${lineup.teamId}`,
      availableAt: lineup.capturedAt,
    })),
  );
  if (external) {
    audit.register('EXTERNAL_PREDICTION', `fixture:${input.fixtureId}`, external.capturedAt, {
      storage: external.storage,
    });
  }
  if (injuryCoverageSnapshot) {
    audit.register(
      'COVERAGE',
      `fixture:${input.fixtureId}:injuries:snapshot`,
      injuryCoverageSnapshot.capturedAt,
      { responseCount: injuryCoverageSnapshot.responseCount },
    );
  } else if (injuriesCoverageAvailable && coverage?.injuriesFetchedAt) {
    audit.register('COVERAGE', `fixture:${input.fixtureId}:injuries`, coverage.injuriesFetchedAt);
  }
  if (lineupCoverageSnapshot) {
    audit.register(
      'COVERAGE',
      `fixture:${input.fixtureId}:context:lineup-coverage`,
      lineupCoverageSnapshot.capturedAt,
      { responseCount: lineupCoverageSnapshot.responseCount },
    );
  }
  if (marketFeatures.available) {
    audit.register('MARKET_FEATURES', `fixture:${input.fixtureId}`, predictionAsOf, {
      bookmakerCount: marketFeatures.bookmakerCount,
      qualityScore: marketFeatures.qualityScore,
      oddsAgeHours: marketFeatures.oddsAgeHours,
    });
  }
  if (statisticsCoverageAvailable && coverage?.statisticsFetchedAt) {
    audit.register(
      'COVERAGE',
      `fixture:${input.fixtureId}:statistics`,
      coverage.statisticsFetchedAt,
    );
  }

  const injuries = injuryRows as Array<{
    teamId: number;
    apiPlayerId: number;
    capturedAt: Date;
  }>;
  const homeInjuries = injuries.filter(
    (row: { teamId: number; apiPlayerId: number }) => row.teamId === input.homeTeamId,
  );
  const awayInjuries = injuries.filter(
    (row: { teamId: number; apiPlayerId: number }) => row.teamId === input.awayTeamId,
  );
  const [homeRegulars, awayRegulars] = await Promise.all([
    countRegularInjuries({
      teamId: input.homeTeamId,
      apiPlayerIds: homeInjuries.map((row: { apiPlayerId: number }) => row.apiPlayerId),
      asOf: predictionAsOf,
    }),
    countRegularInjuries({
      teamId: input.awayTeamId,
      apiPlayerIds: awayInjuries.map((row: { apiPlayerId: number }) => row.apiPlayerId),
      asOf: predictionAsOf,
    }),
  ]);

  const latestFormation = new Map<number, string | null>();
  for (const row of currentLineups) {
    if (!latestFormation.has(row.teamId)) latestFormation.set(row.teamId, row.formation);
  }
  const homeFormation =
    latestFormation.get(input.homeTeamId) ?? lineupAnalysis.home.formation ?? null;
  const awayFormation =
    latestFormation.get(input.awayTeamId) ?? lineupAnalysis.away.formation ?? null;
  const homeTacticalScore = formationScore(homeFormation);
  const awayTacticalScore = formationScore(awayFormation);

  const injuryScale = numberEnvironment('SCIENTIFIC_INJURY_XG_PENALTY', 0.018);
  const regularScale = numberEnvironment('SCIENTIFIC_REGULAR_INJURY_XG_PENALTY', 0.035);
  const homeInjuryPenalty = clamp(
    homeInjuries.length * injuryScale + homeRegulars * regularScale,
    0,
    0.22,
  );
  const awayInjuryPenalty = clamp(
    awayInjuries.length * injuryScale + awayRegulars * regularScale,
    0,
    0.22,
  );

  const homeAttack = homeSummary.expectedGoalsFor / Math.max(leagueHomeXg, 0.3);
  const homeDefense = homeSummary.expectedGoalsAgainst / Math.max(leagueAwayXg, 0.3);
  const awayAttack = awaySummary.expectedGoalsFor / Math.max(leagueAwayXg, 0.3);
  const awayDefense = awaySummary.expectedGoalsAgainst / Math.max(leagueHomeXg, 0.3);

  let homeExpectedGoals = leagueHomeXg * homeAttack * awayDefense;
  let awayExpectedGoals = leagueAwayXg * awayAttack * homeDefense;
  homeExpectedGoals *= 1 - homeInjuryPenalty;
  awayExpectedGoals *= 1 - awayInjuryPenalty;
  homeExpectedGoals *= 1 + homeTacticalScore - awayTacticalScore * 0.25;
  awayExpectedGoals *= 1 + awayTacticalScore - homeTacticalScore * 0.25;
  const lineupTotalMultiplier = clamp(1 + lineupAnalysis.overProbabilityAdjustment * 4, 0.82, 1.18);
  homeExpectedGoals *= lineupTotalMultiplier;
  awayExpectedGoals *= lineupTotalMultiplier;
  homeExpectedGoals = clamp(homeExpectedGoals, 0.2, 4.5);
  awayExpectedGoals = clamp(awayExpectedGoals, 0.15, 4.2);

  const fundamentalsPrediction = await getFundamentalsFixturePrediction({
    fixtureId: input.fixtureId,
    leagueId: input.leagueId,
    homeTeamId: input.homeTeamId,
    awayTeamId: input.awayTeamId,
    kickoffAt: input.kickoffAt,
    predictionAsOf,
    persist: false,
  });
  const fundamentalsBlendWeight = fundamentalsPrediction.available
    ? clamp(numberEnvironment('FUNDAMENTALS_BLEND_WEIGHT', 0.65), 0, 1)
    : 0;

  if (fundamentalsBlendWeight > 0) {
    homeExpectedGoals = clamp(
      homeExpectedGoals * (1 - fundamentalsBlendWeight) +
        fundamentalsPrediction.homeExpectedGoals * fundamentalsBlendWeight,
      0.2,
      4.5,
    );
    awayExpectedGoals = clamp(
      awayExpectedGoals * (1 - fundamentalsBlendWeight) +
        fundamentalsPrediction.awayExpectedGoals * fundamentalsBlendWeight,
      0.15,
      4.2,
    );
  }
  const elo = calculateEloAsOf(history, input.homeTeamId, input.awayTeamId);

  // PREDICTION_AI_V7_FEATURES: opponent-adjusted form, venue home advantage,
  // fatigue density and market consensus/movement features.
  const leagueHomePpg = average(
    history
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
    history
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
  const homeAdjPpg = opponentAdjustedPpg(homeRecords);
  const awayAdjPpg = opponentAdjustedPpg(awayRecords);
  const homeVenueAdvantage = teamHomeAdvantage(homeRecords, leagueHomePpg, leagueAwayPpg);
  const awayVenueAdvantage = teamHomeAdvantage(awayRecords, leagueHomePpg, leagueAwayPpg);
  const homeDensity7 = recentMatchDensity(homeRecords, input.kickoffAt, 7);
  const awayDensity7 = recentMatchDensity(awayRecords, input.kickoffAt, 7);
  const homeDensity14 = recentMatchDensity(homeRecords, input.kickoffAt, 14);
  const awayDensity14 = recentMatchDensity(awayRecords, input.kickoffAt, 14);
  const injuryWeightedHome = homeInjuries.length + homeRegulars * 2;
  const injuryWeightedAway = awayInjuries.length + awayRegulars * 2;

  const marketHomeConsensus = marketFeatures.homeConsensus ?? 1 / 3;
  const marketDrawConsensus = marketFeatures.drawConsensus ?? 1 / 3;
  const marketAwayConsensus = marketFeatures.awayConsensus ?? 1 / 3;
  const marketOver25Consensus = marketFeatures.over25Consensus ?? 0.5;
  const marketBttsYesConsensus = marketFeatures.bttsYesConsensus ?? 0.5;
  const marketMoveHome = marketFeatures.homeMovement ?? 0;
  const marketMoveOver25 = marketFeatures.over25Movement ?? 0;
  const marketOddsAgeHours = marketFeatures.oddsAgeHours ?? 30;
  const marketBookmakerCount = marketFeatures.bookmakerCount ?? 0;

  const featureVector = [
    (elo.home - elo.away) / 400,
    (homeSummary.pointsPerGame - awaySummary.pointsPerGame) / 3,
    (homeSummary.goalsFor - homeSummary.goalsAgainst) / 3,
    (awaySummary.goalsFor - awaySummary.goalsAgainst) / 3,
    homeSummary.expectedGoalsFor / 3,
    awaySummary.expectedGoalsFor / 3,
    homeSummary.expectedGoalsAgainst / 3,
    awaySummary.expectedGoalsAgainst / 3,
    (homeExpectedGoals + awayExpectedGoals) / 4,
    (homeSummary.shotsOnGoal + awaySummary.shotsOnGoal) / 12,
    (awayInjuries.length - homeInjuries.length) / 5,
    (homeInjuries.length + awayInjuries.length) / 10,
    (homeSummary.restDays - awaySummary.restDays) / 14,
    homeTacticalScore + awayTacticalScore,
    lineupAnalysis.overProbabilityAdjustment / 0.025,
    clamp(homeVenueAdvantage - awayVenueAdvantage, -0.8, 0.8),
    marketHomeConsensus,
    marketDrawConsensus,
    marketAwayConsensus,
    marketOver25Consensus,
    marketBttsYesConsensus,
    clamp(marketMoveHome / 0.1, -1, 1),
    clamp(marketMoveOver25 / 0.1, -1, 1),
    marketFeatures.available ? 1 : 0,
    clamp(marketOddsAgeHours / 72, 0, 1),
    clamp(marketBookmakerCount / 10, 0, 1),
    clamp((homeAdjPpg - awayAdjPpg) / 1.5, -1, 1),
    clamp((injuryWeightedAway - injuryWeightedHome) / 6, -1, 1),
    clamp((homeDensity7 - awayDensity7) / 3 + (homeDensity14 - awayDensity14) / 6, -1, 1),
  ];

  const storedArtifact = parseStoredArtifact(setting?.value);
  const modelTrainedAt = storedArtifact ? new Date(storedArtifact.trainedAt) : null;
  const modelTrainedThrough = storedArtifact ? new Date(storedArtifact.trainedThrough) : null;
  const modelAllowedByTime =
    storedArtifact != null &&
    modelTrainedAt != null &&
    modelTrainedThrough != null &&
    Number.isFinite(modelTrainedAt.getTime()) &&
    Number.isFinite(modelTrainedThrough.getTime()) &&
    modelTrainedAt.getTime() <= predictionAsOf.getTime() &&
    modelTrainedThrough.getTime() < predictionAsOf.getTime();
  const artifact = modelAllowedByTime ? storedArtifact : null;

  if (artifact && modelTrainedAt) {
    audit.register('MODEL_ARTIFACT', artifact.version, modelTrainedAt, {
      sampleSize: artifact.sampleSize,
      trainedThrough: artifact.trainedThrough,
    });
  }

  const useMachineLearning = input.useMachineLearning ?? true;
  const isV7Artifact = artifact?.version === 'scientific-ensemble-dixon-coles-v7';

  // PREDICTION_AI_V7: market consensus as a prediction component (for stacking).
  const marketMatchWinner = marketFeatures.available
    ? {
        HOME: marketFeatures.homeConsensus ?? 1 / 3,
        DRAW: marketFeatures.drawConsensus ?? 1 / 3,
        AWAY: marketFeatures.awayConsensus ?? 1 / 3,
      }
    : null;

  const poisson25 = poissonGoalMarkets(homeExpectedGoals, awayExpectedGoals, 2.5);
  const eloProbabilities = eloMatchWinnerProbabilities(elo.home, elo.away);
  const externalProbabilities = externalPredictionRecord(external);

  const modelPrediction =
    !artifact || !useMachineLearning
      ? null
      : isV7Artifact
        ? predictScientificModelV7({
            artifact,
            features: featureVector,
            poissonMatchWinner: poisson25.matchWinner,
            poissonOver25: poisson25.total.overConditional,
            poissonBttsYes: poisson25.btts.YES,
            eloMatchWinner: eloProbabilities,
            marketMatchWinner,
            marketOver25: marketFeatures.over25Consensus,
            marketBttsYes: marketFeatures.bttsYesConsensus,
            horizonMinutes: Math.max(
              0,
              Math.round((input.kickoffAt.getTime() - predictionAsOf.getTime()) / 60_000),
            ),
          })
        : predictScientificModel(artifact, featureVector);
  // PREDICTION_AI_V6_FEATURE_BLEND: hạ trọng số ML khi mẫu ít hoặc ensemble bất đồng.
  const modelUncertainty = modelPrediction?.uncertainty;
  const modelSampleReliability = clamp(
    Math.log10(Math.max(10, artifact?.sampleSize ?? 10)) / 3,
    0.35,
    1,
  );
  // PREDICTION_AI_V7_STACKED_BLEND: when the v7 artifact carries learned
  // stacking weights, the model prediction is already the final blend
  // (poisson + elo + ml + market) with isotonic calibration, so the legacy
  // hand-tuned blend below is skipped for the stacked markets.
  const v7Stacked = Boolean(isV7Artifact && artifact?.stacking && modelPrediction);
  let matchWinner: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  let over25: Record<'OVER' | 'UNDER', number>;
  let btts: Record<'YES' | 'NO', number>;

  if (v7Stacked) {
    matchWinner = modelPrediction!.matchWinner;
    over25 = modelPrediction!.over25;
    btts = modelPrediction!.btts;
  } else {
    const mlWinnerWeight = modelPrediction
      ? clamp(
          0.38 * modelSampleReliability * (1 - (modelUncertainty?.matchWinner ?? 0) * 4),
          0.14,
          0.42,
        )
      : 0;
    const poissonWinnerWeight = modelPrediction
      ? clamp(0.46 - mlWinnerWeight * 0.3, 0.31, 0.46)
      : 0.48;
    const matchWinnerComponents: Array<{
      probabilities: Record<'HOME' | 'DRAW' | 'AWAY', number>;
      weight: number;
    }> = [
      { probabilities: poisson25.matchWinner, weight: poissonWinnerWeight },
      { probabilities: eloProbabilities, weight: 0.24 },
    ];
    if (modelPrediction) {
      matchWinnerComponents.push({
        probabilities: modelPrediction.matchWinner,
        weight: mlWinnerWeight,
      });
    }
    if (externalProbabilities) {
      matchWinnerComponents.push({ probabilities: externalProbabilities, weight: 0.08 });
    }

    matchWinner = weightedRecordBlend(matchWinnerComponents);
    const over25Over = calibrateTotalProbability({
      lineProbability: poisson25.total.overConditional,
      poissonOver25: poisson25.total.overConditional,
      modelOver25: modelPrediction?.over25.OVER,
      calibrationWeight: 0.58,
      modelUncertainty: modelUncertainty?.over25,
      dataQuality: modelSampleReliability,
    });
    over25 = normalizeProbabilities({
      OVER: over25Over,
      UNDER: 1 - over25Over,
    });
    const bttsMlWeight = modelPrediction
      ? clamp(0.48 * modelSampleReliability * (1 - (modelUncertainty?.btts ?? 0) * 4), 0.15, 0.48)
      : 0;
    btts = modelPrediction
      ? weightedRecordBlend([
          { probabilities: poisson25.btts, weight: 1 - bttsMlWeight },
          { probabilities: modelPrediction.btts, weight: bttsMlWeight },
        ])
      : poisson25.btts;
  }

  const historySampleSize = Math.min(homeSummary.matches, awaySummary.matches);
  const historyQuality = clamp(historySampleSize / historyLimit, 0.1, 1);
  const metricCoverage = clamp(
    (homeSummary.metricMatches + awaySummary.metricMatches) /
      Math.max(1, homeSummary.matches + awaySummary.matches),
    0,
    1,
  );
  const lineupQuality = lineupAnalysis.available ? 1 : 0.45;
  const injuryCoverage = injuriesCoverageAvailable ? 1 : 0.35;
  const modelQuality = modelPrediction ? clamp((artifact?.sampleSize ?? 0) / 600, 0.35, 1) : 0.35;
  const baseDataQualityScore = clamp(
    historyQuality * 0.3 +
      metricCoverage * 0.25 +
      lineupQuality * 0.15 +
      injuryCoverage * 0.1 +
      modelQuality * 0.2,
    0,
    1,
  );
  const dataQualityScore = marketMovement.available
    ? clamp(baseDataQualityScore * 0.9 + marketMovement.qualityScore * 0.1, 0, 1)
    : baseDataQualityScore;
  const baseConfidenceScore = clamp(
    0.35 +
      dataQualityScore * 0.4 +
      (modelPrediction ? 0.12 : 0) +
      (lineupAnalysis.available ? 0.08 : 0) +
      (externalProbabilities ? 0.05 : 0),
    0,
    1,
  );
  const marketAgreementScore =
    marketMovement.currentConsensus == null
      ? 0.5
      : clamp(
          1 -
            (Math.abs(matchWinner.HOME - marketMovement.currentConsensus.HOME) +
              Math.abs(matchWinner.DRAW - marketMovement.currentConsensus.DRAW) +
              Math.abs(matchWinner.AWAY - marketMovement.currentConsensus.AWAY)) /
              2,
          0,
          1,
        );
  const confidenceScore = marketMovement.available
    ? clamp(baseConfidenceScore * 0.88 + marketAgreementScore * 0.12, 0, 1)
    : baseConfidenceScore;
  const threeMarket = buildThreeMarketProjection({
    homeExpectedGoals,
    awayExpectedGoals,
    dataQuality: dataQualityScore,
    directModelReliability: modelSampleReliability,
    uncertainty: {
      hda: modelUncertainty?.matchWinner,
      ...(modelUncertainty?.over15 == null ? {} : { over15: modelUncertainty.over15 }),
      over25: modelUncertainty?.over25,
      ...(modelUncertainty?.over35 == null ? {} : { over35: modelUncertainty.over35 }),
      btts: modelUncertainty?.btts,
    },
    directModel: modelPrediction
      ? {
          hda: modelPrediction.matchWinner,
          ...(modelPrediction.over15 ? { over15: modelPrediction.over15.OVER } : {}),
          over25: modelPrediction.over25.OVER,
          ...(modelPrediction.over35 ? { over35: modelPrediction.over35.OVER } : {}),
          bttsYes: modelPrediction.btts.YES,
        }
      : undefined,
  });
  const reasons = [
    `xG kỳ vọng: ${input.homeTeamName} ${homeExpectedGoals.toFixed(2)} - ${awayExpectedGoals.toFixed(2)} ${input.awayTeamName}.`,
    `Phong độ ${historyLimit} trận: ${homeSummary.pointsPerGame.toFixed(2)} - ${awaySummary.pointsPerGame.toFixed(2)} điểm/trận; adjusted: ${homeAdjPpg.toFixed(2)} - ${awayAdjPpg.toFixed(2)}.`,
    `Elo trước trận: ${Math.round(elo.home)} - ${Math.round(elo.away)}.`,
    `Chấn thương ghi nhận: ${homeInjuries.length} - ${awayInjuries.length}; cầu thủ thường đá chính: ${homeRegulars} - ${awayRegulars}.`,
    `Chiến thuật/đội hình: ${homeFormation ?? 'chưa rõ'} - ${awayFormation ?? 'chưa rõ'}.`,
    marketFeatures.available
      ? `Market consensus 1X2: ${(marketHomeConsensus * 100).toFixed(1)}% - ${(marketDrawConsensus * 100).toFixed(1)}% - ${(marketAwayConsensus * 100).toFixed(1)}% (${marketBookmakerCount} nhà cái, odds age ${marketOddsAgeHours.toFixed(1)}h, quality ${(marketFeatures.qualityScore * 100).toFixed(0)}%).`
      : 'Chưa đủ odds snapshot cho market features v7.',
    modelPrediction
      ? `Machine learning ${artifact?.version ?? ''}, mẫu huấn luyện ${artifact?.sampleSize ?? 0}.`
      : storedArtifact && !modelAllowedByTime
        ? 'Không dùng machine learning vì model được huấn luyện sau thời điểm phân tích (chống data leakage).'
        : 'Chưa có model machine learning đủ điều kiện; dùng xG, phong độ, Elo và odds consensus.',
    ...fundamentalsPrediction.reasons,
    ...marketMovement.reasons,
    ...lineupAnalysis.reasons,
  ];

  return {
    fixtureId: input.fixtureId,
    asOf: predictionAsOf,
    predictionAsOf,
    pointInTimeAudit: audit.summary(),
    marketMovement,
    marketFeatures,
    fundamentals: fundamentalsPrediction,
    homeExpectedGoals,
    awayExpectedGoals,
    featureVector,
    featureNames: SCIENTIFIC_FEATURE_NAMES_V7,
    matchWinner,
    over25,
    btts,
    threeMarket,
    modelPrediction,
    modelArtifact: artifact,
    historySampleSize,
    dataQualityScore,
    confidenceScore,
    lineupAnalysis,
    injuries: {
      home: homeInjuries.length,
      away: awayInjuries.length,
      homeRegulars,
      awayRegulars,
      coverageAvailable: injuriesCoverageAvailable,
    },
    elo,
    form: {
      homePointsPerGame: homeSummary.pointsPerGame,
      awayPointsPerGame: awaySummary.pointsPerGame,
    },
    tactical: {
      homeFormation,
      awayFormation,
      homeScore: homeTacticalScore,
      awayScore: awayTacticalScore,
    },
    reasons,
  };
}
