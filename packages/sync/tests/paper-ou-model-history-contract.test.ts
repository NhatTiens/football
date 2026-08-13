import { describe, expect, it } from 'vitest';

import {
  mapPaperOuPredictionToModelSelection,
  type PaperOuSelection,
} from '../src/paper-ou-model-selection-core.js';

describe('O/U direct model-result history contract', () => {
  const cases: Array<{
    sourceSelection: PaperOuSelection;
    sourceLine: 1.5 | 2.5 | 3.5;
    paperSelection: PaperOuSelection;
    paperLine: 1.5 | 2.5 | 3.5;
  }> = [
    { sourceSelection: 'OVER', sourceLine: 1.5, paperSelection: 'OVER', paperLine: 1.5 },
    { sourceSelection: 'OVER', sourceLine: 2.5, paperSelection: 'OVER', paperLine: 2.5 },
    { sourceSelection: 'OVER', sourceLine: 3.5, paperSelection: 'OVER', paperLine: 3.5 },
    { sourceSelection: 'UNDER', sourceLine: 1.5, paperSelection: 'UNDER', paperLine: 1.5 },
    { sourceSelection: 'UNDER', sourceLine: 2.5, paperSelection: 'UNDER', paperLine: 2.5 },
    { sourceSelection: 'UNDER', sourceLine: 3.5, paperSelection: 'UNDER', paperLine: 3.5 },
  ];

  it.each(cases)(
    '$sourceSelection $sourceLine -> $paperSelection $paperLine',
    ({ sourceSelection, sourceLine, paperSelection, paperLine }) => {
      const result = mapPaperOuPredictionToModelSelection({
        predictionSelection: sourceSelection,
        predictionLineValue: sourceLine,
      });

      expect(result.recommendedSelection).toBe(paperSelection);
      expect(result.recommendedLineValue).toBe(paperLine);
      expect(result.lineShiftGoals).toBe(0);
      expect(result.boundaryClamped).toBe(false);
      expect(result.paperOnly).toBe(true);
    },
  );
});
