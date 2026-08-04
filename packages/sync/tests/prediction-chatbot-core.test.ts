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
  });
});
