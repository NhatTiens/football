import { describe, expect, it } from 'vitest';

import {
  aggregateShadowSettlements,
  settleShadowCandidate,
} from '../src/shadow-settlement-core.js';

describe('paper shadow model-source reliability', () => {
  it('keeps model lineage in paper-only reliability groups', () => {
    const row = settleShadowCandidate({
      candidate: {
        snapshotId: 301,
        snapshotHash: 'c'.repeat(64),
        providerFixtureId: 9301,
        checkpointMinutes: 90,
        checkpointLabel: 'T-90',
        snapshotAsOf: new Date('2026-07-30T10:30:00.000Z'),
        kickoffAt: new Date('2026-07-30T12:00:00.000Z'),
        marketType: 'MATCH_WINNER',
        selection: 'HOME',
        lineValue: null,
        decimalOdds: 2.1,
        bookmakerName: 'Paper Book',
        sourceOddsSnapshotId: 401,
        sourceOddsObservedAt: new Date('2026-07-30T10:29:00.000Z'),
        modelSource: 'SCIENTIFIC_BASELINE_FALLBACK',
        modelVersion: 'baseline-v1',
        paperRecommendationVersion: 'paper-shadow-v1',
        shadowTier: 'RAW_VALUE_SHADOW',
        decisionSource: 'paperShadowRecommendation',
      },
      outcomeSnapshots: [
        {
          id: 501,
          providerFixtureId: 9301,
          statusShort: 'FT',
          observedAt: new Date('2026-07-30T14:00:00.000Z'),
          fulltimeHomeGoals: 2,
          fulltimeAwayGoals: 0,
        },
      ],
      closingOddsSnapshots: [],
      reportAsOf: new Date('2026-07-30T18:00:00.000Z'),
    });
    const report = aggregateShadowSettlements([row]);

    expect(row.modelSource).toBe('SCIENTIFIC_BASELINE_FALLBACK');
    expect(row.paperRecommendationVersion).toBe('paper-shadow-v1');
    expect(report.byModelSource.map((group) => group.key)).toEqual([
      'SCIENTIFIC_BASELINE_FALLBACK',
    ]);
    expect(report.byModelSourceMarketAndHorizon[0]?.key).toBe(
      'SCIENTIFIC_BASELINE_FALLBACK:MATCH_WINNER:T-90',
    );
    expect(report.byModelSourceMarketAndHorizon[0]?.settled).toBe(1);
    expect(report.automaticPromotion).toBe(false);
  });
});
