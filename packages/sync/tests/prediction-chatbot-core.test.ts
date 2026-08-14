import { describe, expect, it } from 'vitest';

import {
  detectPredictionChatIntent,
  matchPredictionChatFixture,
  normalizePredictionChatText,
  type PredictionChatFixtureIndex,
} from '../src/prediction-chatbot-core.js';
import { answerPredictionChatFromAnalysis } from '../src/prediction-chatbot-engine.js';

const fixtures: PredictionChatFixtureIndex[] = [
  {
    providerFixtureId: 101,
    kickoffAt: '2026-08-04T13:00:00.000Z',
    leagueName: 'Premier League',
    homeTeamName: 'Arsenal',
    awayTeamName: 'Chelsea',
  },
  {
    providerFixtureId: 102,
    kickoffAt: '2026-08-06T13:00:00.000Z',
    leagueName: 'Premier League',
    homeTeamName: 'Liverpool',
    awayTeamName: 'Arsenal',
  },
];

function analysisFixture(overrides: Record<string, unknown> = {}) {
  return {
    fixture: {
      id: 1,
      apiFixtureId: 101,
      kickoffAt: '2026-08-04T13:00:00.000Z',
      league: { name: 'Premier League' },
      homeTeam: { name: 'Arsenal' },
      awayTeam: { name: 'Chelsea' },
    },
    scientificHda: {
      available: true,
      homeProbability: 0.51,
      drawProbability: 0.27,
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
    currentRecommendationStatus: 'NO_VALUE_SIGNAL',
    currentRecommendationError: null,
    currentRecommendation: null,
    paperShadowRecommendation: null,
    decision: null,
    marketPredictions: [],
    oddsDiagnostics: { snapshotRows: 4, pitUsableRows: 4 },
    state: 'NO_BET',
    ...overrides,
  };
}

describe('read-only prediction chatbot core', () => {
  it('normalizes Vietnamese text and detects market intent', () => {
    expect(normalizePredictionChatText('Dự đoán kèo Tài/Xỉu tối nay')).toBe(
      'du doan keo tai xiu toi nay',
    );
    expect(detectPredictionChatIntent('Soi kèo O/U Arsenal')).toBe('TOTAL_GOALS');
    expect(detectPredictionChatIntent('Có BEST BET cho Chelsea không?')).toBe('BEST_BET');
  });

  it('matches a fixture when both teams are named', () => {
    const result = matchPredictionChatFixture({
      message: 'Dự đoán Arsenal vs Chelsea tối nay',
      fixtures,
      now: new Date('2026-08-04T01:00:00.000Z'),
    });
    expect(result.status).toBe('MATCHED');
    expect(result.fixture?.providerFixtureId).toBe(101);
  });

  it('asks the user to disambiguate when one team has multiple fixtures', () => {
    const result = matchPredictionChatFixture({
      message: 'Dự đoán Arsenal',
      fixtures,
      now: new Date('2026-08-04T01:00:00.000Z'),
    });
    expect(result.status).toBe('AMBIGUOUS');
    expect(result.suggestions).toHaveLength(2);
  });

  it('resolves an ambiguous suggestion by its stable provider fixture id', () => {
    const ambiguous = matchPredictionChatFixture({
      message: 'Du doan Arsenal',
      fixtures,
      now: new Date('2026-08-04T01:00:00.000Z'),
    });
    const selectedPrompt = ambiguous.suggestions[0]?.prompt;
    expect(selectedPrompt).toContain('fixture 101');
    const selected = matchPredictionChatFixture({
      message: selectedPrompt ?? '',
      fixtures,
      now: new Date('2026-08-04T01:00:00.000Z'),
    });
    expect(selected.status).toBe('MATCHED');
    expect(selected.fixture?.providerFixtureId).toBe(101);
  });

  it('does not invent a bet or probability when the model has no value signal', () => {
    const result = answerPredictionChatFromAnalysis({
      message: 'Arsenal vs Chelsea có best bet không?',
      analysis: { fixtures: [analysisFixture()] },
      now: new Date('2026-08-04T01:00:00.000Z'),
    });
    expect(result.status).toBe('ANSWER');
    expect(result.answer?.recommendation).toMatchObject({
      status: 'NONE',
      modelProbability: null,
      officialBestBet: false,
    });
    expect(result.message).toContain('NO BET');
    expect(result.safety).toMatchObject({
      databaseWritten: false,
      probabilitiesInvented: false,
      paperOnly: true,
    });
  });

  it('labels a current recommendation as shadow rather than BEST BET', () => {
    const result = answerPredictionChatFromAnalysis({
      message: 'Dự đoán Arsenal và Chelsea',
      analysis: {
        fixtures: [
          analysisFixture({
            currentRecommendationStatus: 'AVAILABLE',
            currentRecommendation: {
              calculatedAt: '2026-08-04T00:59:00.000Z',
              sourceOddsFreshnessAt: '2026-08-04T00:58:00.000Z',
              marketType: 'TOTAL_GOALS_2_5',
              selection: 'OVER',
              lineValue: 2.5,
              decimalOdds: 1.91,
              bookmakerName: 'Paper Book',
              modelProbability: 0.58,
              edge: 0.04,
              expectedValue: 0.07,
            },
          }),
        ],
      },
      now: new Date('2026-08-04T01:00:00.000Z'),
    });
    expect(result.answer?.recommendation).toMatchObject({
      status: 'CURRENT_SHADOW',
      officialBestBet: false,
      paperOnly: true,
    });
    expect(result.answer?.dataQuality).toMatchObject({
      freshnessStatus: 'CURRENT',
      freshnessSource: 'CURRENT_ANALYSIS',
    });
  });

  it('uses a fresh current-model result instead of an older ledger decision', () => {
    const result = answerPredictionChatFromAnalysis({
      message: 'Soi kèo O/U Arsenal và Chelsea',
      analysis: {
        fixtures: [
          analysisFixture({
            state: 'BEST_BET',
            currentRecommendationStatus: 'AVAILABLE',
            currentRecommendation: {
              calculatedAt: '2026-08-04T00:59:00.000Z',
              sourceOddsFreshnessAt: '2026-08-04T00:58:00.000Z',
              marketType: 'TOTAL_GOALS_2_5',
              selection: 'OVER',
              lineValue: 2.5,
              decimalOdds: 1.91,
              bookmakerName: 'Current Book',
              modelProbability: 0.58,
              edge: 0.04,
              expectedValue: 0.07,
            },
            decision: {
              decisionAsOf: '2026-08-03T12:00:00.000Z',
              decisionType: 'BEST_BET',
              selectedMarket: 'TOTAL_GOALS_2_5',
              selectedSelection: 'UNDER',
              lineValue: 2.5,
              decimalOdds: 1.86,
              bookmakerName: 'Old Book',
              modelProbability: 0.55,
              edge: 0.03,
              expectedValue: 0.05,
            },
          }),
        ],
      },
      now: new Date('2026-08-04T01:00:00.000Z'),
    });

    expect(result.answer?.recommendation).toMatchObject({
      status: 'CURRENT_SHADOW',
      selection: 'OVER',
      bookmakerName: 'Current Book',
    });
  });

  it('fails closed instead of presenting a freshly calculated result from stale source odds', () => {
    const result = answerPredictionChatFromAnalysis({
      message: 'Soi kèo O/U Arsenal và Chelsea',
      analysis: {
        fixtures: [
          analysisFixture({
            currentRecommendationStatus: 'AVAILABLE',
            currentRecommendation: {
              calculatedAt: '2026-08-04T00:59:00.000Z',
              sourceOddsFreshnessAt: '2026-08-03T23:30:00.000Z',
              marketType: 'TOTAL_GOALS_2_5',
              selection: 'OVER',
              lineValue: 2.5,
              decimalOdds: 1.91,
              bookmakerName: 'Stale Book',
              modelProbability: 0.58,
              edge: 0.04,
              expectedValue: 0.07,
            },
          }),
        ],
      },
      now: new Date('2026-08-04T01:00:00.000Z'),
    });

    expect(result.answer?.recommendation).toMatchObject({
      status: 'NONE',
      selection: null,
    });
    expect(result.answer?.dataQuality.freshnessStatus).toBe('STALE');
    expect(result.answer?.markets).toEqual([]);
  });
});
