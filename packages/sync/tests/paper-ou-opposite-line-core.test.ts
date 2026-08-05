import { describe, expect, it } from 'vitest';

import { mapPaperOuPredictionToOppositeLine } from '../src/paper-ou-opposite-line-core.js';

describe('paper O/U opposite protected half-goal rule', () => {
  it.each([
    ['OVER', 1.5, 'UNDER', 2, false, 0.5],
    ['OVER', 2.5, 'UNDER', 3, false, 0.5],
    ['OVER', 3.5, 'UNDER', 3.5, true, 0],
    ['UNDER', 1.5, 'OVER', 1.5, true, 0],
    ['UNDER', 2.5, 'OVER', 2, false, 0.5],
    ['UNDER', 3.5, 'OVER', 3, false, 0.5],
  ] as const)(
    '%s %s becomes %s %s',
    (
      predictionSelection,
      predictionLineValue,
      recommendedSelection,
      recommendedLineValue,
      boundaryClamped,
      lineShiftGoals,
    ) => {
      const result = mapPaperOuPredictionToOppositeLine({
        predictionSelection,
        predictionLineValue,
      });

      expect(result).toMatchObject({
        predictionSelection,
        predictionLineValue,
        recommendedSelection,
        recommendedLineValue,
        boundaryClamped,
        lineShiftGoals,
        paperOnly: true,
      });
    },
  );
});
