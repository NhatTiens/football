import { describe, expect, it } from 'vitest';

import {
  BAYESIAN_TOTAL_GOAL_LINES,
  bayesianPredictiveMarketsHash,
  buildBayesianPredictiveMarkets,
} from '../src/bayesian-predictive-markets-contract.js';

function build(home = 1.55, away = 1.1) {
  return buildBayesianPredictiveMarkets({
    fixtureId: 101,
    horizonMinutes: 30,
    predictionAsOf: new Date('2026-01-01T10:00:00.000Z'),
    expectedHomeGoals: home,
    expectedAwayGoals: away,
    homeGoalsVarianceLog: 0.08,
    awayGoalsVarianceLog: 0.1,
    sourceTeamStrengthVersion: 'stage2',
    sourceTeamStrengthHash: 'stage2-row-hash',
  });
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

describe('Bayesian predictive markets', () => {
  it('normalizes goal distributions, score matrix, HDA and BTTS', () => {
    const result = build();
    expect(sum(result.homeGoalDistribution)).toBeCloseTo(1, 12);
    expect(sum(result.awayGoalDistribution)).toBeCloseTo(1, 12);
    expect(sum(result.scoreMatrix.flat())).toBeCloseTo(1, 12);
    expect(result.hda.HOME + result.hda.DRAW + result.hda.AWAY).toBeCloseTo(1, 12);
    expect(result.btts.YES + result.btts.NO).toBeCloseTo(1, 12);
  });

  it('models integer total lines with an explicit push probability', () => {
    const result = build();
    for (const line of [2, 3]) {
      const market = result.totalGoals.find((row) => row.line === line)!;
      expect(market.OVER.PUSH).toBeGreaterThan(0);
      expect(market.UNDER.PUSH).toBeCloseTo(market.OVER.PUSH, 12);
      expect(market.OVER.WIN + market.OVER.PUSH + market.OVER.LOSS).toBeCloseTo(1, 12);
      expect(market.UNDER.WIN + market.UNDER.PUSH + market.UNDER.LOSS).toBeCloseTo(1, 12);
    }
  });

  it('keeps half-goal totals binary with zero push', () => {
    const result = build();
    for (const line of [1.5, 2.5, 3.5]) {
      const market = result.totalGoals.find((row) => row.line === line)!;
      expect(market.OVER.PUSH).toBeCloseTo(0, 12);
      expect(market.UNDER.PUSH).toBeCloseTo(0, 12);
      expect(market.OVER.WIN + market.OVER.LOSS).toBeCloseTo(1, 12);
    }
    expect(result.totalGoals.map((row) => row.line)).toEqual([...BAYESIAN_TOTAL_GOAL_LINES]);
  });

  it('returns bounded uncertainty for every top-level probability', () => {
    const result = build();
    const probabilities = [
      ...Object.values(result.hda.uncertainty),
      ...Object.values(result.btts.uncertainty),
      ...result.totalGoals.flatMap((row) => [
        ...Object.values(row.OVER.uncertainty),
        ...Object.values(row.UNDER.uncertainty),
      ]),
    ];
    for (const probability of probabilities) {
      expect(probability.probability).toBeGreaterThanOrEqual(0);
      expect(probability.probability).toBeLessThanOrEqual(1);
      expect(probability.lower90).toBeGreaterThanOrEqual(0);
      expect(probability.upper90).toBeLessThanOrEqual(1);
      expect(probability.lower90).toBeLessThanOrEqual(probability.probability);
      expect(probability.upper90).toBeGreaterThanOrEqual(probability.probability);
    }
  });

  it('raises home and over probabilities when home expected goals increase', () => {
    const baseline = build(1.2, 1.0);
    const strongerHome = build(2.2, 1.0);
    const baselineOver = baseline.totalGoals.find((row) => row.line === 2.5)!.OVER.WIN;
    const strongerOver = strongerHome.totalGoals.find((row) => row.line === 2.5)!.OVER.WIN;
    expect(strongerHome.hda.HOME).toBeGreaterThan(baseline.hda.HOME);
    expect(strongerOver).toBeGreaterThan(baselineOver);
  });

  it('is deterministic and hash-stable', () => {
    const first = build();
    const second = build();
    expect(first).toEqual(second);
    expect(bayesianPredictiveMarketsHash(first)).toBe(
      bayesianPredictiveMarketsHash(second),
    );
  });
});
