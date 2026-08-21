import { describe, expect, it } from 'vitest';

import {
  SCIENTIFIC_BEST_BET_EVIDENCE_CLASS,
  SCIENTIFIC_BEST_BET_POLICY,
  SCIENTIFIC_BEST_BET_POLICY_VERSION,
  assessBestBetCandidate,
  assessMarketReliability,
  calculateEdge,
  calculateExpectedValue,
  calculateImpliedProbability,
  deriveBinaryClimatology,
  deriveMulticlassClimatology,
  relativeSkill,
  selectScientificBestBet,
  type MarketReliabilityAssessment,
  type ScientificBetCandidate,
  type ScientificBestBetMarket,
} from '../src/scientific-best-bet-policy-contract.js';

function eligibleReliability(
  market: ScientificBestBetMarket = 'BTTS',
): MarketReliabilityAssessment {
  return assessMarketReliability({
    market,
    model: {
      rows: 200,
      classCount: market === 'MATCH_WINNER' ? 3 : 2,
      accuracy: 0.6,
      brier: market === 'MATCH_WINNER' ? 0.58 : 0.22,
      logLoss: market === 'MATCH_WINNER' ? 0.98 : 0.62,
      ece: 0.02,
    },
    climatology: {
      rows: 200,
      classCount: market === 'MATCH_WINNER' ? 3 : 2,
      accuracy: 0.5,
      brier: market === 'MATCH_WINNER' ? 0.64 : 0.25,
      logLoss: market === 'MATCH_WINNER' ? 1.05 : 0.69,
      classProbabilities:
        market === 'MATCH_WINNER'
          ? {
              HOME: 0.45,
              DRAW: 0.25,
              AWAY: 0.3,
            }
          : {
              POSITIVE: 0.5,
              NEGATIVE: 0.5,
            },
    },
  });
}

function candidate(overrides: Partial<ScientificBetCandidate> = {}): ScientificBetCandidate {
  const modelProbability = overrides.modelProbability ?? 0.62;
  const fairMarketProbability = overrides.fairMarketProbability ?? 0.56;
  const decimalOdds = overrides.decimalOdds ?? 1.8;

  return {
    fixtureId: overrides.fixtureId ?? 1,
    market: overrides.market ?? 'BTTS',
    selection: overrides.selection ?? 'YES',
    lineValue: overrides.lineValue ?? null,
    modelProbability,
    fairMarketProbability,
    decimalOdds,
    edge: overrides.edge ?? calculateEdge(modelProbability, fairMarketProbability),
    expectedValue: overrides.expectedValue ?? calculateExpectedValue(modelProbability, decimalOdds),
    reliability: overrides.reliability ?? eligibleReliability(overrides.market ?? 'BTTS'),
  };
}

describe('v7.0-beta.1A.5 O/U best-bet policy + reliability contract', () => {
  it('uses a stable beta.1A.5 O/U policy version', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY_VERSION).toContain('beta.1A.5');
  });

  it('uses diagnostic non-promotional evidence', () => {
    expect(SCIENTIFIC_BEST_BET_EVIDENCE_CLASS).toBe('HISTORICAL_DIAGNOSTIC_NON_PROMOTIONAL');
  });

  it('locks minimum odds to 1.40', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY.minimumOdds).toBe(1.4);
  });

  it('locks minimum edge to 4%', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY.minimumEdge).toBe(0.04);
  });

  it('locks minimum EV to 3%', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY.minimumExpectedValue).toBe(0.03);
  });

  it('locks maximum bets per fixture to one', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY.maximumBetsPerFixture).toBe(1);
  });

  it('locks reliability sample threshold to 150', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY.minimumReliabilityRows).toBe(150);
  });

  it('locks climatology Brier skill threshold to 0.5%', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY.minimumRelativeBrierSkillVsClimatology).toBe(0.005);
  });

  it('locks climatology log-loss skill threshold to 0.5%', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY.minimumLogLossSkillVsClimatology).toBe(0.005);
  });

  it('locks maximum ECE to 5%', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY.maximumEce).toBe(0.05);
  });

  it('locks scientific evaluation stake to one unit', () => {
    expect(SCIENTIFIC_BEST_BET_POLICY.stakeUnitsForEvaluation).toBe(1);
  });

  it('calculates implied probability from decimal odds', () => {
    expect(calculateImpliedProbability(2)).toBe(0.5);
  });

  it('rejects decimal odds equal to one', () => {
    expect(() => calculateImpliedProbability(1)).toThrow();
  });

  it('rejects non-finite decimal odds', () => {
    expect(() => calculateImpliedProbability(Number.NaN)).toThrow();
  });

  it('calculates edge against fair market probability', () => {
    expect(calculateEdge(0.6, 0.55)).toBeCloseTo(0.05, 12);
  });

  it('rejects invalid model probability when calculating edge', () => {
    expect(() => calculateEdge(1.1, 0.5)).toThrow();
  });

  it('rejects invalid market probability when calculating edge', () => {
    expect(() => calculateEdge(0.5, -0.1)).toThrow();
  });

  it('calculates expected value from model probability and odds', () => {
    expect(calculateExpectedValue(0.6, 2)).toBeCloseTo(0.2, 12);
  });

  it('rejects invalid probability when calculating EV', () => {
    expect(() => calculateExpectedValue(-0.1, 2)).toThrow();
  });

  it('rejects invalid odds when calculating EV', () => {
    expect(() => calculateExpectedValue(0.5, 1)).toThrow();
  });

  it('derives binary climatology positive rate', () => {
    const result = deriveBinaryClimatology([true, true, true, false]);

    expect(result.classProbabilities.POSITIVE).toBe(0.75);
  });

  it('derives binary climatology negative rate', () => {
    const result = deriveBinaryClimatology([true, true, true, false]);

    expect(result.classProbabilities.NEGATIVE).toBe(0.25);
  });

  it('derives binary climatology accuracy as majority rate', () => {
    expect(deriveBinaryClimatology([true, true, true, false]).accuracy).toBe(0.75);
  });

  it('derives binary climatology Brier p(1-p)', () => {
    expect(deriveBinaryClimatology([true, true, false, false]).brier).toBeCloseTo(0.25, 12);
  });

  it('derives binary climatology log-loss ln2 for balanced data', () => {
    expect(deriveBinaryClimatology([true, false]).logLoss).toBeCloseTo(Math.log(2), 12);
  });

  it('rejects empty binary climatology', () => {
    expect(() => deriveBinaryClimatology([])).toThrow();
  });

  it('derives multiclass climatology class frequencies', () => {
    const result = deriveMulticlassClimatology(
      ['HOME', 'HOME', 'DRAW', 'AWAY'],
      ['HOME', 'DRAW', 'AWAY'],
    );

    expect(result.classProbabilities.HOME).toBe(0.5);
    expect(result.classProbabilities.DRAW).toBe(0.25);
    expect(result.classProbabilities.AWAY).toBe(0.25);
  });

  it('derives multiclass climatology majority accuracy', () => {
    const result = deriveMulticlassClimatology(
      ['HOME', 'HOME', 'DRAW', 'AWAY'],
      ['HOME', 'DRAW', 'AWAY'],
    );

    expect(result.accuracy).toBe(0.5);
  });

  it('derives uniform three-class Brier as 2/3', () => {
    const result = deriveMulticlassClimatology(['HOME', 'DRAW', 'AWAY'], ['HOME', 'DRAW', 'AWAY']);

    expect(result.brier).toBeCloseTo(2 / 3, 12);
  });

  it('derives uniform three-class log-loss ln3', () => {
    const result = deriveMulticlassClimatology(['HOME', 'DRAW', 'AWAY'], ['HOME', 'DRAW', 'AWAY']);

    expect(result.logLoss).toBeCloseTo(Math.log(3), 12);
  });

  it('rejects empty multiclass climatology', () => {
    expect(() => deriveMulticlassClimatology([], ['HOME', 'DRAW', 'AWAY'])).toThrow();
  });

  it('rejects unsupported actual class', () => {
    expect(() => deriveMulticlassClimatology(['UNKNOWN'], ['HOME', 'DRAW', 'AWAY'])).toThrow();
  });

  it('calculates positive relative skill when model score is lower', () => {
    expect(relativeSkill(0.2, 0.25)).toBeCloseTo(0.2, 12);
  });

  it('calculates negative relative skill when model score is worse', () => {
    expect(relativeSkill(0.3, 0.25)).toBeCloseTo(-0.2, 12);
  });

  it('returns null skill for zero baseline score', () => {
    expect(relativeSkill(0, 0)).toBeNull();
  });

  it('marks a strong market diagnostic eligible', () => {
    const result = eligibleReliability();

    expect(result.status).toBe('DIAGNOSTIC_ELIGIBLE');
    expect(result.diagnosticEligible).toBe(true);
  });

  it('never marks reliability evidence promotional', () => {
    expect(eligibleReliability().promotional).toBe(false);
  });

  it('blocks reliability below minimum sample size', () => {
    const result = assessMarketReliability({
      market: 'BTTS',
      model: {
        rows: 149,
        classCount: 2,
        accuracy: 0.6,
        brier: 0.2,
        logLoss: 0.6,
        ece: 0.02,
      },
      climatology: {
        rows: 149,
        classCount: 2,
        accuracy: 0.5,
        brier: 0.25,
        logLoss: 0.69,
        classProbabilities: {
          POSITIVE: 0.5,
          NEGATIVE: 0.5,
        },
      },
    });

    expect(result.status).toBe('INSUFFICIENT_SAMPLE');
  });

  it('blocks reliability when Brier does not beat climatology', () => {
    const result = assessMarketReliability({
      market: 'BTTS',
      model: {
        rows: 200,
        classCount: 2,
        accuracy: 0.6,
        brier: 0.251,
        logLoss: 0.62,
        ece: 0.02,
      },
      climatology: {
        rows: 200,
        classCount: 2,
        accuracy: 0.5,
        brier: 0.25,
        logLoss: 0.69,
        classProbabilities: {
          POSITIVE: 0.5,
          NEGATIVE: 0.5,
        },
      },
    });

    expect(result.diagnosticEligible).toBe(false);
    expect(result.reasons).toContain('BRIER_NOT_BETTER_THAN_CLIMATOLOGY');
  });

  it('blocks reliability when log-loss does not beat climatology', () => {
    const result = assessMarketReliability({
      market: 'BTTS',
      model: {
        rows: 200,
        classCount: 2,
        accuracy: 0.6,
        brier: 0.2,
        logLoss: 0.7,
        ece: 0.02,
      },
      climatology: {
        rows: 200,
        classCount: 2,
        accuracy: 0.5,
        brier: 0.25,
        logLoss: 0.69,
        classProbabilities: {
          POSITIVE: 0.5,
          NEGATIVE: 0.5,
        },
      },
    });

    expect(result.diagnosticEligible).toBe(false);
    expect(result.reasons).toContain('LOG_LOSS_NOT_BETTER_THAN_CLIMATOLOGY');
  });

  it('blocks reliability when ECE exceeds the limit', () => {
    const result = assessMarketReliability({
      market: 'BTTS',
      model: {
        rows: 200,
        classCount: 2,
        accuracy: 0.6,
        brier: 0.2,
        logLoss: 0.6,
        ece: 0.051,
      },
      climatology: {
        rows: 200,
        classCount: 2,
        accuracy: 0.5,
        brier: 0.25,
        logLoss: 0.69,
        classProbabilities: {
          POSITIVE: 0.5,
          NEGATIVE: 0.5,
        },
      },
    });

    expect(result.status).toBe('CALIBRATION_BLOCKED');
  });

  it('accepts ECE exactly at the limit', () => {
    const result = assessMarketReliability({
      market: 'BTTS',
      model: {
        rows: 200,
        classCount: 2,
        accuracy: 0.6,
        brier: 0.2,
        logLoss: 0.6,
        ece: 0.05,
      },
      climatology: {
        rows: 200,
        classCount: 2,
        accuracy: 0.5,
        brier: 0.25,
        logLoss: 0.69,
        classProbabilities: {
          POSITIVE: 0.5,
          NEGATIVE: 0.5,
        },
      },
    });

    expect(result.eceWithinLimit).toBe(true);
  });

  it('marks null model metrics invalid', () => {
    const result = assessMarketReliability({
      market: 'BTTS',
      model: {
        rows: 200,
        classCount: 2,
        accuracy: null,
        brier: null,
        logLoss: null,
        ece: null,
      },
      climatology: {
        rows: 200,
        classCount: 2,
        accuracy: 0.5,
        brier: 0.25,
        logLoss: 0.69,
        classProbabilities: {
          POSITIVE: 0.5,
          NEGATIVE: 0.5,
        },
      },
    });

    expect(result.status).toBe('INVALID_METRICS');
  });

  it('requires model and climatology row counts to match', () => {
    const result = assessMarketReliability({
      market: 'BTTS',
      model: {
        rows: 200,
        classCount: 2,
        accuracy: 0.6,
        brier: 0.2,
        logLoss: 0.6,
        ece: 0.02,
      },
      climatology: {
        rows: 199,
        classCount: 2,
        accuracy: 0.5,
        brier: 0.25,
        logLoss: 0.69,
        classProbabilities: {
          POSITIVE: 0.5,
          NEGATIVE: 0.5,
        },
      },
    });

    expect(result.sufficientRows).toBe(false);
  });

  it('accepts a candidate that passes reliability, odds, edge and EV', () => {
    const result = assessBestBetCandidate(candidate());

    expect(result.eligible).toBe(true);
  });

  it('rejects a candidate below odds 1.40', () => {
    const item = candidate({
      decimalOdds: 1.39,
    });
    item.expectedValue = calculateExpectedValue(item.modelProbability, item.decimalOdds);

    const result = assessBestBetCandidate(item);

    expect(result.rejectionReasons).toContain('ODDS_BELOW_MINIMUM');
  });

  it('accepts odds exactly 1.40 when other gates pass', () => {
    const item = candidate({
      modelProbability: 0.8,
      fairMarketProbability: 0.72,
      decimalOdds: 1.4,
    });

    const result = assessBestBetCandidate(item);

    expect(result.rejectionReasons).not.toContain('ODDS_BELOW_MINIMUM');
  });

  it('rejects a candidate below 4% edge', () => {
    const item = candidate({
      modelProbability: 0.58,
      fairMarketProbability: 0.55,
    });

    const result = assessBestBetCandidate(item);

    expect(result.rejectionReasons).toContain('EDGE_BELOW_MINIMUM');
  });

  it('accepts exactly 4% edge when other gates pass', () => {
    const item = candidate({
      modelProbability: 0.6,
      fairMarketProbability: 0.56,
      decimalOdds: 1.8,
    });

    const result = assessBestBetCandidate(item);

    expect(result.rejectionReasons).not.toContain('EDGE_BELOW_MINIMUM');
  });

  it('accepts a floating-point edge numerically equal to 4%', () => {
    const item = candidate({
      modelProbability: 0.6,
      fairMarketProbability: 0.56,
      decimalOdds: 1.8,
    });

    expect(item.edge).toBeLessThan(0.04);

    const result = assessBestBetCandidate(item);

    expect(result.rejectionReasons).not.toContain('EDGE_BELOW_MINIMUM');
  });

  it('accepts an EV boundary within numerical tolerance', () => {
    const probability = 0.515;
    const odds = 2;
    const item = candidate({
      modelProbability: probability,
      fairMarketProbability: 0.47,
      decimalOdds: odds,
    });

    // Force a mathematically equivalent boundary value with binary noise.
    item.expectedValue = 0.03 - 5e-13;

    const result = assessBestBetCandidate(item);

    expect(result.rejectionReasons).not.toContain('EXPECTED_VALUE_BELOW_MINIMUM');
  });

  it('rejects a candidate below 3% expected value', () => {
    const item = candidate({
      modelProbability: 0.55,
      fairMarketProbability: 0.5,
      decimalOdds: 1.86,
    });

    const result = assessBestBetCandidate(item);

    expect(result.rejectionReasons).toContain('EXPECTED_VALUE_BELOW_MINIMUM');
  });

  it('rejects a candidate from an unreliable market', () => {
    const weak = assessMarketReliability({
      market: 'BTTS',
      model: {
        rows: 200,
        classCount: 2,
        accuracy: 0.5,
        brier: 0.26,
        logLoss: 0.7,
        ece: 0.02,
      },
      climatology: {
        rows: 200,
        classCount: 2,
        accuracy: 0.5,
        brier: 0.25,
        logLoss: 0.69,
        classProbabilities: {
          POSITIVE: 0.5,
          NEGATIVE: 0.5,
        },
      },
    });

    const result = assessBestBetCandidate(
      candidate({
        reliability: weak,
      }),
    );

    expect(result.rejectionReasons).toContain('MARKET_RELIABILITY_NOT_ELIGIBLE');
  });

  it('rejects edge inconsistent with probabilities', () => {
    const result = assessBestBetCandidate(
      candidate({
        edge: 0.2,
      }),
    );

    expect(result.rejectionReasons).toContain('EDGE_INCONSISTENT_WITH_PROBABILITIES');
  });

  it('rejects EV inconsistent with model probability and odds', () => {
    const result = assessBestBetCandidate(
      candidate({
        expectedValue: 0.99,
      }),
    );

    expect(result.rejectionReasons).toContain('EV_INCONSISTENT_WITH_ODDS');
  });

  it('rejects candidate pools that mix multiple fixtures', () => {
    expect(() =>
      selectScientificBestBet([
        candidate({
          fixtureId: 1,
        }),
        candidate({
          fixtureId: 2,
        }),
      ]),
    ).toThrow(/exactly one fixture/);
  });

  it('returns NO_BET when there are no candidates', () => {
    expect(selectScientificBestBet([]).decision).toBe('NO_BET');
  });

  it('returns NO_BET when every candidate fails', () => {
    const item = candidate({
      decimalOdds: 1.2,
    });
    item.expectedValue = calculateExpectedValue(item.modelProbability, item.decimalOdds);

    expect(selectScientificBestBet([item]).decision).toBe('NO_BET');
  });

  it('selects a BEST_BET when an eligible candidate exists', () => {
    expect(selectScientificBestBet([candidate()]).decision).toBe('BEST_BET');
  });

  it('selects the highest expected-value eligible candidate first', () => {
    const lower = candidate({
      fixtureId: 1,
      market: 'TOTAL_GOALS_2_5',
      selection: 'OVER',
      lineValue: 2.5,
      modelProbability: 0.6,
      fairMarketProbability: 0.55,
      decimalOdds: 1.8,
      reliability: eligibleReliability('TOTAL_GOALS_2_5'),
    });
    const higher = candidate({
      fixtureId: 1,
      market: 'BTTS',
      selection: 'YES',
      modelProbability: 0.62,
      fairMarketProbability: 0.56,
      decimalOdds: 1.9,
    });

    const result = selectScientificBestBet([lower, higher]);

    expect(result.decision).toBe('BEST_BET');

    if (result.decision === 'BEST_BET') {
      expect(result.selected.market).toBe('BTTS');
    }
  });

  it('uses edge as the second ranking tie-break', () => {
    const left = candidate({
      market: 'BTTS',
      selection: 'YES',
      modelProbability: 0.6,
      fairMarketProbability: 0.54,
      decimalOdds: 1.8,
    });
    const right = candidate({
      market: 'TOTAL_GOALS_2_5',
      selection: 'OVER',
      lineValue: 2.5,
      modelProbability: 0.6,
      fairMarketProbability: 0.55,
      decimalOdds: 1.8,
      reliability: eligibleReliability('TOTAL_GOALS_2_5'),
    });

    const result = selectScientificBestBet([right, left]);

    if (result.decision === 'BEST_BET') {
      expect(result.selected.market).toBe('BTTS');
    } else {
      throw new Error('Expected BEST_BET.');
    }
  });

  it('returns only one selected BEST BET even with multiple eligible candidates', () => {
    const result = selectScientificBestBet([
      candidate(),
      candidate({
        market: 'TOTAL_GOALS_2_5',
        selection: 'OVER',
        lineValue: 2.5,
        modelProbability: 0.65,
        fairMarketProbability: 0.58,
        decimalOdds: 1.8,
        reliability: eligibleReliability('TOTAL_GOALS_2_5'),
      }),
    ]);

    expect(result.decision).toBe('BEST_BET');

    if (result.decision === 'BEST_BET') {
      expect(result.stakeUnits).toBe(1);
      expect(result.selected).not.toBeNull();
    }
  });

  it('never marks BEST BET decision promotional', () => {
    const result = selectScientificBestBet([candidate()]);

    expect(result.promotional).toBe(false);
  });

  it('uses zero stake for NO_BET', () => {
    const result = selectScientificBestBet([]);

    expect(result.stakeUnits).toBe(0);
  });

  it('keeps rejected candidates auditable in a BEST_BET decision', () => {
    const bad = candidate({
      decimalOdds: 1.2,
    });
    bad.expectedValue = calculateExpectedValue(bad.modelProbability, bad.decimalOdds);

    const result = selectScientificBestBet([candidate(), bad]);

    if (result.decision === 'BEST_BET') {
      expect(result.rejectedCandidates).toHaveLength(1);
    } else {
      throw new Error('Expected BEST_BET.');
    }
  });

  it('keeps every rejected candidate auditable in NO_BET', () => {
    const bad = candidate({
      decimalOdds: 1.2,
    });
    bad.expectedValue = calculateExpectedValue(bad.modelProbability, bad.decimalOdds);

    const result = selectScientificBestBet([bad]);

    if (result.decision === 'NO_BET') {
      expect(result.rejectedCandidates).toHaveLength(1);
    } else {
      throw new Error('Expected NO_BET.');
    }
  });
});
