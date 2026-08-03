import { describe, expect, it } from 'vitest';

import { buildPaperShadowRecommendation } from '../src/paper-shadow-recommendation-core.js';

function hdaCandidate(overrides: Record<string, unknown> = {}) {
  return {
    marketType: 'MATCH_WINNER',
    selection: 'AWAY',
    lineValue: null,
    decimalOdds: 7,
    bookmakerName: 'Paper Book',
    modelProbability: 0.32,
    fairMarketProbability: 1 / 7,
    edge: 0.177,
    expectedValue: 1.24,
    quoteOutlier: false,
    reliabilityStatus: 'NO_PROVEN_SKILL',
    modelSource: 'SCIENTIFIC_BASELINE_FALLBACK',
    modelVersion: 'paper-hda-context-v1',
    modelConfidenceTier: 'LIMITED',
    modelHistorySampleSize: 0,
    modelDataQualityScore: 0.2,
    ...overrides,
  };
}

function decide(overrides: Record<string, unknown> = {}) {
  return buildPaperShadowRecommendation({
    providerFixtureId: 9001,
    horizonMinutes: 90,
    calculatedAt: '2026-07-31T00:00:00.000Z',
    candidates: [hdaCandidate(overrides)],
  });
}

describe('fallback HDA longshot firewall', () => {
  it('quarantines high-odds fallback HDA as diagnostic even when raw EV is large', () => {
    const result = decide();

    expect(result.status).toBe('DIAGNOSTIC_SHADOW');
    expect(result.selected?.rawValuePassed).toBe(false);
    expect(result.selected?.hierarchicalValuePassed).toBe(false);
    expect(result.selected?.boundedValuePassed).toBe(false);
    expect(result.selected?.paperTrackEligible).toBe(false);
    expect(result.selected?.reasonCodes).toContain('FALLBACK_HDA_LONGSHOT_DIAGNOSTIC_ONLY');
    expect(result.policy.fallbackHdaMaximumActionableOdds).toBe(3.5);
  });

  it('keeps a fallback HDA candidate at or below the firewall available to paper gates', () => {
    const result = decide({
      decimalOdds: 3.5,
      modelProbability: 0.38,
      fairMarketProbability: 0.28,
      edge: 0.1,
      expectedValue: 0.33,
    });

    expect(result.status).toBe('RAW_VALUE_SHADOW');
    expect(result.selected?.paperTrackEligible).toBe(true);
    expect(result.selected?.reasonCodes).toContain(
      'FALLBACK_HDA_LONGSHOT_FIREWALL_NOT_TRIGGERED',
    );
  });

  it('does not hard-cap a dynamic HDA candidate that has separate model evidence', () => {
    const result = decide({
      modelSource: 'DYNAMIC_DIXON_COLES',
      modelConfidenceTier: 'HIGH',
      modelHistorySampleSize: 20,
      modelDataQualityScore: 0.9,
      reliabilityStatus: 'DIAGNOSTIC_ELIGIBLE',
    });

    expect(result.status).toBe('RAW_VALUE_SHADOW');
    expect(result.selected?.paperTrackEligible).toBe(true);
    expect(result.selected?.reasonCodes).toContain('DYNAMIC_MODEL_OBSERVED');
  });
});
