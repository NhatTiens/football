import { describe, expect, it } from 'vitest';

import {
  automaticQuotaState,
  fixtureDiscoveryIntervalMinutes,
  forceScopeIncludes,
  normalizeForceScope,
  predictionRetryDelayMinutes,
  priorityReserveFloor,
  resultRetryDelayMinutes,
  shouldRunAutomaticPhase,
} from '../src/automatic-pipeline-core.js';

describe('automatic pipeline core', () => {
  it('increases fixture cadence as kickoff approaches', () => {
    expect(fixtureDiscoveryIntervalMinutes({ nearestKickoffMinutes: 60, quotaRemaining: 7000 })).toBe(10);
    expect(fixtureDiscoveryIntervalMinutes({ nearestKickoffMinutes: 600, quotaRemaining: 7000 })).toBe(30);
    expect(fixtureDiscoveryIntervalMinutes({ nearestKickoffMinutes: 2_000, quotaRemaining: 7000 })).toBe(90);
    expect(fixtureDiscoveryIntervalMinutes({ nearestKickoffMinutes: 10_000, quotaRemaining: 7000 })).toBe(360);
  });

  it('conserves provider calls when daily quota is under pressure', () => {
    expect(fixtureDiscoveryIntervalMinutes({ nearestKickoffMinutes: 60, quotaRemaining: 900 })).toBe(180);
    expect(fixtureDiscoveryIntervalMinutes({ nearestKickoffMinutes: 60, quotaRemaining: 300 })).toBe(360);
    expect(automaticQuotaState({ limit: 7500, remaining: 300 }).pressure).toBe('CRITICAL');
  });

  it('runs durable phases only when due unless explicitly forced', () => {
    expect(shouldRunAutomaticPhase({ nowMs: 1_000_000, lastSuccessMs: null, minimumIntervalMinutes: 60 })).toBe(true);
    expect(shouldRunAutomaticPhase({ nowMs: 10_000_000, lastSuccessMs: 9_000_000, minimumIntervalMinutes: 60 })).toBe(false);
    expect(shouldRunAutomaticPhase({ nowMs: 10_000_000, lastSuccessMs: 9_000_000, minimumIntervalMinutes: 60, forced: true })).toBe(true);
  });

  it('reserves quota for critical result calls before lower priorities', () => {
    expect(priorityReserveFloor('CRITICAL')).toBe(0);
    expect(priorityReserveFloor('HIGH')).toBeLessThan(priorityReserveFloor('NORMAL'));
    expect(priorityReserveFloor('NORMAL')).toBeLessThan(priorityReserveFloor('LOW'));
  });

  it('uses bounded result retry backoff', () => {
    expect(resultRetryDelayMinutes(1)).toBe(7);
    expect(resultRetryDelayMinutes(2)).toBe(10);
    expect(resultRetryDelayMinutes(7)).toBe(60);
    expect(resultRetryDelayMinutes(99)).toBe(60);
  });

  it('backs off prediction-provider retries instead of retrying every scheduler tick', () => {
    expect(predictionRetryDelayMinutes(1)).toBe(5);
    expect(predictionRetryDelayMinutes(2)).toBe(10);
    expect(predictionRetryDelayMinutes(5)).toBe(60);
    expect(predictionRetryDelayMinutes(99)).toBe(180);
  });

  it('normalizes force-sync scopes safely', () => {
    expect(normalizeForceScope('predictions')).toBe('PREDICTIONS');
    expect(normalizeForceScope('unexpected')).toBe('FULL');
    expect(forceScopeIncludes('FULL', 'ODDS')).toBe(true);
    expect(forceScopeIncludes('FIXTURES', 'PREDICTIONS')).toBe(false);
  });
});
