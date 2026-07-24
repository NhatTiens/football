import { describe, expect, it } from 'vitest';

import {
  SCIENTIFIC_EVALUATION_VERSION,
  SCIENTIFIC_POLICY_VERSION,
  closingLineValue,
  decidePromotion,
  deterministicHash,
  fairProbabilitiesFromOdds,
  maximumDrawdown,
  multiclassBrier,
  multiclassLogLoss,
  normalizeProbabilities,
  predictedClass,
  settleMatchWinner,
  type BettingMetricSet,
  type EvaluationMetricSet,
} from '../src/scientific-evaluation-contract.js';

function prediction(overrides: Partial<EvaluationMetricSet> = {}): EvaluationMetricSet {
  return {
    rows: 100,
    brier: 0.55,
    logLoss: 0.95,
    accuracy: 0.52,
    expectedCalibrationError: 0.06,
    ...overrides,
  };
}

function betting(overrides: Partial<BettingMetricSet> = {}): BettingMetricSet {
  return {
    bets: 40,
    wins: 22,
    losses: 18,
    pushes: 0,
    stakeUnits: 40,
    profitUnits: 4,
    roi: 0.1,
    hitRate: 0.55,
    maximumDrawdownUnits: 5,
    averageOdds: 1.95,
    averageEdge: 0.06,
    averageExpectedValue: 0.07,
    averageClv: 0.02,
    positiveClvRate: 0.6,
    ...overrides,
  };
}

describe('alpha.7 scientific evaluation contract', () => {
  it('uses stable alpha.7 identifiers', () => {
    expect(SCIENTIFIC_EVALUATION_VERSION).toContain('alpha.7');
    expect(SCIENTIFIC_POLICY_VERSION).toBe('fixed-1x2-policy-v1');
  });

  it('normalizes probabilities', () => {
    const result = normalizeProbabilities({
      HOME: 4,
      DRAW: 2,
      AWAY: 2,
    });

    expect(result.HOME).toBeCloseTo(0.5);
    expect(result.HOME + result.DRAW + result.AWAY).toBeCloseTo(1, 12);
  });

  it('returns uniform probabilities for zero mass', () => {
    const result = normalizeProbabilities({
      HOME: 0,
      DRAW: 0,
      AWAY: 0,
    });

    expect(result.HOME).toBeCloseTo(1 / 3);
    expect(result.DRAW).toBeCloseTo(1 / 3);
    expect(result.AWAY).toBeCloseTo(1 / 3);
  });

  it('clips negative probability mass', () => {
    const result = normalizeProbabilities({
      HOME: -1,
      DRAW: 2,
      AWAY: 2,
    });

    expect(result.HOME).toBe(0);
    expect(result.DRAW).toBeCloseTo(0.5);
  });

  it('selects the highest-probability class', () => {
    expect(
      predictedClass({
        HOME: 0.2,
        DRAW: 0.3,
        AWAY: 0.5,
      }),
    ).toBe('AWAY');
  });

  it('computes zero Brier for a perfect prediction', () => {
    expect(
      multiclassBrier(
        {
          HOME: 1,
          DRAW: 0,
          AWAY: 0,
        },
        'HOME',
      ),
    ).toBe(0);
  });

  it('computes finite Brier for a normalized prediction', () => {
    expect(
      multiclassBrier(
        {
          HOME: 0.5,
          DRAW: 0.3,
          AWAY: 0.2,
        },
        'DRAW',
      ),
    ).toBeCloseTo(0.78);
  });

  it('computes near-zero log-loss for a perfect class', () => {
    expect(
      multiclassLogLoss(
        {
          HOME: 1,
          DRAW: 0,
          AWAY: 0,
        },
        'HOME',
      ),
    ).toBeCloseTo(0);
  });

  it('keeps log-loss finite for a zero actual probability', () => {
    expect(
      Number.isFinite(
        multiclassLogLoss(
          {
            HOME: 1,
            DRAW: 0,
            AWAY: 0,
          },
          'AWAY',
        ),
      ),
    ).toBe(true);
  });

  it('creates no-vig probabilities from decimal odds', () => {
    const result = fairProbabilitiesFromOdds({
      HOME: 2,
      DRAW: 4,
      AWAY: 4,
    });

    expect(result).not.toBeNull();
    expect(result!.HOME).toBeCloseTo(0.5);
    expect(result!.HOME + result!.DRAW + result!.AWAY).toBeCloseTo(1);
  });

  it('rejects incomplete odds', () => {
    expect(
      fairProbabilitiesFromOdds({
        HOME: 2,
        DRAW: null,
        AWAY: 3,
      }),
    ).toBeNull();
  });

  it('settles a winning 1X2 bet', () => {
    expect(settleMatchWinner('HOME', 'HOME', 2.1, 1)).toEqual({
      result: 'WIN',
      profitUnits: 1.1,
    });
  });

  it('settles a losing 1X2 bet', () => {
    expect(settleMatchWinner('DRAW', 'AWAY', 3.2, 1)).toEqual({
      result: 'LOSS',
      profitUnits: -1,
    });
  });

  it('computes positive closing-line value', () => {
    expect(closingLineValue(2.2, 2)).toBeCloseTo(0.1);
  });

  it('returns null CLV for unavailable close odds', () => {
    expect(closingLineValue(2.2, null)).toBeNull();
  });

  it('computes maximum bankroll drawdown', () => {
    expect(maximumDrawdown([2, -1, -3, 1, 4])).toBe(4);
  });

  it('returns zero drawdown for only winning profits', () => {
    expect(maximumDrawdown([1, 2, 3])).toBe(0);
  });

  it('creates deterministic hashes independent of object key order', () => {
    const left = deterministicHash('TEST', {
      b: 2,
      a: 1,
    });
    const right = deterministicHash('TEST', {
      a: 1,
      b: 2,
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes hash when scientific content changes', () => {
    expect(deterministicHash('TEST', { value: 1 })).not.toBe(
      deterministicHash('TEST', { value: 2 }),
    );
  });

  it('marks a fully passing challenger eligible only for manual promotion', () => {
    const result = decidePromotion({
      candidate: {
        prediction: prediction({
          brier: 0.5,
          logLoss: 0.9,
        }),
        betting: betting({
          roi: 0.12,
        }),
      },
      baseline: {
        prediction: prediction({
          brier: 0.55,
          logLoss: 0.95,
        }),
        betting: betting({
          roi: 0.08,
        }),
      },
      leakageViolations: 0,
    });

    expect(result.passed).toBe(true);
    expect(result.status).toBe('ELIGIBLE_FOR_MANUAL_PROMOTION');
  });

  it('rejects any leakage violation', () => {
    const result = decidePromotion({
      candidate: {
        prediction: prediction({
          brier: 0.5,
          logLoss: 0.9,
        }),
        betting: betting(),
      },
      baseline: {
        prediction: prediction(),
        betting: betting({
          roi: 0.08,
        }),
      },
      leakageViolations: 1,
    });

    expect(result.status).toBe('REJECT');
    expect(result.gates.zeroLeakage).toBe(false);
  });

  it('rejects a Brier regression', () => {
    const result = decidePromotion({
      candidate: {
        prediction: prediction({
          brier: 0.6,
        }),
        betting: betting(),
      },
      baseline: {
        prediction: prediction({
          brier: 0.55,
        }),
        betting: betting(),
      },
      leakageViolations: 0,
    });

    expect(result.status).toBe('REJECT');
    expect(result.gates.brierImproved).toBe(false);
  });

  it('holds when predictive gates pass but bet count is insufficient', () => {
    const result = decidePromotion({
      candidate: {
        prediction: prediction({
          brier: 0.5,
          logLoss: 0.9,
        }),
        betting: betting({
          bets: 5,
        }),
      },
      baseline: {
        prediction: prediction(),
        betting: betting({
          roi: 0.08,
        }),
      },
      leakageViolations: 0,
      minimumBets: 20,
    });

    expect(result.status).toBe('HOLD');
    expect(result.gates.sufficientBets).toBe(false);
  });

  it('holds when candidate CLV is not positive', () => {
    const result = decidePromotion({
      candidate: {
        prediction: prediction({
          brier: 0.5,
          logLoss: 0.9,
        }),
        betting: betting({
          averageClv: -0.01,
        }),
      },
      baseline: {
        prediction: prediction(),
        betting: betting({
          roi: 0.08,
        }),
      },
      leakageViolations: 0,
    });

    expect(result.status).toBe('HOLD');
    expect(result.gates.clvAcceptable).toBe(false);
  });

  it('rejects an insufficient final evaluation sample', () => {
    const result = decidePromotion({
      candidate: {
        prediction: prediction({
          rows: 10,
          brier: 0.5,
          logLoss: 0.9,
        }),
        betting: betting(),
      },
      baseline: {
        prediction: prediction(),
        betting: betting({
          roi: 0.08,
        }),
      },
      leakageViolations: 0,
      minimumEvaluationRows: 50,
    });

    expect(result.status).toBe('REJECT');
    expect(result.gates.sufficientEvaluationRows).toBe(false);
  });

  it('reports relative Brier improvement', () => {
    const result = decidePromotion({
      candidate: {
        prediction: prediction({
          brier: 0.5,
          logLoss: 0.9,
        }),
        betting: betting(),
      },
      baseline: {
        prediction: prediction({
          brier: 0.55,
          logLoss: 0.95,
        }),
        betting: betting({
          roi: 0.08,
        }),
      },
      leakageViolations: 0,
    });

    expect(result.deltas.relativeBrierImprovement).toBeCloseTo((0.55 - 0.5) / 0.55);
  });
});
