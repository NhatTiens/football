import { describe, expect, it } from 'vitest';

import { predictionChatRequestSchema } from '../src/chat-security';

describe('prediction chatbot request security', () => {
  it('accepts the bounded client conversation contract', () => {
    expect(
      predictionChatRequestSchema.safeParse({
        message: '  Soi kèo O/U Arsenal  ',
        context: {
          activeProviderFixtureId: 123,
          activeHomeTeamName: 'Arsenal',
          activeAwayTeamName: 'Chelsea',
          lastIntent: 'TOTAL_GOALS',
          turnCount: 3,
        },
      }).success,
    ).toBe(true);
  });

  it('rejects oversized, unexpected, or forged context fields', () => {
    expect(predictionChatRequestSchema.safeParse({ message: 'x'.repeat(241) }).success).toBe(false);
    expect(predictionChatRequestSchema.safeParse({ message: 'Soi kèo', admin: true }).success).toBe(
      false,
    );
    expect(
      predictionChatRequestSchema.safeParse({
        message: 'Soi kèo',
        context: {
          activeProviderFixtureId: null,
          activeHomeTeamName: 'Injected team',
          activeAwayTeamName: null,
          lastIntent: null,
          turnCount: 0,
        },
      }).success,
    ).toBe(false);
  });
});
