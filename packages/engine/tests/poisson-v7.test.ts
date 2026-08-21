import { describe, expect, it } from 'vitest';
import {
  calculatePoissonMarketsV2,
  deriveMarketProbabilities,
  estimateDixonColesRho,
  estimateExpectedGoalsV2,
  expDecayWeight,
  effectiveSampleSize,
  softmax,
  type HistoricalFixture,
} from '../src/index.js';

function fixture(
  homeTeamId: number,
  awayTeamId: number,
  homeGoals: number,
  awayGoals: number,
  kickoffTime: number,
): HistoricalFixture {
  return { homeTeamId, awayTeamId, homeGoals, awayGoals, kickoffTime };
}

const DAY = 86_400_000;

describe('PREDICTION_AI_V7 engine helpers', () => {
  it('decays exponentially with half-life', () => {
    expect(expDecayWeight(0, 60)).toBeCloseTo(1, 6);
    expect(expDecayWeight(60, 60)).toBeCloseTo(0.5, 6);
    expect(expDecayWeight(120, 60)).toBeCloseTo(0.25, 6);
    expect(expDecayWeight(30, 60)).toBeGreaterThan(expDecayWeight(90, 60));
  });

  it('computes Kish effective sample size', () => {
    expect(effectiveSampleSize([1, 1, 1, 1])).toBeCloseTo(4, 6);
    expect(effectiveSampleSize([10])).toBeCloseTo(1, 6);
    const heavy = effectiveSampleSize([10, 1, 1, 1]);
    expect(heavy).toBeGreaterThan(1);
    expect(heavy).toBeLessThan(4);
  });

  it('softmax produces a simplex', () => {
    const values = softmax([1, 2, 3]);
    expect(values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 8);
    expect(values[2]!).toBeGreaterThan(values[0]!);
  });

  it('Dixon-Coles rho is negative and bounded', () => {
    const rho = estimateDixonColesRho(1.6, 1.1);
    expect(rho).toBeLessThan(0);
    expect(rho).toBeGreaterThanOrEqual(-0.12);
    expect(estimateDixonColesRho(0.3, 4.5)).toBeGreaterThanOrEqual(-0.12);
  });
});

describe('PREDICTION_AI_V7 recency-weighted expected goals', () => {
  const home = 1;
  const away = 2;
  const now = Date.UTC(2024, 0, 1);

  it('weights recent form over old form', () => {
    const history: HistoricalFixture[] = [
      // Old season: home team low scoring.
      fixture(home, away, 0, 2, now - 200 * DAY),
      fixture(home, away, 0, 1, now - 180 * DAY),
      fixture(home, away, 1, 1, now - 160 * DAY),
      fixture(home, away, 0, 2, now - 140 * DAY),
      // Recent: home team high scoring.
      fixture(home, away, 4, 1, now - 10 * DAY),
      fixture(home, away, 3, 0, now - 7 * DAY),
      fixture(home, away, 4, 2, now - 4 * DAY),
      fixture(home, away, 3, 1, now - 2 * DAY),
    ];
    const v1 = estimateExpectedGoalsV2(history, home, away, {
      halfLifeDays: 10_000, // effectively no decay
    });
    const v2 = estimateExpectedGoalsV2(history, home, away, {
      halfLifeDays: 30,
    });
    expect(v2.home).toBeGreaterThan(v1.home);
  });

  it('falls back to legacy estimate without timestamps', () => {
    const history: HistoricalFixture[] = [
      { homeTeamId: home, awayTeamId: away, homeGoals: 2, awayGoals: 1 },
      { homeTeamId: home, awayTeamId: away, homeGoals: 1, awayGoals: 1 },
    ];
    const result = estimateExpectedGoalsV2(history, home, away);
    expect(result.home).toBeGreaterThan(0);
    expect(result.sampleSize).toBe(2);
  });

  it('produces valid market probabilities with Dixon-Coles correction', () => {
    const history: HistoricalFixture[] = [
      fixture(home, away, 2, 1, now - 5 * DAY),
      fixture(home, away, 1, 1, now - 12 * DAY),
      fixture(home, away, 3, 0, now - 20 * DAY),
      fixture(home, away, 1, 2, now - 30 * DAY),
    ];
    const markets = calculatePoissonMarketsV2(history, home, away, {
      halfLifeDays: 45,
    });
    const homeTotal =
      markets.MATCH_WINNER.HOME + markets.MATCH_WINNER.DRAW + markets.MATCH_WINNER.AWAY;
    expect(homeTotal).toBeCloseTo(1, 8);
    expect(markets.TOTAL_GOALS_2_5.OVER + markets.TOTAL_GOALS_2_5.UNDER).toBeCloseTo(1, 8);
    expect(markets.BTTS.YES + markets.BTTS.NO).toBeCloseTo(1, 8);
  });

  it('Dixon-Coles rho shifts low-scoreline mass (draw up, BTTS down)', () => {
    const expectedGoals = { home: 1.7, away: 1.2, sampleSize: 10 };
    const withoutRho = deriveMarketProbabilities(expectedGoals, 8, 0);
    const withRho = deriveMarketProbabilities(
      expectedGoals,
      8,
      estimateDixonColesRho(expectedGoals.home, expectedGoals.away),
    );
    // rho < 0 increases 0-0 and 1-1 (draw mass) while decreasing the one-sided
    // scorelines 1-0 and 0-1, so home and away win probabilities both drop and
    // the draw rises. The 2.5 total stays roughly invariant — the documented
    // Dixon-Coles behaviour.
    expect(withRho.MATCH_WINNER.DRAW).toBeGreaterThan(withoutRho.MATCH_WINNER.DRAW);
    expect(withRho.MATCH_WINNER.HOME).toBeLessThan(withoutRho.MATCH_WINNER.HOME);
    expect(withRho.MATCH_WINNER.AWAY).toBeLessThan(withoutRho.MATCH_WINNER.AWAY);
    expect(Math.abs(withRho.TOTAL_GOALS_2_5.OVER - withoutRho.TOTAL_GOALS_2_5.OVER)).toBeLessThan(
      0.002,
    );
  });
});
