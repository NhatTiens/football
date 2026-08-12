import { describe, expect, it } from 'vitest';

import {
  answerAdvancedPredictionChatFromAnalysis,
  buildPredictionChatCollectionFromAnalysis,
  predictionChatCapabilities,
} from '../src/prediction-chatbot-advanced-engine.js';

function fixture(input: {
  id: number;
  providerFixtureId: number;
  home: string;
  away: string;
  kickoffAt: string;
  state?: 'BEST_BET' | 'NO_BET' | 'PREDICTION_ONLY' | 'WAITING_DATA';
  officialBestBet?: boolean;
  paperShadow?: boolean;
}) {
  const officialBestBet = input.officialBestBet === true;
  const paperShadow = input.paperShadow === true;
  return {
    fixture: {
      id: input.id,
      apiFixtureId: input.providerFixtureId,
      kickoffAt: input.kickoffAt,
      league: { id: 1, name: 'Test League' },
      homeTeam: { id: input.id * 10, name: input.home },
      awayTeam: { id: input.id * 10 + 1, name: input.away },
    },
    scientificHda: {
      available: true,
      homeProbability: 0.52,
      drawProbability: 0.26,
      awayProbability: 0.22,
      predictedSelection: 'HOME',
    },
    providerHda: {
      available: false,
      homeProbability: null,
      drawProbability: null,
      awayProbability: null,
      predictedSelection: null,
    },
    currentRecommendationStatus: paperShadow ? 'AVAILABLE' : 'NO_VALUE_SIGNAL',
    currentRecommendationError: null,
    currentRecommendation: null,
    paperShadowRecommendation: paperShadow
      ? {
          status: 'AVAILABLE',
          selected: {
            marketType: 'TOTAL_GOALS_2_5',
            selection: 'OVER',
            lineValue: 2.5,
            decimalOdds: 1.95,
            bookmakerName: 'Paper Book',
            modelProbability: 0.58,
            boundedAdjustedProbability: 0.57,
            boundedEdge: 0.04,
            boundedExpectedValue: 0.08,
            paperTrackEligible: true,
            reasonCodes: [],
          },
        }
      : null,
    decision: officialBestBet
      ? {
          decisionType: 'BEST_BET',
          selectedMarket: 'MATCH_WINNER',
          selectedSelection: 'HOME',
          lineValue: null,
          decimalOdds: 2.05,
          bookmakerName: 'Paper Book',
          modelProbability: 0.52,
          edge: 0.03,
          expectedValue: 0.07,
        }
      : null,
    marketPredictions: [
      {
        code: 'OU_2_5',
        scientificMarketType: 'TOTAL_GOALS_2_5',
        label: 'Total goals 2.5',
        lineValue: 2.5,
        selections: [
          { code: 'OVER', modelProbability: 0.58 },
          { code: 'UNDER', modelProbability: 0.42 },
        ],
      },
    ],
    oddsDiagnostics: { snapshotRows: 6, pitUsableRows: 6 },
    state: input.state ?? (officialBestBet ? 'BEST_BET' : 'PREDICTION_ONLY'),
  };
}

const analysis = {
  fixtures: [
    fixture({
      id: 1,
      providerFixtureId: 101,
      home: 'Arsenal',
      away: 'Chelsea',
      kickoffAt: '2026-08-04T13:00:00.000Z',
      officialBestBet: true,
    }),
    fixture({
      id: 2,
      providerFixtureId: 102,
      home: 'Liverpool',
      away: 'Everton',
      kickoffAt: '2026-08-04T15:00:00.000Z',
      paperShadow: true,
    }),
  ],
};

describe('advanced prediction chatbot engine', () => {
  it('delegates freshness to the worker and remains request read-only', () => {
    expect(predictionChatCapabilities).toMatchObject({
      freshnessCycleBeforeAnswer: false,
      freshnessOwnedByWorker: true,
      paperOnly: true,
      realMoneyExecution: false,
    });
  });
  it('ranks official BEST BET above paper shadow without relabeling the shadow row', () => {
    const result = buildPredictionChatCollectionFromAnalysis({
      analysis,
      message: 'Danh sach best bet toi nay',
      intent: 'BEST_BET',
      now: new Date('2026-08-04T01:00:00.000Z'),
    });
    expect(result.officialBestBets).toBe(1);
    expect(result.paperShadowCandidates).toBe(1);
    expect(result.rows[0]?.recommendation.status).toBe('BEST_BET');
    expect(result.rows[1]?.recommendation.status).toBe('PAPER_SHADOW');
  });

  it('keeps two legs with the same teams distinct by provider fixture id', () => {
    const secondLeg = fixture({
      id: 3,
      providerFixtureId: 103,
      home: 'Chelsea',
      away: 'Arsenal',
      kickoffAt: '2026-08-11T13:00:00.000Z',
    });
    const result = buildPredictionChatCollectionFromAnalysis({
      analysis: { fixtures: [analysis.fixtures[0], secondLeg] },
      message: 'Toi nay co tran nao?',
      intent: 'DISCOVERY',
      now: new Date('2026-08-04T01:00:00.000Z'),
    });
    expect(result.rows.map((row) => row.fixture.providerFixtureId)).toEqual([101, 103]);
  });

  it('uses bounded active-fixture context for a market follow-up', async () => {
    const result = await answerAdvancedPredictionChatFromAnalysis({
      message: 'Con keo O/U?',
      context: {
        activeProviderFixtureId: 102,
        activeHomeTeamName: 'Liverpool',
        activeAwayTeamName: 'Everton',
        lastIntent: 'PREDICTION',
        turnCount: 1,
      },
      analysis,
      now: new Date('2026-08-04T01:00:00.000Z'),
    });
    expect(result.status).toBe('ANSWER');
    expect(result.intent).toBe('TOTAL_GOALS');
    expect(result.answer?.fixture.providerFixtureId).toBe(102);
    expect(result.context.turnCount).toBe(2);
    expect(result.safety).toMatchObject({
      databaseWritten: false,
      probabilitiesInvented: false,
      paperOnly: true,
    });
  });
});
