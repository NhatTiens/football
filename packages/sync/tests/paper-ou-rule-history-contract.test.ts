import { describe, expect, it } from 'vitest';

import {
  mapPaperOuPredictionToOppositeLine,
  type PaperOuSelection,
} from '../src/paper-ou-opposite-line-core.js';

describe('O/U opposite half-goal history contract', () => {
  const cases: Array<{
    sourceSelection: PaperOuSelection;
    sourceLine: 1.5 | 2.5 | 3.5;
    paperSelection: PaperOuSelection;
    paperLine: 1.5 | 2 | 3 | 3.5;
  }> = [
    { sourceSelection: 'OVER', sourceLine: 1.5, paperSelection: 'UNDER', paperLine: 2 },
    { sourceSelection: 'OVER', sourceLine: 2.5, paperSelection: 'UNDER', paperLine: 3 },
    { sourceSelection: 'OVER', sourceLine: 3.5, paperSelection: 'UNDER', paperLine: 3.5 },
    { sourceSelection: 'UNDER', sourceLine: 1.5, paperSelection: 'OVER', paperLine: 1.5 },
    { sourceSelection: 'UNDER', sourceLine: 2.5, paperSelection: 'OVER', paperLine: 2 },
    { sourceSelection: 'UNDER', sourceLine: 3.5, paperSelection: 'OVER', paperLine: 3 },
  ];

  it.each(cases)(
    '$sourceSelection $sourceLine -> $paperSelection $paperLine',
    ({ sourceSelection, sourceLine, paperSelection, paperLine }) => {
      const result = mapPaperOuPredictionToOppositeLine({
        predictionSelection: sourceSelection,
        predictionLineValue: sourceLine,
      });

      expect(result.recommendedSelection).toBe(paperSelection);
      expect(result.recommendedLineValue).toBe(paperLine);
      expect(result.lineShiftGoals).toBe(Math.abs(paperLine - sourceLine));
      expect(result.boundaryClamped).toBe(sourceLine === paperLine);
      expect(result.paperOnly).toBe(true);
    },
  );
});
