import {
  clamp,
  effectiveSampleSize,
  expDecayWeight,
  normalizeProbabilities,
  weightedMean,
} from './math.js';

export interface HistoricalFixture {
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
  /** Unix epoch ms (optional). Used for recency weighting in PREDICTION_AI_V7. */
  kickoffTime?: number;
}

export interface ExpectedGoals {
  home: number;
  away: number;
  sampleSize: number;
}

export interface MarketProbabilities {
  MATCH_WINNER: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  TOTAL_GOALS_2_5: Record<'OVER' | 'UNDER', number>;
  BTTS: Record<'YES' | 'NO', number>;
  expectedGoals: ExpectedGoals;
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function poissonProbability(lambda: number, goals: number): number {
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) factorial *= index;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}

/** PREDICTION_AI_V7: Dixon-Coles low-score dependence parameter. */
export function estimateDixonColesRho(
  homeExpectedGoals: number,
  awayExpectedGoals: number,
): number {
  const total = homeExpectedGoals + awayExpectedGoals;
  const balance = 1 - clamp(Math.abs(homeExpectedGoals - awayExpectedGoals) / 3.5, 0, 0.8);
  return clamp(-0.09 * Math.exp(-Math.abs(total - 2.45) / 2.2) * balance, -0.12, -0.015);
}

/** PREDICTION_AI_V7: Dixon-Coles tau correction for low scorelines (0-0, 1-0, 0-1, 1-1). */
export function dixonColesTau(
  homeGoals: number,
  awayGoals: number,
  homeExpectedGoals: number,
  awayExpectedGoals: number,
  rho: number,
): number {
  if (homeGoals === 0 && awayGoals === 0) {
    return Math.max(0.05, 1 - homeExpectedGoals * awayExpectedGoals * rho);
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return Math.max(0.05, 1 + homeExpectedGoals * rho);
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return Math.max(0.05, 1 + awayExpectedGoals * rho);
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return Math.max(0.05, 1 - rho);
  }
  return 1;
}

export function estimateExpectedGoals(
  history: HistoricalFixture[],
  homeTeamId: number,
  awayTeamId: number,
): ExpectedGoals {
  const valid = history.filter(
    (fixture) => Number.isFinite(fixture.homeGoals) && Number.isFinite(fixture.awayGoals),
  );

  const leagueHomeAverage = average(
    valid.map((fixture) => fixture.homeGoals),
    1.45,
  );
  const leagueAwayAverage = average(
    valid.map((fixture) => fixture.awayGoals),
    1.2,
  );

  const homeGames = valid.filter((fixture) => fixture.homeTeamId === homeTeamId);
  const awayGames = valid.filter((fixture) => fixture.awayTeamId === awayTeamId);

  const homeAttack =
    average(
      homeGames.map((fixture) => fixture.homeGoals),
      leagueHomeAverage,
    ) / Math.max(0.3, leagueHomeAverage);
  const homeDefense =
    average(
      homeGames.map((fixture) => fixture.awayGoals),
      leagueAwayAverage,
    ) / Math.max(0.3, leagueAwayAverage);
  const awayAttack =
    average(
      awayGames.map((fixture) => fixture.awayGoals),
      leagueAwayAverage,
    ) / Math.max(0.3, leagueAwayAverage);
  const awayDefense =
    average(
      awayGames.map((fixture) => fixture.homeGoals),
      leagueHomeAverage,
    ) / Math.max(0.3, leagueHomeAverage);

  const homeSampleWeight = clamp(homeGames.length / 8, 0, 1);
  const awaySampleWeight = clamp(awayGames.length / 8, 0, 1);

  const rawHome = leagueHomeAverage * homeAttack * awayDefense;
  const rawAway = leagueAwayAverage * awayAttack * homeDefense;

  return {
    home: clamp(rawHome * homeSampleWeight + leagueHomeAverage * (1 - homeSampleWeight), 0.25, 4.5),
    away: clamp(rawAway * awaySampleWeight + leagueAwayAverage * (1 - awaySampleWeight), 0.2, 4),
    sampleSize: Math.min(homeGames.length, awayGames.length),
  };
}

export function deriveMarketProbabilities(
  expectedGoals: ExpectedGoals,
  maximumGoals = 8,
  rho = 0,
): MarketProbabilities {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let over = 0;
  let bttsYes = 0;
  let totalMass = 0;

  for (let homeGoals = 0; homeGoals <= maximumGoals; homeGoals += 1) {
    const homeProbability = poissonProbability(expectedGoals.home, homeGoals);
    for (let awayGoals = 0; awayGoals <= maximumGoals; awayGoals += 1) {
      const rawProbability = homeProbability * poissonProbability(expectedGoals.away, awayGoals);
      const probability =
        rho === 0
          ? rawProbability
          : rawProbability *
            dixonColesTau(homeGoals, awayGoals, expectedGoals.home, expectedGoals.away, rho);
      totalMass += probability;
      if (homeGoals > awayGoals) homeWin += probability;
      else if (homeGoals === awayGoals) draw += probability;
      else awayWin += probability;
      if (homeGoals + awayGoals > 2.5) over += probability;
      if (homeGoals > 0 && awayGoals > 0) bttsYes += probability;
    }
  }

  const result = normalizeProbabilities({ HOME: homeWin, DRAW: draw, AWAY: awayWin });
  const total = normalizeProbabilities({ OVER: over, UNDER: Math.max(0, totalMass - over) });
  const btts = normalizeProbabilities({ YES: bttsYes, NO: Math.max(0, totalMass - bttsYes) });

  return {
    MATCH_WINNER: result,
    TOTAL_GOALS_2_5: total,
    BTTS: btts,
    expectedGoals,
  };
}

/**
 * PREDICTION_AI_V7: recency-weighted expected goals.
 *
 * Same Dixon-Coles-compatible structure as estimateExpectedGoals, but older
 * matches decay exponentially (halfLifeDays default 60) so the estimate reacts
 * to current form instead of being diluted by months-old results. If no
 * kickoffTime is present on fixtures, falls back to the legacy unweighted
 * estimate so behavior is identical for existing callers.
 */
export function estimateExpectedGoalsV2(
  history: HistoricalFixture[],
  homeTeamId: number,
  awayTeamId: number,
  options: { halfLifeDays?: number; maximumGames?: number } = {},
): ExpectedGoals {
  const halfLifeDays = options.halfLifeDays ?? 60;
  const maximumGames = options.maximumGames ?? 400;
  const valid = history.filter(
    (fixture) => Number.isFinite(fixture.homeGoals) && Number.isFinite(fixture.awayGoals),
  );
  const hasTimestamps = valid.length > 0 && valid.every((fixture) => fixture.kickoffTime != null);

  if (!hasTimestamps || valid.length === 0) {
    return estimateExpectedGoals(history, homeTeamId, awayTeamId);
  }

  const referenceTime = Math.max(...valid.map((fixture) => fixture.kickoffTime ?? 0));
  const weightOf = (fixture: HistoricalFixture): number =>
    expDecayWeight(
      (referenceTime - (fixture.kickoffTime ?? referenceTime)) / 86_400_000,
      halfLifeDays,
    );

  const recent = [...valid]
    .sort((left, right) => (right.kickoffTime ?? 0) - (left.kickoffTime ?? 0))
    .slice(0, maximumGames);

  const leagueHomeAverage =
    weightedMean(
      recent.map((fixture) => fixture.homeGoals),
      recent.map(weightOf),
    ) || 1.45;
  const leagueAwayAverage =
    weightedMean(
      recent.map((fixture) => fixture.awayGoals),
      recent.map(weightOf),
    ) || 1.2;

  const homeGames = recent.filter((fixture) => fixture.homeTeamId === homeTeamId);
  const awayGames = recent.filter((fixture) => fixture.awayTeamId === awayTeamId);

  const weightedAverage = (
    rows: HistoricalFixture[],
    extract: (row: HistoricalFixture) => number,
    fallback: number,
  ): number =>
    rows.length === 0 ? fallback : weightedMean(rows.map(extract), rows.map(weightOf)) || fallback;

  const homeAttack =
    weightedAverage(homeGames, (row) => row.homeGoals, leagueHomeAverage) /
    Math.max(0.3, leagueHomeAverage);
  const homeDefense =
    weightedAverage(homeGames, (row) => row.awayGoals, leagueAwayAverage) /
    Math.max(0.3, leagueAwayAverage);
  const awayAttack =
    weightedAverage(awayGames, (row) => row.awayGoals, leagueAwayAverage) /
    Math.max(0.3, leagueAwayAverage);
  const awayDefense =
    weightedAverage(awayGames, (row) => row.homeGoals, leagueHomeAverage) /
    Math.max(0.3, leagueHomeAverage);

  const homeEffective = effectiveSampleSize(homeGames.map(weightOf));
  const awayEffective = effectiveSampleSize(awayGames.map(weightOf));
  const homeSampleWeight = clamp(homeEffective / 8, 0, 1);
  const awaySampleWeight = clamp(awayEffective / 8, 0, 1);

  const rawHome = leagueHomeAverage * homeAttack * awayDefense;
  const rawAway = leagueAwayAverage * awayAttack * homeDefense;

  return {
    home: clamp(rawHome * homeSampleWeight + leagueHomeAverage * (1 - homeSampleWeight), 0.25, 4.5),
    away: clamp(rawAway * awaySampleWeight + leagueAwayAverage * (1 - awaySampleWeight), 0.2, 4),
    sampleSize: Math.min(homeGames.length, awayGames.length),
  };
}

/**
 * PREDICTION_AI_V7: one-call entry point for the upgraded baseline model —
 * recency-weighted expected goals + Dixon-Coles corrected market probabilities.
 */
export function calculatePoissonMarketsV2(
  history: HistoricalFixture[],
  homeTeamId: number,
  awayTeamId: number,
  options: { halfLifeDays?: number; maximumGoals?: number; rho?: number } = {},
): MarketProbabilities {
  const expectedGoals = estimateExpectedGoalsV2(history, homeTeamId, awayTeamId, {
    halfLifeDays: options.halfLifeDays,
  });
  const rho = options.rho ?? estimateDixonColesRho(expectedGoals.home, expectedGoals.away);
  return deriveMarketProbabilities(expectedGoals, options.maximumGoals ?? 8, rho);
}

export function calculatePoissonMarkets(
  history: HistoricalFixture[],
  homeTeamId: number,
  awayTeamId: number,
): MarketProbabilities {
  return deriveMarketProbabilities(estimateExpectedGoals(history, homeTeamId, awayTeamId));
}
