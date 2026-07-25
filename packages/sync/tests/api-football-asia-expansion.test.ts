import { describe, expect, it } from 'vitest';

import {
  API_FOOTBALL_ASIA_COUNTRIES,
  API_FOOTBALL_SOUTHEAST_ASIA_COUNTRIES,
  apiFootballLeagueProfile,
  buildVietnamHorizonSchedule,
  classifyApiFootballLeagueRegion,
  parseApiFootballLeagueProfile,
} from '../src/api-football-contract.js';

function leagueRow(input: {
  id: number;
  name: string;
  country: string;
  type?: string;
  year?: number;
}) {
  return {
    league: {
      id: input.id,
      name: input.name,
      type: input.type ?? 'League',
      logo: `https://example.test/${input.id}.png`,
    },
    country: {
      name: input.country,
    },
    seasons: [
      {
        year: input.year ?? 2026,
        current: true,
        coverage: {
          odds: true,
        },
      },
    ],
  };
}

describe('beta.1B FE + Asia league expansion', () => {
  it('includes six Southeast Asia countries', () => {
    expect(API_FOOTBALL_SOUTHEAST_ASIA_COUNTRIES).toHaveLength(6);
  });

  it('includes ten wider Asia countries', () => {
    expect(API_FOOTBALL_ASIA_COUNTRIES).toHaveLength(10);
  });

  it('classifies Vietnam as Southeast Asia', () => {
    expect(
      classifyApiFootballLeagueRegion({
        leagueId: 99901,
        leagueName: 'V.League 1',
        countryName: 'Vietnam',
      }),
    ).toBe('SOUTHEAST_ASIA');
  });

  it('classifies Thailand as Southeast Asia', () => {
    expect(
      classifyApiFootballLeagueRegion({
        leagueId: 99902,
        leagueName: 'Thai League 1',
        countryName: 'Thailand',
      }),
    ).toBe('SOUTHEAST_ASIA');
  });

  it('classifies Indonesia as Southeast Asia', () => {
    expect(
      classifyApiFootballLeagueRegion({
        leagueId: 99903,
        leagueName: 'Liga 1',
        countryName: 'Indonesia',
      }),
    ).toBe('SOUTHEAST_ASIA');
  });

  it('classifies Japan as Asia', () => {
    expect(
      classifyApiFootballLeagueRegion({
        leagueId: 99904,
        leagueName: 'J1 League',
        countryName: 'Japan',
      }),
    ).toBe('ASIA');
  });

  it('supports South-Korea punctuation alias', () => {
    expect(
      classifyApiFootballLeagueRegion({
        leagueId: 99905,
        leagueName: 'K League 1',
        countryName: 'South-Korea',
      }),
    ).toBe('ASIA');
  });

  it('classifies AFC Champions League as AFC', () => {
    expect(
      classifyApiFootballLeagueRegion({
        leagueId: 99906,
        leagueName: 'AFC Champions League Elite',
        countryName: 'World',
      }),
    ).toBe('AFC');
  });

  it('keeps Premier League in global major profile', () => {
    expect(
      classifyApiFootballLeagueRegion({
        leagueId: 39,
        leagueName: 'Premier League',
        countryName: 'England',
      }),
    ).toBe('GLOBAL_MAJOR');
  });

  it('ignores unrelated South American league', () => {
    expect(
      classifyApiFootballLeagueRegion({
        leagueId: 88888,
        leagueName: 'Serie A',
        countryName: 'Brazil',
      }),
    ).toBeNull();
  });

  it('parses and groups live provider league payload', () => {
    const result = parseApiFootballLeagueProfile({
      response: [
        leagueRow({
          id: 39,
          name: 'Premier League',
          country: 'England',
        }),
        leagueRow({
          id: 7001,
          name: 'V.League 1',
          country: 'Vietnam',
        }),
        leagueRow({
          id: 7002,
          name: 'J1 League',
          country: 'Japan',
        }),
        leagueRow({
          id: 7003,
          name: 'AFC Champions League Elite',
          country: 'World',
          type: 'Cup',
        }),
        leagueRow({
          id: 7004,
          name: 'Serie A',
          country: 'Brazil',
        }),
      ],
    });

    expect(result.map((league) => league.group)).toEqual(
      expect.arrayContaining(['GLOBAL_MAJOR', 'SOUTHEAST_ASIA', 'ASIA', 'AFC']),
    );
    expect(result.some((league) => league.id === 7004)).toBe(false);
  });

  it('prioritizes Southeast Asia first-tier league above wider Asia league', () => {
    const result = parseApiFootballLeagueProfile({
      response: [
        leagueRow({
          id: 7101,
          name: 'J2 League',
          country: 'Japan',
        }),
        leagueRow({
          id: 7102,
          name: 'V.League 1',
          country: 'Vietnam',
        }),
      ],
    });

    expect(result[0]?.id).toBe(7102);
  });

  it('defaults the expanded profile to GLOBAL_ASIA', () => {
    delete process.env.API_FOOTBALL_LEAGUE_PROFILE;

    expect(apiFootballLeagueProfile()).toBe('GLOBAL_ASIA');
  });

  it('preserves Vietnam horizon conversion', () => {
    expect(buildVietnamHorizonSchedule(new Date('2026-07-25T18:00:00Z'))).toEqual({
      kickoffVietnam: '2026-07-26 01:00:00',
      t180Vietnam: '2026-07-25 22:00:00',
      t90Vietnam: '2026-07-25 23:30:00',
      t30Vietnam: '2026-07-26 00:30:00',
      t5Vietnam: '2026-07-26 00:55:00',
      timezone: 'Asia/Ho_Chi_Minh',
    });
  });
});
