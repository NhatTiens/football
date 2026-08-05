import { describe, expect, it } from 'vitest';

import {
  PAPER_OU_OPPOSITE_LINE_VERSION,
  derivePaperOuTargetProbabilities,
  mapPaperOuPredictionToOppositeLine,
  type PaperOuSelection,
  type PaperOuSourceLine,
} from '../src/paper-ou-opposite-line-core.js';
import { settlePaperBetSelection } from '../src/paper-bet-ledger-core.js';

describe('O/U opposite half-goal rule', () => {
  const cases: Array<{
    sourceSelection: PaperOuSelection;
    sourceLine: PaperOuSourceLine;
    targetSelection: PaperOuSelection;
    targetLine: number;
  }> = [
    {
      sourceSelection: 'OVER',
      sourceLine: 1.5,
      targetSelection: 'UNDER',
      targetLine: 2,
    },
    {
      sourceSelection: 'OVER',
      sourceLine: 2.5,
      targetSelection: 'UNDER',
      targetLine: 3,
    },
    {
      sourceSelection: 'OVER',
      sourceLine: 3.5,
      targetSelection: 'UNDER',
      targetLine: 3.5,
    },
    {
      sourceSelection: 'UNDER',
      sourceLine: 1.5,
      targetSelection: 'OVER',
      targetLine: 1.5,
    },
    {
      sourceSelection: 'UNDER',
      sourceLine: 2.5,
      targetSelection: 'OVER',
      targetLine: 2,
    },
    {
      sourceSelection: 'UNDER',
      sourceLine: 3.5,
      targetSelection: 'OVER',
      targetLine: 3,
    },
  ];

  for (const row of cases) {
    it(`${row.sourceSelection} ${row.sourceLine} -> ${row.targetSelection} ${row.targetLine}`, () => {
      const mapping = mapPaperOuPredictionToOppositeLine({
        predictionSelection: row.sourceSelection,
        predictionLineValue: row.sourceLine,
      });

      expect(mapping.version).toBe(PAPER_OU_OPPOSITE_LINE_VERSION);
      expect(mapping.recommendedSelection).toBe(row.targetSelection);
      expect(mapping.recommendedLineValue).toBe(row.targetLine);
      expect(mapping.lineShiftGoals).toBe(row.targetLine === row.sourceLine ? 0 : 0.5);
    });
  }

  it('derives push-aware effective probability for Under 3.0', () => {
    const mapping = mapPaperOuPredictionToOppositeLine({
      predictionSelection: 'OVER',
      predictionLineValue: 2.5,
    });
    const result = derivePaperOuTargetProbabilities({
      mapping,
      underProbabilities: {
        line1_5: 0.25,
        line2_5: 0.55,
        line3_5: 0.75,
      },
      decimalOdds: 1.9,
    });

    expect(result.winProbability).toBeCloseTo(0.55, 12);
    expect(result.pushProbability).toBeCloseTo(0.2, 12);
    expect(result.lossProbability).toBeCloseTo(0.25, 12);
    expect(result.effectiveProbability).toBeCloseTo(0.55 + 0.2 / 1.9, 12);
  });

  it('settles Over 2.0 as VOID when total goals equals 2', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'OVER',
        lineValue: 2,
        homeGoals: 1,
        awayGoals: 1,
        decimalOdds: 1.9,
      }),
    ).toEqual({
      result: 'VOID',
      stakeUnits: 1,
      profitUnits: 0,
    });
  });

  it('settles Under 3.0 as VOID when total goals equals 3', () => {
    expect(
      settlePaperBetSelection({
        marketType: 'TOTAL_GOALS_2_5',
        selection: 'UNDER',
        lineValue: 3,
        homeGoals: 2,
        awayGoals: 1,
        decimalOdds: 1.9,
      }),
    ).toEqual({
      result: 'VOID',
      stakeUnits: 1,
      profitUnits: 0,
    });
  });
});
