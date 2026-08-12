import { describe, expect, it } from 'vitest';

import {
  selectPaperShadowHistoryCandidates,
  type CurrentSignalSnapshotRow,
} from '../src/shadow-settlement-report-cli.js';

function snapshot(analysisPayload: unknown): CurrentSignalSnapshotRow {
  return {
    id: 101,
    providerFixtureId: 9901,
    checkpointMinutes: 30,
    checkpointLabel: 'T-30',
    snapshotAsOf: new Date('2026-08-12T09:30:00.000Z'),
    kickoffAt: new Date('2026-08-12T10:00:00.000Z'),
    analysisPayload,
    snapshotHash: 'a'.repeat(64),
    createdAt: new Date('2026-08-12T09:30:01.000Z'),
  };
}

describe('paper shadow History fixture index', () => {
  it('does not count a raw NO_VALUE_SIGNAL snapshot as displayable History', () => {
    const selected = selectPaperShadowHistoryCandidates([
      snapshot({
        status: 'NO_VALUE_SIGNAL',
        recommendation: null,
      }),
    ]);

    expect(selected).toEqual([]);
  });

  it('indexes only a persisted, PIT-safe paper recommendation', () => {
    const selected = selectPaperShadowHistoryCandidates([
      snapshot({
        paperShadowRecommendation: {
          status: 'RAW_VALUE_SHADOW',
          pitSafe: true,
          automaticPromotion: false,
          automaticBetPlacement: false,
          realMoneyExecution: false,
          policy: { paperOnly: true },
          selected: {
            paperTrackEligible: true,
            stakeEligible: false,
            marketType: 'TOTAL_GOALS_2_5',
            selection: 'UNDER',
            lineValue: 2.5,
            decimalOdds: 1.91,
          },
        },
      }),
    ]);

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      providerFixtureId: 9901,
      marketType: 'TOTAL_GOALS_2_5',
      selection: 'UNDER',
      decisionSource: 'paperShadowRecommendation',
    });
  });
});
