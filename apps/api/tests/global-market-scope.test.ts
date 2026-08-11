import { describe, expect, it } from 'vitest';

import {
  isExplicitMatchWinnerQuestion,
  isMatchWinnerMarket,
  sanitizeGlobalMarketPayload,
} from '../src/global-market-scope';

describe('GLOBAL market scope: BTTS + O/U only', () => {
  it('recognizes all hidden aliases', () => {
    expect(isMatchWinnerMarket('MATCH_WINNER')).toBe(true);
    expect(isMatchWinnerMarket('Match Winner')).toBe(true);
    expect(isMatchWinnerMarket('HDA')).toBe(true);
    expect(isMatchWinnerMarket('HDA / 1X2')).toBe(true);
    expect(isMatchWinnerMarket('1X2')).toBe(true);
    expect(isMatchWinnerMarket('BTTS')).toBe(false);
    expect(isMatchWinnerMarket('TOTAL_GOALS_2_5')).toBe(false);
  });

  it('detects explicit winner questions for chatbot blocking', () => {
    expect(isExplicitMatchWinnerQuestion('HDA Arsenal Chelsea')).toBe(true);
    expect(isExplicitMatchWinnerQuestion('1x2 Arsenal Chelsea')).toBe(true);
    expect(isExplicitMatchWinnerQuestion('đội nào thắng Arsenal Chelsea')).toBe(true);
    expect(isExplicitMatchWinnerQuestion('BTTS Arsenal Chelsea')).toBe(false);
    expect(isExplicitMatchWinnerQuestion('Over 2.5 Arsenal Chelsea')).toBe(false);
  });

  it('removes hidden market objects everywhere', () => {
    const payload = sanitizeGlobalMarketPayload({
      integrity: { readOnly: true },
      marketPredictions: [
        { code: 'HDA', scientificMarketType: 'MATCH_WINNER', selections: [] },
        { code: 'BTTS', scientificMarketType: 'BTTS', selections: [] },
        {
          code: 'OVER_UNDER_2_5',
          scientificMarketType: 'TOTAL_GOALS_2_5',
          selections: [],
        },
      ],
      scientificHda: {
        available: true,
        homeProbability: 0.5,
        drawProbability: 0.2,
        awayProbability: 0.3,
      },
      providerHda: { available: true },
      marketMovement: { available: true },
      prediction: {
        source: 'SCIENTIFIC_DECISION',
        homeProbability: 0.5,
        drawProbability: 0.2,
        awayProbability: 0.3,
        predictedSelection: 'HOME',
      },
      recommendation: {
        status: 'BEST_BET',
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
      },
    }) as any;

    expect(payload.marketPredictions).toHaveLength(2);
    expect(payload.marketPredictions.map((row: any) => row.code)).toEqual([
      'BTTS',
      'OVER_UNDER_2_5',
    ]);
    expect(payload.scientificHda.available).toBe(false);
    expect(payload.scientificHda.homeProbability).toBeNull();
    expect(payload.providerHda.available).toBe(false);
    expect(payload.providerHda.predictedSelection).toBeNull();
    expect(payload.marketMovement).toBeNull();
    expect(payload.prediction.predictedSelection).toBeNull();
    expect(payload.recommendation.status).toBe('NONE');
    expect(payload.integrity.marketScope).toBe('BTTS_OU_ONLY');
    expect(payload.integrity.matchWinnerVisible).toBe(false);
  });

  it('filters backtest hidden bets and recomputes visible totals', () => {
    const payload = sanitizeGlobalMarketPayload({
      totalBets: 2,
      wins: 2,
      losses: 0,
      profitUnits: 2.5,
      bets: [
        {
          id: 1,
          marketCode: 'MATCH_WINNER',
          settlementResult: 'WIN',
          stakeUnits: 1,
          profitUnits: 1.5,
          decimalOdds: 2.5,
          kickoffAt: '2026-08-10T10:00:00.000Z',
        },
        {
          id: 2,
          marketCode: 'BTTS',
          settlementResult: 'WIN',
          stakeUnits: 1,
          profitUnits: 1,
          decimalOdds: 2,
          kickoffAt: '2026-08-10T12:00:00.000Z',
        },
      ],
      byMarket: [
        { marketCode: 'MATCH_WINNER', bets: 1 },
        { marketCode: 'BTTS', bets: 1 },
      ],
      equityCurve: [],
    }) as any;

    expect(payload.bets).toHaveLength(1);
    expect(payload.byMarket).toEqual([{ marketCode: 'BTTS', bets: 1 }]);
    expect(payload.totalBets).toBe(1);
    expect(payload.wins).toBe(1);
    expect(payload.profitUnits).toBe(1);
    expect(payload.equityCurve).toHaveLength(1);
    expect(payload.equityCurve[0].equity).toBe(1);
  });
});
