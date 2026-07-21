import { clamp, normalizeProbabilities } from './math.js';

export interface HistoricalFixture {
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number;
  awayGoals: number;
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
    home: clamp(
      rawHome * homeSampleWeight + leagueHomeAverage * (1 - homeSampleWeight),
      0.25,
      4.5,
    ),
    away: clamp(
      rawAway * awaySampleWeight + leagueAwayAverage * (1 - awaySampleWeight),
      0.2,
      4,
    ),
    sampleSize: Math.min(homeGames.length, awayGames.length),
  };
}

export function deriveMarketProbabilities(
  expectedGoals: ExpectedGoals,
  maximumGoals = 8,
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
      const probability =
        homeProbability * poissonProbability(expectedGoals.away, awayGoals);
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

export function calculatePoissonMarkets(
  history: HistoricalFixture[],
  homeTeamId: number,
  awayTeamId: number,
): MarketProbabilities {
  return deriveMarketProbabilities(estimateExpectedGoals(history, homeTeamId, awayTeamId));
}
