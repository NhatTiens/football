import { describe, expect, it } from 'vitest';

import {
  compareCurrentShadowCandidates,
  selectCurrentShadowCandidate,
} from '../src/current-shadow-candidate-core.js';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    marketType: 'BTTS',
    selection: 'YES',
    lineValue: null,
    decimalOdds: 2,
    bookmakerName: 'Bookmaker',
    modelProbability: 0.55,
    fairMarketProbability: 0.5,
    edge: 0.05,
    expectedValue: 0.1,
    conservativeEdge: -0.03,
    conservativeExpectedValue: -0.08,
    riskAdjustedScore: -0.02,
    quoteAgreementRatio: 0.8,
    quoteOutlier: false,
    currentSignalEligible: false,
    modelConfidenceTier: 'LIMITED',
    modelHistorySampleSize: 0,
    rejectionReasons: ['CURRENT_LOW_CONFIDENCE_DIAGNOSTIC_ONLY'],
    ...overrides,
  };
}

describe('R4.10.2.10 current shadow candidate', () => {
  it('keeps a raw-value candidate for shadow research even when conservative EV is negative', () => {
    const decision = selectCurrentShadowCandidate([candidate()]);

    expect(decision.status).toBe('SHADOW_CANDIDATE');
    expect(decision.selected?.selection).toBe('YES');
    expect(decision.selected?.conservativeExpectedValue).toBeLessThan(0);
    expect(decision.officialBestBetChanged).toBe(false);
  });

  it('blocks a limited-confidence longshot above the shadow odds cap', () => {
    const decision = selectCurrentShadowCandidate([
      candidate({ decimalOdds: 5, expectedValue: 0.7, edge: 0.14 }),
    ]);

    expect(decision.status).toBe('NO_SHADOW_CANDIDATE');
    expect(decision.rejectedByReason.SHADOW_LIMITED_CONFIDENCE_ODDS_CAP_EXCEEDED).toBe(1);
  });

  it('ranks by risk-adjusted evidence instead of the largest raw EV', () => {
    const decision = selectCurrentShadowCandidate([
      candidate({
        marketType: 'MATCH_WINNER',
        selection: 'AWAY',
        decimalOdds: 3.4,
        expectedValue: 0.55,
        edge: 0.12,
        riskAdjustedScore: -0.3,
        conservativeExpectedValue: -0.35,
      }),
      candidate({
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'OVER',
        decimalOdds: 2.1,
        expectedValue: 0.08,
        edge: 0.04,
        riskAdjustedScore: -0.01,
        conservativeExpectedValue: -0.05,
      }),
    ]);

    expect(decision.selected?.marketType).toBe('TOTAL_GOALS_2_5');
    expect(decision.selected?.selection).toBe('OVER');
  });

  it('prioritizes a current eligible candidate without turning it into an official bet', () => {
    const decision = selectCurrentShadowCandidate([
      candidate({ selection: 'YES', currentSignalEligible: false }),
      candidate({ selection: 'NO', currentSignalEligible: true }),
    ]);

    expect(decision.status).toBe('CURRENT_VALUE_AVAILABLE');
    expect(decision.selected?.selection).toBe('NO');
    expect(decision.automaticBetPlacement).toBe(false);
  });

  it('rejects bookmaker quote outliers from the selected shadow signal', () => {
    const decision = selectCurrentShadowCandidate([
      candidate({ quoteOutlier: true, expectedValue: 0.3, edge: 0.1 }),
    ]);

    expect(decision.status).toBe('NO_SHADOW_CANDIDATE');
    expect(decision.rejectedByReason.SHADOW_BOOKMAKER_QUOTE_OUTLIER).toBe(1);
  });

  it('uses deterministic lower-odds tie breaking', () => {
    const values = [
      candidate({ selection: 'YES', decimalOdds: 2.4 }),
      candidate({ selection: 'NO', decimalOdds: 2 }),
    ];

    const normalized = values
      .map((value) => selectCurrentShadowCandidate([value]).selected)
      .filter((value): value is NonNullable<typeof value> => value != null)
      .sort(compareCurrentShadowCandidates);

    expect(normalized[0]?.selection).toBe('NO');
  });
});
