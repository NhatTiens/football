import { describe, expect, it } from 'vitest';

import { mapPaperOuPredictionToModelSelection } from '../src/paper-ou-model-selection-core.js';
import { buildPaperShadowRecommendation } from '../src/paper-shadow-recommendation-core.js';

describe('paper O/U direct strategy audit propagation', () => {
  it('preserves the calculated model selection and line', () => {
    const mapping = mapPaperOuPredictionToModelSelection({
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
      recommendedSelection: 'OVER',
      recommendedLineValue: 2.5,
      predictionProbability: 0.62,
      paperOnly: true,
    });
    expect(result.selected?.reasonCodes).toContain('OU_DIRECT_MODEL_SELECTION_APPLIED');
    expect(result.selected?.reasonCodes).toContain('OU_ORIGINAL_LINE_PRESERVED');
    expect(result.paperOnly).toBe(true);
    expect(result.realMoneyExecution).toBe(false);
  });
});
