import { describe, expect, it } from 'vitest';
import {
  SCIENTIFIC_FEATURE_NAMES,
  trainScientificArtifact,
  type ScientificTrainingSample,
} from '../src/scientific-model.js';

function samples(count = 70): ScientificTrainingSample[] {
  const start = Date.UTC(2024, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const homeGoals = index % 4;
    const awayGoals = (index * 3) % 3;
    const features = Array.from({ length: SCIENTIFIC_FEATURE_NAMES.length }, (_, column) =>
      ((index + 1) * (column + 3)) % 17 / 17,
    );
    return {
      features,
      matchWinnerClass: homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2,
      over25: homeGoals + awayGoals > 2.5 ? 1 : 0,
      btts: homeGoals > 0 && awayGoals > 0 ? 1 : 0,
      kickoffAt: new Date(start + index * 86_400_000),
    };
  });
}

describe('scientific historical training timestamp contract', () => {
  it('accepts a historical trainedAt for leakage-safe walk-forward', () => {
    const trainingSamples = samples();
    const trainedAt = new Date(Date.UTC(2024, 5, 1));
    const artifact = trainScientificArtifact({
      samples: trainingSamples,
      trainedAt,
      epochs: 40,
      ensembleMembers: 1,
      validationFraction: 0.2,
    });
    expect(artifact.trainedAt).toBe(trainedAt.toISOString());
    expect(new Date(artifact.trainedAt).getTime()).toBeGreaterThan(
      new Date(artifact.trainedThrough).getTime(),
    );
  });

  it('never allows trainedAt to be at or before trainedThrough', () => {
    const trainingSamples = samples();
    const artifact = trainScientificArtifact({
      samples: trainingSamples,
      trainedAt: new Date(Date.UTC(2024, 0, 2)),
      epochs: 40,
      ensembleMembers: 1,
      validationFraction: 0.2,
    });
    expect(new Date(artifact.trainedAt).getTime()).toBeGreaterThan(
      new Date(artifact.trainedThrough).getTime(),
    );
  });
});
