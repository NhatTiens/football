import { describe, expect, it } from 'vitest';

import {
  historySummaryKey,
  normalizeHistoryMarket,
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
    expect(
      historySummaryKey({ providerFixtureId: 7, market: 'OU', lineValue: 2.5 }),
    ).toBe('7|TOTAL_GOALS|2.50');
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

    expect(selected.map((row) => row.id)).toEqual([
      'ledger:settled',
      'shadow:btts',
    ]);
    expect(rows).toHaveLength(5);
  });
});
