import { describe, expect, it } from 'vitest';

import {
  API_FOOTBALL_PREMATCH_HISTORY_DAYS,
  API_FOOTBALL_PROVIDER_VERSION,
  API_FOOTBALL_SUPPORTED_TOTAL_LINES,
  classifyApiFootballBetName,
  lastUtcDates,
  normalizeApiFootballFixtures,
  normalizeApiFootballPrematchOdds,
  parseApiFootballQuotaHeaders,
  parseApiFootballSelection,
  parseCommaSeparatedIds,
  utcDateString,
} from '../src/api-football-contract.js';

describe('v7.0-beta.1B API-Football contract', () => {
  it('uses a stable beta.1B provider version', () => {
    expect(API_FOOTBALL_PROVIDER_VERSION).toContain('beta.1B');
  });

  it('locks pre-match salvage window to 7 days', () => {
    expect(API_FOOTBALL_PREMATCH_HISTORY_DAYS).toBe(7);
  });

  it('supports total-goals 1.5, 2.0, 2.5, 3.0 and 3.5', () => {
    expect([...API_FOOTBALL_SUPPORTED_TOTAL_LINES]).toEqual([1.5, 2, 2.5, 3, 3.5]);
  });

  it('classifies Match Winner', () => {
    expect(classifyApiFootballBetName('Match Winner')).toBe('MATCH_WINNER');
  });

  it('classifies Fulltime Result as match winner alias', () => {
    expect(classifyApiFootballBetName('Fulltime Result')).toBe('MATCH_WINNER');
  });

  it('classifies Goals Over/Under', () => {
    expect(classifyApiFootballBetName('Goals Over/Under')).toBe('TOTAL_GOALS');
  });

  it('classifies Both Teams Score', () => {
    expect(classifyApiFootballBetName('Both Teams Score')).toBe('BTTS');
  });

  it('classifies Both Teams to Score alias', () => {
    expect(classifyApiFootballBetName('Both Teams to Score')).toBe('BTTS');
  });

  it('ignores unrelated market', () => {
    expect(classifyApiFootballBetName('Correct Score')).toBeNull();
  });

  it('parses HOME selection', () => {
    expect(parseApiFootballSelection('MATCH_WINNER', 'Home')).toEqual({
      selection: 'HOME',
      lineValue: null,
    });
  });

  it('parses DRAW selection', () => {
    expect(parseApiFootballSelection('MATCH_WINNER', 'Draw')).toEqual({
      selection: 'DRAW',
      lineValue: null,
    });
  });

  it('parses AWAY selection', () => {
    expect(parseApiFootballSelection('MATCH_WINNER', 'Away')).toEqual({
      selection: 'AWAY',
      lineValue: null,
    });
  });

  it('parses BTTS YES', () => {
    expect(parseApiFootballSelection('BTTS', 'Yes')).toEqual({
      selection: 'YES',
      lineValue: null,
    });
  });

  it('parses BTTS NO', () => {
    expect(parseApiFootballSelection('BTTS', 'No')).toEqual({
      selection: 'NO',
      lineValue: null,
    });
  });

  it('parses OVER 1.5', () => {
    expect(parseApiFootballSelection('TOTAL_GOALS', 'Over 1.5')).toEqual({
      selection: 'OVER',
      lineValue: 1.5,
    });
  });

  it('parses UNDER 2.5', () => {
    expect(parseApiFootballSelection('TOTAL_GOALS', 'Under 2.5')).toEqual({
      selection: 'UNDER',
      lineValue: 2.5,
    });
  });

  it('parses OVER 2.0', () => {
    expect(parseApiFootballSelection('TOTAL_GOALS', 'Over 2.0')).toEqual({
      selection: 'OVER',
      lineValue: 2,
    });
  });

  it('parses UNDER 3.0', () => {
    expect(parseApiFootballSelection('TOTAL_GOALS', 'Under 3.0')).toEqual({
      selection: 'UNDER',
      lineValue: 3,
    });
  });

  it('parses OVER 3.5', () => {
    expect(parseApiFootballSelection('TOTAL_GOALS', 'Over 3.5')).toEqual({
      selection: 'OVER',
      lineValue: 3.5,
    });
  });

  it('rejects unsupported O/U 4.5', () => {
    expect(parseApiFootballSelection('TOTAL_GOALS', 'Over 4.5')).toBeNull();
  });

  it('rejects malformed total value', () => {
    expect(parseApiFootballSelection('TOTAL_GOALS', 'Over')).toBeNull();
  });

  it('normalizes one pre-match response across all supported selections', () => {
    const payload = {
      response: [
        {
          league: {
            id: 39,
            season: 2026,
          },
          fixture: {
            id: 1001,
            date: '2026-07-25T18:00:00+00:00',
          },
          update: '2026-07-25T12:00:00+00:00',
          bookmakers: [
            {
              id: 8,
              name: 'Bet365',
              bets: [
                {
                  id: 1,
                  name: 'Match Winner',
                  values: [
                    { value: 'Home', odd: '1.80' },
                    { value: 'Draw', odd: '3.50' },
                    { value: 'Away', odd: '4.20' },
                  ],
                },
                {
                  id: 5,
                  name: 'Goals Over/Under',
                  values: [
                    { value: 'Over 1.5', odd: '1.30' },
                    { value: 'Under 1.5', odd: '3.30' },
                    { value: 'Over 2.0', odd: '1.55' },
                    { value: 'Under 2.0', odd: '2.35' },
                    { value: 'Over 2.5', odd: '1.90' },
                    { value: 'Under 2.5', odd: '1.90' },
                    { value: 'Over 3.0', odd: '2.40' },
                    { value: 'Under 3.0', odd: '1.62' },
                    { value: 'Over 3.5', odd: '3.10' },
                    { value: 'Under 3.5', odd: '1.35' },
                  ],
                },
                {
                  id: 8,
                  name: 'Both Teams Score',
                  values: [
                    { value: 'Yes', odd: '1.75' },
                    { value: 'No', odd: '2.00' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(
      normalizeApiFootballPrematchOdds(payload, new Date('2026-07-25T12:05:00Z')),
    ).toHaveLength(15);
  });

  it('marks fresh pre-kickoff odds PIT usable', () => {
    const rows = normalizeApiFootballPrematchOdds(
      {
        response: [
          {
            league: { id: 39, season: 2026 },
            fixture: {
              id: 1,
              date: '2026-07-25T18:00:00Z',
            },
            update: '2026-07-25T12:00:00Z',
            bookmakers: [
              {
                id: 1,
                name: 'Book',
                bets: [
                  {
                    id: 1,
                    name: 'Match Winner',
                    values: [{ value: 'Home', odd: '2.0' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      new Date('2026-07-25T12:05:00Z'),
    );

    expect(rows[0]?.pitUsable).toBe(true);
  });

  it('marks historical retrieval after kickoff non-fresh/PIT unusable', () => {
    const rows = normalizeApiFootballPrematchOdds(
      {
        response: [
          {
            league: { id: 39, season: 2026 },
            fixture: {
              id: 1,
              date: '2026-07-20T18:00:00Z',
            },
            update: '2026-07-20T12:00:00Z',
            bookmakers: [
              {
                id: 1,
                name: 'Book',
                bets: [
                  {
                    id: 1,
                    name: 'Match Winner',
                    values: [{ value: 'Home', odd: '2.0' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      new Date('2026-07-25T12:05:00Z'),
    );

    expect(rows[0]?.pitUsable).toBe(false);
  });

  it('marks odds without source update PIT unusable', () => {
    const rows = normalizeApiFootballPrematchOdds(
      {
        response: [
          {
            league: { id: 39, season: 2026 },
            fixture: {
              id: 1,
              date: '2026-07-25T18:00:00Z',
            },
            bookmakers: [
              {
                id: 1,
                name: 'Book',
                bets: [
                  {
                    id: 1,
                    name: 'Match Winner',
                    values: [{ value: 'Home', odd: '2.0' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      new Date('2026-07-25T12:05:00Z'),
    );

    expect(rows[0]?.pitUsable).toBe(false);
  });

  it('ignores invalid odds <= 1', () => {
    const rows = normalizeApiFootballPrematchOdds(
      {
        response: [
          {
            league: { id: 39, season: 2026 },
            fixture: {
              id: 1,
              date: '2026-07-25T18:00:00Z',
            },
            update: '2026-07-25T12:00:00Z',
            bookmakers: [
              {
                id: 1,
                name: 'Book',
                bets: [
                  {
                    id: 1,
                    name: 'Match Winner',
                    values: [{ value: 'Home', odd: '1.0' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      new Date('2026-07-25T12:05:00Z'),
    );

    expect(rows).toHaveLength(0);
  });

  it('ignores unsupported market rows', () => {
    const rows = normalizeApiFootballPrematchOdds(
      {
        response: [
          {
            league: { id: 39, season: 2026 },
            fixture: {
              id: 1,
              date: '2026-07-25T18:00:00Z',
            },
            update: '2026-07-25T12:00:00Z',
            bookmakers: [
              {
                id: 1,
                name: 'Book',
                bets: [
                  {
                    id: 99,
                    name: 'Correct Score',
                    values: [{ value: '1-0', odd: '5.0' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      new Date('2026-07-25T12:05:00Z'),
    );

    expect(rows).toHaveLength(0);
  });

  it('normalizes fixture identifiers and fulltime score', () => {
    const rows = normalizeApiFootballFixtures({
      response: [
        {
          fixture: {
            id: 123,
            date: '2026-07-25T18:00:00Z',
            status: {
              short: 'FT',
            },
          },
          league: {
            id: 39,
            season: 2026,
          },
          teams: {
            home: {
              id: 10,
              name: 'Home FC',
            },
            away: {
              id: 11,
              name: 'Away FC',
            },
          },
          goals: {
            home: 2,
            away: 1,
          },
          score: {
            fulltime: {
              home: 2,
              away: 1,
            },
          },
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      providerFixtureId: 123,
      providerLeagueId: 39,
      season: 2026,
      statusShort: 'FT',
      homeProviderTeamId: 10,
      awayProviderTeamId: 11,
      fulltimeHomeGoals: 2,
      fulltimeAwayGoals: 1,
    });
  });

  it('skips malformed fixture rows', () => {
    expect(
      normalizeApiFootballFixtures({
        response: [
          {
            fixture: {
              id: 1,
            },
          },
        ],
      }),
    ).toHaveLength(0);
  });

  it('parses all four rate-limit headers', () => {
    const values = new Map([
      ['x-ratelimit-requests-limit', '7500'],
      ['x-ratelimit-requests-remaining', '7400'],
      ['x-ratelimit-limit', '300'],
      ['x-ratelimit-remaining', '299'],
    ]);

    const result = parseApiFootballQuotaHeaders({
      get(name) {
        return values.get(name.toLowerCase()) ?? null;
      },
    });

    expect(result).toEqual({
      requestsLimitDay: 7500,
      requestsRemainingDay: 7400,
      rateLimitPerMinute: 300,
      rateRemainingPerMinute: 299,
    });
  });

  it('returns null for missing quota headers', () => {
    expect(
      parseApiFootballQuotaHeaders({
        get() {
          return null;
        },
      }),
    ).toEqual({
      requestsLimitDay: null,
      requestsRemainingDay: null,
      rateLimitPerMinute: null,
      rateRemainingPerMinute: null,
    });
  });

  it('parses comma-separated positive ids', () => {
    expect(parseCommaSeparatedIds('39,140,39')).toEqual([39, 140]);
  });

  it('returns empty ids for blank input', () => {
    expect(parseCommaSeparatedIds(' ')).toEqual([]);
  });

  it('rejects invalid comma-separated ids', () => {
    expect(() => parseCommaSeparatedIds('39,nope')).toThrow();
  });

  it('formats UTC date', () => {
    expect(utcDateString(new Date('2026-07-25T23:59:59Z'))).toBe('2026-07-25');
  });

  it('returns ordered last UTC dates', () => {
    expect(lastUtcDates(new Date('2026-07-25T12:00:00Z'), 3)).toEqual([
      '2026-07-23',
      '2026-07-24',
      '2026-07-25',
    ]);
  });

  it('rejects non-positive last-date count', () => {
    expect(() => lastUtcDates(new Date(), 0)).toThrow();
  });
});
