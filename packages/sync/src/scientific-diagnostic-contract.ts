export const SCIENTIFIC_DIAGNOSTIC_VERSION = 'v7.0-alpha.7.1-diagnostic-improvement-v1';

export const SCIENTIFIC_DEVELOPMENT_POLICY_VERSION = 'safe-convex-development-v1';

export type ScientificDiagnosticStatus = 'RUNNING' | 'SUCCESS' | 'FAILED';

export type ScientificDevelopmentCandidateStatus =
  | 'DEVELOPMENT_CANDIDATE'
  | 'NO_SAFE_IMPROVEMENT'
  | 'INSUFFICIENT_BRANCH_DATA'
  | 'INSUFFICIENT_VALIDATION_DATA';

export interface ScientificDevelopmentMetricSet {
  rows: number;
  brier: number | null;
  logLoss: number | null;
  accuracy: number | null;
  expectedCalibrationError: number | null;
  meanConfidence?: number | null;
  meanEntropy?: number | null;
}

export interface ScientificDevelopmentSafetyInput {
  candidate: ScientificDevelopmentMetricSet;
  baseline: ScientificDevelopmentMetricSet;
  minimumBrierImprovement?: number;
  maximumLogLossRegression?: number;
  maximumEceRegression?: number;
}

export interface ScientificDevelopmentSafetyResult {
  passed: boolean;
  gates: {
    minimumBrierImprovement: boolean;
    logLossControlled: boolean;
    calibrationControlled: boolean;
  };
  deltas: {
    brierImprovement: number | null;
    logLossChange: number | null;
    eceChange: number | null;
  };
}

function finiteDifference(
  left: number | null | undefined,
  right: number | null | undefined,
): number | null {
  if (left == null || right == null || !Number.isFinite(left) || !Number.isFinite(right)) {
    return null;
  }

  return left - right;
}

export function evaluateScientificDevelopmentSafety(
  input: ScientificDevelopmentSafetyInput,
): ScientificDevelopmentSafetyResult {
  const minimumBrierImprovement = input.minimumBrierImprovement ?? 0.002;
  const maximumLogLossRegression = input.maximumLogLossRegression ?? 0.005;
  const maximumEceRegression = input.maximumEceRegression ?? 0.02;

  const brierImprovement = finiteDifference(input.baseline.brier, input.candidate.brier);
  const logLossChange = finiteDifference(input.candidate.logLoss, input.baseline.logLoss);
  const eceChange = finiteDifference(
    input.candidate.expectedCalibrationError,
    input.baseline.expectedCalibrationError,
  );

  const gates = {
    minimumBrierImprovement:
      brierImprovement != null && brierImprovement >= minimumBrierImprovement,
    logLossControlled: logLossChange != null && logLossChange <= maximumLogLossRegression,
    calibrationControlled: eceChange != null && eceChange <= maximumEceRegression,
  };

  return {
    passed: Object.values(gates).every(Boolean),
    gates,
    deltas: {
      brierImprovement,
      logLossChange,
      eceChange,
    },
  };
}

export function scientificDiagnosticSeverity(
  psi: number | null,
  absoluteStandardizedMeanDifference: number,
): 'LOW' | 'MODERATE' | 'HIGH' {
  if ((psi != null && psi >= 0.25) || absoluteStandardizedMeanDifference >= 0.5) {
    return 'HIGH';
  }

  if ((psi != null && psi >= 0.1) || absoluteStandardizedMeanDifference >= 0.25) {
    return 'MODERATE';
  }

  return 'LOW';
}
