import { describe, expect, it } from 'vitest';
import {
  SCIENTIFIC_MODEL_VERSION,
  adaptiveModelWeight,
  calibrateTotalProbability,
  conservativeProbability,
  poissonGoalMarkets,
  predictScientificModel,
  trainScientificArtifact,
  type ScientificTrainingSample,
} from '../src/scientific-model.js';

function syntheticSamples(count = 180): ScientificTrainingSample[] {
  let state = 246_813_579;
  const random = () => {
    state = (1_664_525 * state + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  const normal = () => {
    const first = Math.max(1e-9, random());
    const second = Math.max(1e-9, random());
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
  };
  const start = Date.UTC(2022, 0, 1);

  return Array.from({ length: count }, (_, index) => {
    const elo = normal() * 0.65;
    const form = normal() * 0.5;
    const goalBalance = normal() * 0.45;
    const totalSignal = normal() * 0.5;
    const shotSignal = normal() * 0.4;
    const injury = normal() * 0.25;
    const rest = normal() * 0.2;
    const lineup = normal() * 0.3;
    const winnerScore =
      1.35 * elo + 0.65 * form + 0.45 * goalBalance - 0.35 * injury + normal() * 0.5;
    const drawThreshold = 0.33 + Math.abs(totalSignal) * 0.08;
    const overScore = 1.2 * totalSignal + 0.75 * shotSignal + 0.35 * lineup + normal() * 0.55;
    const bttsScore =
      0.8 * totalSignal + 0.45 * shotSignal - 0.25 * Math.abs(elo) + normal() * 0.6;

    return {
      features: [
        elo,
        form,
        goalBalance,
        -goalBalance * 0.8 + normal() * 0.1,
        0.45 + totalSignal * 0.2,
        0.4 + totalSignal * 0.18,
        0.42 - totalSignal * 0.08,
        0.4 - totalSignal * 0.06,
        0.65 + totalSignal,
        0.7 + shotSignal,
        injury,
        Math.abs(injury),
        rest,
        normal() * 0.2,
        lineup,
        1,
      ],
      matchWinnerClass:
        winnerScore > drawThreshold ? 0 : winnerScore < -drawThreshold ? 2 : 1,
      over25: overScore > 0 ? 1 : 0,
      btts: bttsScore > 0 ? 1 : 0,
      kickoffAt: new Date(start + index * 86_400_000),
    };
  });
}

describe('scientific model v6', () => {
  it('normalizes every Dixon-Coles market', () => {
    const result = poissonGoalMarkets(1.62, 1.08, 2.5);
    expect(result.matchWinner.HOME + result.matchWinner.DRAW + result.matchWinner.AWAY).toBeCloseTo(1, 8);
    expect(result.btts.YES + result.btts.NO).toBeCloseTo(1, 8);
    expect(result.total.overWin + result.total.underWin + result.total.push).toBeCloseTo(1, 8);
  });

  it('applies the low-score Dixon-Coles correction', () => {
    const independent = poissonGoalMarkets(1.4, 1.2, 2.5, 10, 0);
    const corrected = poissonGoalMarkets(1.4, 1.2, 2.5, 10, -0.08);
    expect(corrected.matchWinner.DRAW).toBeGreaterThan(independent.matchWinner.DRAW);
  });

  it('reduces trust when uncertainty and data quality are worse', () => {
    const reliable = adaptiveModelWeight({
      baseWeight: 0.6,
      sampleSize: 1_200,
      dataQuality: 0.9,
      uncertainty: 0.01,
    });
    const unreliable = adaptiveModelWeight({
      baseWeight: 0.6,
      sampleSize: 90,
      dataQuality: 0.4,
      uncertainty: 0.12,
    });
    expect(reliable).toBeGreaterThan(unreliable);
    expect(
      conservativeProbability({ probability: 0.61, uncertainty: 0.05, dataQuality: 0.8 }),
    ).toBeLessThan(0.61);
  });

  it('moves a total probability without blindly copying the ML output', () => {
    const result = calibrateTotalProbability({
      lineProbability: 0.51,
      poissonOver25: 0.48,
      modelOver25: 0.62,
      modelUncertainty: 0.02,
      dataQuality: 0.9,
    });
    expect(result).toBeGreaterThan(0.51);
    expect(result).toBeLessThan(0.62);
  });

  it('trains a chronological calibrated ensemble and drops constant features', () => {
    const artifact = trainScientificArtifact({
      samples: syntheticSamples(),
      epochs: 100,
      learningRate: 0.015,
      l2: 0.004,
      ensembleMembers: 3,
      randomSeed: 42,
    });
    expect(artifact.version).toBe(SCIENTIFIC_MODEL_VERSION);
    expect(artifact.members).toHaveLength(3);
    expect(artifact.transform?.activeFeatureIndices).not.toContain(15);
    expect(artifact.validationSampleSize).toBeGreaterThanOrEqual(20);
    expect(Number.isFinite(artifact.validationMetrics?.matchWinnerLogLoss)).toBe(true);
  });

  it('learns the direction of a strong home/away signal', () => {
    const artifact = trainScientificArtifact({
      samples: syntheticSamples(),
      epochs: 100,
      learningRate: 0.015,
      l2: 0.004,
      ensembleMembers: 3,
      randomSeed: 42,
    });
    const home = predictScientificModel(artifact, [
      1.5, 0.8, 0.8, -0.6, 0.55, 0.35, 0.25, 0.65, 0.8, 0.7, -0.2, 0.2, 0.1, 0, 0.1, 1,
    ]);
    const away = predictScientificModel(artifact, [
      -1.5, -0.8, -0.8, 0.6, 0.35, 0.55, 0.65, 0.25, 0.8, 0.7, 0.2, 0.2, -0.1, 0, 0.1, 1,
    ]);
    expect(home.matchWinner.HOME).toBeGreaterThan(home.matchWinner.AWAY);
    expect(away.matchWinner.AWAY).toBeGreaterThan(away.matchWinner.HOME);
    expect(home.uncertainty?.memberCount).toBe(3);
  });
});
