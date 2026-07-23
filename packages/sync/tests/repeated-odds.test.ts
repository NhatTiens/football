import { describe, expect, it } from 'vitest';

import {
  buildRepeatedOddsCheckpointKey,
  classifyRepeatedOddsWindow,
  evaluateRepeatedOddsQuota,
  getRepeatedOddsDueAt,
  parseRepeatedOddsHorizons,
  resolveRepeatedOddsOutcome,
} from '../src/repeated-odds-core.js';

describe('repeated odds collection core', () => {
  it('parses unique horizons in descending order', () => {
    expect(parseRepeatedOddsHorizons('90,1440,30,90,360,10')).toEqual([1440, 360, 90, 30, 10]);
  });

  it('rejects invalid horizons', () => {
    expect(() => parseRepeatedOddsHorizons('90,0,30')).toThrow(/integer >= 1/);
  });

  it('computes a deterministic due time', () => {
    const kickoff = new Date('2026-08-01T20:00:00.000Z');

    expect(getRepeatedOddsDueAt(kickoff, 90).toISOString()).toBe('2026-08-01T18:30:00.000Z');
  });

  it('builds a stable checkpoint key', () => {
    expect(buildRepeatedOddsCheckpointKey(124, 90)).toBe('124:T-90');
  });

  it('does not collect before the lead window', () => {
    expect(
      classifyRepeatedOddsWindow({
        now: new Date('2026-08-01T18:27:59.000Z'),
        kickoffAt: new Date('2026-08-01T20:00:00.000Z'),
        dueAt: new Date('2026-08-01T18:30:00.000Z'),
        dueToleranceMinutes: 12,
        dueLeadMinutes: 2,
      }),
    ).toBe('NOT_DUE');
  });

  it('collects inside the horizon window', () => {
    expect(
      classifyRepeatedOddsWindow({
        now: new Date('2026-08-01T18:35:00.000Z'),
        kickoffAt: new Date('2026-08-01T20:00:00.000Z'),
        dueAt: new Date('2026-08-01T18:30:00.000Z'),
        dueToleranceMinutes: 12,
        dueLeadMinutes: 2,
      }),
    ).toBe('DUE');
  });

  it('marks a missed horizon after tolerance', () => {
    expect(
      classifyRepeatedOddsWindow({
        now: new Date('2026-08-01T18:43:00.000Z'),
        kickoffAt: new Date('2026-08-01T20:00:00.000Z'),
        dueAt: new Date('2026-08-01T18:30:00.000Z'),
        dueToleranceMinutes: 12,
        dueLeadMinutes: 2,
      }),
    ).toBe('MISSED');
  });

  it('blocks collection at kickoff', () => {
    expect(
      classifyRepeatedOddsWindow({
        now: new Date('2026-08-01T20:00:00.000Z'),
        kickoffAt: new Date('2026-08-01T20:00:00.000Z'),
        dueAt: new Date('2026-08-01T19:50:00.000Z'),
        dueToleranceMinutes: 12,
        dueLeadMinutes: 2,
      }),
    ).toBe('AFTER_KICKOFF');
  });

  it('reserves the daily API quota', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');

    expect(
      evaluateRepeatedOddsQuota({
        now,
        observation: {
          requestDate: now,
          dailyRemaining: 50,
          minuteRemaining: 10,
        },
        dailyRequestReserve: 50,
        minuteRequestReserve: 2,
      }),
    ).toEqual({
      allowed: false,
      reason: 'DAILY_RESERVE',
    });
  });

  it('ignores stale minute quota information', () => {
    const now = new Date('2026-08-01T12:05:00.000Z');

    expect(
      evaluateRepeatedOddsQuota({
        now,
        observation: {
          requestDate: new Date('2026-08-01T12:00:00.000Z'),
          dailyRemaining: 500,
          minuteRemaining: 0,
        },
        dailyRequestReserve: 50,
        minuteRequestReserve: 2,
      }),
    ).toEqual({
      allowed: true,
      reason: 'OK',
    });
  });

  it('marks a checked unchanged market as success', () => {
    const outcome = resolveRepeatedOddsOutcome({
      now: new Date('2026-08-01T18:30:00.000Z'),
      dueAt: new Date('2026-08-01T18:30:00.000Z'),
      dueToleranceMinutes: 12,
      attempts: 1,
      maximumAttempts: 3,
      retryMinutes: 4,
      processed: 9,
    });

    expect(outcome.status).toBe('SUCCESS');
    expect(outcome.completedAt).not.toBeNull();
  });

  it('retries an empty API response inside the window', () => {
    const outcome = resolveRepeatedOddsOutcome({
      now: new Date('2026-08-01T18:31:00.000Z'),
      dueAt: new Date('2026-08-01T18:30:00.000Z'),
      dueToleranceMinutes: 12,
      attempts: 1,
      maximumAttempts: 3,
      retryMinutes: 4,
      processed: 0,
    });

    expect(outcome.status).toBe('RETRY');
    expect(outcome.nextRetryAt?.toISOString()).toBe('2026-08-01T18:35:00.000Z');
  });

  it('finishes empty after exhausting attempts', () => {
    const outcome = resolveRepeatedOddsOutcome({
      now: new Date('2026-08-01T18:35:00.000Z'),
      dueAt: new Date('2026-08-01T18:30:00.000Z'),
      dueToleranceMinutes: 12,
      attempts: 3,
      maximumAttempts: 3,
      retryMinutes: 4,
      processed: 0,
    });

    expect(outcome.status).toBe('EMPTY');
    expect(outcome.completedAt).not.toBeNull();
  });

  it('finishes failed after the final API error', () => {
    const outcome = resolveRepeatedOddsOutcome({
      now: new Date('2026-08-01T18:42:00.000Z'),
      dueAt: new Date('2026-08-01T18:30:00.000Z'),
      dueToleranceMinutes: 12,
      attempts: 2,
      maximumAttempts: 3,
      retryMinutes: 4,
      processed: 0,
      errorMessage: 'API unavailable',
    });

    expect(outcome.status).toBe('FAILED');
    expect(outcome.errorMessage).toBe('API unavailable');
  });
});
