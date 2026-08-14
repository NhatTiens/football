import { describe, expect, it, vi } from 'vitest';

import { runProductionScientificLiveCycle } from '../src/production-scientific-cycle.js';

describe('production scientific live cycle', () => {
  it('collects context and odds before capturing history and deciding', async () => {
    const order: string[] = [];
    const operation = (name: string) =>
      vi.fn(async () => {
        order.push(name);
        return { name };
      });
    const now = new Date('2026-08-14T05:00:00.000Z');

    const result = await runProductionScientificLiveCycle({
      now,
      operations: {
        syncContext: operation('context') as never,
        collectFreshOdds: operation('odds') as never,
        captureSnapshots: operation('snapshots') as never,
        createPaperDecisions: operation('decisions') as never,
      },
    });

    expect(order).toEqual(['context', 'odds', 'snapshots', 'decisions']);
    expect(result).toMatchObject({
      event: 'PRODUCTION_SCIENTIFIC_LIVE_CYCLE',
      executedAt: '2026-08-14T05:00:00.000Z',
      safety: {
        paperOnly: true,
        automaticBetPlacement: false,
        realMoneyExecution: false,
      },
    });
  });
});
