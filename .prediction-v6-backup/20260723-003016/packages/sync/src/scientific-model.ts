import { clamp, normalizeProbabilities } from '@football-ai/engine';

export const SCIENTIFIC_MODEL_KEY = 'SCIENTIFIC_MODEL_V1';
export const SCIENTIFIC_MODEL_VERSION = 'scientific-ensemble-market-v5';

export const SCIENTIFIC_FEATURE_NAMES = [
  'eloDiff',
  'formPpgDiff',
  'homeGoalBalance',
  'awayGoalBalance',
  'homeXgFor',
  'awayXgFor',
  'homeXgAgainst',
  'awayXgAgainst',
  'combinedExpectedGoals',
  'combinedShotsOnTarget',
  'injuryDiff',
  'injuryTotal',
  'restDaysDiff',
  'tacticalTotal',
  'lineupOverAdjustment',
  'homeAdvantage',
] as const;

export type ScientificFeatureName = (typeof SCIENTIFIC_FEATURE_NAMES)[number];

export interface ScientificTrainingSample {
  features: number[];
  matchWinnerClass: 0 | 1 | 2;
  over25: 0 | 1;
  btts: 0 | 1;
  kickoffAt: Date;
}

export interface ScientificModelArtifact {
  version: string;
  featureNames: string[];
  means: number[];
  standardDeviations: number[];
  matchWinnerWeights: number[][];
  over25Weights: number[];
  bttsWeights: number[];
  sampleSize: number;
  trainedAt: string;
  trainedThrough: string;
  epochs: number;
  learningRate: number;
  l2: number;
}

export interface ScientificModelPrediction {
  matchWinner: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  over25: Record<'OVER' | 'UNDER', number>;
  btts: Record<'YES' | 'NO', number>;
}

export interface GoalMarketProbabilities {
  matchWinner: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  btts: Record<'YES' | 'NO', number>;
  total: {
    lineValue: number;
    overWin: number;
    underWin: number;
    push: number;
    overConditional: number;
    underConditional: number;
  };
}

function dot(weights: number[], values: number[]): number {
  let result = weights[0] ?? 0;
  for (let index = 0; index < values.length; index += 1) {
    result += (weights[index + 1] ?? 0) * (values[index] ?? 0);
  }
  return result;
}

function sigmoid(value: number): number {
  const bounded = clamp(value, -35, 35);
  return 1 / (1 + Math.exp(-bounded));
}

function softmax(values: number[]): number[] {
  const maximum = Math.max(...values);
  const exponentials = values.map((value) => Math.exp(value - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / Math.max(total, 1e-12));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], average: number): number {
  if (values.length <= 1) return 1;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;
  const result = Math.sqrt(variance);
  return result < 1e-6 ? 1 : result;
}

function standardizeMatrix(matrix: number[][]): {
  standardized: number[][];
  means: number[];
  standardDeviations: number[];
} {
  const width = matrix[0]?.length ?? 0;
  const means: number[] = [];
  const standardDeviations: number[] = [];

  for (let column = 0; column < width; column += 1) {
    const values = matrix.map((row) => row[column] ?? 0);
    const average = mean(values);
    means.push(average);
    standardDeviations.push(standardDeviation(values, average));
  }

  return {
    means,
    standardDeviations,
    standardized: matrix.map((row) =>
      row.map(
        (value, column) =>
          (value - (means[column] ?? 0)) /
          Math.max(standardDeviations[column] ?? 1, 1e-6),
      ),
    ),
  };
}

function trainBinaryLogistic(input: {
  matrix: number[][];
  labels: number[];
  epochs: number;
  learningRate: number;
  l2: number;
}): number[] {
  const width = input.matrix[0]?.length ?? 0;
  const weights = Array.from({ length: width + 1 }, () => 0);
  const count = Math.max(1, input.matrix.length);

  for (let epoch = 0; epoch < input.epochs; epoch += 1) {
    const gradients = Array.from({ length: width + 1 }, () => 0);

    for (let rowIndex = 0; rowIndex < input.matrix.length; rowIndex += 1) {
      const row = input.matrix[rowIndex] ?? [];
      const label = input.labels[rowIndex] ?? 0;
      const prediction = sigmoid(dot(weights, row));
      const error = prediction - label;
      gradients[0] = (gradients[0] ?? 0) + error;

      for (let column = 0; column < width; column += 1) {
        gradients[column + 1] =
          (gradients[column + 1] ?? 0) + error * (row[column] ?? 0);
      }
    }

    for (let column = 0; column < weights.length; column += 1) {
      const regularization = column === 0 ? 0 : input.l2 * (weights[column] ?? 0);
      weights[column] =
        (weights[column] ?? 0) -
        input.learningRate * ((gradients[column] ?? 0) / count + regularization);
    }
  }

  return weights;
}

function trainSoftmax(input: {
  matrix: number[][];
  labels: number[];
  classes: number;
  epochs: number;
  learningRate: number;
  l2: number;
}): number[][] {
  const width = input.matrix[0]?.length ?? 0;
  const weights = Array.from({ length: input.classes }, () =>
    Array.from({ length: width + 1 }, () => 0),
  );
  const count = Math.max(1, input.matrix.length);

  for (let epoch = 0; epoch < input.epochs; epoch += 1) {
    const gradients = Array.from({ length: input.classes }, () =>
      Array.from({ length: width + 1 }, () => 0),
    );

    for (let rowIndex = 0; rowIndex < input.matrix.length; rowIndex += 1) {
      const row = input.matrix[rowIndex] ?? [];
      const label = input.labels[rowIndex] ?? 0;
      const probabilities = softmax(weights.map((rowWeights) => dot(rowWeights, row)));

      for (let classIndex = 0; classIndex < input.classes; classIndex += 1) {
        const error = (probabilities[classIndex] ?? 0) - (classIndex === label ? 1 : 0);
        const classGradient = gradients[classIndex] ?? [];
        classGradient[0] = (classGradient[0] ?? 0) + error;

        for (let column = 0; column < width; column += 1) {
          classGradient[column + 1] =
            (classGradient[column + 1] ?? 0) + error * (row[column] ?? 0);
        }
      }
    }

    for (let classIndex = 0; classIndex < input.classes; classIndex += 1) {
      const classWeights = weights[classIndex] ?? [];
      const classGradients = gradients[classIndex] ?? [];

      for (let column = 0; column < classWeights.length; column += 1) {
        const regularization =
          column === 0 ? 0 : input.l2 * (classWeights[column] ?? 0);
        classWeights[column] =
          (classWeights[column] ?? 0) -
          input.learningRate *
            ((classGradients[column] ?? 0) / count + regularization);
      }
    }
  }

  return weights;
}

export function trainScientificArtifact(input: {
  samples: ScientificTrainingSample[];
  epochs?: number;
  learningRate?: number;
  l2?: number;
}): ScientificModelArtifact {
  if (input.samples.length === 0) {
    throw new Error('Scientific model training requires at least one sample.');
  }

  const epochs = Math.max(20, Math.floor(input.epochs ?? 280));
  const learningRate = clamp(input.learningRate ?? 0.035, 0.0001, 0.5);
  const l2 = clamp(input.l2 ?? 0.002, 0, 1);
  const matrix = input.samples.map((sample) => sample.features);
  const { standardized, means, standardDeviations } = standardizeMatrix(matrix);

  const matchWinnerWeights = trainSoftmax({
    matrix: standardized,
    labels: input.samples.map((sample) => sample.matchWinnerClass),
    classes: 3,
    epochs,
    learningRate,
    l2,
  });

  const over25Weights = trainBinaryLogistic({
    matrix: standardized,
    labels: input.samples.map((sample) => sample.over25),
    epochs,
    learningRate,
    l2,
  });

  const bttsWeights = trainBinaryLogistic({
    matrix: standardized,
    labels: input.samples.map((sample) => sample.btts),
    epochs,
    learningRate,
    l2,
  });

  const trainedThrough = input.samples.reduce(
    (latest, sample) => (sample.kickoffAt > latest ? sample.kickoffAt : latest),
    input.samples[0]!.kickoffAt,
  );

  return {
    version: SCIENTIFIC_MODEL_VERSION,
    featureNames: [...SCIENTIFIC_FEATURE_NAMES],
    means,
    standardDeviations,
    matchWinnerWeights,
    over25Weights,
    bttsWeights,
    sampleSize: input.samples.length,
    trainedAt: new Date().toISOString(),
    trainedThrough: trainedThrough.toISOString(),
    epochs,
    learningRate,
    l2,
  };
}

export function isScientificModelArtifact(value: unknown): value is ScientificModelArtifact {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ScientificModelArtifact>;
  return (
    candidate.version === SCIENTIFIC_MODEL_VERSION &&
    Array.isArray(candidate.featureNames) &&
    Array.isArray(candidate.means) &&
    Array.isArray(candidate.standardDeviations) &&
    Array.isArray(candidate.matchWinnerWeights) &&
    Array.isArray(candidate.over25Weights) &&
    Array.isArray(candidate.bttsWeights) &&
    typeof candidate.sampleSize === 'number' &&
    typeof candidate.trainedThrough === 'string'
  );
}

export function predictScientificModel(
  artifact: ScientificModelArtifact,
  features: number[],
): ScientificModelPrediction {
  const standardized = features.map(
    (value, index) =>
      (value - (artifact.means[index] ?? 0)) /
      Math.max(artifact.standardDeviations[index] ?? 1, 1e-6),
  );
  const matchWinnerValues = softmax(
    artifact.matchWinnerWeights.map((weights) => dot(weights, standardized)),
  );
  const over = sigmoid(dot(artifact.over25Weights, standardized));
  const yes = sigmoid(dot(artifact.bttsWeights, standardized));

  return {
    matchWinner: normalizeProbabilities({
      HOME: matchWinnerValues[0] ?? 1 / 3,
      DRAW: matchWinnerValues[1] ?? 1 / 3,
      AWAY: matchWinnerValues[2] ?? 1 / 3,
    }),
    over25: normalizeProbabilities({ OVER: over, UNDER: 1 - over }),
    btts: normalizeProbabilities({ YES: yes, NO: 1 - yes }),
  };
}

function poissonProbability(lambda: number, goals: number): number {
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) factorial *= index;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}

export function poissonGoalMarkets(
  homeExpectedGoals: number,
  awayExpectedGoals: number,
  lineValue = 2.5,
  maximumGoals = 10,
): GoalMarketProbabilities {
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let bttsYes = 0;
  let overWin = 0;
  let underWin = 0;
  let push = 0;
  let mass = 0;

  for (let homeGoals = 0; homeGoals <= maximumGoals; homeGoals += 1) {
    const homeProbability = poissonProbability(homeExpectedGoals, homeGoals);
    for (let awayGoals = 0; awayGoals <= maximumGoals; awayGoals += 1) {
      const probability =
        homeProbability * poissonProbability(awayExpectedGoals, awayGoals);
      const totalGoals = homeGoals + awayGoals;
      mass += probability;

      if (homeGoals > awayGoals) homeWin += probability;
      else if (homeGoals < awayGoals) awayWin += probability;
      else draw += probability;

      if (homeGoals > 0 && awayGoals > 0) bttsYes += probability;
      if (Math.abs(totalGoals - lineValue) < 0.0001) push += probability;
      else if (totalGoals > lineValue) overWin += probability;
      else underWin += probability;
    }
  }

  const missingMass = Math.max(0, 1 - mass);
  underWin += missingMass;
  const nonPush = Math.max(1e-9, overWin + underWin);

  return {
    matchWinner: normalizeProbabilities({ HOME: homeWin, DRAW: draw, AWAY: awayWin }),
    btts: normalizeProbabilities({ YES: bttsYes, NO: Math.max(0, mass - bttsYes) }),
    total: {
      lineValue,
      overWin: clamp(overWin, 0, 1),
      underWin: clamp(underWin, 0, 1),
      push: clamp(push, 0, 1),
      overConditional: clamp(overWin / nonPush, 0.001, 0.999),
      underConditional: clamp(underWin / nonPush, 0.001, 0.999),
    },
  };
}

export function logit(value: number): number {
  const bounded = clamp(value, 0.0001, 0.9999);
  return Math.log(bounded / (1 - bounded));
}

export function inverseLogit(value: number): number {
  return sigmoid(value);
}

export function calibrateTotalProbability(input: {
  lineProbability: number;
  poissonOver25: number;
  modelOver25?: number;
  calibrationWeight?: number;
}): number {
  if (input.modelOver25 === undefined) return input.lineProbability;
  const correction =
    logit(input.modelOver25) - logit(input.poissonOver25);
  return clamp(
    inverseLogit(
      logit(input.lineProbability) +
        correction * clamp(input.calibrationWeight ?? 0.35, 0, 1),
    ),
    0.001,
    0.999,
  );
}
