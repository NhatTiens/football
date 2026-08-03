import { describe, expect, it } from 'vitest';

import {
  PAPER_SHADOW_RECOMMENDATION_VERSION,
  buildPaperShadowRecommendation,
} from '../src/paper-shadow-recommendation-core.js';

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    marketType: 'BTTS',
    selection: 'YES',
    lineValue: null,
    decimalOdds: 2.2,
    bookmakerName: 'Paper Book',
    modelProbability: 0.55,
    fairMarketProbability: 0.44,
    edge: 0.11,
    expectedValue: 0.21,
    riskAdjustedScore: -0.03,
    quoteOutlier: false,
    reliabilityStatus: 'NO_PROVEN_SKILL',
    modelSource: 'SCIENTIFIC_BASELINE_FALLBACK',
    modelVersion: 'baseline-v1',
    modelConfidenceTier: 'LIMITED',
    modelHistorySampleSize: 0,
    modelDataQualityScore: 0.2,
    sourceOddsSnapshotId: 10,
    sourceOddsEffectiveAt: '2026-07-30T00:00:00.000Z',
    currentSignalRejectionReasons: ['CURRENT_BASELINE_FALLBACK_RESEARCH_ONLY'],
    officialRejectionReasons: ['MARKET_RELIABILITY_NOT_ELIGIBLE'],
    ...overrides,
  };
}

describe('paper shadow recommendation', () => {
  it('returns a safe empty decision', () => {
    const result = buildPaperShadowRecommendation({
      providerFixtureId: 100,
      horizonMinutes: 90,
      calculatedAt: '2026-07-30T00:00:00.000Z',
      candidates: [],
    });

    expect(result.status).toBe('NO_CANDIDATE');
    expect(result.selected).toBeNull();
    expect(result.paperOnly).toBe(true);
    expect(result.automaticPromotion).toBe(false);
  });

  it('exposes a raw value fallback as paper-only', () => {
    const result = buildPaperShadowRecommendation({
      providerFixtureId: 101,
      horizonMinutes: 90,
      calculatedAt: '2026-07-30T00:00:00.000Z',
      candidates: [candidate()],
    });

    expect(result.status).toBe('RAW_VALUE_SHADOW');
    expect(result.selected?.paperTrackEligible).toBe(true);
    expect(result.selected?.hypotheticalFlatStakeUnits).toBe(1);
    expect(result.selected?.stakeEligible).toBe(false);
    expect(result.selected?.officialEligible).toBe(false);
  });

  it('keeps a weak candidate visible as diagnostic only', () => {
    const result = buildPaperShadowRecommendation({
      providerFixtureId: 102,
      horizonMinutes: 30,
      calculatedAt: '2026-07-30T00:00:00.000Z',
      candidates: [
        candidate({
          decimalOdds: 1.8,
          modelProbability: 0.52,
          fairMarketProbability: 0.54,
          edge: -0.02,
          expectedValue: -0.064,
        }),
      ],
    });

    expect(result.status).toBe('DIAGNOSTIC_SHADOW');
    expect(result.selected?.paperTrackEligible).toBe(false);
  });

  it('can identify hierarchical value below the raw edge threshold', () => {
    const result = buildPaperShadowRecommendation({
      providerFixtureId: 103,
      horizonMinutes: 90,
      calculatedAt: '2026-07-30T00:00:00.000Z',
      candidates: [
        candidate({
          marketType: 'MATCH_WINNER',
          selection: 'HOME',
          decimalOdds: 2.1,
          modelProbability: 0.53,
          fairMarketProbability: 0.5,
          edge: 0.03,
          expectedValue: 0.113,
          reliabilityStatus: 'DIAGNOSTIC_ELIGIBLE',
          modelSource: 'DYNAMIC_DIXON_COLES',
          modelConfidenceTier: 'HIGH',
          modelHistorySampleSize: 20,
          modelDataQualityScore: 0.9,
        }),
      ],
    });

    expect(result.status).toBe('HIERARCHICAL_VALUE_SHADOW');
    expect(result.selected?.rawValuePassed).toBe(false);
    expect(result.selected?.hierarchicalValuePassed).toBe(true);
  });

  it('creates a bounded paper proposal with no more than one percentage point adjustment', () => {
    const result = buildPaperShadowRecommendation({
      providerFixtureId: 104,
      horizonMinutes: 90,
      calculatedAt: '2026-07-30T00:00:00.000Z',
      candidates: [
        candidate({
          marketType: 'MATCH_WINNER',
          selection: 'HOME',
          decimalOdds: 2.02,
          modelProbability: 0.515,
          fairMarketProbability: 0.5,
          edge: 0.015,
          expectedValue: 0.0403,
          reliabilityStatus: 'DIAGNOSTIC_ELIGIBLE',
          modelSource: 'DYNAMIC_DIXON_COLES',
          modelConfidenceTier: 'HIGH',
          modelHistorySampleSize: 20,
          modelDataQualityScore: 0.9,
        }),
      ],
    });

    expect(result.status).toBe('BOUNDED_VALUE_SHADOW');
    expect(result.selected?.rawValuePassed).toBe(false);
    expect(result.selected?.hierarchicalValuePassed).toBe(false);
    expect(result.selected?.boundedValuePassed).toBe(true);
    expect(Math.abs(result.selected?.boundedProbabilityAdjustment ?? 1)).toBeLessThanOrEqual(
      result.policy.boundedMaximumProbabilityAdjustment,
    );
    expect(result.selected?.paperTrackEligible).toBe(true);
    expect(result.selected?.officialEligible).toBe(false);
  });

  it('allows the bounded sensitivity adjustment to move probability downward', () => {
    const result = buildPaperShadowRecommendation({
      providerFixtureId: 105,
      horizonMinutes: 30,
      calculatedAt: '2026-07-30T00:00:00.000Z',
      candidates: [
        candidate({
          decimalOdds: 2,
          modelProbability: 0.45,
          fairMarketProbability: 0.5,
          edge: -0.05,
          expectedValue: -0.1,
          reliabilityStatus: 'DIAGNOSTIC_ELIGIBLE',
          modelSource: 'DYNAMIC_DIXON_COLES',
          modelConfidenceTier: 'HIGH',
          modelHistorySampleSize: 20,
          modelDataQualityScore: 0.9,
        }),
      ],
    });

    expect(result.selected?.boundedProbabilityAdjustment).toBeLessThan(0);
    expect(Math.abs(result.selected?.boundedProbabilityAdjustment ?? 1)).toBeLessThanOrEqual(0.01);
    expect(result.selected?.paperTrackEligible).toBe(false);
  });
  it('ranks raw value before diagnostic candidates deterministically', () => {
    const result = buildPaperShadowRecommendation({
      providerFixtureId: 104,
      horizonMinutes: 5,
      calculatedAt: '2026-07-30T00:00:00.000Z',
      candidates: [
        candidate({
          marketType: 'TOTAL_GOALS_3_5',
          selection: 'UNDER',
          edge: -0.01,
          expectedValue: -0.02,
        }),
        candidate({
          marketType: 'BTTS',
          selection: 'NO',
          edge: 0.06,
          expectedValue: 0.08,
        }),
      ],
    });

    expect(result.selected?.selection).toBe('NO');
    expect(result.version).toBe(PAPER_SHADOW_RECOMMENDATION_VERSION);
    expect(result.realMoneyExecution).toBe(false);
  });
});
