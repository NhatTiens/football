import { describe, expect, it } from 'vitest';
import { predictScientificModel, trainScientificArtifact } from '../src/scientific-model.js';
import { buildThreeMarketProjection } from '../src/three-market-core.js';

describe('R3 O/U specialist', () => {
  it('trains separate O1.5 and O3.5 heads and keeps final total lines monotonic', () => {
    const samples = Array.from({ length: 90 }, (_, i) => {
      const f = Array.from({ length: 16 }, (_, j) => Math.sin((i + 1) * (j + 2) * 0.07));
      const total = i % 6;
      return {
        features: f,
        matchWinnerClass: (i % 3) as 0 | 1 | 2,
        over15: (total > 1 ? 1 : 0) as 0 | 1,
        over25: (total > 2 ? 1 : 0) as 0 | 1,
        over35: (total > 3 ? 1 : 0) as 0 | 1,
        btts: (i % 2) as 0 | 1,
        kickoffAt: new Date(Date.UTC(2024, 0, i + 1)),
      };
    });
    const artifact = trainScientificArtifact({
      samples,
      epochs: 40,
      ensembleMembers: 2,
      validationFraction: 0.2,
      trainedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    expect(artifact.members?.every((m) => m.over15Weights?.length && m.over35Weights?.length)).toBe(true);

    const prediction = predictScientificModel(artifact, samples[70]!.features);
    expect(prediction.over15).toBeDefined();
    expect(prediction.over35).toBeDefined();

    const projection = buildThreeMarketProjection({
      homeExpectedGoals: 1.55,
      awayExpectedGoals: 1.05,
      dataQuality: 0.9,
      directModelReliability: 0.9,
      directModel: {
        over15: prediction.over15!.OVER,
        over25: prediction.over25.OVER,
        over35: prediction.over35!.OVER,
      },
    });
    expect(projection.totals[1.5].probabilities.OVER)
      .toBeGreaterThanOrEqual(projection.totals[2.5].probabilities.OVER);
    expect(projection.totals[2.5].probabilities.OVER)
      .toBeGreaterThanOrEqual(projection.totals[3.5].probabilities.OVER);
  });
});
