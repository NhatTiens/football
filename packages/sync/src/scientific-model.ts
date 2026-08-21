import { clamp, normalizeProbabilities } from '@football-ai/engine';

export const SCIENTIFIC_MODEL_KEY = 'SCIENTIFIC_MODEL_V1';
export const SCIENTIFIC_MODEL_VERSION = 'scientific-ensemble-dixon-coles-v6';
export const SCIENTIFIC_MODEL_VERSION_V7 = 'scientific-ensemble-dixon-coles-v7';

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

// PREDICTION_AI_V7_FEATURES: append market-derived + context features to the
// v6 vector. Order matters — both training and inference must produce the
// exact same 29-wide vector. Feature index 15 (homeAdvantage) keeps its slot
// for v6 artifact compatibility; v7 replaces the constant 1 with the real
// team-specific home advantage signal.
export const SCIENTIFIC_FEATURE_NAMES_V7 = [
  ...SCIENTIFIC_FEATURE_NAMES.slice(0, 15),
  'homeAdvantageTeam',
  'marketHomeConsensus',
  'marketDrawConsensus',
  'marketAwayConsensus',
  'marketOver25Consensus',
  'marketBttsYesConsensus',
  'marketMoveHome',
  'marketMoveOver25',
  'marketAvailable',
  'marketOddsAgeHours',
  'marketBookmakerCount',
  'opponentAdjustedFormDiff',
  'injuryWeightedDiff',
  'fatigueDensityDiff',
] as const;

export type ScientificFeatureNameV7 = (typeof SCIENTIFIC_FEATURE_NAMES_V7)[number];

export type ScientificFeatureName = (typeof SCIENTIFIC_FEATURE_NAMES)[number];

export interface ScientificTrainingSample {
  features: number[];
  matchWinnerClass: 0 | 1 | 2;
  over15?: 0 | 1;
  over25: 0 | 1;
  over35?: 0 | 1;
  btts: 0 | 1;
  kickoffAt: Date;
}

export interface ScientificModelMember {
  matchWinnerWeights: number[][];
  over15Weights?: number[];
  over25Weights: number[];
  over35Weights?: number[];
  bttsWeights: number[];
  seed: number;
}

export interface BinaryCalibration {
  scale: number;
  bias: number;
}

export interface ScientificCalibration {
  matchWinnerTemperature: number;
  over15?: BinaryCalibration;
  over25: BinaryCalibration;
  over35?: BinaryCalibration;
  btts: BinaryCalibration;
}

export interface ScientificValidationMetrics {
  matchWinnerLogLoss: number;
  matchWinnerBrier: number;
  over25LogLoss: number;
  over25Brier: number;
  bttsLogLoss: number;
  bttsBrier: number;
  expectedCalibrationError: number;
}

export interface ScientificFeatureTransform {
  activeFeatureIndices: number[];
  quadraticFeatureIndices: number[];
  interactionPairs: Array<[number, number]>;
  expandedFeatureNames: string[];
}

export interface ScientificModelArtifact {
  version: string;
  featureNames: string[];
  means: number[];
  standardDeviations: number[];
  matchWinnerWeights: number[][];
  over15Weights?: number[];
  over25Weights: number[];
  over35Weights?: number[];
  bttsWeights: number[];
  sampleSize: number;
  trainedAt: string;
  trainedThrough: string;
  epochs: number;
  learningRate: number;
  l2: number;
  algorithm?: string;
  randomSeed?: number;
  validationSampleSize?: number;
  members?: ScientificModelMember[];
  transform?: ScientificFeatureTransform;
  calibration?: ScientificCalibration;
  validationMetrics?: ScientificValidationMetrics;
  // PREDICTION_AI_V7_STACKING: learned convex weights blending the component
  // models (poisson / elo / ml / market) per market instead of hand-tuned ones.
  stacking?: ScientificStackWeights;
  // PREDICTION_AI_V7_ISOTONIC: non-parametric calibration for binary markets.
  isotonic?: {
    over15?: IsotonicCalibration;
    over25?: IsotonicCalibration;
    over35?: IsotonicCalibration;
    btts?: IsotonicCalibration;
  };
}

// ============================================================================
// PREDICTION_AI_V7 — stacking meta-learner
// ============================================================================

/** Convex weights over the component models for one market. */
export interface ScientificStackWeights {
  /** [poisson, elo, ml, market] — must be non-negative and sum to 1. */
  matchWinner: number[];
  /** [poisson, ml, market] — must be non-negative and sum to 1. */
  over25: number[];
  /** [poisson, ml, market] — must be non-negative and sum to 1. */
  btts: number[];
  fittedAt: string;
  sampleSize: number;
  validationLogLoss: {
    matchWinner: number | null;
    over25: number | null;
    btts: number | null;
  };
}

/**
 * One training row for the stacking meta-learner.
 * Components are raw (uncalibrated) probability vectors from each sub-model.
 */
export interface StackTrainingRow {
  matchWinnerComponents: number[][]; // 4 x 3: poisson, elo, ml, market
  over25Components: number[][]; // 3 x 1 (OVER prob): poisson, ml, market
  bttsComponents: number[][]; // 3 x 1 (YES prob): poisson, ml, market
  matchWinnerClass: 0 | 1 | 2;
  over25: 0 | 1;
  btts: 0 | 1;
}

export interface StackTrainingOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
  randomSeed?: number;
}

function multiclassLogLossForRows(predictions: number[][], labels: number[]): number {
  let total = 0;
  for (let index = 0; index < predictions.length; index += 1) {
    const label = labels[index] ?? 0;
    const probability = Math.max(1e-9, predictions[index]?.[label] ?? 1 / 3);
    total -= Math.log(probability);
  }
  return predictions.length === 0 ? 0 : total / predictions.length;
}

function binaryLogLossForRows(predictions: number[], labels: number[]): number {
  let total = 0;
  for (let index = 0; index < predictions.length; index += 1) {
    const label = labels[index] ?? 0;
    const probability = clamp(predictions[index] ?? 0.5, 1e-9, 1 - 1e-9);
    total -= label === 1 ? Math.log(probability) : Math.log(1 - probability);
  }
  return predictions.length === 0 ? 0 : total / predictions.length;
}

function blendComponents(components: number[][], weights: number[]): number[] {
  const width = components[0]?.length ?? 1;
  const result = new Array<number>(width).fill(0);
  let totalWeight = 0;
  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const weight = weights[componentIndex] ?? 0;
    const component = components[componentIndex];
    if (!component || weight <= 0) continue;
    totalWeight += weight;
    for (let index = 0; index < width; index += 1) {
      result[index] = (result[index] ?? 0) + (component[index] ?? 0) * weight;
    }
  }
  if (totalWeight <= 0) return new Array<number>(width).fill(1 / width);
  // Binary case (width 1): the value IS a probability — blend without
  // renormalizing, otherwise every blend collapses to 1.0.
  if (width === 1) {
    return [clamp(result[0]! / totalWeight, 1e-6, 1 - 1e-6)];
  }
  // Multiclass case: renormalize the probability vector to a valid simplex.
  const total = result.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return new Array<number>(width).fill(1 / width);
  return result.map((value) => Math.max(0, value) / total);
}

/**
 * PREDICTION_AI_V7: train convex stacking weights using coordinate ascent on
 * the probability simplex (weights always stay non-negative and sum to 1).
 * Equal-weight initialization means the learner starts from the current
 * hand-tuned blend and only moves when a component genuinely adds information.
 */
export function trainStackingWeights(
  rows: StackTrainingRow[],
  options: StackTrainingOptions = {},
): ScientificStackWeights {
  const epochs = Math.max(20, Math.floor(options.epochs ?? 300));
  const step = clamp(options.learningRate ?? 0.05, 0.005, 0.2);
  const seed = Math.floor(options.randomSeed ?? 20260821);

  const random = (() => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  })();

  // Deterministic coordinate ascent: every ordered pair is tried each epoch, so
  // an improving direction can never be missed by bad luck. Stops when a full
  // epoch produces no improvement.
  const fitMulticlass = (
    allComponents: number[][][],
    allLabels: number[],
    width: number,
  ): number[] => {
    if (allComponents.length < 5) return [0.45, 0.24, 0.23, 0.08].slice(0, width);
    const weights = new Array<number>(width).fill(1 / width);
    let bestLoss = multiclassLogLossForRows(
      allComponents.map((components) => blendComponents(components, weights)),
      allLabels,
    );
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      let improved = false;
      for (let from = 0; from < width; from += 1) {
        for (let to = 0; to < width; to += 1) {
          if (from === to) continue;
          const candidate = [...weights];
          const delta = Math.min(step, candidate[from]!);
          if (delta <= 1e-6) continue;
          candidate[from]! -= delta;
          candidate[to]! += delta;
          const loss = multiclassLogLossForRows(
            allComponents.map((components) => blendComponents(components, candidate)),
            allLabels,
          );
          if (loss < bestLoss - 1e-9) {
            bestLoss = loss;
            weights.splice(0, weights.length, ...candidate);
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    return weights;
  };

  const fitBinary = (allComponents: number[][][], allLabels: number[], width: number): number[] => {
    if (allComponents.length < 5) return [0.6, 0.3, 0.1].slice(0, width);
    const weights = new Array<number>(width).fill(1 / width);
    let bestLoss = binaryLogLossForRows(
      allComponents.map((components) => blendComponents(components, weights)[0] ?? 0.5),
      allLabels,
    );
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      let improved = false;
      for (let from = 0; from < width; from += 1) {
        for (let to = 0; to < width; to += 1) {
          if (from === to) continue;
          const candidate = [...weights];
          const delta = Math.min(step, candidate[from]!);
          if (delta <= 1e-6) continue;
          candidate[from]! -= delta;
          candidate[to]! += delta;
          const loss = binaryLogLossForRows(
            allComponents.map((components) => blendComponents(components, candidate)[0] ?? 0.5),
            allLabels,
          );
          if (loss < bestLoss - 1e-9) {
            bestLoss = loss;
            weights.splice(0, weights.length, ...candidate);
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    return weights;
  };

  const matchWinner = fitMulticlass(
    rows.map((row) => row.matchWinnerComponents),
    rows.map((row) => row.matchWinnerClass),
    4,
  );
  const over25 = fitBinary(
    rows.map((row) => row.over25Components),
    rows.map((row) => row.over25),
    3,
  );
  const btts = fitBinary(
    rows.map((row) => row.bttsComponents),
    rows.map((row) => row.btts),
    3,
  );

  return {
    matchWinner,
    over25,
    btts,
    fittedAt: new Date().toISOString(),
    sampleSize: rows.length,
    validationLogLoss: {
      matchWinner: multiclassLogLossForRows(
        rows.map((row) => blendComponents(row.matchWinnerComponents, matchWinner)),
        rows.map((row) => row.matchWinnerClass),
      ),
      over25: binaryLogLossForRows(
        rows.map((row) => blendComponents(row.over25Components, over25)[0] ?? 0.5),
        rows.map((row) => row.over25),
      ),
      btts: binaryLogLossForRows(
        rows.map((row) => blendComponents(row.bttsComponents, btts)[0] ?? 0.5),
        rows.map((row) => row.btts),
      ),
    },
  };
}

export function applyStackingMatchWinner(
  weights: number[] | undefined,
  components: number[][],
  fallback: number[],
): number[] {
  if (!weights || weights.length !== components.length) return fallback;
  return blendComponents(components, weights);
}

export function applyStackingBinary(
  weights: number[] | undefined,
  components: number[][],
  fallback: number,
): number {
  if (!weights || weights.length !== components.length) return fallback;
  return blendComponents(components, weights)[0] ?? fallback;
}

// ============================================================================
// PREDICTION_AI_V7 — isotonic (PAV) calibration for binary markets
// ============================================================================

export interface IsotonicCalibration {
  /** Increasing bin boundaries on [0,1]. */
  thresholds: number[];
  /** Fitted values (non-decreasing) for each bin. */
  values: number[];
  fittedAt: string;
  sampleSize: number;
}

/**
 * Binned isotonic regression via the Pool Adjacent Violators algorithm.
 * Guarantees a non-decreasing calibration map on [0,1] without assuming a
 * parametric form (Platt/temperature assume logistic shape).
 */
export function fitIsotonicRegression(
  probabilities: number[],
  labels: number[],
  bins = 20,
): IsotonicCalibration {
  const safeBins = Math.max(4, Math.min(100, Math.floor(bins)));
  const rows = probabilities
    .map((probability, index) => ({
      probability: clamp(probability, 0, 1),
      label: labels[index] ?? 0,
    }))
    .filter((row) => Number.isFinite(row.probability));

  if (rows.length < 10) {
    return {
      thresholds: [],
      values: [],
      fittedAt: new Date().toISOString(),
      sampleSize: rows.length,
    };
  }

  // Sort by probability then pool adjacent violators.
  rows.sort((left, right) => left.probability - right.probability);
  const pooled: Array<{ start: number; end: number; mean: number; weight: number }> = [];
  for (const row of rows) {
    pooled.push({ start: row.probability, end: row.probability, mean: row.label, weight: 1 });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < pooled.length; index += 1) {
      const previous = pooled[index - 1]!;
      const current = pooled[index]!;
      if (previous.mean > current.mean) {
        const totalWeight = previous.weight + current.weight;
        const mergedMean =
          (previous.mean * previous.weight + current.mean * current.weight) / totalWeight;
        pooled[index - 1] = {
          start: previous.start,
          end: current.end,
          mean: mergedMean,
          weight: totalWeight,
        };
        pooled.splice(index, 1);
        changed = true;
        break;
      }
    }
  }

  // Bucket into `safeBins` thresholds for storage compactness.
  const thresholds: number[] = [];
  const values: number[] = [];
  for (let bin = 0; bin < safeBins; bin += 1) {
    const lower = bin / safeBins;
    const upper = (bin + 1) / safeBins;
    const members = pooled.filter((segment) => segment.start < upper && segment.end >= lower);
    if (members.length === 0) continue;
    const value =
      members.reduce((sum, segment) => sum + segment.mean * segment.weight, 0) /
      members.reduce((sum, segment) => sum + segment.weight, 0);
    thresholds.push(upper);
    values.push(clamp(value, 1e-6, 1 - 1e-6));
  }

  return {
    thresholds,
    values,
    fittedAt: new Date().toISOString(),
    sampleSize: rows.length,
  };
}

export function applyIsotonicRegression(
  probability: number,
  calibration: IsotonicCalibration | undefined,
): number {
  if (!calibration || calibration.thresholds.length === 0) return clamp(probability, 0.001, 0.999);
  const bounded = clamp(probability, 0, 1);
  const thresholds = calibration.thresholds;
  const values = calibration.values;
  if (bounded <= thresholds[0]!) return values[0]!;
  for (let index = 1; index < thresholds.length; index += 1) {
    if (bounded <= thresholds[index]!) {
      const lowerX = thresholds[index - 1]!;
      const upperX = thresholds[index]!;
      const lowerY = values[index - 1]!;
      const upperY = values[index]!;
      if (upperX - lowerX <= 1e-12) return upperY;
      const fraction = (bounded - lowerX) / (upperX - lowerX);
      return clamp(lowerY + fraction * (upperY - lowerY), 0.001, 0.999);
    }
  }
  return values[values.length - 1]!;
}

export interface ScientificPredictionUncertainty {
  matchWinner: number;
  over15?: number;
  over25: number;
  over35?: number;
  btts: number;
  memberCount: number;
}

export interface ScientificModelPrediction {
  matchWinner: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  over15?: Record<'OVER' | 'UNDER', number>;
  over25: Record<'OVER' | 'UNDER', number>;
  over35?: Record<'OVER' | 'UNDER', number>;
  btts: Record<'YES' | 'NO', number>;
  uncertainty?: ScientificPredictionUncertainty;
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

interface ModelProbabilities {
  matchWinner: number[];
  over15: number;
  over25: number;
  over35: number;
  btts: number;
}

interface TrainingOptions {
  matrix: number[][];
  labels: number[];
  validationMatrix: number[][];
  validationLabels: number[];
  epochs: number;
  learningRate: number;
  l2: number;
  sampleWeights: number[];
  seed: number;
}

const EPSILON = 1e-9;

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
  return exponentials.map((value) => value / Math.max(total, EPSILON));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], average = mean(values)): number {
  if (values.length <= 1) return 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

export function probabilityStddev(values: number[]): number {
  return standardDeviation(values);
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function cloneMatrix(matrix: number[][]): number[][] {
  return matrix.map((row) => [...row]);
}

function normalizeFeatureWidth(features: number[], width: number): number[] {
  return Array.from({ length: width }, (_, index) => {
    const value = features[index];
    return Number.isFinite(value) ? Number(value) : 0;
  });
}

function buildStatistics(matrix: number[][]): {
  means: number[];
  standardDeviations: number[];
  activeFeatureIndices: number[];
} {
  const width = matrix[0]?.length ?? SCIENTIFIC_FEATURE_NAMES.length;
  const means: number[] = [];
  const standardDeviations: number[] = [];
  const activeFeatureIndices: number[] = [];

  for (let column = 0; column < width; column += 1) {
    const values = matrix.map((row) => row[column] ?? 0);
    const average = mean(values);
    const deviation = standardDeviation(values, average);
    means.push(average);
    standardDeviations.push(deviation < 1e-6 ? 1 : deviation);
    if (deviation >= 1e-6) activeFeatureIndices.push(column);
  }

  if (activeFeatureIndices.length === 0) {
    activeFeatureIndices.push(...Array.from({ length: width }, (_, index) => index));
  }

  return { means, standardDeviations, activeFeatureIndices };
}

function defaultInteractionPairs(activeFeatureIndices: number[]): Array<[number, number]> {
  const available = new Set(activeFeatureIndices);
  const candidates: Array<[number, number]> = [
    [0, 1],
    [0, 12],
    [2, 3],
    [4, 6],
    [5, 7],
    [8, 9],
    [8, 14],
    [10, 11],
    [13, 14],
  ];
  return candidates.filter(([left, right]) => available.has(left) && available.has(right));
}

function buildTransform(activeFeatureIndices: number[]): ScientificFeatureTransform {
  const quadraticFeatureIndices = [...activeFeatureIndices];
  const interactionPairs = defaultInteractionPairs(activeFeatureIndices);
  const expandedFeatureNames = [
    ...activeFeatureIndices.map((index) => SCIENTIFIC_FEATURE_NAMES[index] ?? `f${index}`),
    ...quadraticFeatureIndices.map(
      (index) => `${SCIENTIFIC_FEATURE_NAMES[index] ?? `f${index}`}^2_signed`,
    ),
    ...interactionPairs.map(([left, right]) => {
      const leftName = SCIENTIFIC_FEATURE_NAMES[left] ?? `f${left}`;
      const rightName = SCIENTIFIC_FEATURE_NAMES[right] ?? `f${right}`;
      return `${leftName}*${rightName}`;
    }),
  ];
  return {
    activeFeatureIndices,
    quadraticFeatureIndices,
    interactionPairs,
    expandedFeatureNames,
  };
}

function standardizedRawFeatures(
  features: number[],
  means: number[],
  standardDeviations: number[],
): number[] {
  const width = Math.max(means.length, standardDeviations.length, features.length);
  return Array.from({ length: width }, (_, index) => {
    const value = Number.isFinite(features[index]) ? Number(features[index]) : 0;
    return clamp(
      (value - (means[index] ?? 0)) / Math.max(Math.abs(standardDeviations[index] ?? 1), 1e-6),
      -8,
      8,
    );
  });
}

function expandFeatures(
  features: number[],
  means: number[],
  standardDeviations: number[],
  transform: ScientificFeatureTransform,
): number[] {
  const standardized = standardizedRawFeatures(features, means, standardDeviations);
  const active = transform.activeFeatureIndices.map((index) => standardized[index] ?? 0);
  const quadratic = transform.quadraticFeatureIndices.map((index) => {
    const value = standardized[index] ?? 0;
    return clamp((Math.sign(value) * value ** 2) / 3, -8, 8);
  });
  const interactions = transform.interactionPairs.map(([left, right]) =>
    clamp((standardized[left] ?? 0) * (standardized[right] ?? 0), -8, 8),
  );
  return [...active, ...quadratic, ...interactions];
}

function binaryLogLoss(probability: number, label: number): number {
  const bounded = clamp(probability, 1e-7, 1 - 1e-7);
  return -(label * Math.log(bounded) + (1 - label) * Math.log(1 - bounded));
}

function multiclassLogLoss(probabilities: number[], label: number): number {
  return -Math.log(clamp(probabilities[label] ?? 1 / probabilities.length, 1e-7, 1));
}

function classWeights(labels: number[], classes: number): number[] {
  const counts = Array.from({ length: classes }, () => 0);
  for (const label of labels) counts[label] = (counts[label] ?? 0) + 1;
  return counts.map((count) => (count > 0 ? labels.length / (classes * count) : 1));
}

function recentSampleWeights(samples: ScientificTrainingSample[]): number[] {
  if (samples.length === 0) return [];
  const latest = samples[samples.length - 1]!.kickoffAt.getTime();
  const halfLifeDays = 300;
  return samples.map((sample) => {
    const ageDays = Math.max(0, latest - sample.kickoffAt.getTime()) / 86_400_000;
    return clamp(0.3 + 0.7 * Math.exp((-Math.log(2) * ageDays) / halfLifeDays), 0.3, 1);
  });
}

function bootstrapRows(
  matrix: number[][],
  labels: number[],
  sampleWeights: number[],
  seed: number,
): { matrix: number[][]; labels: number[]; sampleWeights: number[] } {
  if (matrix.length <= 12) {
    return {
      matrix: cloneMatrix(matrix),
      labels: [...labels],
      sampleWeights: [...sampleWeights],
    };
  }
  const random = createSeededRandom(seed);
  const outputMatrix: number[][] = [];
  const outputLabels: number[] = [];
  const outputWeights: number[] = [];
  for (let index = 0; index < matrix.length; index += 1) {
    const selected = Math.min(matrix.length - 1, Math.floor(random() * matrix.length));
    outputMatrix.push([...(matrix[selected] ?? [])]);
    outputLabels.push(labels[selected] ?? 0);
    outputWeights.push(sampleWeights[selected] ?? 1);
  }
  return { matrix: outputMatrix, labels: outputLabels, sampleWeights: outputWeights };
}

function trainBinaryLogistic(input: TrainingOptions): number[] {
  const width = input.matrix[0]?.length ?? 0;
  const weights = Array.from({ length: width + 1 }, () => 0);
  const firstMoment = Array.from({ length: width + 1 }, () => 0);
  const secondMoment = Array.from({ length: width + 1 }, () => 0);
  const random = createSeededRandom(input.seed);
  for (let index = 1; index < weights.length; index += 1) {
    weights[index] = (random() - 0.5) * 0.01;
  }

  const balancedWeights = classWeights(input.labels, 2);
  let bestWeights = [...weights];
  let bestLoss = Number.POSITIVE_INFINITY;
  let staleEpochs = 0;
  const evaluationInterval = 5;
  const patience = Math.max(30, Math.floor(input.epochs * 0.15));

  for (let epoch = 1; epoch <= input.epochs; epoch += 1) {
    const gradients = Array.from({ length: width + 1 }, () => 0);
    let totalWeight = 0;
    for (let rowIndex = 0; rowIndex < input.matrix.length; rowIndex += 1) {
      const row = input.matrix[rowIndex] ?? [];
      const label = input.labels[rowIndex] ?? 0;
      const observationWeight =
        (input.sampleWeights[rowIndex] ?? 1) * (balancedWeights[label] ?? 1);
      const prediction = sigmoid(dot(weights, row));
      const error = (prediction - label) * observationWeight;
      totalWeight += observationWeight;
      gradients[0] = (gradients[0] ?? 0) + error;
      for (let column = 0; column < width; column += 1) {
        gradients[column + 1] = (gradients[column + 1] ?? 0) + error * (row[column] ?? 0);
      }
    }

    const normalizer = Math.max(totalWeight, 1);
    for (let column = 0; column < weights.length; column += 1) {
      const regularization = column === 0 ? 0 : input.l2 * (weights[column] ?? 0);
      const gradient = (gradients[column] ?? 0) / normalizer + regularization;
      firstMoment[column] = 0.9 * (firstMoment[column] ?? 0) + 0.1 * gradient;
      secondMoment[column] = 0.999 * (secondMoment[column] ?? 0) + 0.001 * gradient ** 2;
      const correctedFirst = (firstMoment[column] ?? 0) / (1 - 0.9 ** epoch);
      const correctedSecond = (secondMoment[column] ?? 0) / (1 - 0.999 ** epoch);
      weights[column] =
        (weights[column] ?? 0) -
        (input.learningRate * correctedFirst) / (Math.sqrt(correctedSecond) + 1e-8);
    }

    if (epoch % evaluationInterval !== 0 && epoch !== input.epochs) continue;
    const evaluationMatrix =
      input.validationMatrix.length > 0 ? input.validationMatrix : input.matrix;
    const evaluationLabels =
      input.validationLabels.length > 0 ? input.validationLabels : input.labels;
    const loss = mean(
      evaluationMatrix.map((row, index) =>
        binaryLogLoss(sigmoid(dot(weights, row)), evaluationLabels[index] ?? 0),
      ),
    );
    if (loss + 1e-6 < bestLoss) {
      bestLoss = loss;
      bestWeights = [...weights];
      staleEpochs = 0;
    } else {
      staleEpochs += evaluationInterval;
      if (staleEpochs >= patience) break;
    }
  }
  return bestWeights;
}

function trainSoftmax(input: TrainingOptions & { classes: number }): number[][] {
  const width = input.matrix[0]?.length ?? 0;
  const weights = Array.from({ length: input.classes }, () =>
    Array.from({ length: width + 1 }, () => 0),
  );
  const firstMoment = weights.map((row) => row.map(() => 0));
  const secondMoment = weights.map((row) => row.map(() => 0));
  const random = createSeededRandom(input.seed);
  for (const row of weights) {
    for (let index = 1; index < row.length; index += 1) {
      row[index] = (random() - 0.5) * 0.01;
    }
  }

  const balancedWeights = classWeights(input.labels, input.classes);
  let bestWeights = cloneMatrix(weights);
  let bestLoss = Number.POSITIVE_INFINITY;
  let staleEpochs = 0;
  const evaluationInterval = 5;
  const patience = Math.max(30, Math.floor(input.epochs * 0.15));

  for (let epoch = 1; epoch <= input.epochs; epoch += 1) {
    const gradients = weights.map((row) => row.map(() => 0));
    let totalWeight = 0;
    for (let rowIndex = 0; rowIndex < input.matrix.length; rowIndex += 1) {
      const row = input.matrix[rowIndex] ?? [];
      const label = input.labels[rowIndex] ?? 0;
      const observationWeight =
        (input.sampleWeights[rowIndex] ?? 1) * (balancedWeights[label] ?? 1);
      totalWeight += observationWeight;
      const probabilities = softmax(weights.map((rowWeights) => dot(rowWeights, row)));
      for (let classIndex = 0; classIndex < input.classes; classIndex += 1) {
        const error =
          ((probabilities[classIndex] ?? 0) - (classIndex === label ? 1 : 0)) * observationWeight;
        const classGradient = gradients[classIndex] ?? [];
        classGradient[0] = (classGradient[0] ?? 0) + error;
        for (let column = 0; column < width; column += 1) {
          classGradient[column + 1] = (classGradient[column + 1] ?? 0) + error * (row[column] ?? 0);
        }
      }
    }

    const normalizer = Math.max(totalWeight, 1);
    for (let classIndex = 0; classIndex < input.classes; classIndex += 1) {
      const classWeights = weights[classIndex] ?? [];
      const classGradients = gradients[classIndex] ?? [];
      const classFirstMoment = firstMoment[classIndex] ?? [];
      const classSecondMoment = secondMoment[classIndex] ?? [];
      for (let column = 0; column < classWeights.length; column += 1) {
        const regularization = column === 0 ? 0 : input.l2 * (classWeights[column] ?? 0);
        const gradient = (classGradients[column] ?? 0) / normalizer + regularization;
        classFirstMoment[column] = 0.9 * (classFirstMoment[column] ?? 0) + 0.1 * gradient;
        classSecondMoment[column] =
          0.999 * (classSecondMoment[column] ?? 0) + 0.001 * gradient ** 2;
        const correctedFirst = (classFirstMoment[column] ?? 0) / (1 - 0.9 ** epoch);
        const correctedSecond = (classSecondMoment[column] ?? 0) / (1 - 0.999 ** epoch);
        classWeights[column] =
          (classWeights[column] ?? 0) -
          (input.learningRate * correctedFirst) / (Math.sqrt(correctedSecond) + 1e-8);
      }
    }

    if (epoch % evaluationInterval !== 0 && epoch !== input.epochs) continue;
    const evaluationMatrix =
      input.validationMatrix.length > 0 ? input.validationMatrix : input.matrix;
    const evaluationLabels =
      input.validationLabels.length > 0 ? input.validationLabels : input.labels;
    const loss = mean(
      evaluationMatrix.map((row, index) =>
        multiclassLogLoss(
          softmax(weights.map((rowWeights) => dot(rowWeights, row))),
          evaluationLabels[index] ?? 0,
        ),
      ),
    );
    if (loss + 1e-6 < bestLoss) {
      bestLoss = loss;
      bestWeights = cloneMatrix(weights);
      staleEpochs = 0;
    } else {
      staleEpochs += evaluationInterval;
      if (staleEpochs >= patience) break;
    }
  }
  return bestWeights;
}

function memberPrediction(member: ScientificModelMember, features: number[]): ModelProbabilities {
  const matchWinner = softmax(member.matchWinnerWeights.map((weights) => dot(weights, features)));
  const over25 = sigmoid(dot(member.over25Weights, features));
  return {
    matchWinner,
    over15: member.over15Weights ? sigmoid(dot(member.over15Weights, features)) : over25,
    over25,
    over35: member.over35Weights ? sigmoid(dot(member.over35Weights, features)) : over25,
    btts: sigmoid(dot(member.bttsWeights, features)),
  };
}

function averageMemberPredictions(predictions: ModelProbabilities[]): ModelProbabilities {
  if (predictions.length === 0) {
    return { matchWinner: [1 / 3, 1 / 3, 1 / 3], over15: 0.5, over25: 0.5, over35: 0.5, btts: 0.5 };
  }
  return {
    matchWinner: [0, 1, 2].map((index) =>
      mean(predictions.map((prediction) => prediction.matchWinner[index] ?? 1 / 3)),
    ),
    over15: mean(predictions.map((prediction) => prediction.over15)),
    over25: mean(predictions.map((prediction) => prediction.over25)),
    over35: mean(predictions.map((prediction) => prediction.over35)),
    btts: mean(predictions.map((prediction) => prediction.btts)),
  };
}

function applyTemperature(probabilities: number[], temperature: number): number[] {
  const boundedTemperature = clamp(temperature, 0.35, 4);
  const transformed = probabilities.map(
    (probability) => Math.log(clamp(probability, 1e-7, 1)) / boundedTemperature,
  );
  return softmax(transformed);
}

function fitTemperature(probabilities: number[][], labels: number[]): number {
  if (probabilities.length < 20) return 1;
  let bestTemperature = 1;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let step = 0; step <= 70; step += 1) {
    const temperature = 0.5 + step * 0.035;
    const loss = mean(
      probabilities.map((row, index) =>
        multiclassLogLoss(applyTemperature(row, temperature), labels[index] ?? 0),
      ),
    );
    if (loss < bestLoss) {
      bestLoss = loss;
      bestTemperature = temperature;
    }
  }
  return bestTemperature;
}

function fitBinaryCalibration(probabilities: number[], labels: number[]): BinaryCalibration {
  if (probabilities.length < 20 || !labels.includes(0) || !labels.includes(1)) {
    return { scale: 1, bias: 0 };
  }
  let scale = 1;
  let bias = 0;
  for (let epoch = 0; epoch < 300; epoch += 1) {
    let scaleGradient = 0;
    let biasGradient = 0;
    for (let index = 0; index < probabilities.length; index += 1) {
      const input = logit(probabilities[index] ?? 0.5);
      const prediction = sigmoid(scale * input + bias);
      const error = prediction - (labels[index] ?? 0);
      scaleGradient += error * input;
      biasGradient += error;
    }
    const normalizer = Math.max(probabilities.length, 1);
    scale -= 0.025 * (scaleGradient / normalizer + 0.001 * (scale - 1));
    bias -= 0.025 * (biasGradient / normalizer + 0.001 * bias);
    scale = clamp(scale, 0.2, 3.5);
    bias = clamp(bias, -2.5, 2.5);
  }
  return { scale, bias };
}

function applyBinaryCalibration(
  probability: number,
  calibration: BinaryCalibration | undefined,
): number {
  if (!calibration) return clamp(probability, 0.001, 0.999);
  return clamp(sigmoid(calibration.scale * logit(probability) + calibration.bias), 0.001, 0.999);
}

function expectedCalibrationError(probabilities: number[], labels: number[], bins = 10): number {
  if (probabilities.length === 0) return 0;
  let total = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const lower = bin / bins;
    const upper = (bin + 1) / bins;
    const indices = probabilities
      .map((probability, index) => ({ probability, index }))
      .filter(({ probability }) =>
        bin === bins - 1
          ? probability >= lower && probability <= upper
          : probability >= lower && probability < upper,
      );
    if (indices.length === 0) continue;
    const confidence = mean(indices.map(({ probability }) => probability));
    const accuracy = mean(indices.map(({ index }) => labels[index] ?? 0));
    total += (indices.length / probabilities.length) * Math.abs(confidence - accuracy);
  }
  return total;
}

function calculateValidationMetrics(input: {
  matchWinner: number[][];
  matchWinnerLabels: number[];
  over25: number[];
  over25Labels: number[];
  btts: number[];
  bttsLabels: number[];
}): ScientificValidationMetrics {
  const matchWinnerBrier = mean(
    input.matchWinner.map((probabilities, rowIndex) => {
      const label = input.matchWinnerLabels[rowIndex] ?? 0;
      return (
        [0, 1, 2].reduce(
          (sum, classIndex) =>
            sum + ((probabilities[classIndex] ?? 0) - (classIndex === label ? 1 : 0)) ** 2,
          0,
        ) / 3
      );
    }),
  );
  return {
    matchWinnerLogLoss: mean(
      input.matchWinner.map((probabilities, index) =>
        multiclassLogLoss(probabilities, input.matchWinnerLabels[index] ?? 0),
      ),
    ),
    matchWinnerBrier,
    over25LogLoss: mean(
      input.over25.map((probability, index) =>
        binaryLogLoss(probability, input.over25Labels[index] ?? 0),
      ),
    ),
    over25Brier: mean(
      input.over25.map(
        (probability, index) => (probability - (input.over25Labels[index] ?? 0)) ** 2,
      ),
    ),
    bttsLogLoss: mean(
      input.btts.map((probability, index) =>
        binaryLogLoss(probability, input.bttsLabels[index] ?? 0),
      ),
    ),
    bttsBrier: mean(
      input.btts.map((probability, index) => (probability - (input.bttsLabels[index] ?? 0)) ** 2),
    ),
    expectedCalibrationError:
      (expectedCalibrationError(input.over25, input.over25Labels) +
        expectedCalibrationError(input.btts, input.bttsLabels)) /
      2,
  };
}

export function trainScientificArtifact(input: {
  samples: ScientificTrainingSample[];
  epochs?: number;
  learningRate?: number;
  l2?: number;
  ensembleMembers?: number;
  randomSeed?: number;
  validationFraction?: number;
  trainedAt?: Date;
}): ScientificModelArtifact {
  if (input.samples.length === 0) {
    throw new Error('Scientific model training requires at least one sample.');
  }

  const sortedSamples = [...input.samples].sort(
    (left, right) => left.kickoffAt.getTime() - right.kickoffAt.getTime(),
  );
  const featureWidth = Math.max(
    SCIENTIFIC_FEATURE_NAMES.length,
    ...sortedSamples.map((sample) => sample.features.length),
  );
  const normalizedSamples = sortedSamples.map((sample) => ({
    ...sample,
    features: normalizeFeatureWidth(sample.features, featureWidth),
  }));

  const epochs = Math.max(40, Math.floor(input.epochs ?? 360));
  const learningRate = clamp(input.learningRate ?? 0.018, 0.0001, 0.2);
  const l2 = clamp(input.l2 ?? 0.003, 0, 1);
  const randomSeed = Math.floor(input.randomSeed ?? 2_026_0722);
  const ensembleMembers = Math.max(1, Math.min(9, Math.floor(input.ensembleMembers ?? 3)));
  const validationFraction = clamp(input.validationFraction ?? 0.2, 0.1, 0.35);

  const requestedValidation = Math.max(
    20,
    Math.floor(normalizedSamples.length * validationFraction),
  );
  const validationSize =
    normalizedSamples.length >= 60
      ? Math.min(requestedValidation, normalizedSamples.length - 35)
      : 0;
  const splitIndex = normalizedSamples.length - validationSize;
  const trainingSamples = normalizedSamples.slice(0, splitIndex);
  const validationSamples = normalizedSamples.slice(splitIndex);
  const rawTrainingMatrix = trainingSamples.map((sample) => sample.features);
  const { means, standardDeviations, activeFeatureIndices } = buildStatistics(rawTrainingMatrix);
  const transform = buildTransform(activeFeatureIndices);

  const trainingMatrix = rawTrainingMatrix.map((features) =>
    expandFeatures(features, means, standardDeviations, transform),
  );
  const validationMatrix = validationSamples.map((sample) =>
    expandFeatures(sample.features, means, standardDeviations, transform),
  );
  const recencyWeights = recentSampleWeights(trainingSamples);
  const members: ScientificModelMember[] = [];

  for (let memberIndex = 0; memberIndex < ensembleMembers; memberIndex += 1) {
    const seed = randomSeed + memberIndex * 104_729;
    const winnerBootstrap = bootstrapRows(
      trainingMatrix,
      trainingSamples.map((sample) => sample.matchWinnerClass),
      recencyWeights,
      seed + 11,
    );
    const over15Bootstrap = bootstrapRows(
      trainingMatrix,
      trainingSamples.map((sample) => sample.over15 ?? sample.over25),
      recencyWeights,
      seed + 17,
    );
    const overBootstrap = bootstrapRows(
      trainingMatrix,
      trainingSamples.map((sample) => sample.over25),
      recencyWeights,
      seed + 23,
    );
    const over35Bootstrap = bootstrapRows(
      trainingMatrix,
      trainingSamples.map((sample) => sample.over35 ?? sample.over25),
      recencyWeights,
      seed + 29,
    );
    const bttsBootstrap = bootstrapRows(
      trainingMatrix,
      trainingSamples.map((sample) => sample.btts),
      recencyWeights,
      seed + 37,
    );

    const matchWinnerWeights = trainSoftmax({
      matrix: winnerBootstrap.matrix,
      labels: winnerBootstrap.labels,
      sampleWeights: winnerBootstrap.sampleWeights,
      validationMatrix,
      validationLabels: validationSamples.map((sample) => sample.matchWinnerClass),
      classes: 3,
      epochs,
      learningRate,
      l2,
      seed: seed + 41,
    });
    const over15Weights = trainBinaryLogistic({
      matrix: over15Bootstrap.matrix,
      labels: over15Bootstrap.labels,
      sampleWeights: over15Bootstrap.sampleWeights,
      validationMatrix,
      validationLabels: validationSamples.map((sample) => sample.over15 ?? sample.over25),
      epochs,
      learningRate,
      l2,
      seed: seed + 47,
    });
    const over25Weights = trainBinaryLogistic({
      matrix: overBootstrap.matrix,
      labels: overBootstrap.labels,
      sampleWeights: overBootstrap.sampleWeights,
      validationMatrix,
      validationLabels: validationSamples.map((sample) => sample.over25),
      epochs,
      learningRate,
      l2,
      seed: seed + 53,
    });
    const over35Weights = trainBinaryLogistic({
      matrix: over35Bootstrap.matrix,
      labels: over35Bootstrap.labels,
      sampleWeights: over35Bootstrap.sampleWeights,
      validationMatrix,
      validationLabels: validationSamples.map((sample) => sample.over35 ?? sample.over25),
      epochs,
      learningRate,
      l2,
      seed: seed + 59,
    });
    const bttsWeights = trainBinaryLogistic({
      matrix: bttsBootstrap.matrix,
      labels: bttsBootstrap.labels,
      sampleWeights: bttsBootstrap.sampleWeights,
      validationMatrix,
      validationLabels: validationSamples.map((sample) => sample.btts),
      epochs,
      learningRate,
      l2,
      seed: seed + 67,
    });
    members.push({
      matchWinnerWeights,
      over15Weights,
      over25Weights,
      over35Weights,
      bttsWeights,
      seed,
    });
  }

  const rawValidationPredictions = validationMatrix.map((features) =>
    averageMemberPredictions(members.map((member) => memberPrediction(member, features))),
  );
  const calibration: ScientificCalibration = {
    matchWinnerTemperature: fitTemperature(
      rawValidationPredictions.map((prediction) => prediction.matchWinner),
      validationSamples.map((sample) => sample.matchWinnerClass),
    ),
    over15: fitBinaryCalibration(
      rawValidationPredictions.map((prediction) => prediction.over15),
      validationSamples.map((sample) => sample.over15 ?? sample.over25),
    ),
    over25: fitBinaryCalibration(
      rawValidationPredictions.map((prediction) => prediction.over25),
      validationSamples.map((sample) => sample.over25),
    ),
    over35: fitBinaryCalibration(
      rawValidationPredictions.map((prediction) => prediction.over35),
      validationSamples.map((sample) => sample.over35 ?? sample.over25),
    ),
    btts: fitBinaryCalibration(
      rawValidationPredictions.map((prediction) => prediction.btts),
      validationSamples.map((sample) => sample.btts),
    ),
  };

  const calibratedValidation = rawValidationPredictions.map((prediction) => ({
    matchWinner: applyTemperature(prediction.matchWinner, calibration.matchWinnerTemperature),
    over15: applyBinaryCalibration(prediction.over15, calibration.over15),
    over25: applyBinaryCalibration(prediction.over25, calibration.over25),
    over35: applyBinaryCalibration(prediction.over35, calibration.over35),
    btts: applyBinaryCalibration(prediction.btts, calibration.btts),
  }));
  const validationMetrics = calculateValidationMetrics({
    matchWinner: calibratedValidation.map((prediction) => prediction.matchWinner),
    matchWinnerLabels: validationSamples.map((sample) => sample.matchWinnerClass),
    over25: calibratedValidation.map((prediction) => prediction.over25),
    over25Labels: validationSamples.map((sample) => sample.over25),
    btts: calibratedValidation.map((prediction) => prediction.btts),
    bttsLabels: validationSamples.map((sample) => sample.btts),
  });

  const firstMember = members[0]!;
  const trainedThrough = normalizedSamples[normalizedSamples.length - 1]!.kickoffAt;
  const requestedTrainedAt = input.trainedAt ?? new Date();
  const trainedAt = new Date(Math.max(requestedTrainedAt.getTime(), trainedThrough.getTime() + 1));
  return {
    version: SCIENTIFIC_MODEL_VERSION,
    featureNames: Array.from(
      { length: featureWidth },
      (_, index) => SCIENTIFIC_FEATURE_NAMES[index] ?? `feature_${index}`,
    ),
    means,
    standardDeviations,
    matchWinnerWeights: firstMember.matchWinnerWeights,
    over15Weights: firstMember.over15Weights,
    over25Weights: firstMember.over25Weights,
    over35Weights: firstMember.over35Weights,
    bttsWeights: firstMember.bttsWeights,
    sampleSize: normalizedSamples.length,
    trainedAt: trainedAt.toISOString(),
    trainedThrough: trainedThrough.toISOString(),
    epochs,
    learningRate,
    l2,
    algorithm:
      'bagged nonlinear logistic ensemble + chronological validation + probability calibration',
    randomSeed,
    validationSampleSize: validationSamples.length,
    members,
    transform,
    calibration,
    validationMetrics,
  };
}

/**
 * PREDICTION_AI_V7: opponent-strength-adjusted points per game.
 *
 * Results against strong opponents carry more information about a team's true
 * level. Each result's contribution is weighted by the opponent's Elo at that
 * time (normalized around 1500). Rows without an opponent rating weight 1.
 */
export function opponentAdjustedPpg(
  rows: Array<{ points: number; opponentRating: number | null }>,
  fallback = 1.35,
): number {
  if (rows.length === 0) return fallback;
  const weights = rows.map((row) =>
    row.opponentRating == null ? 1 : clamp(0.6 + (row.opponentRating - 1500) / 750, 0.25, 1.5),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return fallback;
  return rows.reduce((sum, row, index) => sum + row.points * weights[index]!, 0) / totalWeight;
}

/**
 * PREDICTION_AI_V7: assemble the v7 artifact on top of a trained v6-style base.
 * - sets the v7 version marker;
 * - attaches learned stacking weights (poisson/elo/ml/market blend);
 * - attaches isotonic calibration for binary markets;
 * - keeps all base fields so prediction and audit keep working.
 */
export function buildScientificArtifactV7(input: {
  base: ScientificModelArtifact;
  stacking?: ScientificStackWeights | null;
  isotonic?: ScientificModelArtifact['isotonic'];
}): ScientificModelArtifact {
  const stacking = input.stacking ?? undefined;
  return {
    ...input.base,
    version: SCIENTIFIC_MODEL_VERSION_V7,
    featureNames: [...SCIENTIFIC_FEATURE_NAMES_V7],
    ...(stacking ? { stacking } : {}),
    ...(input.isotonic && Object.keys(input.isotonic).length > 0
      ? { isotonic: input.isotonic }
      : {}),
    algorithm: input.base.algorithm
      ? `${input.base.algorithm} + v7 market features + learned stacking + isotonic calibration`
      : 'v7 stacked ensemble (poisson + elo + ml + market) with isotonic calibration',
  };
}

export function isScientificModelArtifact(value: unknown): value is ScientificModelArtifact {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ScientificModelArtifact>;
  return (
    (candidate.version === SCIENTIFIC_MODEL_VERSION ||
      candidate.version === SCIENTIFIC_MODEL_VERSION_V7) &&
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

function legacyPrediction(
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
  const over15 = artifact.over15Weights ? sigmoid(dot(artifact.over15Weights, standardized)) : null;
  const over35 = artifact.over35Weights ? sigmoid(dot(artifact.over35Weights, standardized)) : null;
  const yes = sigmoid(dot(artifact.bttsWeights, standardized));
  return {
    matchWinner: normalizeProbabilities({
      HOME: matchWinnerValues[0] ?? 1 / 3,
      DRAW: matchWinnerValues[1] ?? 1 / 3,
      AWAY: matchWinnerValues[2] ?? 1 / 3,
    }),
    ...(over15 == null
      ? {}
      : { over15: normalizeProbabilities({ OVER: over15, UNDER: 1 - over15 }) }),
    over25: normalizeProbabilities({ OVER: over, UNDER: 1 - over }),
    ...(over35 == null
      ? {}
      : { over35: normalizeProbabilities({ OVER: over35, UNDER: 1 - over35 }) }),
    btts: normalizeProbabilities({ YES: yes, NO: 1 - yes }),
    uncertainty: { matchWinner: 0.08, over25: 0.08, btts: 0.08, memberCount: 1 },
  };
}

/**
 * PREDICTION_AI_V7: adapt a feature vector to the width the artifact was
 * trained with. v6 artifacts get the first 16 features (their training width);
 * v7 artifacts get the full 29-wide vector. Padding uses neutral fallbacks
 * (0 except homeAdvantage slot = 1 for v6-style vectors).
 */
export function adaptFeatureWidth(features: number[], artifact: ScientificModelArtifact): number[] {
  const expectedWidth = artifact.featureNames.length;
  if (features.length === expectedWidth) return features;
  if (features.length > expectedWidth) return features.slice(0, expectedWidth);
  const padded = [...features];
  for (let index = features.length; index < expectedWidth; index += 1) {
    padded.push(SCIENTIFIC_FEATURE_NAMES[index] === 'homeAdvantage' ? 1 : 0);
  }
  return padded;
}

export function predictScientificModel(
  artifact: ScientificModelArtifact,
  features: number[],
  options: { horizonMinutes?: number } = {},
): ScientificModelPrediction {
  const adapted = adaptFeatureWidth(features, artifact);
  if (!artifact.members?.length || !artifact.transform) {
    return legacyPrediction(artifact, adapted);
  }
  const transformed = expandFeatures(
    adapted,
    artifact.means,
    artifact.standardDeviations,
    artifact.transform,
  );
  const memberPredictions = artifact.members.map((member) => memberPrediction(member, transformed));
  const average = averageMemberPredictions(memberPredictions);
  const matchWinnerValues = applyTemperature(
    average.matchWinner,
    artifact.calibration?.matchWinnerTemperature ?? 1,
  );
  const hasOuSpecialist = artifact.members.every(
    (member) => Array.isArray(member.over15Weights) && Array.isArray(member.over35Weights),
  );
  const over15 = hasOuSpecialist
    ? applyBinaryCalibration(average.over15, artifact.calibration?.over15)
    : null;
  const over = applyBinaryCalibration(average.over25, artifact.calibration?.over25);
  const over35 = hasOuSpecialist
    ? applyBinaryCalibration(average.over35, artifact.calibration?.over35)
    : null;
  const yes = applyBinaryCalibration(average.btts, artifact.calibration?.btts);
  const matchWinnerUncertainty = Math.max(
    ...[0, 1, 2].map((classIndex) =>
      probabilityStddev(
        memberPredictions.map((prediction) => prediction.matchWinner[classIndex] ?? 1 / 3),
      ),
    ),
  );
  return {
    matchWinner: normalizeProbabilities({
      HOME: matchWinnerValues[0] ?? 1 / 3,
      DRAW: matchWinnerValues[1] ?? 1 / 3,
      AWAY: matchWinnerValues[2] ?? 1 / 3,
    }),
    ...(over15 == null
      ? {}
      : { over15: normalizeProbabilities({ OVER: over15, UNDER: 1 - over15 }) }),
    over25: normalizeProbabilities({ OVER: over, UNDER: 1 - over }),
    ...(over35 == null
      ? {}
      : { over35: normalizeProbabilities({ OVER: over35, UNDER: 1 - over35 }) }),
    btts: normalizeProbabilities({ YES: yes, NO: 1 - yes }),
    uncertainty: {
      matchWinner: clamp(matchWinnerUncertainty, 0, 0.25),
      ...(hasOuSpecialist
        ? {
            over15: clamp(
              probabilityStddev(memberPredictions.map((prediction) => prediction.over15)),
              0,
              0.25,
            ),
          }
        : {}),
      over25: clamp(
        probabilityStddev(memberPredictions.map((prediction) => prediction.over25)),
        0,
        0.25,
      ),
      ...(hasOuSpecialist
        ? {
            over35: clamp(
              probabilityStddev(memberPredictions.map((prediction) => prediction.over35)),
              0,
              0.25,
            ),
          }
        : {}),
      btts: clamp(
        probabilityStddev(memberPredictions.map((prediction) => prediction.btts)),
        0,
        0.25,
      ),
      memberCount: memberPredictions.length,
    },
  };
}

/**
 * PREDICTION_AI_V7: stack-aware prediction. Blends component models with the
 * learned stacking weights when the artifact carries them, then applies
 * isotonic calibration to the binary markets. Falls back to the plain
 * predictScientificModel for v6 artifacts or missing components.
 */
export function predictScientificModelV7(input: {
  artifact: ScientificModelArtifact;
  features: number[];
  poissonMatchWinner?: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  poissonOver25?: number;
  poissonBttsYes?: number;
  eloMatchWinner?: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  marketMatchWinner?: Record<'HOME' | 'DRAW' | 'AWAY', number> | null;
  marketOver25?: number | null;
  marketBttsYes?: number | null;
  horizonMinutes?: number;
}): ScientificModelPrediction {
  const base = predictScientificModel(input.artifact, input.features, {
    horizonMinutes: input.horizonMinutes,
  });
  const isV7 = input.artifact.version === SCIENTIFIC_MODEL_VERSION_V7;
  const stacking = input.artifact.stacking;
  if (!isV7 || !stacking) return base;
  if (!input.poissonMatchWinner || input.poissonOver25 == null) return base;

  const fitComponents = (components: number[][], trainedWeights: number[]): number[] | null => {
    if (components.length === 0) return null;
    if (components.length === trainedWeights.length) {
      return blendComponents(components, trainedWeights);
    }
    if (components.length < trainedWeights.length) {
      const effective = trainedWeights.slice(0, components.length);
      const total = effective.reduce((sum, weight) => sum + weight, 0);
      if (total <= 0) return null;
      return blendComponents(
        components,
        effective.map((weight) => weight / total),
      );
    }
    return null;
  };

  const matchWinnerComponents: number[][] = [
    [input.poissonMatchWinner.HOME, input.poissonMatchWinner.DRAW, input.poissonMatchWinner.AWAY],
    [
      input.eloMatchWinner?.HOME ?? 1 / 3,
      input.eloMatchWinner?.DRAW ?? 1 / 3,
      input.eloMatchWinner?.AWAY ?? 1 / 3,
    ],
    [base.matchWinner.HOME, base.matchWinner.DRAW, base.matchWinner.AWAY],
  ];
  if (input.marketMatchWinner) {
    matchWinnerComponents.push([
      input.marketMatchWinner.HOME,
      input.marketMatchWinner.DRAW,
      input.marketMatchWinner.AWAY,
    ]);
  }
  const stackedMatchWinner = fitComponents(matchWinnerComponents, stacking.matchWinner);
  const matchWinner = stackedMatchWinner
    ? normalizeProbabilities({
        HOME: stackedMatchWinner[0] ?? base.matchWinner.HOME,
        DRAW: stackedMatchWinner[1] ?? base.matchWinner.DRAW,
        AWAY: stackedMatchWinner[2] ?? base.matchWinner.AWAY,
      })
    : base.matchWinner;

  const over25Components: number[][] = [[input.poissonOver25], [base.over25.OVER]];
  if (input.marketOver25 != null) over25Components.push([input.marketOver25]);
  const stackedOver25 = fitComponents(over25Components, stacking.over25);
  const over25Blend =
    stackedOver25 == null ? base.over25.OVER : (stackedOver25[0] ?? base.over25.OVER);
  const over25Calibrated = input.artifact.isotonic?.over25
    ? applyIsotonicRegression(over25Blend, input.artifact.isotonic.over25)
    : over25Blend;

  const bttsComponents: number[][] = [
    [input.poissonBttsYes ?? input.poissonOver25],
    [base.btts.YES],
  ];
  if (input.marketBttsYes != null) bttsComponents.push([input.marketBttsYes]);
  const stackedBtts = fitComponents(bttsComponents, stacking.btts);
  const bttsBlend = stackedBtts == null ? base.btts.YES : (stackedBtts[0] ?? base.btts.YES);
  const bttsCalibrated = input.artifact.isotonic?.btts
    ? applyIsotonicRegression(bttsBlend, input.artifact.isotonic.btts)
    : bttsBlend;

  return {
    ...base,
    matchWinner,
    over25: normalizeProbabilities({
      OVER: clamp(over25Calibrated, 0.001, 0.999),
      UNDER: clamp(1 - over25Calibrated, 0.001, 0.999),
    }),
    btts: normalizeProbabilities({
      YES: clamp(bttsCalibrated, 0.001, 0.999),
      NO: clamp(1 - bttsCalibrated, 0.001, 0.999),
    }),
  };
}

function poissonProbability(lambda: number, goals: number): number {
  let factorial = 1;
  for (let index = 2; index <= goals; index += 1) factorial *= index;
  return (Math.exp(-lambda) * lambda ** goals) / factorial;
}

export function estimateDixonColesRho(
  homeExpectedGoals: number,
  awayExpectedGoals: number,
): number {
  const total = homeExpectedGoals + awayExpectedGoals;
  const balance = 1 - clamp(Math.abs(homeExpectedGoals - awayExpectedGoals) / 3.5, 0, 0.8);
  return clamp(-0.09 * Math.exp(-Math.abs(total - 2.45) / 2.2) * balance, -0.12, -0.015);
}

function dixonColesCorrection(
  homeGoals: number,
  awayGoals: number,
  homeExpectedGoals: number,
  awayExpectedGoals: number,
  rho: number,
): number {
  if (homeGoals === 0 && awayGoals === 0) {
    return Math.max(0.05, 1 - homeExpectedGoals * awayExpectedGoals * rho);
  }
  if (homeGoals === 0 && awayGoals === 1) {
    return Math.max(0.05, 1 + homeExpectedGoals * rho);
  }
  if (homeGoals === 1 && awayGoals === 0) {
    return Math.max(0.05, 1 + awayExpectedGoals * rho);
  }
  if (homeGoals === 1 && awayGoals === 1) {
    return Math.max(0.05, 1 - rho);
  }
  return 1;
}

export function poissonGoalMarkets(
  homeExpectedGoals: number,
  awayExpectedGoals: number,
  lineValue = 2.5,
  maximumGoals = 10,
  rho = estimateDixonColesRho(homeExpectedGoals, awayExpectedGoals),
): GoalMarketProbabilities {
  const safeHomeExpectedGoals = clamp(homeExpectedGoals, 0.05, 6);
  const safeAwayExpectedGoals = clamp(awayExpectedGoals, 0.05, 6);
  const scoreRows: Array<{ homeGoals: number; awayGoals: number; probability: number }> = [];
  let rawMass = 0;

  for (let homeGoals = 0; homeGoals <= maximumGoals; homeGoals += 1) {
    const homeProbability = poissonProbability(safeHomeExpectedGoals, homeGoals);
    for (let awayGoals = 0; awayGoals <= maximumGoals; awayGoals += 1) {
      const rawProbability = homeProbability * poissonProbability(safeAwayExpectedGoals, awayGoals);
      const correctedProbability =
        rawProbability *
        dixonColesCorrection(
          homeGoals,
          awayGoals,
          safeHomeExpectedGoals,
          safeAwayExpectedGoals,
          rho,
        );
      rawMass += correctedProbability;
      scoreRows.push({ homeGoals, awayGoals, probability: correctedProbability });
    }
  }

  const normalization = Math.max(rawMass, EPSILON);
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  let bttsYes = 0;
  let overWin = 0;
  let underWin = 0;
  let push = 0;

  for (const row of scoreRows) {
    const probability = row.probability / normalization;
    const totalGoals = row.homeGoals + row.awayGoals;
    if (row.homeGoals > row.awayGoals) homeWin += probability;
    else if (row.homeGoals < row.awayGoals) awayWin += probability;
    else draw += probability;
    if (row.homeGoals > 0 && row.awayGoals > 0) bttsYes += probability;
    if (Math.abs(totalGoals - lineValue) < 0.0001) push += probability;
    else if (totalGoals > lineValue) overWin += probability;
    else underWin += probability;
  }

  const nonPush = Math.max(EPSILON, overWin + underWin);
  return {
    matchWinner: normalizeProbabilities({ HOME: homeWin, DRAW: draw, AWAY: awayWin }),
    btts: normalizeProbabilities({ YES: bttsYes, NO: Math.max(0, 1 - bttsYes) }),
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

export function adaptiveModelWeight(input: {
  baseWeight?: number;
  sampleSize?: number;
  dataQuality?: number;
  uncertainty?: number;
  disagreement?: number;
}): number {
  const baseWeight = clamp(input.baseWeight ?? 0.55, 0, 1);
  const sampleReliability = clamp(Math.log10(Math.max(10, input.sampleSize ?? 10)) / 3, 0.35, 1);
  const dataQuality = clamp(input.dataQuality ?? 0.65, 0.2, 1);
  const uncertaintyPenalty = 1 - clamp((input.uncertainty ?? 0) * 4, 0, 0.65);
  const disagreementPenalty = 1 - clamp((input.disagreement ?? 0) * 1.8, 0, 0.55);
  return clamp(
    baseWeight * sampleReliability * dataQuality * uncertaintyPenalty * disagreementPenalty,
    0.12,
    0.72,
  );
}

export function conservativeProbability(input: {
  probability: number;
  uncertainty?: number;
  dataQuality?: number;
  penaltyMultiplier?: number;
}): number {
  const uncertainty = clamp(input.uncertainty ?? 0, 0, 0.25);
  const dataQuality = clamp(input.dataQuality ?? 0.65, 0, 1);
  const multiplier = clamp(input.penaltyMultiplier ?? 0.85, 0, 3);
  const qualityPenalty = (1 - dataQuality) * 0.015;
  return clamp(input.probability - uncertainty * multiplier - qualityPenalty, 0.001, 0.999);
}

export function calibrateTotalProbability(input: {
  lineProbability: number;
  poissonOver25: number;
  modelOver25?: number;
  calibrationWeight?: number;
  modelUncertainty?: number;
  dataQuality?: number;
}): number {
  if (input.modelOver25 === undefined) return clamp(input.lineProbability, 0.001, 0.999);
  const correction = logit(input.modelOver25) - logit(input.poissonOver25);
  const disagreement = Math.abs(input.modelOver25 - input.poissonOver25);
  const weight = adaptiveModelWeight({
    baseWeight: input.calibrationWeight ?? 0.35,
    sampleSize: 600,
    dataQuality: input.dataQuality ?? 0.75,
    uncertainty: input.modelUncertainty,
    disagreement,
  });
  return clamp(inverseLogit(logit(input.lineProbability) + correction * weight), 0.001, 0.999);
}
