import { createHash } from 'node:crypto';

export const SCIENTIFIC_EVALUATION_VERSION = 'v7.0-alpha.7-scientific-evaluation-v1';
export const SCIENTIFIC_POLICY_VERSION = 'fixed-1x2-policy-v1';

export type MatchWinnerClass = 'HOME' | 'DRAW' | 'AWAY';

export interface MatchWinnerProbabilities {
  HOME: number;
  DRAW: number;
  AWAY: number;
}

export interface MatchWinnerOdds {
  HOME: number | null;
  DRAW: number | null;
  AWAY: number | null;
}

export interface EvaluationMetricSet {
  rows: number;
  brier: number | null;
  logLoss: number | null;
  accuracy: number | null;
  expectedCalibrationError: number | null;
}

export interface BettingMetricSet {
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  stakeUnits: number;
  profitUnits: number;
  roi: number | null;
  hitRate: number | null;
  maximumDrawdownUnits: number;
  averageOdds: number | null;
  averageEdge: number | null;
  averageExpectedValue: number | null;
  averageClv: number | null;
  positiveClvRate: number | null;
}

export interface PromotionInput {
  candidate: {
    prediction: EvaluationMetricSet;
    betting: BettingMetricSet;
  };
  baseline: {
    prediction: EvaluationMetricSet;
    betting: BettingMetricSet;
  };
  leakageViolations: number;
  minimumEvaluationRows?: number;
  minimumBets?: number;
  minimumRelativeBrierImprovement?: number;
  maximumLogLossRegression?: number;
  minimumRoiImprovement?: number;
  maximumDrawdownRegressionUnits?: number;
  requirePositiveClv?: boolean;
}

export interface PromotionDecision {
  status: 'ELIGIBLE_FOR_MANUAL_PROMOTION' | 'HOLD' | 'REJECT';
  passed: boolean;
  reasons: string[];
  gates: Record<string, boolean>;
  deltas: {
    relativeBrierImprovement: number | null;
    logLossChange: number | null;
    roiImprovement: number | null;
    drawdownChangeUnits: number;
    clvChange: number | null;
  };
}

const EPSILON = 1e-12;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number | null | undefined, fallback = 0): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function normalizeProbabilities(
  probabilities: MatchWinnerProbabilities,
): MatchWinnerProbabilities {
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

export function probabilityForClass(
  probabilities: MatchWinnerProbabilities,
  actual: MatchWinnerClass,
): number {
  return normalizeProbabilities(probabilities)[actual];
}

export function predictedClass(probabilities: MatchWinnerProbabilities): MatchWinnerClass {
  const normalized = normalizeProbabilities(probabilities);
  const rows = Object.entries(normalized) as Array<[MatchWinnerClass, number]>;

  rows.sort((left, right) => right[1] - left[1]);

  return rows[0]?.[0] ?? 'HOME';
}

export function multiclassBrier(
  probabilities: MatchWinnerProbabilities,
  actual: MatchWinnerClass,
): number {
  const normalized = normalizeProbabilities(probabilities);

  return (
    (normalized.HOME - (actual === 'HOME' ? 1 : 0)) ** 2 +
    (normalized.DRAW - (actual === 'DRAW' ? 1 : 0)) ** 2 +
    (normalized.AWAY - (actual === 'AWAY' ? 1 : 0)) ** 2
  );
}

export function multiclassLogLoss(
  probabilities: MatchWinnerProbabilities,
  actual: MatchWinnerClass,
): number {
  return -Math.log(clamp(probabilityForClass(probabilities, actual), 1e-12, 1));
}

export function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function maximumDrawdown(profits: number[]): number {
  let bankroll = 0;
  let peak = 0;
  let maximum = 0;

  for (const profit of profits) {
    bankroll += finite(profit);
    peak = Math.max(peak, bankroll);
    maximum = Math.max(maximum, peak - bankroll);
  }

  return maximum;
}

export function fairProbabilitiesFromOdds(odds: MatchWinnerOdds): MatchWinnerProbabilities | null {
  if (
    odds.HOME == null ||
    odds.DRAW == null ||
    odds.AWAY == null ||
    odds.HOME <= 1 ||
    odds.DRAW <= 1 ||
    odds.AWAY <= 1
  ) {
    return null;
  }

  return normalizeProbabilities({
    HOME: 1 / odds.HOME,
    DRAW: 1 / odds.DRAW,
    AWAY: 1 / odds.AWAY,
  });
}

export function settleMatchWinner(
  selection: MatchWinnerClass,
  actual: MatchWinnerClass,
  decimalOdds: number,
  stakeUnits = 1,
): {
  result: 'WIN' | 'LOSS';
  profitUnits: number;
} {
  if (selection === actual) {
    return {
      result: 'WIN',
      profitUnits: (decimalOdds - 1) * stakeUnits,
    };
  }

  return {
    result: 'LOSS',
    profitUnits: -stakeUnits,
  };
}

export function closingLineValue(decisionOdds: number, closingOdds: number | null): number | null {
  if (
    !Number.isFinite(decisionOdds) ||
    decisionOdds <= 1 ||
    closingOdds == null ||
    !Number.isFinite(closingOdds) ||
    closingOdds <= 1
  ) {
    return null;
  }

  return decisionOdds / closingOdds - 1;
}

export function deterministicHash(kind: string, value: unknown): string {
  return createHash('sha256')
    .update(kind)
    .update('\n')
    .update(stableStringify(value))
    .digest('hex');
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  const object = value as Record<string, unknown>;

  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}

export function decidePromotion(input: PromotionInput): PromotionDecision {
  const minimumEvaluationRows = input.minimumEvaluationRows ?? 80;
  const minimumBets = input.minimumBets ?? 30;
  const minimumRelativeBrierImprovement = input.minimumRelativeBrierImprovement ?? 0.005;
  const maximumLogLossRegression = input.maximumLogLossRegression ?? 0;
  const minimumRoiImprovement = input.minimumRoiImprovement ?? 0;
  const maximumDrawdownRegressionUnits = input.maximumDrawdownRegressionUnits ?? 2;
  const requirePositiveClv = input.requirePositiveClv ?? true;

  const candidateBrier = input.candidate.prediction.brier;
  const baselineBrier = input.baseline.prediction.brier;
  const candidateLogLoss = input.candidate.prediction.logLoss;
  const baselineLogLoss = input.baseline.prediction.logLoss;
  const candidateRoi = input.candidate.betting.roi;
  const baselineRoi = input.baseline.betting.roi;
  const candidateClv = input.candidate.betting.averageClv;
  const baselineClv = input.baseline.betting.averageClv;

  const relativeBrierImprovement =
    candidateBrier != null && baselineBrier != null && baselineBrier > EPSILON
      ? (baselineBrier - candidateBrier) / baselineBrier
      : null;
  const logLossChange =
    candidateLogLoss != null && baselineLogLoss != null ? candidateLogLoss - baselineLogLoss : null;
  const roiImprovement =
    candidateRoi != null && baselineRoi != null ? candidateRoi - baselineRoi : null;
  const drawdownChangeUnits =
    input.candidate.betting.maximumDrawdownUnits - input.baseline.betting.maximumDrawdownUnits;
  const clvChange = candidateClv != null && baselineClv != null ? candidateClv - baselineClv : null;

  const gates = {
    zeroLeakage: input.leakageViolations === 0,
    sufficientEvaluationRows: input.candidate.prediction.rows >= minimumEvaluationRows,
    sufficientBets: input.candidate.betting.bets >= minimumBets,
    brierImproved:
      relativeBrierImprovement != null &&
      relativeBrierImprovement >= minimumRelativeBrierImprovement,
    logLossNotWorse: logLossChange != null && logLossChange <= maximumLogLossRegression,
    roiNotWorse: roiImprovement != null && roiImprovement >= minimumRoiImprovement,
    drawdownControlled: drawdownChangeUnits <= maximumDrawdownRegressionUnits,
    clvAcceptable: !requirePositiveClv || (candidateClv != null && candidateClv > 0),
  };

  const reasons: string[] = [];

  for (const [gate, passed] of Object.entries(gates)) {
    if (!passed) {
      reasons.push(`FAILED_${gate.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`);
    }
  }

  const hardFailure =
    !gates.zeroLeakage ||
    !gates.sufficientEvaluationRows ||
    !gates.brierImproved ||
    !gates.logLossNotWorse;

  const passed = Object.values(gates).every(Boolean);

  return {
    status: passed ? 'ELIGIBLE_FOR_MANUAL_PROMOTION' : hardFailure ? 'REJECT' : 'HOLD',
    passed,
    reasons,
    gates,
    deltas: {
      relativeBrierImprovement,
      logLossChange,
      roiImprovement,
      drawdownChangeUnits,
      clvChange,
    },
  };
}
