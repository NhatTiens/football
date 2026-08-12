import { afterEach, describe, expect, it } from 'vitest';

import { predictionChatFreshnessCooldownMs } from '../src/prediction-chatbot-freshness';

const original = process.env.PREDICTION_CHAT_FRESHNESS_COOLDOWN_SECONDS;

afterEach(() => {
  if (original == null) {
    delete process.env.PREDICTION_CHAT_FRESHNESS_COOLDOWN_SECONDS;
  } else {
    process.env.PREDICTION_CHAT_FRESHNESS_COOLDOWN_SECONDS = original;
  }
});

describe('prediction chatbot freshness policy', () => {
  it('defaults to 60 seconds', () => {
    expect(predictionChatFreshnessCooldownMs(undefined)).toBe(60_000);
  });

  it('clamps low values to 30 seconds', () => {
    expect(predictionChatFreshnessCooldownMs('5')).toBe(30_000);
  });

  it('clamps high values to 300 seconds', () => {
    expect(predictionChatFreshnessCooldownMs('999')).toBe(300_000);
  });

  it('accepts configured values in range', () => {
    expect(predictionChatFreshnessCooldownMs('90')).toBe(90_000);
  });
});
