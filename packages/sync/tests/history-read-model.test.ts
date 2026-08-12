import { describe, expect, it } from 'vitest';

import {
  historySummaryKey,
  isUserHistoryKickoffVisible,
  normalizeHistoryMarket,
  paginateHistoryFixtures,
  selectCanonicalHistoryRows,
} from '../src/history-read-model.js';

type Row = {
  id: string;
  fixture: number;
  source: 'PAPER_LEDGER' | 'PAPER_SHADOW';
  market: string;
  line: number | null;
  at: string;
  settled: boolean;
};

function candidate(row: Row) {
  return {
    row,
    providerFixtureId: row.fixture,
    source: row.source,
    market: row.market,
    lineValue: row.line,
    decisionAsOf: row.at,
    settled: row.settled,
  };
}

describe('canonical USER history read-model', () => {
  it('normalizes market aliases into the same key', () => {
    expect(normalizeHistoryMarket('TOTAL_GOALS_2_5')).toBe('TOTAL_GOALS');
    expect(normalizeHistoryMarket('Over Under')).toBe('TOTAL_GOALS');
    expect(historySummaryKey({ providerFixtureId: 7, market: 'OU', lineValue: 2.5 })).toBe(
      '7|TOTAL_GOALS|2.50',
    );
    expect(normalizeHistoryMarket('both team to score')).toBe('BTTS');
  });

  it('counts, sorts and paginates only the displayable fixture index', () => {
    const page = paginateHistoryFixtures(
      [
        { providerFixtureId: 7, kickoffAt: '2026-08-12T10:00:00.000Z' },
        { providerFixtureId: 7, kickoffAt: '2026-08-12T11:00:00.000Z' },
        { providerFixtureId: 8, kickoffAt: '2026-08-13T10:00:00.000Z' },
        { providerFixtureId: 9, kickoffAt: 'not-a-date' },
      ],
      1,
      1,
    );

    expect(page).toEqual({
      page: 1,
      pageSize: 1,
      totalFixtures: 2,
      totalPages: 2,
      hasPrevious: false,
      hasNext: true,
      providerFixtureIds: [8],
    });
  });

  it('returns an internally consistent empty page', () => {
    expect(paginateHistoryFixtures([], 99, 20)).toEqual({
      page: 1,
      pageSize: 20,
      totalFixtures: 0,
      totalPages: 1,
      hasPrevious: false,
      hasNext: false,
      providerFixtureIds: [],
    });
  });

  it('shows USER History only from 01/08/2026 through the report time in Vietnam', () => {
    const reportAsOf = new Date('2026-08-12T12:00:00.000Z');

    expect(isUserHistoryKickoffVisible('2026-07-31T16:59:59.999Z', reportAsOf)).toBe(false);
    expect(isUserHistoryKickoffVisible('2026-07-31T17:00:00.000Z', reportAsOf)).toBe(true);
    expect(isUserHistoryKickoffVisible('2026-08-12T12:00:00.001Z', reportAsOf)).toBe(false);
  });

  it('selects settled, then ledger, then newest without mutating audit rows', () => {
    const rows: Row[] = [
      {
        id: 'shadow:new',
        fixture: 7,
        source: 'PAPER_SHADOW',
        market: 'TOTAL_GOALS_2_5',
        line: 2.5,
        at: '2026-08-12T10:00:00.000Z',
        settled: false,
      },
      {
        id: 'ledger:settled',
        fixture: 7,
        source: 'PAPER_LEDGER',
        market: 'OU',
        line: 2.5,
        at: '2026-08-12T09:00:00.000Z',
        settled: true,
      },
      {
        id: 'shadow:btts',
        fixture: 7,
        source: 'PAPER_SHADOW',
        market: 'BOTH_TEAMS_TO_SCORE',
        line: null,
        at: '2026-08-12T08:00:00.000Z',
        settled: false,
      },
      {
        id: 'ledger:hda-hidden',
        fixture: 7,
        source: 'PAPER_LEDGER',
        market: 'MATCH_WINNER',
        line: null,
        at: '2026-08-12T11:00:00.000Z',
        settled: true,
      },
      {
        id: 'ledger:no-bet-hidden',
        fixture: 7,
        source: 'PAPER_LEDGER',
        market: '',
        line: null,
        at: '2026-08-12T12:00:00.000Z',
        settled: false,
      },
    ];

    const selected = selectCanonicalHistoryRows(rows.map(candidate));

    expect(selected.map((row) => row.id)).toEqual(['ledger:settled', 'shadow:btts']);
    expect(rows).toHaveLength(5);
  });
});
