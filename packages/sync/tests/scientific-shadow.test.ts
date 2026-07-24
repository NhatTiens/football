import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SCIENTIFIC_SHADOW_EXPERIMENT_ID,
  SCIENTIFIC_SHADOW_FORMULA_VERSION,
  SCIENTIFIC_SHADOW_POLICY_VERSION,
  SCIENTIFIC_SHADOW_VERSION,
  applyShadowTemperature,
  buildFrozenShadowCandidateProbability,
  capShadowProbabilityShift,
  decideScientificShadowReview,
  normalizeShadowProbabilities,
  type ShadowBettingMetricSet,
  type ShadowPredictionMetricSet,
} from '../src/scientific-shadow-contract.js';

function prediction(overrides: Partial<ShadowPredictionMetricSet> = {}): ShadowPredictionMetricSet {
  return {
    rows: 180,
    accuracy: 0.45,
    brier: 0.59,
    logLoss: 0.99,
    expectedCalibrationError: 0.1,
    ...overrides,
  };
}

function betting(overrides: Partial<ShadowBettingMetricSet> = {}): ShadowBettingMetricSet {
  return {
    bets: 45,
    roi: 0.02,
    maximumDrawdownUnits: 5,
    averageClv: 0.01,
    ...overrides,
  };
}

describe('v7.0-alpha.8 fresh shadow contract', () => {
  it('uses stable version identifiers', () => {
    expect(SCIENTIFIC_SHADOW_VERSION).toContain('alpha.8');
    expect(SCIENTIFIC_SHADOW_FORMULA_VERSION).toBe('convex-cap-then-temperature-v1');
    expect(SCIENTIFIC_SHADOW_POLICY_VERSION).toBe('fresh-shadow-promotion-policy-v1');
    expect(DEFAULT_SCIENTIFIC_SHADOW_EXPERIMENT_ID).toBe('289d3fdb1fab2547');
  });

  it('normalizes probabilities', () => {
    const result = normalizeShadowProbabilities({
      HOME: 4,
      DRAW: 3,
      AWAY: 3,
    });

    expect(result.HOME + result.DRAW + result.AWAY).toBeCloseTo(1);
    expect(result.HOME).toBeCloseTo(0.4);
  });

  it('caps raw blend shift from baseline', () => {
    const baseline = {
      HOME: 0.4,
      DRAW: 0.3,
      AWAY: 0.3,
    };
    const result = capShadowProbabilityShift(
      {
        HOME: 0.7,
        DRAW: 0.15,
        AWAY: 0.15,
      },
      baseline,
      0.08,
    );

    expect(
      Math.max(
        Math.abs(result.HOME - baseline.HOME),
        Math.abs(result.DRAW - baseline.DRAW),
        Math.abs(result.AWAY - baseline.AWAY),
      ),
    ).toBeLessThanOrEqual(0.080000000001);
  });

  it('temperature below one sharpens distribution', () => {
    const source = {
      HOME: 0.5,
      DRAW: 0.3,
      AWAY: 0.2,
    };
    const result = applyShadowTemperature(source, 0.8);

    expect(result.HOME).toBeGreaterThan(source.HOME);
  });

  it('rejects non-positive temperature', () => {
    expect(() =>
      applyShadowTemperature(
        {
          HOME: 0.4,
          DRAW: 0.3,
          AWAY: 0.3,
        },
        0,
      ),
    ).toThrow();
  });

  it('reproduces 95/5 baseline Dixon blend', () => {
    const result = buildFrozenShadowCandidateProbability(
      {
        HOME: 0.5,
        DRAW: 0.3,
        AWAY: 0.2,
      },
      {
        HOME: 0.4,
        DRAW: 0.35,
        AWAY: 0.25,
      },
      {
        baselineWeight: 0.95,
        dixonColesWeight: 0.05,
        temperature: 1,
        maximumProbabilityShift: 0.08,
      },
    );

    expect(result.HOME).toBeCloseTo(0.495);
    expect(result.DRAW).toBeCloseTo(0.3025);
    expect(result.AWAY).toBeCloseTo(0.2025);
  });

  it('uses cap before temperature for frozen formula', () => {
    const result = buildFrozenShadowCandidateProbability(
      {
        HOME: 0.5,
        DRAW: 0.3,
        AWAY: 0.2,
      },
      {
        HOME: 0.45,
        DRAW: 0.32,
        AWAY: 0.23,
      },
      {
        baselineWeight: 0.95,
        dixonColesWeight: 0.05,
        temperature: 0.8,
        maximumProbabilityShift: 0.08,
      },
    );

    expect(result.HOME).toBeGreaterThan(0.4975);
  });

  it('marks insufficient fixture count as collecting', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          roi: 0,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 0.98,
        }),
        betting: betting(),
      },
      freshFixtures: 80,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.status).toBe('COLLECTING');
  });

  it('marks insufficient bet count as collecting', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          bets: 10,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 0.98,
        }),
        betting: betting({
          bets: 10,
        }),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.status).toBe('COLLECTING');
  });

  it('rejects leakage after enough data', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          roi: 0,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 0.98,
        }),
        betting: betting(),
      },
      freshFixtures: 180,
      leakageViolations: 1,
      freshnessViolations: 0,
    });

    expect(decision.status).toBe('REJECT');
  });

  it('rejects freshness violations after enough data', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          roi: 0,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 0.98,
        }),
        betting: betting(),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 1,
    });

    expect(decision.status).toBe('REJECT');
  });

  it('requires relative Brier improvement', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          roi: 0,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.599,
          logLoss: 0.99,
        }),
        betting: betting(),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.gates.brierImproved).toBe(false);
    expect(decision.status).toBe('REJECT');
  });

  it('requires log-loss to be no worse', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          roi: 0,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 1.01,
        }),
        betting: betting(),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.gates.logLossNotWorse).toBe(false);
    expect(decision.status).toBe('REJECT');
  });

  it('holds when ECE is too much worse', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
          expectedCalibrationError: 0.08,
        }),
        betting: betting({
          roi: 0,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 0.98,
          expectedCalibrationError: 0.12,
        }),
        betting: betting(),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.gates.calibrationControlled).toBe(false);
    expect(decision.status).toBe('HOLD');
  });

  it('holds when ROI is worse', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          roi: 0.03,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 0.98,
        }),
        betting: betting({
          roi: 0.01,
        }),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.gates.roiNotWorse).toBe(false);
    expect(decision.status).toBe('HOLD');
  });

  it('holds when drawdown regresses too much', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          roi: 0,
          maximumDrawdownUnits: 4,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 0.98,
        }),
        betting: betting({
          maximumDrawdownUnits: 7,
        }),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.gates.drawdownControlled).toBe(false);
    expect(decision.status).toBe('HOLD');
  });

  it('holds when candidate CLV is not positive', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          roi: 0,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 0.98,
        }),
        betting: betting({
          averageClv: -0.001,
        }),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.gates.clvAcceptable).toBe(false);
    expect(decision.status).toBe('HOLD');
  });

  it('becomes eligible only when every gate passes', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
          expectedCalibrationError: 0.1,
        }),
        betting: betting({
          roi: 0,
          maximumDrawdownUnits: 6,
          averageClv: -0.01,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.58,
          logLoss: 0.98,
          expectedCalibrationError: 0.09,
        }),
        betting: betting({
          roi: 0.03,
          maximumDrawdownUnits: 5,
          averageClv: 0.01,
        }),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.passed).toBe(true);
    expect(decision.status).toBe('ELIGIBLE_FOR_MANUAL_REVIEW');
  });

  it('reports Brier and log-loss deltas', () => {
    const decision = decideScientificShadowReview({
      baseline: {
        prediction: prediction({
          brier: 0.6,
          logLoss: 1,
        }),
        betting: betting({
          roi: 0,
        }),
      },
      candidate: {
        prediction: prediction({
          brier: 0.57,
          logLoss: 0.97,
        }),
        betting: betting(),
      },
      freshFixtures: 180,
      leakageViolations: 0,
      freshnessViolations: 0,
    });

    expect(decision.deltas.relativeBrierImprovement).toBeCloseTo(0.05);
    expect(decision.deltas.logLossChange).toBeCloseTo(-0.03);
  });
});
