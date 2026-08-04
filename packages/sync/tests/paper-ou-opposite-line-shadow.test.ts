import { describe, expect, it } from 'vitest';

import { mapPaperOuPredictionToOppositeLine } from '../src/paper-ou-opposite-line-core.js';
import { buildPaperShadowRecommendation } from '../src/paper-shadow-recommendation-core.js';

describe('paper O/U strategy audit propagation', () => {
  it('preserves the model prediction beside the mapped paper selection', () => {
    const mapping = mapPaperOuPredictionToOppositeLine({
      predictionSelection: 'OVER',
      predictionLineValue: 2.5,
    });
    const result = buildPaperShadowRecommendation({
      providerFixtureId: 200,
      horizonMinutes: 90,
      calculatedAt: '2026-08-04T00:00:00.000Z',
      candidates: [
        {
          marketType: mapping.recommendedMarketType,
          selection: mapping.recommendedSelection,
          lineValue: mapping.recommendedLineValue,
          decimalOdds: 1.9,
          bookmakerName: 'Paper Book',
          modelProbability: 0.56,
          fairMarketProbability: 0.5,
          edge: 0.06,
          expectedValue: 0.064,
          riskAdjustedScore: 0.02,
          quoteOutlier: false,
          reliabilityStatus: 'NO_PROVEN_SKILL',
          modelSource: 'DYNAMIC_DIXON_COLES',
          modelVersion: 'test-model',
          modelConfidenceTier: 'HIGH',
          modelHistorySampleSize: 20,
          modelDataQualityScore: 0.9,
          sourceOddsSnapshotId: 100,
          sourceOddsEffectiveAt: '2026-08-04T00:00:00.000Z',
          currentSignalRejectionReasons: [],
          officialRejectionReasons: [],
          ouOppositeLineStrategy: {
            ...mapping,
            predictionProbability: 0.62,
          },
        },
      ],
    });

    expect(result.selected?.ouOppositeLineStrategy).toMatchObject({
      predictionSelection: 'OVER',
      predictionLineValue: 2.5,
      recommendedSelection: 'UNDER',
      recommendedLineValue: 3.5,
      predictionProbability: 0.62,
      paperOnly: true,
    });
    expect(result.selected?.reasonCodes).toContain('OU_OPPOSITE_PROTECTED_LINE_APPLIED');
    expect(result.selected?.reasonCodes).toContain('OU_LINE_SHIFTED_ONE_GOAL');
    expect(result.paperOnly).toBe(true);
    expect(result.realMoneyExecution).toBe(false);
  });
});
