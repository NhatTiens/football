export const SCIENTIFIC_SHADOW_VERSION = 'v7.0-alpha.8-fresh-shadow-evaluation-v1';

export const SCIENTIFIC_SHADOW_FORMULA_VERSION = 'convex-cap-then-temperature-v1';

export const SCIENTIFIC_SHADOW_POLICY_VERSION = 'fresh-shadow-promotion-policy-v1';

export const DEFAULT_SCIENTIFIC_SHADOW_EXPERIMENT_ID = '289d3fdb1fab2547';

export type ShadowMatchWinnerClass = 'HOME' | 'DRAW' | 'AWAY';

export interface ShadowMatchWinnerProbabilities {
  HOME: number;
  DRAW: number;
  AWAY: number;
}

export interface FrozenShadowCandidateConfiguration {
  baselineWeight: number;
  dixonColesWeight: number;
  temperature: number;
  maximumProbabilityShift: number;
}

export interface ShadowPredictionMetricSet {
  rows: number;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  expectedCalibrationError: number | null;
}

export interface ShadowBettingMetricSet {
  bets: number;
  roi: number | null;
  maximumDrawdownUnits: number;
  averageClv: number | null;
}

export interface ShadowReviewInput {
  baseline: {
    prediction: ShadowPredictionMetricSet;
    betting: ShadowBettingMetricSet;
  };
  candidate: {
    prediction: ShadowPredictionMetricSet;
    betting: ShadowBettingMetricSet;
  };
  freshFixtures: number;
  leakageViolations: number;
  freshnessViolations: number;
  minimumFreshFixtures?: number;
  minimumFreshBets?: number;
  minimumRelativeBrierImprovement?: number;
  maximumLogLossRegression?: number;
  maximumEceRegression?: number;
  minimumRoiImprovement?: number;
  maximumDrawdownRegressionUnits?: number;
  requirePositiveClv?: boolean;
}

export interface ShadowReviewDecision {
  status: 'COLLECTING' | 'ELIGIBLE_FOR_MANUAL_REVIEW' | 'HOLD' | 'REJECT';
  passed: boolean;
  reasons: string[];
  gates: {
    zeroLeakage: boolean;
    zeroFreshnessViolations: boolean;
    sufficientFreshFixtures: boolean;
    sufficientBets: boolean;
    brierImproved: boolean;
    logLossNotWorse: boolean;
    calibrationControlled: boolean;
    roiNotWorse: boolean;
    drawdownControlled: boolean;
    clvAcceptable: boolean;
  };
  deltas: {
    relativeBrierImprovement: number | null;
    logLossChange: number | null;
    eceChange: number | null;
    roiImprovement: number | null;
    drawdownChangeUnits: number;
    clvChange: number | null;
  };
}

const EPSILON = 1e-12;

export function shadowClamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number | null | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function normalizeShadowProbabilities(
  probabilities: ShadowMatchWinnerProbabilities,
): ShadowMatchWinnerProbabilities {
  const home = Math.max(0, finite(probabilities.HOME));
  const draw = Math.max(0, finite(probabilities.DRAW));
  const away = Math.max(0, finite(probabilities.AWAY));
  const total = home + draw + away;

  if (total <= EPSILON) {
    return {
      HOME: 1 / 3,
      DRAW: 1 / 3,
      AWAY: 1 / 3,
    };
  }

  return {
    HOME: home / total,
    DRAW: draw / total,
    AWAY: away / total,
  };
}

export function capShadowProbabilityShift(
  candidate: ShadowMatchWinnerProbabilities,
  baseline: ShadowMatchWinnerProbabilities,
  maximumShift: number,
): ShadowMatchWinnerProbabilities {
  const normalizedCandidate = normalizeShadowProbabilities(candidate);
  const normalizedBaseline = normalizeShadowProbabilities(baseline);
  const differences = [
    normalizedCandidate.HOME - normalizedBaseline.HOME,
    normalizedCandidate.DRAW - normalizedBaseline.DRAW,
    normalizedCandidate.AWAY - normalizedBaseline.AWAY,
  ];
  const maximumDifference = Math.max(...differences.map((value) => Math.abs(value)));

  if (maximumDifference <= maximumShift + EPSILON) {
    return normalizedCandidate;
  }

  const scale = maximumShift / Math.max(maximumDifference, EPSILON);

  return normalizeShadowProbabilities({
    HOME: normalizedBaseline.HOME + differences[0]! * scale,
    DRAW: normalizedBaseline.DRAW + differences[1]! * scale,
    AWAY: normalizedBaseline.AWAY + differences[2]! * scale,
  });
}

export function applyShadowTemperature(
  probabilities: ShadowMatchWinnerProbabilities,
  temperature: number,
): ShadowMatchWinnerProbabilities {
  if (!Number.isFinite(temperature) || temperature <= 0) {
    throw new RangeError('Temperature must be a positive finite number.');
  }

  const normalized = normalizeShadowProbabilities(probabilities);

  if (Math.abs(temperature - 1) <= EPSILON) {
    return normalized;
  }

  const inverse = 1 / temperature;
  const powered = {
    HOME: normalized.HOME ** inverse,
    DRAW: normalized.DRAW ** inverse,
    AWAY: normalized.AWAY ** inverse,
  };

  return normalizeShadowProbabilities(powered);
}

export function buildFrozenShadowCandidateProbability(
  baseline: ShadowMatchWinnerProbabilities,
  dixonColes: ShadowMatchWinnerProbabilities,
  configuration: FrozenShadowCandidateConfiguration,
): ShadowMatchWinnerProbabilities {
  const baselineWeight = finite(configuration.baselineWeight);
  const dixonWeight = finite(configuration.dixonColesWeight);
  const totalWeight = baselineWeight + dixonWeight;

  if (baselineWeight < 0 || dixonWeight < 0 || totalWeight <= EPSILON) {
    throw new RangeError('Candidate weights must be non-negative with a positive total.');
  }

  const normalizedBaseline = normalizeShadowProbabilities(baseline);
  const normalizedDixon = normalizeShadowProbabilities(dixonColes);
  const rawBlend = normalizeShadowProbabilities({
    HOME:
      (normalizedBaseline.HOME * baselineWeight + normalizedDixon.HOME * dixonWeight) / totalWeight,
    DRAW:
      (normalizedBaseline.DRAW * baselineWeight + normalizedDixon.DRAW * dixonWeight) / totalWeight,
    AWAY:
      (normalizedBaseline.AWAY * baselineWeight + normalizedDixon.AWAY * dixonWeight) / totalWeight,
  });
  const capped = capShadowProbabilityShift(
    rawBlend,
    normalizedBaseline,
    configuration.maximumProbabilityShift,
  );

  // Alpha.7.1 selected the candidate using this exact order:
  // convex blend -> shift cap -> temperature scaling.
  return applyShadowTemperature(capped, configuration.temperature);
}

function finiteDifference(
  left: number | null | undefined,
  right: number | null | undefined,
): number | null {
  return left != null && right != null && Number.isFinite(left) && Number.isFinite(right)
    ? Number(left) - Number(right)
    : null;
}

export function decideScientificShadowReview(input: ShadowReviewInput): ShadowReviewDecision {
  const minimumFreshFixtures = input.minimumFreshFixtures ?? 150;
  const minimumFreshBets = input.minimumFreshBets ?? 30;
  const minimumRelativeBrierImprovement = input.minimumRelativeBrierImprovement ?? 0.005;
  const maximumLogLossRegression = input.maximumLogLossRegression ?? 0;
  const maximumEceRegression = input.maximumEceRegression ?? 0.02;
  const minimumRoiImprovement = input.minimumRoiImprovement ?? 0;
  const maximumDrawdownRegressionUnits = input.maximumDrawdownRegressionUnits ?? 2;
  const requirePositiveClv = input.requirePositiveClv ?? true;

  const candidateBrier = input.candidate.prediction.brier;
  const baselineBrier = input.baseline.prediction.brier;
  const relativeBrierImprovement =
    candidateBrier != null && baselineBrier != null && baselineBrier > EPSILON
      ? (baselineBrier - candidateBrier) / baselineBrier
      : null;
  const logLossChange = finiteDifference(
    input.candidate.prediction.logLoss,
    input.baseline.prediction.logLoss,
  );
  const eceChange = finiteDifference(
    input.candidate.prediction.expectedCalibrationError,
    input.baseline.prediction.expectedCalibrationError,
  );
  const roiImprovement = finiteDifference(input.candidate.betting.roi, input.baseline.betting.roi);
  const drawdownChangeUnits =
    input.candidate.betting.maximumDrawdownUnits - input.baseline.betting.maximumDrawdownUnits;
  const clvChange = finiteDifference(
    input.candidate.betting.averageClv,
    input.baseline.betting.averageClv,
  );

  const gates = {
    zeroLeakage: input.leakageViolations === 0,
    zeroFreshnessViolations: input.freshnessViolations === 0,
    sufficientFreshFixtures: input.freshFixtures >= minimumFreshFixtures,
    sufficientBets: input.candidate.betting.bets >= minimumFreshBets,
    brierImproved:
      relativeBrierImprovement != null &&
      relativeBrierImprovement >= minimumRelativeBrierImprovement,
    logLossNotWorse: logLossChange != null && logLossChange <= maximumLogLossRegression,
    calibrationControlled: eceChange != null && eceChange <= maximumEceRegression,
    roiNotWorse: roiImprovement != null && roiImprovement >= minimumRoiImprovement,
    drawdownControlled: drawdownChangeUnits <= maximumDrawdownRegressionUnits,
    clvAcceptable:
      !requirePositiveClv ||
      (input.candidate.betting.averageClv != null && input.candidate.betting.averageClv! > 0),
  };

  const reasons = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([gate]) => `FAILED_${gate.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`);
  const collecting = !gates.sufficientFreshFixtures || !gates.sufficientBets;
  const hardFailure =
    !gates.zeroLeakage ||
    !gates.zeroFreshnessViolations ||
    (!collecting && (!gates.brierImproved || !gates.logLossNotWorse));
  const passed = Object.values(gates).every(Boolean);

  return {
    status: passed
      ? 'ELIGIBLE_FOR_MANUAL_REVIEW'
      : collecting
        ? 'COLLECTING'
        : hardFailure
          ? 'REJECT'
          : 'HOLD',
    passed,
    reasons,
    gates,
    deltas: {
      relativeBrierImprovement,
      logLossChange,
      eceChange,
      roiImprovement,
      drawdownChangeUnits,
      clvChange,
    },
  };
}
