import { describe, expect, it } from 'vitest';

import {
  dueV8PaperHorizons,
  v8PaperMarketType,
} from '../src/v8-paper-runtime-engine.js';

describe('Stage 8 v8 paper runtime', () => {
  it('emits only the independently due horizon', () => {
    const now = new Date('2026-01-01T10:00:00.000Z');
    expect(dueV8PaperHorizons(now, new Date('2026-01-01T10:30:00.000Z'))).toEqual([30]);
  });

  it('does not retroactively emit an earlier horizon', () => {
    const now = new Date('2026-01-01T10:00:00.000Z');
    expect(dueV8PaperHorizons(now, new Date('2026-01-01T10:12:30.000Z'), 2)).toEqual([]);
  });

  it('maps v8 market identities onto the existing paper settlement ledger', () => {
    expect(v8PaperMarketType('HDA')).toBe('MATCH_WINNER');
    expect(v8PaperMarketType('TOTAL_GOALS:2.5')).toBe('TOTAL_GOALS_2_5');
  });
});

