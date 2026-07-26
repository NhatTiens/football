import { describe, expect, it } from 'vitest';

import {
  deterministicBookmakerNamespaceId,
  findStrictHistoricalEvent,
  historicalSnapshotRequestAt,
  mapHistoricalSnapshotToRows,
  normalizeTeamName,
  teamNameScore,
  type HistoricalOddsTarget,
  type TheOddsApiHistoricalResponse,
} from '../src/historical-real-odds-backfill-core.js';

const target: HistoricalOddsTarget = {
  fixtureId: 10,
  providerFixtureId: 9001,
  providerLeagueId: 39,
  season: 2023,
  leagueName: 'Premier League',
  country: 'England',
  homeTeamName: 'Manchester City FC',
  awayTeamName: 'Liverpool FC',
  kickoffAt: new Date('2023-04-01T11:30:00.000Z'),
  decisionAsOf: new Date('2023-04-01T10:00:00.000Z'),
  sportKey: 'soccer_epl',
};

const response: TheOddsApiHistoricalResponse = {
  timestamp: '2023-04-01T10:00:00.000Z',
  data: [
    {
      id: 'evt-1',
      sport_key: 'soccer_epl',
      commence_time: '2023-04-01T11:30:00.000Z',
      home_team: 'Manchester City',
      away_team: 'Liverpool',
      bookmakers: [
        {
          key: 'book-a',
          title: 'Book A',
          last_update: '2023-04-01T09:59:00.000Z',
          markets: [
            {
              key: 'h2h',
              last_update: '2023-04-01T09:59:00.000Z',
              outcomes: [
                { name: 'Manchester City', price: 1.8 },
                { name: 'Liverpool', price: 4.5 },
                { name: 'Draw', price: 3.8 },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('beta.1B.2a historical real-odds backfill core', () => {
  it('normalizes common football club suffixes without inventing aliases', () => {
    expect(normalizeTeamName('Manchester City FC')).toBe('manchester city');
    expect(teamNameScore('Manchester City FC', 'Manchester City')).toBe(1);
  });

  it('strictly maps home/away and kickoff to one historical provider event', () => {
    const match = findStrictHistoricalEvent({ target, events: response.data });
    expect(match.status).toBe('MATCHED');
    expect(match.event?.id).toBe('evt-1');
  });

  it('does not accept a home/away swap', () => {
    const swapped = [{ ...response.data[0]!, home_team: 'Liverpool', away_team: 'Manchester City' }];
    const match = findStrictHistoricalEvent({ target, events: swapped });
    expect(match.status).toBe('NO_MATCH');
  });

  it('floors historical requests to a provider snapshot cadence without future leakage', () => {
    const request = historicalSnapshotRequestAt(new Date('2023-04-01T10:03:59.000Z'));
    expect(request.toISOString()).toBe('2023-04-01T10:00:00.000Z');
    expect(request.getTime()).toBeLessThanOrEqual(new Date('2023-04-01T10:03:59.000Z').getTime());
  });

  it('uses a deterministic negative bookmaker namespace', () => {
    expect(deterministicBookmakerNamespaceId('book-a')).toBe(deterministicBookmakerNamespaceId('book-a'));
    expect(deterministicBookmakerNamespaceId('book-a')).toBeLessThan(0);
  });

  it('maps only complete real 1X2 bookmaker states and marks them PIT usable', () => {
    const rows = mapHistoricalSnapshotToRows({
      target,
      response,
      matchedEvent: response.data[0]!,
      ingestedAt: new Date('2026-07-25T12:00:00.000Z'),
    });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.selection))).toEqual(new Set(['HOME', 'DRAW', 'AWAY']));
    expect(rows.every((row) => row.pitUsable)).toBe(true);
    expect(rows.every((row) => row.observedAt.getUTCFullYear() === 2026)).toBe(true);
    expect(rows.every((row) => row.sourceSnapshotAt.getUTCFullYear() === 2023)).toBe(true);
  });

  it('rejects a provider snapshot after decisionAsOf from PIT eligibility', () => {
    const future: TheOddsApiHistoricalResponse = { ...response, timestamp: '2023-04-01T10:05:00.000Z' };
    const rows = mapHistoricalSnapshotToRows({
      target,
      response: future,
      matchedEvent: future.data[0]!,
      ingestedAt: new Date('2026-07-25T12:00:00.000Z'),
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => !row.pitUsable)).toBe(true);
  });
});
