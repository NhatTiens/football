import { createHash } from 'node:crypto';

export const ML_MARKET_MODEL_KEY = 'CATBOOST_FUNDAMENTALS_MARKET_RESIDUAL_V1';
export const ML_MARKET_MODEL_VERSION = 'v7.0-alpha.6-catboost-market-residual-v1';

export const ML_MARKET_FEATURE_NAMES = [
  'horizon_minutes_scaled',
  'fundamentals_quality',
  'home_data_quality',
  'away_data_quality',
  'home_sample_size_scaled',
  'away_sample_size_scaled',
  'home_venue_sample_scaled',
  'away_venue_sample_scaled',
  'home_ppg_5',
  'away_ppg_5',
  'ppg_5_diff',
  'home_ppg_10',
  'away_ppg_10',
  'ppg_10_diff',
  'home_ppg_20',
  'away_ppg_20',
  'ppg_20_diff',
  'home_goals_for_5',
  'away_goals_for_5',
  'home_goals_against_5',
  'away_goals_against_5',
  'home_goals_for_10',
  'away_goals_for_10',
  'home_goals_against_10',
  'away_goals_against_10',
  'home_xg_for_10',
  'away_xg_for_10',
  'home_xg_against_10',
  'away_xg_against_10',
  'xg_balance_diff',
  'home_shots_10',
  'away_shots_10',
  'home_shots_on_goal_10',
  'away_shots_on_goal_10',
  'possession_diff_scaled',
  'corners_diff',
  'win_rate_diff',
  'draw_rate_mean',
  'clean_sheet_rate_diff',
  'btts_rate_mean',
  'over_25_rate_mean',
  'venue_ppg_diff',
  'venue_goals_for_diff',
  'venue_goals_against_diff',
  'rest_days_diff_scaled',
  'metric_coverage_min',
  'dixon_coles_home_xg',
  'dixon_coles_away_xg',
  'dixon_coles_home_probability',
  'dixon_coles_draw_probability',
  'dixon_coles_away_probability',
  'dixon_coles_over_25_probability',
  'dixon_coles_btts_probability',
  'market_available',
  'market_bookmaker_count_scaled',
  'market_home_probability',
  'market_draw_probability',
  'market_away_probability',
  'market_average_dispersion',
  'market_bookmaker_agreement',
  'market_quality',
  'market_movement_available',
  'market_move_home',
  'market_move_draw',
  'market_move_away',
  'market_recent_move_home',
  'market_recent_move_draw',
  'market_recent_move_away',
  'market_steam_strength',
  'dixon_market_home_residual',
  'dixon_market_draw_residual',
  'dixon_market_away_residual',
] as const;

export type MlMarketFeatureName = (typeof ML_MARKET_FEATURE_NAMES)[number];

export const ML_MARKET_FEATURE_CONTRACT_HASH = createHash('sha256')
  .update(
    JSON.stringify({
      version: ML_MARKET_MODEL_VERSION,
      featureNames: ML_MARKET_FEATURE_NAMES,
    }),
  )
  .digest('hex');

export type MatchWinnerProbabilities = Record<'HOME' | 'DRAW' | 'AWAY', number>;

export interface TeamFundamentalFeatureRow {
  sampleSize: number;
  venueSampleSize: number;
  pointsPerGame5: number;
  pointsPerGame10: number;
  pointsPerGame20: number;
  goalsFor5: number;
  goalsFor10: number;
  goalsAgainst5: number;
  goalsAgainst10: number;
  expectedGoalsFor10: number;
  expectedGoalsAgainst10: number;
  shots10: number;
  shotsOnGoal10: number;
  possession10: number;
  corners10: number;
  winRate10: number;
  drawRate10: number;
  cleanSheetRate10: number;
  bttsRate10: number;
  over25Rate10: number;
  metricCoverage10: number;
  venuePointsPerGame10: number;
  venueGoalsFor10: number;
  venueGoalsAgainst10: number;
  restDays: number;
  dataQualityScore: number;
}

export interface DixonColesFeatureRow {
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  over25Probability: number;
  bttsProbability: number;
  dataQualityScore: number;
}

export interface MarketFeatureRow {
  available: boolean;
  movementAvailable: boolean;
  bookmakerCount: number;
  currentConsensus: MatchWinnerProbabilities | null;
  movement: MatchWinnerProbabilities;
  recentMovement: MatchWinnerProbabilities;
  averageDispersion: number;
  bookmakerAgreement: number;
  steamStrength: number;
  qualityScore: number;
}

export interface MlMarketFeatureInput {
  horizonMinutes: number;
  home: TeamFundamentalFeatureRow;
  away: TeamFundamentalFeatureRow;
  dixonColes: DixonColesFeatureRow;
  market: MarketFeatureRow;
}

export interface MlMarketFeatureVector {
  featureNames: readonly MlMarketFeatureName[];
  featureVector: number[];
  featureContractHash: string;
  marketAvailable: boolean;
  marketConsensus: MatchWinnerProbabilities | null;
}

export interface MlMarketPrediction {
  catBoost: MatchWinnerProbabilities;
  residualMarket: MatchWinnerProbabilities | null;
  final: MatchWinnerProbabilities;
  over25: Record<'OVER' | 'UNDER', number>;
  btts: Record<'YES' | 'NO', number>;
}

const EPSILON = 1e-12;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number | null | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function safeDifference(left: number, right: number): number {
  return finite(left) - finite(right);
}

function safeMean(left: number, right: number): number {
  return (finite(left) + finite(right)) / 2;
}

export function normalizeMatchWinner(input: MatchWinnerProbabilities): MatchWinnerProbabilities {
  const home = Math.max(0, finite(input.HOME));
  const draw = Math.max(0, finite(input.DRAW));
  const away = Math.max(0, finite(input.AWAY));
  const total = home + draw + away;

  if (total <= EPSILON) {
    return {
      HOME: 1 / 3,
      DRAW: 1 / 3,
      AWAY: 1 / 3,
    };
  }

  return {
    HOME: home / total,
    DRAW: draw / total,
    AWAY: away / total,
  };
}

export function buildMlMarketFeatureVector(input: MlMarketFeatureInput): MlMarketFeatureVector {
  const { home, away, dixonColes, market } = input;
  const marketConsensus =
    market.available && market.currentConsensus != null
      ? normalizeMatchWinner(market.currentConsensus)
      : null;
  const marketFallback = marketConsensus ?? {
    HOME: dixonColes.homeProbability,
    DRAW: dixonColes.drawProbability,
    AWAY: dixonColes.awayProbability,
  };
  const movement = market.movement;
  const recentMovement = market.recentMovement;

  const vector = [
    clamp(input.horizonMinutes / 1440, 0, 2),
    clamp(dixonColes.dataQualityScore, 0, 1),
    clamp(home.dataQualityScore, 0, 1),
    clamp(away.dataQualityScore, 0, 1),
    clamp(home.sampleSize / 20, 0, 2),
    clamp(away.sampleSize / 20, 0, 2),
    clamp(home.venueSampleSize / 10, 0, 2),
    clamp(away.venueSampleSize / 10, 0, 2),
    finite(home.pointsPerGame5, 1.35),
    finite(away.pointsPerGame5, 1.35),
    safeDifference(home.pointsPerGame5, away.pointsPerGame5),
    finite(home.pointsPerGame10, 1.35),
    finite(away.pointsPerGame10, 1.35),
    safeDifference(home.pointsPerGame10, away.pointsPerGame10),
    finite(home.pointsPerGame20, 1.35),
    finite(away.pointsPerGame20, 1.35),
    safeDifference(home.pointsPerGame20, away.pointsPerGame20),
    finite(home.goalsFor5, 1.25),
    finite(away.goalsFor5, 1.25),
    finite(home.goalsAgainst5, 1.25),
    finite(away.goalsAgainst5, 1.25),
    finite(home.goalsFor10, 1.25),
    finite(away.goalsFor10, 1.25),
    finite(home.goalsAgainst10, 1.25),
    finite(away.goalsAgainst10, 1.25),
    finite(home.expectedGoalsFor10, 1.25),
    finite(away.expectedGoalsFor10, 1.25),
    finite(home.expectedGoalsAgainst10, 1.25),
    finite(away.expectedGoalsAgainst10, 1.25),
    safeDifference(
      finite(home.expectedGoalsFor10, 1.25) - finite(home.expectedGoalsAgainst10, 1.25),
      finite(away.expectedGoalsFor10, 1.25) - finite(away.expectedGoalsAgainst10, 1.25),
    ),
    finite(home.shots10, 10),
    finite(away.shots10, 10),
    finite(home.shotsOnGoal10, 4),
    finite(away.shotsOnGoal10, 4),
    clamp(safeDifference(home.possession10, away.possession10) / 50, -2, 2),
    safeDifference(home.corners10, away.corners10),
    safeDifference(home.winRate10, away.winRate10),
    safeMean(home.drawRate10, away.drawRate10),
    safeDifference(home.cleanSheetRate10, away.cleanSheetRate10),
    safeMean(home.bttsRate10, away.bttsRate10),
    safeMean(home.over25Rate10, away.over25Rate10),
    safeDifference(home.venuePointsPerGame10, away.venuePointsPerGame10),
    safeDifference(home.venueGoalsFor10, away.venueGoalsFor10),
    safeDifference(home.venueGoalsAgainst10, away.venueGoalsAgainst10),
    clamp(safeDifference(home.restDays, away.restDays) / 14, -2, 2),
    clamp(Math.min(finite(home.metricCoverage10), finite(away.metricCoverage10)), 0, 1),
    finite(dixonColes.homeExpectedGoals, 1.25),
    finite(dixonColes.awayExpectedGoals, 1.15),
    finite(dixonColes.homeProbability, 1 / 3),
    finite(dixonColes.drawProbability, 1 / 3),
    finite(dixonColes.awayProbability, 1 / 3),
    finite(dixonColes.over25Probability, 0.5),
    finite(dixonColes.bttsProbability, 0.5),
    marketConsensus ? 1 : 0,
    clamp(market.bookmakerCount / 12, 0, 2),
    finite(marketFallback.HOME, 1 / 3),
    finite(marketFallback.DRAW, 1 / 3),
    finite(marketFallback.AWAY, 1 / 3),
    clamp(market.averageDispersion, 0, 1),
    clamp(market.bookmakerAgreement, 0, 1),
    clamp(market.qualityScore, 0, 1),
    market.movementAvailable ? 1 : 0,
    finite(movement.HOME),
    finite(movement.DRAW),
    finite(movement.AWAY),
    finite(recentMovement.HOME),
    finite(recentMovement.DRAW),
    finite(recentMovement.AWAY),
    clamp(market.steamStrength, 0, 1),
    finite(dixonColes.homeProbability, 1 / 3) - finite(marketFallback.HOME, 1 / 3),
    finite(dixonColes.drawProbability, 1 / 3) - finite(marketFallback.DRAW, 1 / 3),
    finite(dixonColes.awayProbability, 1 / 3) - finite(marketFallback.AWAY, 1 / 3),
  ].map((value) => clamp(finite(value), -20, 20));

  if (vector.length !== ML_MARKET_FEATURE_NAMES.length) {
    throw new Error(
      `ML feature contract mismatch: ${vector.length} values for ${ML_MARKET_FEATURE_NAMES.length} names.`,
    );
  }

  return {
    featureNames: ML_MARKET_FEATURE_NAMES,
    featureVector: vector,
    featureContractHash: ML_MARKET_FEATURE_CONTRACT_HASH,
    marketAvailable: marketConsensus != null,
    marketConsensus,
  };
}

export function applyMarketResidual(input: {
  marketConsensus: MatchWinnerProbabilities | null;
  residual: MatchWinnerProbabilities | null;
  residualStrength?: number;
}): MatchWinnerProbabilities | null {
  if (input.marketConsensus == null || input.residual == null) {
    return null;
  }

  const market = normalizeMatchWinner(input.marketConsensus);
  const strength = clamp(input.residualStrength ?? 1, 0, 1.5);

  return normalizeMatchWinner({
    HOME: market.HOME + finite(input.residual.HOME) * strength,
    DRAW: market.DRAW + finite(input.residual.DRAW) * strength,
    AWAY: market.AWAY + finite(input.residual.AWAY) * strength,
  });
}

export function blendMlMarketPrediction(input: {
  catBoost: MatchWinnerProbabilities;
  residualMarket: MatchWinnerProbabilities | null;
  catBoostWeight?: number;
}): MatchWinnerProbabilities {
  const catBoost = normalizeMatchWinner(input.catBoost);
  if (input.residualMarket == null) {
    return catBoost;
  }

  const residualMarket = normalizeMatchWinner(input.residualMarket);
  const catBoostWeight = clamp(input.catBoostWeight ?? 0.6, 0, 1);
  const marketWeight = 1 - catBoostWeight;

  return normalizeMatchWinner({
    HOME: catBoost.HOME * catBoostWeight + residualMarket.HOME * marketWeight,
    DRAW: catBoost.DRAW * catBoostWeight + residualMarket.DRAW * marketWeight,
    AWAY: catBoost.AWAY * catBoostWeight + residualMarket.AWAY * marketWeight,
  });
}

export function deterministicPayloadHash(kind: string, value: unknown): string {
  return createHash('sha256')
    .update(kind)
    .update('\n')
    .update(stableStringify(value))
    .digest('hex');
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}
