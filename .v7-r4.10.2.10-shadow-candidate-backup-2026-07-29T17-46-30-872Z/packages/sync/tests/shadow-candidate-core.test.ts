import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildShadowCandidateClassification,
  compareShadowCandidates,
  type ShadowCandidateInput,
} from '../src/shadow-candidate-core.js';

function candidate(
  overrides: Partial<ShadowCandidateInput> = {},
): ShadowCandidateInput {
  return {
    marketType: 'MATCH_WINNER',
    selection: 'HOME',
    lineValue: null,
    decimalOdds: 2,
    bookmakerName: 'Bookmaker',
    modelProbability: 0.55,
    fairMarketProbability: 0.5,
    edge: 0.05,
    expectedValue: 0.1,
    conservativeEdge: -0.03,
    conservativeExpectedValue: -0.08,
    riskAdjustedScore: -0.04,
    currentSignalEligible: false,
    officialEligible: false,
    signalTier: 'LOW_CONFIDENCE_DIAGNOSTIC',
    modelSource: 'SCIENTIFIC_BASELINE_FALLBACK',
    modelConfidenceTier: 'LIMITED',
    modelHistorySampleSize: 0,
    quoteOutlier: false,
    currentSignalRejectionReasons: [
      'CURRENT_RELIABILITY_NOT_PROVEN',
    ],
    officialRejectionReasons: [
      'RELIABILITY_GATE_FAILED',
    ],
    sourceOddsSnapshotId: 11,
    sourceOddsEffectiveAt: '2026-07-29T12:00:00.000Z',
    ...overrides,
  };
}

describe(
  'shadow candidate classification',
  () => {
    it(
      'selects current-value candidate before diagnostic alternatives',
      () => {
        const result =
          buildShadowCandidateClassification({
            providerFixtureId: 1,
            checkpointMinutes: 90,
            calculatedAt: '2026-07-29T12:00:00.000Z',
            analysisStatus: 'AVAILABLE',
            candidates: [
              candidate({
                selection: 'AWAY',
                decimalOdds: 8,
                expectedValue: 0.9,
                riskAdjustedScore: 0.3,
              }),
              candidate({
                selection: 'HOME',
                currentSignalEligible: true,
                signalTier: 'RISK_ADJUSTED_RESEARCH',
                conservativeEdge: 0.05,
                conservativeExpectedValue: 0.08,
                riskAdjustedScore: 0.12,
              }),
            ],
          });

        expect(
          result.selected?.selection,
        ).toBe('HOME');
        expect(
          result.selected?.shadowTier,
        ).toBe(
          'CURRENT_VALUE_SHADOW',
        );
        expect(
          result.selected?.stakeEligible,
        ).toBe(false);
      },
    );

    it(
      'ranks by risk-adjusted score instead of raw high-odds EV',
      () => {
        const longshot =
          candidate({
            selection: 'AWAY',
            decimalOdds: 7,
            expectedValue: 0.8,
            conservativeExpectedValue: -0.45,
            riskAdjustedScore: -0.35,
          });

        const safer =
          candidate({
            selection: 'DRAW',
            decimalOdds: 3.2,
            expectedValue: 0.08,
            conservativeExpectedValue: -0.06,
            riskAdjustedScore: -0.02,
          });

        expect(
          [
            longshot,
            safer,
          ].sort(
            compareShadowCandidates,
          )[0]?.selection,
        ).toBe('DRAW');
      },
    );

    it(
      'tracks a low-confidence candidate without promoting it',
      () => {
        const result =
          buildShadowCandidateClassification({
            providerFixtureId: 2,
            checkpointMinutes: 30,
            calculatedAt: '2026-07-29T12:00:00.000Z',
            analysisStatus: 'NO_VALUE_SIGNAL',
            candidates: [candidate()],
          });

        expect(result.status).toBe(
          'SHADOW_CANDIDATE',
        );
        expect(
          result.selected?.shadowTier,
        ).toBe(
          'DIAGNOSTIC_TRACKING_SHADOW',
        );
        expect(
          result.selected?.shadowOnly,
        ).toBe(true);
        expect(
          result.selected?.officialEligible,
        ).toBe(false);
        expect(
          result.officialBestBetChanged,
        ).toBe(false);
      },
    );

    it(
      'excludes quote outliers from shadow selection',
      () => {
        const result =
          buildShadowCandidateClassification({
            providerFixtureId: 3,
            checkpointMinutes: 60,
            calculatedAt: '2026-07-29T12:00:00.000Z',
            analysisStatus: 'NO_VALUE_SIGNAL',
            candidates: [
              candidate({
                quoteOutlier: true,
              }),
            ],
          });

        expect(result.status).toBe(
          'SHADOW_NO_CANDIDATE',
        );
        expect(result.selected).toBeNull();
        expect(
          result.excludedCandidateCount,
        ).toBe(1);
      },
    );

    it(
      'uses deterministic lower-odds tie break',
      () => {
        const high =
          candidate({
            selection: 'AWAY',
            decimalOdds: 4,
          });
        const low =
          candidate({
            selection: 'HOME',
            decimalOdds: 2,
          });

        const result =
          buildShadowCandidateClassification({
            providerFixtureId: 4,
            checkpointMinutes: 5,
            calculatedAt: '2026-07-29T12:00:00.000Z',
            analysisStatus: 'NO_VALUE_SIGNAL',
            candidates: [high, low],
          });

        expect(
          result.selected?.selection,
        ).toBe('HOME');
      },
    );
  },
);
