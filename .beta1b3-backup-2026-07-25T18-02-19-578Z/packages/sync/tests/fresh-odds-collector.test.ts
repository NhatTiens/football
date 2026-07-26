import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRESH_ODDS_HORIZONS_MINUTES,
  classifyFreshOddsWindow,
  evaluateFreshOddsQuota,
  freshOddsDueAt,
  freshOddsHorizonLabel,
  isClosingProxyHorizon,
  parseFreshOddsHorizons,
  sourceAgeMinutes,
  summarizeSourceAges,
} from '../src/fresh-odds-collector-core.js';

describe('beta.1B.3 fresh odds collector core', () => {
  it('uses the scientific fresh horizons including T-5 closing proxy', () => {
    expect(DEFAULT_FRESH_ODDS_HORIZONS_MINUTES).toEqual([180, 90, 30, 10, 5]);
    expect(freshOddsHorizonLabel(180)).toBe('T-180');
    expect(freshOddsHorizonLabel(5)).toBe('CLOSING_PROXY_T5');
    expect(isClosingProxyHorizon(5)).toBe(true);
  });

  it('parses, deduplicates and sorts horizons', () => {
    expect(parseFreshOddsHorizons('10,180,5,90,10,30')).toEqual([180, 90, 30, 10, 5]);
  });

  it('computes due times before kickoff', () => {
    const kickoff = new Date('2026-08-01T15:00:00.000Z');
    expect(freshOddsDueAt(kickoff, 90).toISOString()).toBe('2026-08-01T13:30:00.000Z');
  });

  it('classifies due windows without allowing post-kickoff capture', () => {
    const kickoffAt = new Date('2026-08-01T15:00:00.000Z');
    const dueAt = freshOddsDueAt(kickoffAt, 10);
    expect(classifyFreshOddsWindow({ now: new Date('2026-08-01T14:49:30.000Z'), kickoffAt, dueAt, leadMinutes: 1, toleranceMinutes: 8 })).toBe('DUE');
    expect(classifyFreshOddsWindow({ now: new Date('2026-08-01T15:00:00.000Z'), kickoffAt, dueAt, leadMinutes: 1, toleranceMinutes: 8 })).toBe('AFTER_KICKOFF');
  });

  it('blocks collection when daily quota reaches reserve', () => {
    expect(evaluateFreshOddsQuota({ observation: { requestsRemainingDay: 500, rateRemainingPerMinute: 50 }, dailyReserve: 500, minuteReserve: 5 })).toEqual({ allowed: false, reason: 'DAILY_RESERVE' });
  });

  it('blocks collection when minute quota reaches reserve', () => {
    expect(evaluateFreshOddsQuota({ observation: { requestsRemainingDay: 7000, rateRemainingPerMinute: 5 }, dailyReserve: 500, minuteReserve: 5 })).toEqual({ allowed: false, reason: 'MINUTE_RESERVE' });
  });

  it('allows collection when quota is safely above reserves', () => {
    expect(evaluateFreshOddsQuota({ observation: { requestsRemainingDay: 7000, rateRemainingPerMinute: 50 }, dailyReserve: 500, minuteReserve: 5 })).toEqual({ allowed: true, reason: 'OK' });
  });

  it('measures provider source age rather than pretending T-5 is true closing', () => {
    expect(sourceAgeMinutes({ observedAt: new Date('2026-08-01T14:55:00.000Z'), sourceUpdatedAt: new Date('2026-08-01T12:00:00.000Z') })).toBe(175);
  });

  it('summarizes known source ages while preserving missing timestamps', () => {
    expect(summarizeSourceAges([10, 20, null, 30])).toEqual({ rows: 4, knownRows: 3, minimumMinutes: 10, maximumMinutes: 30, averageMinutes: 20 });
  });
});
