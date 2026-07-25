import { describe, expect, it } from 'vitest';

import {
  API_FOOTBALL_DEFAULT_TIMEZONE,
  API_FOOTBALL_MAJOR_8_LEAGUE_IDS,
  apiFootballTimezone,
  buildVietnamHorizonSchedule,
  dateStringInTimeZone,
  formatDateTimeInTimeZone,
  lastDatesInTimeZone,
  resolveApiFootballLeagueIds,
} from '../src/api-football-contract.js';

describe('beta.1B hotfix expanded leagues + Vietnam time', () => {
  it('defaults to Asia/Ho_Chi_Minh', () => {
    delete process.env.API_FOOTBALL_TIMEZONE;
    expect(apiFootballTimezone()).toBe(API_FOOTBALL_DEFAULT_TIMEZONE);
  });

  it('supports overriding provider timezone', () => {
    process.env.API_FOOTBALL_TIMEZONE = 'Europe/London';
    expect(apiFootballTimezone()).toBe('Europe/London');
    delete process.env.API_FOOTBALL_TIMEZONE;
  });

  it('defines eight default competitions', () => {
    expect(API_FOOTBALL_MAJOR_8_LEAGUE_IDS).toHaveLength(8);
  });

  it('uses MAJOR_8 by default', () => {
    delete process.env.API_FOOTBALL_LEAGUE_PROFILE;
    delete process.env.API_FOOTBALL_LEAGUE_IDS;

    expect(resolveApiFootballLeagueIds()).toEqual([...API_FOOTBALL_MAJOR_8_LEAGUE_IDS]);
  });

  it('merges custom league ids with default profile', () => {
    delete process.env.API_FOOTBALL_LEAGUE_PROFILE;
    process.env.API_FOOTBALL_LEAGUE_IDS = '999,39';

    const ids = resolveApiFootballLeagueIds();

    expect(ids).toContain(999);
    expect(ids.filter((id) => id === 39)).toHaveLength(1);

    delete process.env.API_FOOTBALL_LEAGUE_IDS;
  });

  it('allows fully custom league list with NONE profile', () => {
    process.env.API_FOOTBALL_LEAGUE_PROFILE = 'NONE';
    process.env.API_FOOTBALL_LEAGUE_IDS = '39,140';

    expect(resolveApiFootballLeagueIds()).toEqual([39, 140]);

    delete process.env.API_FOOTBALL_LEAGUE_PROFILE;
    delete process.env.API_FOOTBALL_LEAGUE_IDS;
  });

  it('rejects unknown league profile', () => {
    process.env.API_FOOTBALL_LEAGUE_PROFILE = 'ALL_WORLD';

    expect(() => resolveApiFootballLeagueIds()).toThrow();

    delete process.env.API_FOOTBALL_LEAGUE_PROFILE;
  });

  it('formats UTC midnight to Vietnam morning', () => {
    expect(formatDateTimeInTimeZone(new Date('2026-07-25T00:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe(
      '2026-07-25 07:00:00',
    );
  });

  it('formats UTC evening into next Vietnam date', () => {
    expect(dateStringInTimeZone(new Date('2026-07-25T20:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe(
      '2026-07-26',
    );
  });

  it('returns Vietnam-local dates in chronological order', () => {
    expect(lastDatesInTimeZone(new Date('2026-07-25T20:00:00Z'), 3, 'Asia/Ho_Chi_Minh')).toEqual([
      '2026-07-24',
      '2026-07-25',
      '2026-07-26',
    ]);
  });

  it('builds T-180/T-90/T-30/T-5 in Vietnam time', () => {
    const result = buildVietnamHorizonSchedule(new Date('2026-07-25T18:00:00Z'));

    expect(result).toEqual({
      kickoffVietnam: '2026-07-26 01:00:00',
      t180Vietnam: '2026-07-25 22:00:00',
      t90Vietnam: '2026-07-25 23:30:00',
      t30Vietnam: '2026-07-26 00:30:00',
      t5Vietnam: '2026-07-26 00:55:00',
      timezone: 'Asia/Ho_Chi_Minh',
    });
  });

  it('keeps schedule conversion independent from stored UTC instant', () => {
    const kickoff = new Date('2026-07-25T18:00:00Z');
    buildVietnamHorizonSchedule(kickoff);

    expect(kickoff.toISOString()).toBe('2026-07-25T18:00:00.000Z');
  });
});
