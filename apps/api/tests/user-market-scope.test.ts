import { describe, expect, it } from 'vitest';

import {
  canAccessMatchWinner,
  isMatchWinnerMarket,
  sanitizeUserPredictionAnalysis,
} from '../src/user-market-scope';

function sampleAnalysis() {
  return {
    version: 'test',
    generatedAt: '2026-08-11T08:00:00.000Z',
    counts: {
      fixtures: 1,
      predicted: 1,
      scientificDecisions: 1,
      bestBets: 1,
      currentRecommendations: 1,
      paperRecommendations: 1,
      noBets: 0,
      predictionOnly: 0,
      waitingData: 0,
    },
    currentRecommendationStatusCounts: {
      AVAILABLE: 1,
      NO_VALUE_SIGNAL: 0,
    },
    topBestBets: [],
    fixtures: [
      {
        fixture: { id: 1 },
        prediction: {
          source: 'SCIENTIFIC_DECISION',
          homeProbability: 0.5,
          drawProbability: 0.2,
          awayProbability: 0.3,
          predictedSelection: 'HOME',
        },
        scientificHda: {
          available: true,
          source: 'SCIENTIFIC_DECISION',
          homeProbability: 0.5,
          drawProbability: 0.2,
          awayProbability: 0.3,
          predictedSelection: 'HOME',
        },
        providerHda: {
          available: true,
          source: 'API_FOOTBALL',
          homeProbability: 0.45,
          drawProbability: 0.25,
          awayProbability: 0.3,
          predictedSelection: 'HOME',
        },
        currentRecommendationStatus: 'AVAILABLE',
        currentRecommendationError: null,
        currentRecommendation: {
          marketType: 'MATCH_WINNER',
          selection: 'HOME',
        },
        paperShadowRecommendation: {
          status: 'RAW_VALUE_SHADOW',
          consideredCandidates: 1,
          validCandidates: 1,
          rawValueCandidates: 1,
          hierarchicalValueCandidates: 1,
          boundedValueCandidates: 1,
          selected: {
            marketType: 'MATCH_WINNER',
            selection: 'HOME',
          },
        },
        decision: {
          selectedMarket: 'MATCH_WINNER',
          selectedSelection: 'HOME',
          candidates: [
            { marketType: 'MATCH_WINNER' },
            { marketType: 'BTTS' },
          ],
        },
        stake: { stakeUnits: 1 },
        marketPredictions: [
          {
            code: 'HDA',
            scientificMarketType: 'MATCH_WINNER',
            selections: [{ modelProbability: 0.5, decimalOdds: 2 }],
          },
          {
            code: 'BTTS',
            scientificMarketType: 'BTTS',
            selections: [{ modelProbability: 0.62, decimalOdds: 1.9 }],
          },
          {
            code: 'OVER_UNDER_2_5',
            scientificMarketType: 'TOTAL_GOALS_2_5',
            selections: [{ modelProbability: 0.58, decimalOdds: 1.95 }],
          },
        ],
        oddsDiagnostics: { marketsWithOdds: 3 },
        marketMovement: { available: true },
        multiMarketMovements: [{ code: 'BTTS' }, { code: 'OVER_UNDER_2_5' }],
        state: 'BEST_BET',
      },
    ],
    integrity: {},
  };
}

describe('USER market scope: BTTS + O/U only', () => {
  it('keeps MATCH_WINNER internal to ANALYST and ADMIN', () => {
    expect(canAccessMatchWinner('USER')).toBe(false);
    expect(canAccessMatchWinner(null)).toBe(false);
    expect(canAccessMatchWinner('ANALYST')).toBe(true);
    expect(canAccessMatchWinner('ADMIN')).toBe(true);
  });

  it('recognizes HDA/1X2/MATCH_WINNER aliases', () => {
    expect(isMatchWinnerMarket('MATCH_WINNER')).toBe(true);
    expect(isMatchWinnerMarket('HDA')).toBe(true);
    expect(isMatchWinnerMarket('1X2')).toBe(true);
    expect(isMatchWinnerMarket('BTTS')).toBe(false);
    expect(isMatchWinnerMarket('TOTAL_GOALS_2_5')).toBe(false);
  });

  it('removes winner output but keeps BTTS and O/U', () => {
    const scoped = sanitizeUserPredictionAnalysis(sampleAnalysis() as any);

    expect(scoped.integrity.userMarketScope).toBe('BTTS_OU_ONLY');
    expect(scoped.fixtures[0].marketPredictions.map((row: any) => row.code)).toEqual([
      'BTTS',
      'OVER_UNDER_2_5',
    ]);
    expect(scoped.fixtures[0].scientificHda.available).toBe(false);
    expect(scoped.fixtures[0].providerHda.available).toBe(false);
    expect(scoped.fixtures[0].marketMovement).toBeNull();
    expect(scoped.fixtures[0].currentRecommendation).toBeNull();
    expect(scoped.fixtures[0].paperShadowRecommendation.selected).toBeNull();
    expect(scoped.fixtures[0].decision).toBeNull();
    expect(scoped.fixtures[0].stake).toBeNull();
    expect(scoped.fixtures[0].state).toBe('PREDICTION_ONLY');
  });
});
