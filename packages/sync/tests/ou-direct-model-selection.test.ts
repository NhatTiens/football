import { describe, expect, it } from 'vitest';

import {
  PAPER_OU_MODEL_SELECTION_VERSION,
  derivePaperOuTargetProbabilities,
  mapPaperOuPredictionToModelSelection,
  type PaperOuSelection,
  type PaperOuSourceLine,
} from '../src/paper-ou-model-selection-core.js';
import { settlePaperBetSelection } from '../src/paper-bet-ledger-core.js';

describe('O/U direct model-selection rule', () => {
  const cases: Array<{
    sourceSelection: PaperOuSelection;
    sourceLine: PaperOuSourceLine;
    targetSelection: PaperOuSelection;
    targetLine: number;
  }> = [
    {
      sourceSelection: 'OVER',
      sourceLine: 1.5,
      targetSelection: 'OVER',
      targetLine: 1.5,
    },
    {
      sourceSelection: 'OVER',
      sourceLine: 2.5,
      targetSelection: 'OVER',
      targetLine: 2.5,
    },
    {
      sourceSelection: 'OVER',
      sourceLine: 3.5,
      targetSelection: 'OVER',
      targetLine: 3.5,
    },
    {
      sourceSelection: 'UNDER',
      sourceLine: 1.5,
      targetSelection: 'UNDER',
      targetLine: 1.5,
    },
    {
      sourceSelection: 'UNDER',
      sourceLine: 2.5,
      targetSelection: 'UNDER',
      targetLine: 2.5,
    },
    {
      sourceSelection: 'UNDER',
      sourceLine: 3.5,
      targetSelection: 'UNDER',
      targetLine: 3.5,
    },
  ];

  for (const row of cases) {
    it(`${row.sourceSelection} ${row.sourceLine} -> ${row.targetSelection} ${row.targetLine}`, () => {
      const mapping = mapPaperOuPredictionToModelSelection({
        predictionSelection: row.sourceSelection,
        predictionLineValue: row.sourceLine,
      });

      expect(mapping.version).toBe(PAPER_OU_MODEL_SELECTION_VERSION);
      expect(mapping.recommendedSelection).toBe(row.targetSelection);
      expect(mapping.recommendedLineValue).toBe(row.targetLine);
      expect(mapping.lineShiftGoals).toBe(0);
    });
  }

  it('uses the calculated probability without a shifted-line push adjustment', () => {
    const mapping = mapPaperOuPredictionToModelSelection({
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

    expect(result.winProbability).toBeCloseTo(0.45, 12);
    expect(result.pushProbability).toBe(0);
    expect(result.lossProbability).toBeCloseTo(0.55, 12);
    expect(result.effectiveProbability).toBeCloseTo(0.45, 12);
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
