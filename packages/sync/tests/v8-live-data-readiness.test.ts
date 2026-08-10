import { describe, expect, it } from 'vitest';
import { assessApiQuota } from '../src/v8-live-data-readiness.js';

describe('Stage 10 live data readiness', () => {
  it('does not recommend a paid upgrade when quota remains healthy', () => {
    expect(
      assessApiQuota({
        quotaAfter: { requestsLimitDay: 1000, requestsRemainingDay: 600 },
        failedRuns24h: 0,
      }).decision,
    ).toBe('KEEP_CURRENT_PLAN');
  });

  it('recommends review only when quota is exhausted and failures occur', () => {
    expect(
      assessApiQuota({
        quotaAfter: { requestsLimitDay: 1000, requestsRemainingDay: 20 },
        failedRuns24h: 3,
      }).decision,
    ).toBe('UPGRADE_RECOMMENDED');
  });
});

