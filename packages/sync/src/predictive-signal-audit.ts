import type { PredictionConfidenceGrade } from './three-market-core.js';

export interface ProbabilityBaseline {
  brier: number | null;
  logLoss: number | null;
}

const EPSILON = 1e-12;

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function standardDeviation(values: readonly number[]): number | null {
  const average = mean(values);
  if (average == null) return null;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

export function pearsonCorrelation(left: readonly number[], right: readonly number[]): number | null {
  if (left.length !== right.length || left.length < 3) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  if (leftMean == null || rightMean == null) return null;
  let numerator = 0;
  let leftSq = 0;
  let rightSq = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = (left[index] ?? 0) - leftMean;
    const r = (right[index] ?? 0) - rightMean;
    numerator += l * r;
    leftSq += l * l;
    rightSq += r * r;
  }
  if (leftSq <= EPSILON || rightSq <= EPSILON) return null;
  return numerator / Math.sqrt(leftSq * rightSq);
}

export function rankAuc(values: readonly number[], labels: readonly boolean[]): number | null {
  if (values.length !== labels.length || values.length < 3) return null;
  const positives = labels.filter(Boolean).length;
  const negatives = labels.length - positives;
  if (positives === 0 || negatives === 0) return null;

  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = Array.from({ length: values.length }, () => 0);
  let cursor = 0;
  while (cursor < indexed.length) {
    let end = cursor + 1;
    while (end < indexed.length && Math.abs(indexed[end]!.value - indexed[cursor]!.value) <= 1e-12) {
      end += 1;
    }
    const averageRank = (cursor + 1 + end) / 2;
    for (let position = cursor; position < end; position += 1) {
      ranks[indexed[position]!.index] = averageRank;
    }
    cursor = end;
  }

  let positiveRankSum = 0;
  for (let index = 0; index < labels.length; index += 1) {
    if (labels[index]) positiveRankSum += ranks[index] ?? 0;
  }
  return (positiveRankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

export function binaryPrevalenceBaseline(labels: readonly boolean[]): ProbabilityBaseline {
  if (labels.length === 0) return { brier: null, logLoss: null };
  const positives = labels.filter(Boolean).length;
  const p = Math.min(1 - 1e-9, Math.max(1e-9, positives / labels.length));
  return {
    brier: p * (1 - p),
    logLoss: -(p * Math.log(p) + (1 - p) * Math.log(1 - p)),
  };
}

export function multiclassClimatologyBaseline(
  labels: readonly ('HOME' | 'DRAW' | 'AWAY')[],
): ProbabilityBaseline {
  if (labels.length === 0) return { brier: null, logLoss: null };
  const counts = { HOME: 0, DRAW: 0, AWAY: 0 };
  for (const label of labels) counts[label] += 1;
  const probabilities = {
    HOME: counts.HOME / labels.length,
    DRAW: counts.DRAW / labels.length,
    AWAY: counts.AWAY / labels.length,
  };
  const brier =
    1 -
    (probabilities.HOME ** 2 + probabilities.DRAW ** 2 + probabilities.AWAY ** 2);
  const logLoss = -(['HOME', 'DRAW', 'AWAY'] as const).reduce((sum, label) => {
    const p = Math.max(1e-9, probabilities[label]);
    return sum + p * Math.log(p);
  }, 0);
  return { brier, logLoss };
}

export function properScoreSkill(
  candidate: number | null,
  baseline: number | null,
): number | null {
  if (candidate == null || baseline == null || baseline <= EPSILON) return null;
  return 1 - candidate / baseline;
}

export function aucStrength(auc: number | null): number | null {
  if (auc == null) return null;
  return Math.max(auc, 1 - auc);
}

export interface HorizonVector {
  fixtureId: number;
  horizonMinutes: number;
  features: number[];
  probabilities: {
    hdaHome: number;
    hdaDraw: number;
    hdaAway: number;
    over15: number;
    over25: number;
    over35: number;
    btts: number;
  };
  coverage: {
    model: boolean;
    marketMovement: boolean;
    lineup: boolean;
    injury: boolean;
  };
}

export interface HorizonPairSensitivity {
  leftHorizon: number;
  rightHorizon: number;
  comparableFixtures: number;
  featureChangeCoverage: number | null;
  averageFeatureL1Delta: number | null;
  probabilityChangeCoverage: number | null;
  averageProbabilityL1Delta: number | null;
}

export function summarizeHorizonSensitivity(
  rows: readonly HorizonVector[],
  horizons: readonly number[],
): HorizonPairSensitivity[] {
  const byFixture = new Map<number, Map<number, HorizonVector>>();
  for (const row of rows) {
    const map = byFixture.get(row.fixtureId) ?? new Map<number, HorizonVector>();
    map.set(row.horizonMinutes, row);
    byFixture.set(row.fixtureId, map);
  }

  const sorted = [...horizons].sort((a, b) => b - a);
  const pairs: HorizonPairSensitivity[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const leftHorizon = sorted[index]!;
    const rightHorizon = sorted[index + 1]!;
    let comparable = 0;
    let featureChanged = 0;
    let probabilityChanged = 0;
    const featureDeltas: number[] = [];
    const probabilityDeltas: number[] = [];

    for (const map of byFixture.values()) {
      const left = map.get(leftHorizon);
      const right = map.get(rightHorizon);
      if (!left || !right) continue;
      comparable += 1;

      const width = Math.max(left.features.length, right.features.length);
      let featureL1 = 0;
      for (let feature = 0; feature < width; feature += 1) {
        featureL1 += Math.abs((left.features[feature] ?? 0) - (right.features[feature] ?? 0));
      }
      featureDeltas.push(featureL1);
      if (featureL1 > 1e-8) featureChanged += 1;

      const keys = ['hdaHome','hdaDraw','hdaAway','over15','over25','over35','btts'] as const;
      let probabilityL1 = 0;
      for (const key of keys) {
        probabilityL1 += Math.abs(left.probabilities[key] - right.probabilities[key]);
      }
      probabilityDeltas.push(probabilityL1);
      if (probabilityL1 > 1e-8) probabilityChanged += 1;
    }

    pairs.push({
      leftHorizon,
      rightHorizon,
      comparableFixtures: comparable,
      featureChangeCoverage: comparable > 0 ? featureChanged / comparable : null,
      averageFeatureL1Delta: mean(featureDeltas),
      probabilityChangeCoverage: comparable > 0 ? probabilityChanged / comparable : null,
      averageProbabilityL1Delta: mean(probabilityDeltas),
    });
  }
  return pairs;
}

export function isReleasedGrade(grade: PredictionConfidenceGrade): boolean {
  return grade === 'HIGH' || grade === 'MEDIUM';
}
