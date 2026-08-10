import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';

export const CALIBRATION_UNCERTAINTY_VERSION =
  'v8.0-stage5-temporal-calibration-uncertainty-v1';
export const CALIBRATION_POLICY_VERSION = 'v8.0-stage5-temperature-calibration-policy-v1';

export type CalibrationSplit = 'TRAIN' | 'CALIBRATION' | 'TEST';

export interface CalibrationObservation {
  fixtureId: number;
  leagueId: number;
  horizonMinutes: number;
  kickoffAt: string;
  marketKey: string;
  probabilities: Record<string, number>;
  outcome: string;
  componentDisagreement: number;
}

export interface ProbabilityMetrics {
  samples: number;
  brierScore: number | null;
  logLoss: number | null;
  ece: number | null;
  reliability: Array<{
    binFrom: number;
    binTo: number;
    samples: number;
    meanConfidence: number | null;
    accuracy: number | null;
  }>;
}

export interface TemperatureCalibrator {
  version: string;
  scope: 'MARKET_HORIZON' | 'LEAGUE_MARKET_HORIZON';
  marketKey: string;
  horizonMinutes: number;
  leagueId: number | null;
  trainedFrom: string;
  trainedThrough: string;
  samples: number;
  temperature: number;
  rawCalibrationMetrics: ProbabilityMetrics;
  calibratedCalibrationMetrics: ProbabilityMetrics;
  accepted: boolean;
  rejectionReason: string | null;
  artifactHash: string;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeProbabilities(
  probabilities: Record<string, number>,
): Record<string, number> {
  const entries = Object.entries(probabilities).map(([key, value]) => [
    key,
    clampProbability(Number(value)),
  ] as const);
  const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  if (entries.length === 0 || total <= 1e-15) {
    throw new Error('Cannot normalize an empty probability vector.');
  }
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total]));
}

export function applyTemperature(
  probabilities: Record<string, number>,
  temperature: number,
): Record<string, number> {
  const safeTemperature = Number.isFinite(temperature) && temperature > 0 ? temperature : 1;
  const normalized = normalizeProbabilities(probabilities);
  const powered = Object.fromEntries(
    Object.entries(normalized).map(([key, value]) => [
      key,
      Math.exp(Math.log(Math.max(1e-12, value)) / safeTemperature),
    ]),
  );
  return normalizeProbabilities(powered);
}

function topSelection(probabilities: Record<string, number>): [string, number] {
  const entries = Object.entries(probabilities);
  if (entries.length === 0) throw new Error('Probability vector is empty.');
  return entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
}

export function probabilityMetrics(
  observations: readonly CalibrationObservation[],
  transform: (probabilities: Record<string, number>) => Record<string, number> =
    normalizeProbabilities,
  binCount = 10,
): ProbabilityMetrics {
  if (observations.length === 0) {
    return { samples: 0, brierScore: null, logLoss: null, ece: null, reliability: [] };
  }
  let brier = 0;
  let logLoss = 0;
  const bins = Array.from({ length: binCount }, () => ({ samples: 0, confidence: 0, correct: 0 }));
  for (const observation of observations) {
    const probabilities = transform(observation.probabilities);
    if (!(observation.outcome in probabilities)) {
      throw new Error(`Outcome ${observation.outcome} is absent from ${observation.marketKey}.`);
    }
    for (const [selection, probability] of Object.entries(probabilities)) {
      const target = selection === observation.outcome ? 1 : 0;
      brier += (probability - target) ** 2;
    }
    logLoss -= Math.log(Math.max(1e-12, probabilities[observation.outcome]!));
    const [selection, confidence] = topSelection(probabilities);
    const binIndex = Math.min(binCount - 1, Math.floor(confidence * binCount));
    const bin = bins[binIndex]!;
    bin.samples += 1;
    bin.confidence += confidence;
    if (selection === observation.outcome) bin.correct += 1;
  }
  const reliability = bins.map((bin, index) => ({
    binFrom: index / binCount,
    binTo: (index + 1) / binCount,
    samples: bin.samples,
    meanConfidence: bin.samples ? bin.confidence / bin.samples : null,
    accuracy: bin.samples ? bin.correct / bin.samples : null,
  }));
  const ece = reliability.reduce(
    (sum, bin) =>
      sum +
      (bin.samples / observations.length) *
        Math.abs((bin.accuracy ?? 0) - (bin.meanConfidence ?? 0)),
    0,
  );
  return {
    samples: observations.length,
    brierScore: brier / observations.length,
    logLoss: logLoss / observations.length,
    ece,
    reliability,
  };
}

export function fitTemperatureCalibrator(input: {
  observations: readonly CalibrationObservation[];
  scope: TemperatureCalibrator['scope'];
  marketKey: string;
  horizonMinutes: number;
  leagueId?: number | null;
  minimumSamples?: number;
  maximumLogLossRegression?: number;
}): TemperatureCalibrator {
  const minimumSamples = Math.max(20, input.minimumSamples ?? 60);
  const maximumLogLossRegression = Math.max(0, input.maximumLogLossRegression ?? 0.01);
  const rawMetrics = probabilityMetrics(input.observations);
  let bestTemperature = 1;
  let bestMetrics = rawMetrics;
  let bestScore = (rawMetrics.ece ?? Number.POSITIVE_INFINITY) + (rawMetrics.logLoss ?? 0) * 0.15;
  if (input.observations.length >= minimumSamples) {
    for (let step = 10; step <= 300; step += 2) {
      const temperature = step / 100;
      const metrics = probabilityMetrics(input.observations, (probabilities) =>
        applyTemperature(probabilities, temperature),
      );
      if (
        metrics.logLoss != null &&
        rawMetrics.logLoss != null &&
        metrics.logLoss > rawMetrics.logLoss + maximumLogLossRegression
      ) {
        continue;
      }
      const score = (metrics.ece ?? Number.POSITIVE_INFINITY) + (metrics.logLoss ?? 0) * 0.15;
      if (score < bestScore - 1e-12) {
        bestScore = score;
        bestTemperature = temperature;
        bestMetrics = metrics;
      }
    }
  }
  const accepted =
    input.observations.length >= minimumSamples &&
    bestTemperature !== 1 &&
    bestMetrics.ece != null &&
    rawMetrics.ece != null &&
    bestMetrics.ece < rawMetrics.ece &&
    bestMetrics.logLoss != null &&
    rawMetrics.logLoss != null &&
    bestMetrics.logLoss <= rawMetrics.logLoss + maximumLogLossRegression;
  const base = {
    version: CALIBRATION_POLICY_VERSION,
    scope: input.scope,
    marketKey: input.marketKey,
    horizonMinutes: input.horizonMinutes,
    leagueId: input.leagueId ?? null,
    trainedFrom: input.observations[0]?.kickoffAt ?? '',
    trainedThrough: input.observations.at(-1)?.kickoffAt ?? '',
    samples: input.observations.length,
    temperature: accepted ? bestTemperature : 1,
    rawCalibrationMetrics: rawMetrics,
    calibratedCalibrationMetrics: accepted ? bestMetrics : rawMetrics,
    accepted,
    rejectionReason:
      input.observations.length < minimumSamples
        ? 'INSUFFICIENT_CALIBRATION_SAMPLE'
        : accepted
          ? null
          : 'NO_SAFE_CALIBRATION_IMPROVEMENT',
  };
  return { ...base, artifactHash: sha256(stableStringify(base)) };
}

export function temporalFixtureSplit(input: {
  fixtures: Array<{ fixtureId: number; kickoffAt: string }>;
  trainRatio?: number;
  calibrationRatio?: number;
}): Map<number, CalibrationSplit> {
  const trainRatio = input.trainRatio ?? 0.6;
  const calibrationRatio = input.calibrationRatio ?? 0.2;
  const unique = [...new Map(input.fixtures.map((row) => [row.fixtureId, row])).values()].sort(
    (left, right) =>
      new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime() ||
      left.fixtureId - right.fixtureId,
  );
  const trainEnd = Math.floor(unique.length * trainRatio);
  const calibrationEnd = Math.floor(unique.length * (trainRatio + calibrationRatio));
  return new Map(
    unique.map((row, index) => [
      row.fixtureId,
      index < trainEnd ? 'TRAIN' : index < calibrationEnd ? 'CALIBRATION' : 'TEST',
    ]),
  );
}

