import { describe, expect, it } from 'vitest';

import {
  canPredictionChatUseActiveFixture,
  detectAdvancedPredictionChatIntent,
  isPredictionChatAggregateQuery,
  nextPredictionChatContext,
  sanitizePredictionChatContext,
} from '../src/prediction-chatbot-conversation-core.js';

describe('prediction chatbot bounded conversation context', () => {
  it.each([
    ['Tại sao lại chọn đội chủ nhà?', 'EXPLANATION'],
    ['Cho xem lịch sử đúng sai và CLV', 'HISTORY'],
    ['Độ tin cậy O/U hiện tại thế nào?', 'RELIABILITY'],
    ['Tối nay có trận nào?', 'DISCOVERY'],
    ['Danh sách BEST BET tối nay', 'BEST_BET'],
    ['Còn kèo O/U?', 'TOTAL_GOALS'],
  ] as const)('detects %s', (message, intent) => {
    expect(detectAdvancedPredictionChatIntent(message)).toBe(intent);
  });

  it('sanitizes untrusted client context and caps turn count', () => {
    expect(
      sanitizePredictionChatContext({
        activeProviderFixtureId: '123',
        activeHomeTeamName: 'Arsenal',
        activeAwayTeamName: 'Chelsea',
        lastIntent: 'PREDICTION',
        turnCount: 999,
        injected: { admin: true },
      }),
    ).toEqual({
      activeProviderFixtureId: 123,
      activeHomeTeamName: 'Arsenal',
      activeAwayTeamName: 'Chelsea',
      lastIntent: 'PREDICTION',
      turnCount: 24,
    });
  });

  it('uses the active fixture for a follow-up but not for a list query', () => {
    const context = sanitizePredictionChatContext({
      activeProviderFixtureId: 123,
      activeHomeTeamName: 'Arsenal',
      activeAwayTeamName: 'Chelsea',
      lastIntent: 'PREDICTION',
      turnCount: 1,
    });
    expect(
      canPredictionChatUseActiveFixture({
        message: 'Tại sao?',
        intent: 'EXPLANATION',
        context,
      }),
    ).toBe(true);
    expect(
      isPredictionChatAggregateQuery({
        message: 'Tối nay có trận nào?',
        intent: 'DISCOVERY',
        context,
      }),
    ).toBe(true);
  });

  it('advances bounded context without losing the selected fixture', () => {
    const next = nextPredictionChatContext({
      previous: sanitizePredictionChatContext(null),
      intent: 'PREDICTION',
      fixture: {
        providerFixtureId: 55,
        homeTeamName: 'Vietnam',
        awayTeamName: 'Thailand',
      },
    });
    expect(next).toMatchObject({
      activeProviderFixtureId: 55,
      activeHomeTeamName: 'Vietnam',
      activeAwayTeamName: 'Thailand',
      lastIntent: 'PREDICTION',
      turnCount: 1,
    });
  });
});
