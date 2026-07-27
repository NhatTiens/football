import { describe, expect, it } from 'vitest';
import {
  classifyContextCheckpoint,
  getContextDueAt,
} from '../src/repeated-context-core.js';
import {
  injurySnapshotContentHash,
  normalizeInjurySnapshotRows,
} from '../src/context-snapshots.js';

describe('R5 repeated context core', () => {
  it('computes horizon due time exactly', () => {
    const kickoff = new Date('2026-08-01T12:00:00.000Z');
    expect(
      getContextDueAt(kickoff, 90).toISOString(),
    ).toBe('2026-08-01T10:30:00.000Z');
  });

  it('classifies early, due and missed windows', () => {
    const now = new Date('2026-08-01T10:30:00.000Z');
    expect(
      classifyContextCheckpoint({
        now,
        dueAt: new Date('2026-08-01T10:40:00.000Z'),
        dueLeadMinutes: 4,
        dueToleranceMinutes: 12,
      }),
    ).toBe('EARLY');

    expect(
      classifyContextCheckpoint({
        now,
        dueAt: new Date('2026-08-01T10:28:00.000Z'),
        dueLeadMinutes: 4,
        dueToleranceMinutes: 12,
      }),
    ).toBe('DUE');

    expect(
      classifyContextCheckpoint({
        now,
        dueAt: new Date('2026-08-01T10:00:00.000Z'),
        dueLeadMinutes: 4,
        dueToleranceMinutes: 12,
      }),
    ).toBe('MISSED');
  });

  it('creates deterministic injury snapshot hashes independent of input order', () => {
    const rows = [
      {
        teamId: 2,
        apiPlayerId: 22,
        playerName: ' B ',
        reason: 'Knock',
      },
      {
        teamId: 1,
        apiPlayerId: 11,
        playerName: 'A',
        reason: null,
      },
    ];

    const normalized = normalizeInjurySnapshotRows(rows);
    expect(normalized[0]?.teamId).toBe(1);
    expect(
      injurySnapshotContentHash(rows),
    ).toBe(injurySnapshotContentHash([...rows].reverse()));
  });
});
