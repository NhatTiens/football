import { describe, expect, it } from 'vitest';

import { mapPaperOuPredictionToModelSelection } from '../src/paper-ou-model-selection-core.js';

describe('paper O/U direct model-selection rule', () => {
  it.each([
    ['OVER', 1.5],
    ['OVER', 2.5],
    ['OVER', 3.5],
    ['UNDER', 1.5],
    ['UNDER', 2.5],
    ['UNDER', 3.5],
  ] as const)(
    '%s %s remains unchanged',
    (predictionSelection, predictionLineValue) => {
      const result = mapPaperOuPredictionToModelSelection({
        predictionSelection,
        predictionLineValue,
      });

      expect(result).toMatchObject({
        predictionSelection,
        predictionLineValue,
        recommendedSelection: predictionSelection,
        recommendedLineValue: predictionLineValue,
        strategy: 'OU_DIRECT_MODEL_SELECTION',
        boundaryClamped: false,
        lineShiftGoals: 0,
        paperOnly: true,
      });
    },
  );
});
