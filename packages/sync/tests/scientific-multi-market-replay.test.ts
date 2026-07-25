import { describe, expect, it } from 'vitest';

import {
  SCIENTIFIC_MULTI_MARKET_REPLAY_HORIZON_MINUTES,
  SCIENTIFIC_MULTI_MARKET_REPLAY_POLICY,
  SCIENTIFIC_MULTI_MARKET_REPLAY_VERSION,
  SCIENTIFIC_TOTAL_GOAL_LINES,
  actualBtts,
  actualMatchWinner,
  actualOverLine,
  deriveScientificScoreGridMarkets,
  evaluateBinaryPredictions,
  evaluateMatchWinnerPredictions,
  maximumAbsoluteDifference,
} from '../src/scientific-multi-market-replay-contract.js';

function grid() {
  return deriveScientificScoreGridMarkets({
    homeExpectedGoals: 1.6,
    awayExpectedGoals: 1.1,
    rho: -0.08,
    maximumGoals: 10,
  });
}

describe('v7.0-beta.1A.3 scientific multi-market replay contract', () => {
  it('uses stable beta.1A.3 version', () => {
    expect(SCIENTIFIC_MULTI_MARKET_REPLAY_VERSION).toContain('beta.1A.3');
  });

  it('uses historical non-promotional policy', () => {
    expect(SCIENTIFIC_MULTI_MARKET_REPLAY_POLICY).toBe(
      'historical-t90-multi-market-non-promotional-v1',
    );
  });

  it('locks the replay horizon at T-90', () => {
    expect(SCIENTIFIC_MULTI_MARKET_REPLAY_HORIZON_MINUTES).toBe(90);
  });

  it('activates exactly total-goal lines 1.5, 2.5 and 3.5', () => {
    expect([...SCIENTIFIC_TOTAL_GOAL_LINES]).toEqual([1.5, 2.5, 3.5]);
  });

  it('creates finite score-grid mass', () => {
    expect(Number.isFinite(grid().scoreGridMass)).toBe(true);
  });

  it('creates positive score-grid mass', () => {
    expect(grid().scoreGridMass).toBeGreaterThan(0);
  });

  it('normalizes match-winner probabilities', () => {
    const result = grid().matchWinner;

    expect(result.HOME + result.DRAW + result.AWAY).toBeCloseTo(1, 12);
  });

  it('normalizes O/U 1.5 probabilities', () => {
    const result = grid().totalGoals[1.5];

    expect(result.OVER + result.UNDER).toBeCloseTo(1, 12);
  });

  it('normalizes O/U 2.5 probabilities', () => {
    const result = grid().totalGoals[2.5];

    expect(result.OVER + result.UNDER).toBeCloseTo(1, 12);
  });

  it('normalizes O/U 3.5 probabilities', () => {
    const result = grid().totalGoals[3.5];

    expect(result.OVER + result.UNDER).toBeCloseTo(1, 12);
  });

  it('normalizes BTTS probabilities', () => {
    const result = grid().btts;

    expect(result.YES + result.NO).toBeCloseTo(1, 12);
  });

  it('keeps Over 1.5 probability at least Over 2.5', () => {
    const result = grid().totalGoals;

    expect(result[1.5].OVER).toBeGreaterThanOrEqual(result[2.5].OVER);
  });

  it('keeps Over 2.5 probability at least Over 3.5', () => {
    const result = grid().totalGoals;

    expect(result[2.5].OVER).toBeGreaterThanOrEqual(result[3.5].OVER);
  });

  it('keeps all total-goal probabilities in [0,1]', () => {
    for (const line of SCIENTIFIC_TOTAL_GOAL_LINES) {
      expect(grid().totalGoals[line].OVER).toBeGreaterThanOrEqual(0);
      expect(grid().totalGoals[line].OVER).toBeLessThanOrEqual(1);
    }
  });

  it('keeps BTTS probability in [0,1]', () => {
    expect(grid().btts.YES).toBeGreaterThanOrEqual(0);
    expect(grid().btts.YES).toBeLessThanOrEqual(1);
  });

  it('rejects negative home expected goals', () => {
    expect(() =>
      deriveScientificScoreGridMarkets({
        homeExpectedGoals: -1,
        awayExpectedGoals: 1,
        rho: 0,
      }),
    ).toThrow();
  });

  it('rejects negative away expected goals', () => {
    expect(() =>
      deriveScientificScoreGridMarkets({
        homeExpectedGoals: 1,
        awayExpectedGoals: -1,
        rho: 0,
      }),
    ).toThrow();
  });

  it('rejects non-finite rho', () => {
    expect(() =>
      deriveScientificScoreGridMarkets({
        homeExpectedGoals: 1,
        awayExpectedGoals: 1,
        rho: Number.NaN,
      }),
    ).toThrow();
  });

  it('enforces at least six goals in the truncated grid', () => {
    expect(
      deriveScientificScoreGridMarkets({
        homeExpectedGoals: 1,
        awayExpectedGoals: 1,
        rho: 0,
        maximumGoals: 2,
      }).maximumGoals,
    ).toBe(6);
  });

  it('classifies a home win', () => {
    expect(actualMatchWinner(2, 1)).toBe('HOME');
  });

  it('classifies a draw', () => {
    expect(actualMatchWinner(1, 1)).toBe('DRAW');
  });

  it('classifies an away win', () => {
    expect(actualMatchWinner(0, 1)).toBe('AWAY');
  });

  it('settles 1-1 as Over 1.5', () => {
    expect(actualOverLine(1, 1, 1.5)).toBe(true);
  });

  it('settles 1-1 as Under 2.5', () => {
    expect(actualOverLine(1, 1, 2.5)).toBe(false);
  });

  it('settles 2-1 as Over 2.5', () => {
    expect(actualOverLine(2, 1, 2.5)).toBe(true);
  });

  it('settles 2-1 as Under 3.5', () => {
    expect(actualOverLine(2, 1, 3.5)).toBe(false);
  });

  it('settles 3-1 as Over 3.5', () => {
    expect(actualOverLine(3, 1, 3.5)).toBe(true);
  });

  it('settles 2-1 as BTTS YES', () => {
    expect(actualBtts(2, 1)).toBe(true);
  });

  it('settles 2-0 as BTTS NO', () => {
    expect(actualBtts(2, 0)).toBe(false);
  });

  it('gives perfect binary predictions 100% accuracy', () => {
    const metrics = evaluateBinaryPredictions([
      {
        positiveProbability: 1,
        actualPositive: true,
      },
      {
        positiveProbability: 0,
        actualPositive: false,
      },
    ]);

    expect(metrics.accuracy).toBe(1);
  });

  it('gives perfect binary predictions zero Brier', () => {
    const metrics = evaluateBinaryPredictions([
      {
        positiveProbability: 1,
        actualPositive: true,
      },
      {
        positiveProbability: 0,
        actualPositive: false,
      },
    ]);

    expect(metrics.brier).toBe(0);
  });

  it('gives perfect binary predictions near-zero log-loss', () => {
    const metrics = evaluateBinaryPredictions([
      {
        positiveProbability: 1,
        actualPositive: true,
      },
      {
        positiveProbability: 0,
        actualPositive: false,
      },
    ]);

    expect(metrics.logLoss ?? 1).toBeLessThan(1e-10);
  });

  it('computes binary actual positive rate', () => {
    const metrics = evaluateBinaryPredictions([
      {
        positiveProbability: 0.8,
        actualPositive: true,
      },
      {
        positiveProbability: 0.8,
        actualPositive: false,
      },
      {
        positiveProbability: 0.2,
        actualPositive: true,
      },
      {
        positiveProbability: 0.2,
        actualPositive: false,
      },
    ]);

    expect(metrics.positiveRate).toBe(0.5);
  });

  it('gives uniform binary probability zero Brier skill', () => {
    const metrics = evaluateBinaryPredictions([
      {
        positiveProbability: 0.5,
        actualPositive: true,
      },
      {
        positiveProbability: 0.5,
        actualPositive: false,
      },
    ]);

    expect(metrics.brierSkillVsUniform).toBeCloseTo(0, 12);
  });

  it('gives uniform binary probability zero log-loss skill', () => {
    const metrics = evaluateBinaryPredictions([
      {
        positiveProbability: 0.5,
        actualPositive: true,
      },
      {
        positiveProbability: 0.5,
        actualPositive: false,
      },
    ]);

    expect(metrics.logLossSkillVsUniform).toBeCloseTo(0, 12);
  });

  it('returns null binary metrics for empty input', () => {
    const metrics = evaluateBinaryPredictions([]);

    expect(metrics.accuracy).toBeNull();
    expect(metrics.brier).toBeNull();
  });

  it('rejects invalid binary probability', () => {
    expect(() =>
      evaluateBinaryPredictions([
        {
          positiveProbability: 1.1,
          actualPositive: true,
        },
      ]),
    ).toThrow();
  });

  it('gives perfect HDA predictions 100% accuracy', () => {
    const metrics = evaluateMatchWinnerPredictions([
      {
        probabilities: {
          HOME: 1,
          DRAW: 0,
          AWAY: 0,
        },
        actualClass: 'HOME',
      },
      {
        probabilities: {
          HOME: 0,
          DRAW: 1,
          AWAY: 0,
        },
        actualClass: 'DRAW',
      },
    ]);

    expect(metrics.accuracy).toBe(1);
  });

  it('gives perfect HDA predictions zero Brier', () => {
    const metrics = evaluateMatchWinnerPredictions([
      {
        probabilities: {
          HOME: 1,
          DRAW: 0,
          AWAY: 0,
        },
        actualClass: 'HOME',
      },
    ]);

    expect(metrics.brier).toBe(0);
  });

  it('gives perfect HDA predictions near-zero log-loss', () => {
    const metrics = evaluateMatchWinnerPredictions([
      {
        probabilities: {
          HOME: 1,
          DRAW: 0,
          AWAY: 0,
        },
        actualClass: 'HOME',
      },
    ]);

    expect(metrics.logLoss ?? 1).toBeLessThan(1e-10);
  });

  it('gives uniform HDA Brier 2/3', () => {
    const metrics = evaluateMatchWinnerPredictions([
      {
        probabilities: {
          HOME: 1 / 3,
          DRAW: 1 / 3,
          AWAY: 1 / 3,
        },
        actualClass: 'HOME',
      },
    ]);

    expect(metrics.brier).toBeCloseTo(2 / 3, 12);
  });

  it('gives uniform HDA log-loss ln(3)', () => {
    const metrics = evaluateMatchWinnerPredictions([
      {
        probabilities: {
          HOME: 1 / 3,
          DRAW: 1 / 3,
          AWAY: 1 / 3,
        },
        actualClass: 'AWAY',
      },
    ]);

    expect(metrics.logLoss).toBeCloseTo(Math.log(3), 12);
  });

  it('gives uniform HDA zero Brier skill', () => {
    const metrics = evaluateMatchWinnerPredictions([
      {
        probabilities: {
          HOME: 1 / 3,
          DRAW: 1 / 3,
          AWAY: 1 / 3,
        },
        actualClass: 'DRAW',
      },
    ]);

    expect(metrics.brierSkillVsUniform).toBeCloseTo(0, 12);
  });

  it('gives uniform HDA zero log-loss skill', () => {
    const metrics = evaluateMatchWinnerPredictions([
      {
        probabilities: {
          HOME: 1 / 3,
          DRAW: 1 / 3,
          AWAY: 1 / 3,
        },
        actualClass: 'DRAW',
      },
    ]);

    expect(metrics.logLossSkillVsUniform).toBeCloseTo(0, 12);
  });

  it('returns null HDA metrics for empty input', () => {
    const metrics = evaluateMatchWinnerPredictions([]);

    expect(metrics.accuracy).toBeNull();
    expect(metrics.logLoss).toBeNull();
  });

  it('produces calibration buckets for binary evaluation', () => {
    const metrics = evaluateBinaryPredictions([
      {
        positiveProbability: 0.8,
        actualPositive: true,
      },
      {
        positiveProbability: 0.8,
        actualPositive: true,
      },
    ]);

    expect(metrics.calibration.reduce((sum, bucket) => sum + bucket.rows, 0)).toBe(2);
  });

  it('produces zero ECE when confidence equals observed correctness', () => {
    const metrics = evaluateBinaryPredictions([
      {
        positiveProbability: 1,
        actualPositive: true,
      },
      {
        positiveProbability: 1,
        actualPositive: true,
      },
    ]);

    expect(metrics.ece).toBeCloseTo(0, 12);
  });

  it('computes maximum absolute difference', () => {
    expect(
      maximumAbsoluteDifference([
        {
          left: 0.1,
          right: 0.15,
        },
        {
          left: 0.9,
          right: 0.7,
        },
      ]),
    ).toBeCloseTo(0.2, 12);
  });

  it('gives independent-Poisson BTTS analytical value when rho=0', () => {
    const home = 1.2;
    const away = 0.8;
    const result = deriveScientificScoreGridMarkets({
      homeExpectedGoals: home,
      awayExpectedGoals: away,
      rho: 0,
      maximumGoals: 14,
    });
    const analytical = (1 - Math.exp(-home)) * (1 - Math.exp(-away));

    expect(result.btts.YES).toBeCloseTo(analytical, 8);
  });

  it('keeps score-grid mass close to one with a wide grid', () => {
    const result = deriveScientificScoreGridMarkets({
      homeExpectedGoals: 1.2,
      awayExpectedGoals: 0.8,
      rho: 0,
      maximumGoals: 14,
    });

    expect(result.scoreGridMass).toBeCloseTo(1, 8);
  });
});
