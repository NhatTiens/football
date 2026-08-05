import { describe, expect, it } from 'vitest';

import { replayLegacyOuHistorySelection } from '../src/ou-legacy-history-replay-core.js';
import {
  type PaperOuLine,
  type PaperOuSelection,
  type PaperOuSourceLine,
} from '../src/paper-ou-opposite-line-core.js';

describe('legacy O/U history PIT replay', () => {
  const cases: Array<{
    sourceSelection: PaperOuSelection;
    sourceLine: PaperOuSourceLine;
    targetSelection: PaperOuSelection;
    targetLine: PaperOuLine;
  }> = [
    { sourceSelection: 'OVER', sourceLine: 1.5, targetSelection: 'UNDER', targetLine: 2 },
    { sourceSelection: 'OVER', sourceLine: 2.5, targetSelection: 'UNDER', targetLine: 3 },
    { sourceSelection: 'OVER', sourceLine: 3.5, targetSelection: 'UNDER', targetLine: 3.5 },
    { sourceSelection: 'UNDER', sourceLine: 1.5, targetSelection: 'OVER', targetLine: 1.5 },
    { sourceSelection: 'UNDER', sourceLine: 2.5, targetSelection: 'OVER', targetLine: 2 },
    { sourceSelection: 'UNDER', sourceLine: 3.5, targetSelection: 'OVER', targetLine: 3 },
  ];

  it.each(cases)(
    '$sourceSelection $sourceLine -> $targetSelection $targetLine using the target PIT quote',
    ({ sourceSelection, sourceLine, targetSelection, targetLine }) => {
      const sourceMarket = 'TOTAL_GOALS_' + String(sourceLine).replace('.', '_');
      const targetMarket = sourceMarket;
      const replayed = replayLegacyOuHistorySelection({
        selected: {
          marketType: sourceMarket,
          selection: sourceSelection,
          lineValue: sourceLine,
          decimalOdds: 4.99,
          modelProbability: 0.61,
          paperTrackEligible: true,
          stakeEligible: false,
          status: 'PAPER',
        },
        analysisCandidates: [
          {
            marketType: sourceMarket,
            selection: sourceSelection,
            lineValue: sourceLine,
            decimalOdds: 4.99,
            modelProbability: 0.61,
          },
          {
            marketType: targetMarket,
            selection: targetSelection,
            lineValue: targetLine,
            decimalOdds: 1.73,
            bookmakerName: 'PIT Bookmaker',
            sourceOddsSnapshotId: 987,
            modelProbability: 0.72,
            fairMarketProbability: 0.68,
            edge: 0.04,
            expectedValue: 0.2456,
          },
        ],
      });

      expect(replayed).not.toBeNull();
      expect(replayed?.marketType).toBe(targetMarket);
      expect(replayed?.selection).toBe(targetSelection);
      expect(replayed?.lineValue).toBe(targetLine);
      expect(replayed?.decimalOdds).toBe(1.73);
      expect(replayed?.sourceOddsSnapshotId).toBe(987);
      expect(replayed?.ouOppositeLineStrategy).toMatchObject({
        predictionSelection: sourceSelection,
        predictionLineValue: sourceLine,
        predictionProbability: 0.61,
        recommendedSelection: targetSelection,
        recommendedLineValue: targetLine,
      });
    },
  );

  it('accepts a neighboring legacy market alias for an exact integer target line', () => {
    const replayed = replayLegacyOuHistorySelection({
      selected: {
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'UNDER',
        lineValue: 2.5,
        decimalOdds: 2.1,
        modelProbability: 0.61,
        paperTrackEligible: true,
        stakeEligible: false,
      },
      analysisCandidates: [
        {
          marketType: 'TOTAL_GOALS_1_5',
          selection: 'OVER',
          lineValue: 2,
          decimalOdds: 1.73,
          sourceOddsSnapshotId: 987,
        },
      ],
    });

    expect(replayed).not.toBeNull();
    expect(replayed?.marketType).toBe('TOTAL_GOALS_2_5');
    expect(replayed?.selection).toBe('OVER');
    expect(replayed?.lineValue).toBe(2);
    expect(replayed?.decimalOdds).toBe(1.73);
    expect(replayed?.legacyOuHistoryReplay).toMatchObject({
      observedTargetMarketType: 'TOTAL_GOALS_1_5',
      marketAliasFallbackUsed: true,
    });
  });

  it('does not invent odds when the exact target candidate is absent', () => {
    expect(
      replayLegacyOuHistorySelection({
        selected: {
          marketType: 'TOTAL_GOALS_2_5',
          selection: 'UNDER',
          lineValue: 2.5,
          decimalOdds: 2.1,
          paperTrackEligible: true,
          stakeEligible: false,
        },
        analysisCandidates: [],
      }),
    ).toBeNull();
  });
});
