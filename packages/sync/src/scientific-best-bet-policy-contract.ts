export const SCIENTIFIC_BEST_BET_POLICY_VERSION = 'v7.0-beta.1A.4-best-bet-policy-reliability-v1';

export const SCIENTIFIC_BEST_BET_EVIDENCE_CLASS = 'HISTORICAL_DIAGNOSTIC_NON_PROMOTIONAL' as const;

export const SCIENTIFIC_BEST_BET_POLICY = Object.freeze({
  minimumOdds: 1.4,
  minimumEdge: 0.04,
  minimumExpectedValue: 0.03,
  maximumBetsPerFixture: 1,
  minimumReliabilityRows: 150,
  minimumRelativeBrierSkillVsClimatology: 0.005,
  minimumLogLossSkillVsClimatology: 0.005,
  maximumEce: 0.05,
  stakeUnitsForEvaluation: 1,
});

export type ScientificBestBetMarket =
  'MATCH_WINNER' | 'TOTAL_GOALS_1_5' | 'TOTAL_GOALS_2_5' | 'TOTAL_GOALS_3_5' | 'BTTS';

export type ScientificBestBetSelection = 'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO';

export type MarketReliabilityStatus =
  | 'DIAGNOSTIC_ELIGIBLE'
  | 'NO_PROVEN_SKILL'
  | 'INSUFFICIENT_SAMPLE'
  | 'CALIBRATION_BLOCKED'
  | 'INVALID_METRICS';

export interface ModelMetricSummary {
  rows: number;
  classCount: 2 | 3;
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  ece: number | null;
}

export interface ClimatologyMetricSummary {
  rows: number;
  classCount: 2 | 3;
  accuracy: number;
  brier: number;
  logLoss: number;
  classProbabilities: Record<string, number>;
}

export interface MarketReliabilityAssessment {
  market: ScientificBestBetMarket;
  status: MarketReliabilityStatus;
  diagnosticEligible: boolean;
  model: ModelMetricSummary;
  climatology: ClimatologyMetricSummary;
  relativeBrierSkillVsClimatology: number | null;
  logLossSkillVsClimatology: number | null;
  eceWithinLimit: boolean;
  sufficientRows: boolean;
  reasons: string[];
  evidenceClass: typeof SCIENTIFIC_BEST_BET_EVIDENCE_CLASS;
  promotional: false;
}

export interface ScientificBetCandidate {
  fixtureId: number | string;
  market: ScientificBestBetMarket;
  selection: ScientificBestBetSelection;
  lineValue: number | null;
  modelProbability: number;
  fairMarketProbability: number;
  decimalOdds: number;
  edge: number;
  expectedValue: number;
  reliability: MarketReliabilityAssessment;
}

export interface ScientificCandidateAssessment {
  candidate: ScientificBetCandidate;
  eligible: boolean;
  rejectionReasons: string[];
}

export type ScientificBestBetDecision =
  | {
      decision: 'BEST_BET';
      selected: ScientificBetCandidate;
      eligibleCandidates: ScientificBetCandidate[];
      rejectedCandidates: ScientificCandidateAssessment[];
      policyVersion: typeof SCIENTIFIC_BEST_BET_POLICY_VERSION;
      stakeUnits: 1;
      promotional: false;
    }
  | {
      decision: 'NO_BET';
      selected: null;
      eligibleCandidates: [];
      rejectedCandidates: ScientificCandidateAssessment[];
      policyVersion: typeof SCIENTIFIC_BEST_BET_POLICY_VERSION;
      stakeUnits: 0;
      promotional: false;
    };

const EPSILON = 1e-15;
const POLICY_THRESHOLD_TOLERANCE = 1e-12;

function safeLog(value: number): number {
  return Math.log(Math.min(1 - EPSILON, Math.max(EPSILON, value)));
}

function assertProbability(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite probability in [0, 1].`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative.`);
  }
}

export function calculateImpliedProbability(decimalOdds: number): number {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
    throw new RangeError('decimalOdds must be finite and greater than 1.');
  }

  return 1 / decimalOdds;
}

export function calculateEdge(modelProbability: number, fairMarketProbability: number): number {
  assertProbability(modelProbability, 'modelProbability');
  assertProbability(fairMarketProbability, 'fairMarketProbability');

  return modelProbability - fairMarketProbability;
}

export function calculateExpectedValue(modelProbability: number, decimalOdds: number): number {
  assertProbability(modelProbability, 'modelProbability');

  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
    throw new RangeError('decimalOdds must be finite and greater than 1.');
  }

  return modelProbability * decimalOdds - 1;
}

export function deriveBinaryClimatology(actualPositive: boolean[]): ClimatologyMetricSummary {
  if (actualPositive.length === 0) {
    throw new RangeError('Binary climatology requires at least one row.');
  }

  const positives = actualPositive.filter(Boolean).length;
  const p = positives / actualPositive.length;
  const q = 1 - p;

  const brier =
    actualPositive.reduce((sum, actual) => sum + (p - (actual ? 1 : 0)) ** 2, 0) /
    actualPositive.length;

  const logLoss =
    actualPositive.reduce((sum, actual) => sum + (actual ? -safeLog(p) : -safeLog(q)), 0) /
    actualPositive.length;

  return {
    rows: actualPositive.length,
    classCount: 2,
    accuracy: Math.max(p, q),
    brier,
    logLoss,
    classProbabilities: {
      POSITIVE: p,
      NEGATIVE: q,
    },
  };
}

export function deriveMulticlassClimatology(
  actualClasses: string[],
  supportedClasses: string[],
): ClimatologyMetricSummary {
  if (actualClasses.length === 0) {
    throw new RangeError('Multiclass climatology requires at least one row.');
  }

  if (supportedClasses.length < 2) {
    throw new RangeError('Multiclass climatology requires at least two supported classes.');
  }

  const classSet = new Set(supportedClasses);

  for (const actualClass of actualClasses) {
    if (!classSet.has(actualClass)) {
      throw new RangeError(`Unsupported actual class: ${actualClass}.`);
    }
  }

  const classProbabilities = Object.fromEntries(
    supportedClasses.map((classCode) => [
      classCode,
      actualClasses.filter((value) => value === classCode).length / actualClasses.length,
    ]),
  );

  let brierTotal = 0;
  let logLossTotal = 0;

  for (const actualClass of actualClasses) {
    for (const classCode of supportedClasses) {
      const probability = classProbabilities[classCode] ?? 0;
      const actual = actualClass === classCode ? 1 : 0;

      brierTotal += (probability - actual) ** 2;
    }

    logLossTotal += -safeLog(classProbabilities[actualClass] ?? 0);
  }

  return {
    rows: actualClasses.length,
    classCount: supportedClasses.length === 2 ? 2 : 3,
    accuracy: Math.max(...Object.values(classProbabilities)),
    brier: brierTotal / actualClasses.length,
    logLoss: logLossTotal / actualClasses.length,
    classProbabilities,
  };
}

export function relativeSkill(modelScore: number, baselineScore: number): number | null {
  assertNonNegativeFinite(modelScore, 'modelScore');
  assertNonNegativeFinite(baselineScore, 'baselineScore');

  if (baselineScore <= EPSILON) {
    return null;
  }

  return 1 - modelScore / baselineScore;
}

export function assessMarketReliability(input: {
  market: ScientificBestBetMarket;
  model: ModelMetricSummary;
  climatology: ClimatologyMetricSummary;
}): MarketReliabilityAssessment {
  const { market, model, climatology } = input;
  const reasons: string[] = [];

  const metricsValid =
    model.rows >= 0 &&
    model.classCount === climatology.classCount &&
    model.brier != null &&
    Number.isFinite(model.brier) &&
    model.brier >= 0 &&
    model.logLoss != null &&
    Number.isFinite(model.logLoss) &&
    model.logLoss >= 0 &&
    model.ece != null &&
    Number.isFinite(model.ece) &&
    model.ece >= 0;

  const sufficientRows =
    model.rows >= SCIENTIFIC_BEST_BET_POLICY.minimumReliabilityRows &&
    climatology.rows === model.rows;

  const relativeBrierSkillVsClimatology = metricsValid
    ? relativeSkill(model.brier!, climatology.brier)
    : null;

  const logLossSkillVsClimatology = metricsValid
    ? relativeSkill(model.logLoss!, climatology.logLoss)
    : null;

  const eceWithinLimit = metricsValid && model.ece! <= SCIENTIFIC_BEST_BET_POLICY.maximumEce;

  if (!metricsValid) {
    reasons.push('INVALID_METRICS');
  }

  if (!sufficientRows) {
    reasons.push('INSUFFICIENT_SAMPLE');
  }

  if (
    metricsValid &&
    (relativeBrierSkillVsClimatology == null ||
      relativeBrierSkillVsClimatology <
        SCIENTIFIC_BEST_BET_POLICY.minimumRelativeBrierSkillVsClimatology)
  ) {
    reasons.push('BRIER_NOT_BETTER_THAN_CLIMATOLOGY');
  }

  if (
    metricsValid &&
    (logLossSkillVsClimatology == null ||
      logLossSkillVsClimatology < SCIENTIFIC_BEST_BET_POLICY.minimumLogLossSkillVsClimatology)
  ) {
    reasons.push('LOG_LOSS_NOT_BETTER_THAN_CLIMATOLOGY');
  }

  if (metricsValid && !eceWithinLimit) {
    reasons.push('CALIBRATION_EXCEEDS_LIMIT');
  }

  const diagnosticEligible =
    metricsValid &&
    sufficientRows &&
    eceWithinLimit &&
    relativeBrierSkillVsClimatology != null &&
    relativeBrierSkillVsClimatology >=
      SCIENTIFIC_BEST_BET_POLICY.minimumRelativeBrierSkillVsClimatology &&
    logLossSkillVsClimatology != null &&
    logLossSkillVsClimatology >= SCIENTIFIC_BEST_BET_POLICY.minimumLogLossSkillVsClimatology;

  let status: MarketReliabilityStatus = 'NO_PROVEN_SKILL';

  if (!metricsValid) {
    status = 'INVALID_METRICS';
  } else if (!sufficientRows) {
    status = 'INSUFFICIENT_SAMPLE';
  } else if (!eceWithinLimit) {
    status = 'CALIBRATION_BLOCKED';
  } else if (diagnosticEligible) {
    status = 'DIAGNOSTIC_ELIGIBLE';
  }

  return {
    market,
    status,
    diagnosticEligible,
    model,
    climatology,
    relativeBrierSkillVsClimatology,
    logLossSkillVsClimatology,
    eceWithinLimit,
    sufficientRows,
    reasons,
    evidenceClass: SCIENTIFIC_BEST_BET_EVIDENCE_CLASS,
    promotional: false,
  };
}

export function assessBestBetCandidate(
  candidate: ScientificBetCandidate,
): ScientificCandidateAssessment {
  assertProbability(candidate.modelProbability, 'candidate.modelProbability');
  assertProbability(candidate.fairMarketProbability, 'candidate.fairMarketProbability');

  if (!Number.isFinite(candidate.decimalOdds) || candidate.decimalOdds <= 1) {
    throw new RangeError('candidate.decimalOdds must be greater than 1.');
  }

  if (!Number.isFinite(candidate.edge)) {
    throw new RangeError('candidate.edge must be finite.');
  }

  if (!Number.isFinite(candidate.expectedValue)) {
    throw new RangeError('candidate.expectedValue must be finite.');
  }

  const rejectionReasons: string[] = [];

  if (!candidate.reliability.diagnosticEligible) {
    rejectionReasons.push('MARKET_RELIABILITY_NOT_ELIGIBLE');
  }

  if (candidate.decimalOdds + POLICY_THRESHOLD_TOLERANCE < SCIENTIFIC_BEST_BET_POLICY.minimumOdds) {
    rejectionReasons.push('ODDS_BELOW_MINIMUM');
  }

  if (candidate.edge + POLICY_THRESHOLD_TOLERANCE < SCIENTIFIC_BEST_BET_POLICY.minimumEdge) {
    rejectionReasons.push('EDGE_BELOW_MINIMUM');
  }

  if (
    candidate.expectedValue + POLICY_THRESHOLD_TOLERANCE <
    SCIENTIFIC_BEST_BET_POLICY.minimumExpectedValue
  ) {
    rejectionReasons.push('EXPECTED_VALUE_BELOW_MINIMUM');
  }

  const calculatedEdge = calculateEdge(candidate.modelProbability, candidate.fairMarketProbability);

  if (Math.abs(calculatedEdge - candidate.edge) > 1e-9) {
    rejectionReasons.push('EDGE_INCONSISTENT_WITH_PROBABILITIES');
  }

  const calculatedEv = calculateExpectedValue(candidate.modelProbability, candidate.decimalOdds);

  if (Math.abs(calculatedEv - candidate.expectedValue) > 1e-9) {
    rejectionReasons.push('EV_INCONSISTENT_WITH_ODDS');
  }

  return {
    candidate,
    eligible: rejectionReasons.length === 0,
    rejectionReasons,
  };
}

function compareBestBetCandidates(
  left: ScientificBetCandidate,
  right: ScientificBetCandidate,
): number {
  return (
    right.expectedValue - left.expectedValue ||
    right.edge - left.edge ||
    right.modelProbability - left.modelProbability ||
    left.decimalOdds - right.decimalOdds ||
    left.market.localeCompare(right.market) ||
    left.selection.localeCompare(right.selection) ||
    (left.lineValue ?? -1) - (right.lineValue ?? -1)
  );
}

export function selectScientificBestBet(
  candidates: ScientificBetCandidate[],
): ScientificBestBetDecision {
  const fixtureIds = new Set(candidates.map((candidate) => String(candidate.fixtureId)));

  if (fixtureIds.size > 1) {
    throw new RangeError(
      'selectScientificBestBet must receive candidates from exactly one fixture.',
    );
  }

  const assessments = candidates.map(assessBestBetCandidate);
  const eligible = assessments
    .filter((assessment) => assessment.eligible)
    .map((assessment) => assessment.candidate)
    .sort(compareBestBetCandidates);
  const rejected = assessments.filter((assessment) => !assessment.eligible);

  if (eligible.length === 0) {
    return {
      decision: 'NO_BET',
      selected: null,
      eligibleCandidates: [],
      rejectedCandidates: rejected,
      policyVersion: SCIENTIFIC_BEST_BET_POLICY_VERSION,
      stakeUnits: 0,
      promotional: false,
    };
  }

  return {
    decision: 'BEST_BET',
    selected: eligible[0]!,
    eligibleCandidates: eligible,
    rejectedCandidates: rejected,
    policyVersion: SCIENTIFIC_BEST_BET_POLICY_VERSION,
    stakeUnits: 1,
    promotional: false,
  };
}
