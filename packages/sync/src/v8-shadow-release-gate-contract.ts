export const V8_SHADOW_RELEASE_GATE_VERSION = 'v8.0-stage11-shadow-release-gate-v1';

export const V8_SHADOW_RELEASE_THRESHOLDS = {
  minimumDecisions: 200,
  minimumSettledBestBets: 100,
  minimumActiveDecisionDays: 30,
  minimumObservationSpanDays: 30,
  maximumPaperEce: 0.08,
  maximumEceRegressionAgainstChampion: 0.02,
  minimumPaperRoi: 0,
  minimumMeanClv: 0,
  maximumPaperDrawdownUnits: 30,
} as const;

export interface V8ReleaseBacktestEvidence {
  artifactPresent: boolean;
  artifactHashVerified: boolean;
  status: string | null;
  promotionEligible: boolean;
  championEce: number | null;
  challengerEce: number | null;
  championRoi: number | null;
  challengerRoi: number | null;
  gateReasons: string[];
}

export interface V8ReleasePaperEvidence {
  decisions: number;
  bestBets: number;
  noBets: number;
  settledBestBets: number;
  activeDecisionDays: number;
  observationSpanDays: number;
  duplicateSemanticDecisions: number;
  sourceOddsAfterDecisionViolations: number;
  maturedBestBetsMissingSettlement: number;
  roi: number | null;
  meanClv: number | null;
  ece: number | null;
  maximumDrawdownUnits: number | null;
}

export interface V8ReleaseGateEvidence {
  baseline: {
    championTagPresent: boolean;
    stage1TagPresent: boolean;
    currentChampionChanged: false;
  };
  backtest: V8ReleaseBacktestEvidence;
  paper: V8ReleasePaperEvidence;
  liveData: {
    status: string;
    blockers: string[];
  };
  policy: {
    ouPolicyParityCertified: boolean;
    reason: string | null;
  };
}

export interface V8ReleaseGateDecision {
  version: typeof V8_SHADOW_RELEASE_GATE_VERSION;
  status: 'READY_FOR_MANUAL_PROMOTION_REVIEW' | 'BLOCKED_EVIDENCE';
  promotionEligible: boolean;
  blockers: string[];
  automaticPromotion: false;
  currentChampionChanged: false;
  paperOnly: true;
}

export function evaluateV8ShadowReleaseGate(
  evidence: V8ReleaseGateEvidence,
): V8ReleaseGateDecision {
  const blockers: string[] = [];
  const thresholds = V8_SHADOW_RELEASE_THRESHOLDS;

  if (!evidence.baseline.championTagPresent) blockers.push('V7_5_CHAMPION_TAG_MISSING');
  if (!evidence.baseline.stage1TagPresent) blockers.push('V8_STAGE1_CERTIFICATION_TAG_MISSING');
  if (!evidence.backtest.artifactPresent) blockers.push('STAGE7_ARTIFACT_MISSING');
  if (evidence.backtest.artifactPresent && !evidence.backtest.artifactHashVerified) {
    blockers.push('STAGE7_ARTIFACT_HASH_MISMATCH');
  }
  if (evidence.backtest.status !== 'READY_FOR_PAPER_RUNTIME') {
    blockers.push('STAGE7_BACKTEST_NOT_READY');
  }
  if (!evidence.backtest.promotionEligible) {
    blockers.push('STAGE7_CHALLENGER_NOT_PROMOTION_ELIGIBLE');
  }
  if (evidence.paper.decisions < thresholds.minimumDecisions) {
    blockers.push('PAPER_DECISIONS_BELOW_200');
  }
  if (evidence.paper.settledBestBets < thresholds.minimumSettledBestBets) {
    blockers.push('PAPER_SETTLED_BEST_BETS_BELOW_100');
  }
  if (evidence.paper.activeDecisionDays < thresholds.minimumActiveDecisionDays) {
    blockers.push('PAPER_ACTIVE_DECISION_DAYS_BELOW_30');
  }
  if (evidence.paper.observationSpanDays < thresholds.minimumObservationSpanDays) {
    blockers.push('PAPER_OBSERVATION_SPAN_BELOW_30_DAYS');
  }
  if (evidence.paper.duplicateSemanticDecisions > 0) {
    blockers.push('DUPLICATE_SEMANTIC_PAPER_DECISIONS');
  }
  if (evidence.paper.sourceOddsAfterDecisionViolations > 0) {
    blockers.push('SOURCE_ODDS_AFTER_DECISION_PIT_VIOLATION');
  }
  if (evidence.paper.maturedBestBetsMissingSettlement > 0) {
    blockers.push('MATURED_PAPER_BETS_MISSING_SETTLEMENT');
  }
  if (evidence.paper.roi == null || evidence.paper.roi < thresholds.minimumPaperRoi) {
    blockers.push('PAPER_ROI_BELOW_ZERO_OR_UNAVAILABLE');
  }
  if (evidence.paper.meanClv == null || evidence.paper.meanClv < thresholds.minimumMeanClv) {
    blockers.push('PAPER_MEAN_CLV_BELOW_ZERO_OR_UNAVAILABLE');
  }
  if (evidence.paper.ece == null || evidence.paper.ece > thresholds.maximumPaperEce) {
    blockers.push('PAPER_ECE_ABOVE_0_08_OR_UNAVAILABLE');
  }
  if (
    evidence.paper.ece != null &&
    evidence.backtest.championEce != null &&
    evidence.paper.ece >
      evidence.backtest.championEce + thresholds.maximumEceRegressionAgainstChampion
  ) {
    blockers.push('PAPER_ECE_REGRESSION_ABOVE_CHAMPION_GUARD');
  }
  if (
    evidence.paper.maximumDrawdownUnits == null ||
    evidence.paper.maximumDrawdownUnits > thresholds.maximumPaperDrawdownUnits
  ) {
    blockers.push('PAPER_DRAWDOWN_ABOVE_30_UNITS_OR_UNAVAILABLE');
  }
  if (evidence.liveData.status !== 'READY_FOR_SHADOW_INPUT') {
    blockers.push('STAGE10_LIVE_DATA_NOT_READY');
  }
  if (!evidence.policy.ouPolicyParityCertified) {
    blockers.push('V7_V8_PAPER_OU_POLICY_PARITY_NOT_CERTIFIED');
  }

  return {
    version: V8_SHADOW_RELEASE_GATE_VERSION,
    status: blockers.length === 0 ? 'READY_FOR_MANUAL_PROMOTION_REVIEW' : 'BLOCKED_EVIDENCE',
    promotionEligible: blockers.length === 0,
    blockers: [...new Set(blockers)],
    automaticPromotion: false,
    currentChampionChanged: false,
    paperOnly: true,
  };
}
