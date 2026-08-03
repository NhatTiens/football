export const DECISION_OPPORTUNITY_AUDIT_VERSION =
  'v7.0-r4.10.2.11.1-decision-opportunity-model-availability-audit-v1';

export const DEFAULT_PAPER_DECISION_HORIZONS = [90, 30, 5] as const;
export const DEFAULT_PAPER_DECISION_TOLERANCE_MINUTES = 2 as const;

export type PaperDecisionType = 'BEST_BET' | 'NO_BET';

export type PaperDecisionLinkStatus =
  | 'NOT_CONFIGURED_HORIZON'
  | 'PENDING_DECISION_WINDOW'
  | 'BEST_BET_LINKED'
  | 'NO_BET_LINKED'
  | 'MISSING_EXPECTED_DECISION'
  | 'DUPLICATE_DECISIONS'
  | 'INVALID_DECISION_LINEAGE';

export type ModelAvailabilityStatus =
  | 'DYNAMIC_MODEL_AVAILABLE'
  | 'BASELINE_FALLBACK_ONLY'
  | 'MIXED_MODEL_SOURCES'
  | 'NO_MODEL_EVIDENCE';

export type PromotionEvidenceStatus =
  | 'OFFICIAL_CANDIDATE_AVAILABLE'
  | 'RESEARCH_SIGNAL_ONLY'
  | 'NO_CURRENT_VALUE_SIGNAL'
  | 'NO_CANDIDATE_EVIDENCE';

export type OpportunityClassification =
  'COVERED' | 'OPERATIONAL_GAP' | 'PREREQUISITE_GAP' | 'PENDING' | 'NOT_APPLICABLE' | 'INVALID';

export type DecisionOpportunityReasonCode =
  | 'PAPER_HORIZON_NOT_CONFIGURED'
  | 'DECISION_WINDOW_PENDING'
  | 'PAPER_BEST_BET_RECORDED'
  | 'PAPER_NO_BET_RECORDED'
  | 'PAPER_DECISION_DUPLICATE'
  | 'PAPER_DECISION_PIT_VIOLATION'
  | 'PAPER_DECISION_WINDOW_MISMATCH'
  | 'FRESH_ODDS_CHECKPOINT_MISSING'
  | 'FRESH_ODDS_NOT_SUCCESSFUL'
  | 'NO_PIT_USABLE_ODDS'
  | 'SNAPSHOT_NO_FRESH_PIT_ODDS'
  | 'MODEL_OUTPUT_UNAVAILABLE'
  | 'BASELINE_FALLBACK_OFFICIAL_LOCK'
  | 'LIMITED_CONFIDENCE_RESEARCH_ONLY'
  | 'MODEL_HISTORY_INSUFFICIENT'
  | 'HORIZON_NOT_VALIDATED'
  | 'RELIABILITY_NOT_PROVEN'
  | 'NO_OFFICIAL_ELIGIBLE_CANDIDATE'
  | 'OFFICIAL_ELIGIBLE_BUT_DECISION_MISSING'
  | 'RESEARCH_SIGNAL_AVAILABLE'
  | 'NO_CURRENT_VALUE_SIGNAL'
  | 'DECISION_CYCLE_MISSING';

export interface DecisionOpportunitySnapshot {
  snapshotId: number;
  snapshotHash: string;
  providerFixtureId: number;
  checkpointMinutes: number;
  checkpointLabel: string;
  snapshotAsOf: Date;
  kickoffAt: Date;
  analysisStatus: string;
  candidateCount: number;
  currentEligibleCandidateCount: number;
  officialEligibleCandidateCount: number;
  modelSources: string[];
  confidenceTiers: string[];
  reliabilityStatuses: string[];
  modelHistorySampleSizes: number[];
  currentRejectionReasons: string[];
  officialRejectionReasons: string[];
}

export interface PaperDecisionEvidence {
  id: number;
  providerFixtureId: number;
  horizonMinutes: number;
  decisionAsOf: Date;
  kickoffAt: Date;
  decisionType: PaperDecisionType;
  selectedMarket: string | null;
  selectedSelection: string | null;
}

export interface FreshOddsCheckpointEvidence {
  id: number;
  providerFixtureId: number;
  horizonMinutes: number;
  status: string;
  dueAt: Date;
  attemptedAt: Date | null;
  completedAt: Date | null;
  attempts: number;
  normalizedOdds: number;
  pitUsableOdds: number;
  errorMessage: string | null;
}

export interface DecisionOpportunityAuditRow {
  version: string;
  snapshotId: number;
  snapshotHash: string;
  providerFixtureId: number;
  checkpointMinutes: number;
  checkpointLabel: string;
  snapshotAsOf: string;
  kickoffAt: string;
  scheduledPaperHorizon: boolean;
  decisionWindowDueAt: string;
  decisionWindowClosedAt: string;
  paperDecisionLinkStatus: PaperDecisionLinkStatus;
  linkedDecisionId: number | null;
  linkedDecisionType: PaperDecisionType | null;
  modelAvailabilityStatus: ModelAvailabilityStatus;
  promotionEvidenceStatus: PromotionEvidenceStatus;
  opportunityClassification: OpportunityClassification;
  primaryReason: DecisionOpportunityReasonCode;
  reasonCodes: DecisionOpportunityReasonCode[];
  analysisStatus: string;
  candidateCount: number;
  currentEligibleCandidateCount: number;
  officialEligibleCandidateCount: number;
  modelSources: string[];
  confidenceTiers: string[];
  reliabilityStatuses: string[];
  maximumModelHistorySampleSize: number;
  freshOddsCheckpointStatus: string | null;
  freshOddsPitUsableOdds: number | null;
  paperOnly: true;
  appendOnlySource: true;
  officialBestBetChanged: false;
  automaticPromotion: false;
  automaticBetPlacement: false;
  realMoneyExecution: false;
}

export interface DecisionOpportunityMetrics {
  rows: number;
  scheduled: number;
  maturedScheduled: number;
  covered: number;
  bestBets: number;
  noBets: number;
  missingExpectedDecisions: number;
  operationalGaps: number;
  prerequisiteGaps: number;
  pending: number;
  invalid: number;
  researchSignals: number;
  officialEligibleRows: number;
  dynamicModelRows: number;
  fallbackModelRows: number;
  noModelEvidenceRows: number;
  terminalDecisionCoverageRate: number | null;
  researchSignalRate: number | null;
  officialEligibilityRate: number | null;
  dynamicModelCoverageRate: number | null;
}

export interface DecisionOpportunityGroup extends DecisionOpportunityMetrics {
  key: string;
  checkpointMinutes: number | null;
}

export interface DecisionOpportunityAuditReport {
  version: string;
  overall: DecisionOpportunityMetrics;
  byHorizon: DecisionOpportunityGroup[];
  byPaperDecisionLinkStatus: Array<{ key: string; rows: number }>;
  byOpportunityClassification: Array<{ key: string; rows: number }>;
  byModelAvailability: Array<{ key: string; rows: number }>;
  byPrimaryReason: Array<{ key: string; rows: number }>;
  paperOnly: true;
  appendOnlyDerivedReadModel: true;
  officialBestBetChanged: false;
  automaticPromotion: false;
  automaticBetPlacement: false;
  realMoneyExecution: false;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .filter((value): boolean => value.trim().length > 0)
        .map((value): string => value.trim()),
    ),
  ].sort((left, right): number => left.localeCompare(right));
}

function finiteNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function includesFragment(values: readonly string[], fragment: string): boolean {
  const normalized = fragment.toUpperCase();
  return values.some((value): boolean => value.toUpperCase().includes(normalized));
}

function modelAvailability(snapshot: DecisionOpportunitySnapshot): ModelAvailabilityStatus {
  const sources = uniqueStrings(snapshot.modelSources).map((value) => value.toUpperCase());
  const dynamic = sources.some((value): boolean => value.includes('DYNAMIC_DIXON_COLES'));
  const fallback = sources.some((value): boolean => value.includes('BASELINE_FALLBACK'));

  if (dynamic && fallback) return 'MIXED_MODEL_SOURCES';
  if (dynamic) return 'DYNAMIC_MODEL_AVAILABLE';
  if (fallback) return 'BASELINE_FALLBACK_ONLY';
  return 'NO_MODEL_EVIDENCE';
}

function promotionEvidence(snapshot: DecisionOpportunitySnapshot): PromotionEvidenceStatus {
  if (snapshot.officialEligibleCandidateCount > 0) {
    return 'OFFICIAL_CANDIDATE_AVAILABLE';
  }

  if (snapshot.currentEligibleCandidateCount > 0) {
    return 'RESEARCH_SIGNAL_ONLY';
  }

  if (snapshot.candidateCount > 0) {
    return 'NO_CURRENT_VALUE_SIGNAL';
  }

  return 'NO_CANDIDATE_EVIDENCE';
}

function decisionWindow(input: {
  snapshot: DecisionOpportunitySnapshot;
  toleranceMinutes: number;
}): { dueAt: Date; closedAt: Date } {
  const dueAt = new Date(
    input.snapshot.kickoffAt.getTime() - input.snapshot.checkpointMinutes * 60_000,
  );

  return {
    dueAt,
    closedAt: new Date(dueAt.getTime() + input.toleranceMinutes * 60_000),
  };
}

function decisionLineageViolations(input: {
  snapshot: DecisionOpportunitySnapshot;
  decision: PaperDecisionEvidence;
  toleranceMinutes: number;
}): DecisionOpportunityReasonCode[] {
  const reasons: DecisionOpportunityReasonCode[] = [];
  const actualMinutesToKickoff =
    (input.decision.kickoffAt.getTime() - input.decision.decisionAsOf.getTime()) / 60_000;

  if (
    input.decision.providerFixtureId !== input.snapshot.providerFixtureId ||
    input.decision.horizonMinutes !== input.snapshot.checkpointMinutes ||
    input.decision.kickoffAt.getTime() !== input.snapshot.kickoffAt.getTime() ||
    input.decision.decisionAsOf.getTime() > input.decision.kickoffAt.getTime()
  ) {
    reasons.push('PAPER_DECISION_PIT_VIOLATION');
  }

  if (
    Math.abs(actualMinutesToKickoff - input.snapshot.checkpointMinutes) > input.toleranceMinutes
  ) {
    reasons.push('PAPER_DECISION_WINDOW_MISMATCH');
  }

  return reasons;
}

function diagnosticReasonCodes(input: {
  snapshot: DecisionOpportunitySnapshot;
  freshOddsCheckpoint: FreshOddsCheckpointEvidence | null;
  modelAvailabilityStatus: ModelAvailabilityStatus;
  promotionEvidenceStatus: PromotionEvidenceStatus;
}): DecisionOpportunityReasonCode[] {
  const reasons: DecisionOpportunityReasonCode[] = [];
  const snapshotStatus = input.snapshot.analysisStatus.toUpperCase();
  const confidence = uniqueStrings(input.snapshot.confidenceTiers);
  const reliability = uniqueStrings(input.snapshot.reliabilityStatuses);
  const officialReasons = uniqueStrings(input.snapshot.officialRejectionReasons);
  const currentReasons = uniqueStrings(input.snapshot.currentRejectionReasons);

  if (input.freshOddsCheckpoint == null) {
    reasons.push('FRESH_ODDS_CHECKPOINT_MISSING');
  } else {
    if (input.freshOddsCheckpoint.status.toUpperCase() !== 'SUCCESS') {
      reasons.push('FRESH_ODDS_NOT_SUCCESSFUL');
    }

    if (input.freshOddsCheckpoint.pitUsableOdds <= 0) {
      reasons.push('NO_PIT_USABLE_ODDS');
    }
  }

  if (snapshotStatus === 'NO_FRESH_PIT_ODDS') {
    reasons.push('SNAPSHOT_NO_FRESH_PIT_ODDS');
  }

  if (input.modelAvailabilityStatus === 'NO_MODEL_EVIDENCE') {
    reasons.push('MODEL_OUTPUT_UNAVAILABLE');
  }

  if (input.modelAvailabilityStatus === 'BASELINE_FALLBACK_ONLY') {
    reasons.push('BASELINE_FALLBACK_OFFICIAL_LOCK');
  }

  if (includesFragment(confidence, 'LIMITED')) {
    reasons.push('LIMITED_CONFIDENCE_RESEARCH_ONLY');
  }

  if (
    Math.max(0, ...input.snapshot.modelHistorySampleSizes) < 3 ||
    includesFragment(currentReasons, 'MODEL_HISTORY_INSUFFICIENT')
  ) {
    reasons.push('MODEL_HISTORY_INSUFFICIENT');
  }

  if (
    includesFragment(reliability, 'HORIZON_NOT_VALIDATED') ||
    includesFragment(officialReasons, 'HORIZON_NOT_VALIDATED')
  ) {
    reasons.push('HORIZON_NOT_VALIDATED');
  }

  if (
    includesFragment(reliability, 'NO_PROVEN_SKILL') ||
    includesFragment(reliability, 'INSUFFICIENT_SAMPLE') ||
    includesFragment(reliability, 'CALIBRATION_BLOCKED') ||
    includesFragment(currentReasons, 'RELIABILITY_NOT_PROVEN') ||
    includesFragment(officialReasons, 'MARKET_RELIABILITY_NOT_ELIGIBLE')
  ) {
    reasons.push('RELIABILITY_NOT_PROVEN');
  }

  if (input.snapshot.officialEligibleCandidateCount <= 0) {
    reasons.push('NO_OFFICIAL_ELIGIBLE_CANDIDATE');
  }

  if (input.promotionEvidenceStatus === 'OFFICIAL_CANDIDATE_AVAILABLE') {
    reasons.push('OFFICIAL_ELIGIBLE_BUT_DECISION_MISSING');
  } else if (input.promotionEvidenceStatus === 'RESEARCH_SIGNAL_ONLY') {
    reasons.push('RESEARCH_SIGNAL_AVAILABLE');
  } else if (input.promotionEvidenceStatus === 'NO_CURRENT_VALUE_SIGNAL') {
    reasons.push('NO_CURRENT_VALUE_SIGNAL');
  }

  reasons.push('DECISION_CYCLE_MISSING');
  return [...new Set(reasons)];
}

function primaryDiagnosticReason(
  reasons: readonly DecisionOpportunityReasonCode[],
): DecisionOpportunityReasonCode {
  const priority: DecisionOpportunityReasonCode[] = [
    'OFFICIAL_ELIGIBLE_BUT_DECISION_MISSING',
    'SNAPSHOT_NO_FRESH_PIT_ODDS',
    'NO_PIT_USABLE_ODDS',
    'FRESH_ODDS_NOT_SUCCESSFUL',
    'FRESH_ODDS_CHECKPOINT_MISSING',
    'MODEL_OUTPUT_UNAVAILABLE',
    'BASELINE_FALLBACK_OFFICIAL_LOCK',
    'HORIZON_NOT_VALIDATED',
    'RELIABILITY_NOT_PROVEN',
    'LIMITED_CONFIDENCE_RESEARCH_ONLY',
    'MODEL_HISTORY_INSUFFICIENT',
    'NO_OFFICIAL_ELIGIBLE_CANDIDATE',
    'NO_CURRENT_VALUE_SIGNAL',
    'RESEARCH_SIGNAL_AVAILABLE',
    'DECISION_CYCLE_MISSING',
  ];

  return priority.find((reason): boolean => reasons.includes(reason)) ?? 'DECISION_CYCLE_MISSING';
}

export function auditDecisionOpportunity(input: {
  snapshot: DecisionOpportunitySnapshot;
  paperDecisions: readonly PaperDecisionEvidence[];
  freshOddsCheckpoint: FreshOddsCheckpointEvidence | null;
  reportAsOf: Date;
  paperHorizons?: readonly number[];
  decisionToleranceMinutes?: number;
}): DecisionOpportunityAuditRow {
  const paperHorizons = [...new Set(input.paperHorizons ?? DEFAULT_PAPER_DECISION_HORIZONS)];
  const toleranceMinutes =
    input.decisionToleranceMinutes ?? DEFAULT_PAPER_DECISION_TOLERANCE_MINUTES;
  const scheduledPaperHorizon = paperHorizons.includes(input.snapshot.checkpointMinutes);
  const window = decisionWindow({
    snapshot: input.snapshot,
    toleranceMinutes,
  });
  const modelAvailabilityStatus = modelAvailability(input.snapshot);
  const promotionEvidenceStatus = promotionEvidence(input.snapshot);
  const matchingDecisions = input.paperDecisions
    .filter(
      (decision): boolean =>
        decision.providerFixtureId === input.snapshot.providerFixtureId &&
        decision.horizonMinutes === input.snapshot.checkpointMinutes,
    )
    .sort(
      (left, right): number =>
        left.decisionAsOf.getTime() - right.decisionAsOf.getTime() || left.id - right.id,
    );

  let paperDecisionLinkStatus: PaperDecisionLinkStatus;
  let opportunityClassification: OpportunityClassification;
  let linkedDecision: PaperDecisionEvidence | null = null;
  let reasonCodes: DecisionOpportunityReasonCode[];

  if (!scheduledPaperHorizon) {
    paperDecisionLinkStatus = 'NOT_CONFIGURED_HORIZON';
    opportunityClassification = 'NOT_APPLICABLE';
    reasonCodes = ['PAPER_HORIZON_NOT_CONFIGURED'];
  } else if (input.reportAsOf.getTime() <= window.closedAt.getTime()) {
    paperDecisionLinkStatus = 'PENDING_DECISION_WINDOW';
    opportunityClassification = 'PENDING';
    reasonCodes = ['DECISION_WINDOW_PENDING'];
  } else if (matchingDecisions.length > 1) {
    paperDecisionLinkStatus = 'DUPLICATE_DECISIONS';
    opportunityClassification = 'INVALID';
    reasonCodes = ['PAPER_DECISION_DUPLICATE'];
  } else if (matchingDecisions.length === 1) {
    linkedDecision = matchingDecisions[0] as PaperDecisionEvidence;
    const violations = decisionLineageViolations({
      snapshot: input.snapshot,
      decision: linkedDecision,
      toleranceMinutes,
    });

    if (violations.length > 0) {
      paperDecisionLinkStatus = 'INVALID_DECISION_LINEAGE';
      opportunityClassification = 'INVALID';
      reasonCodes = violations;
    } else if (linkedDecision.decisionType === 'BEST_BET') {
      paperDecisionLinkStatus = 'BEST_BET_LINKED';
      opportunityClassification = 'COVERED';
      reasonCodes = ['PAPER_BEST_BET_RECORDED'];
    } else {
      paperDecisionLinkStatus = 'NO_BET_LINKED';
      opportunityClassification = 'COVERED';
      reasonCodes = ['PAPER_NO_BET_RECORDED'];
    }
  } else {
    paperDecisionLinkStatus = 'MISSING_EXPECTED_DECISION';
    reasonCodes = diagnosticReasonCodes({
      snapshot: input.snapshot,
      freshOddsCheckpoint: input.freshOddsCheckpoint,
      modelAvailabilityStatus,
      promotionEvidenceStatus,
    });
    const prerequisiteGap =
      input.snapshot.candidateCount <= 0 ||
      input.snapshot.analysisStatus === 'NO_FRESH_PIT_ODDS' ||
      input.freshOddsCheckpoint == null ||
      input.freshOddsCheckpoint.status.toUpperCase() !== 'SUCCESS' ||
      input.freshOddsCheckpoint.pitUsableOdds <= 0;
    opportunityClassification = prerequisiteGap ? 'PREREQUISITE_GAP' : 'OPERATIONAL_GAP';
  }

  return {
    version: DECISION_OPPORTUNITY_AUDIT_VERSION,
    snapshotId: input.snapshot.snapshotId,
    snapshotHash: input.snapshot.snapshotHash,
    providerFixtureId: input.snapshot.providerFixtureId,
    checkpointMinutes: input.snapshot.checkpointMinutes,
    checkpointLabel: input.snapshot.checkpointLabel,
    snapshotAsOf: input.snapshot.snapshotAsOf.toISOString(),
    kickoffAt: input.snapshot.kickoffAt.toISOString(),
    scheduledPaperHorizon,
    decisionWindowDueAt: window.dueAt.toISOString(),
    decisionWindowClosedAt: window.closedAt.toISOString(),
    paperDecisionLinkStatus,
    linkedDecisionId: linkedDecision?.id ?? null,
    linkedDecisionType: linkedDecision?.decisionType ?? null,
    modelAvailabilityStatus,
    promotionEvidenceStatus,
    opportunityClassification,
    primaryReason:
      reasonCodes[0] === 'PAPER_BEST_BET_RECORDED' ||
      reasonCodes[0] === 'PAPER_NO_BET_RECORDED' ||
      reasonCodes[0] === 'PAPER_HORIZON_NOT_CONFIGURED' ||
      reasonCodes[0] === 'DECISION_WINDOW_PENDING' ||
      reasonCodes[0] === 'PAPER_DECISION_DUPLICATE' ||
      reasonCodes[0] === 'PAPER_DECISION_PIT_VIOLATION' ||
      reasonCodes[0] === 'PAPER_DECISION_WINDOW_MISMATCH'
        ? (reasonCodes[0] as DecisionOpportunityReasonCode)
        : primaryDiagnosticReason(reasonCodes),
    reasonCodes,
    analysisStatus: input.snapshot.analysisStatus,
    candidateCount: finiteNonNegativeInteger(input.snapshot.candidateCount),
    currentEligibleCandidateCount: finiteNonNegativeInteger(
      input.snapshot.currentEligibleCandidateCount,
    ),
    officialEligibleCandidateCount: finiteNonNegativeInteger(
      input.snapshot.officialEligibleCandidateCount,
    ),
    modelSources: uniqueStrings(input.snapshot.modelSources),
    confidenceTiers: uniqueStrings(input.snapshot.confidenceTiers),
    reliabilityStatuses: uniqueStrings(input.snapshot.reliabilityStatuses),
    maximumModelHistorySampleSize: Math.max(
      0,
      ...input.snapshot.modelHistorySampleSizes.map(finiteNonNegativeInteger),
    ),
    freshOddsCheckpointStatus: input.freshOddsCheckpoint?.status ?? null,
    freshOddsPitUsableOdds: input.freshOddsCheckpoint?.pitUsableOdds ?? null,
    paperOnly: true,
    appendOnlySource: true,
    officialBestBetChanged: false,
    automaticPromotion: false,
    automaticBetPlacement: false,
    realMoneyExecution: false,
  };
}

function metrics(rows: readonly DecisionOpportunityAuditRow[]): DecisionOpportunityMetrics {
  const scheduled = rows.filter((row): boolean => row.scheduledPaperHorizon);
  const maturedScheduled = scheduled.filter(
    (row): boolean => row.paperDecisionLinkStatus !== 'PENDING_DECISION_WINDOW',
  );
  const covered = maturedScheduled.filter(
    (row): boolean => row.opportunityClassification === 'COVERED',
  );
  const modelEvaluated = rows.filter(
    (row): boolean => row.modelAvailabilityStatus !== 'NO_MODEL_EVIDENCE',
  );

  return {
    rows: rows.length,
    scheduled: scheduled.length,
    maturedScheduled: maturedScheduled.length,
    covered: covered.length,
    bestBets: rows.filter((row): boolean => row.paperDecisionLinkStatus === 'BEST_BET_LINKED')
      .length,
    noBets: rows.filter((row): boolean => row.paperDecisionLinkStatus === 'NO_BET_LINKED').length,
    missingExpectedDecisions: rows.filter(
      (row): boolean => row.paperDecisionLinkStatus === 'MISSING_EXPECTED_DECISION',
    ).length,
    operationalGaps: rows.filter(
      (row): boolean => row.opportunityClassification === 'OPERATIONAL_GAP',
    ).length,
    prerequisiteGaps: rows.filter(
      (row): boolean => row.opportunityClassification === 'PREREQUISITE_GAP',
    ).length,
    pending: rows.filter((row): boolean => row.opportunityClassification === 'PENDING').length,
    invalid: rows.filter((row): boolean => row.opportunityClassification === 'INVALID').length,
    researchSignals: rows.filter(
      (row): boolean => row.promotionEvidenceStatus === 'RESEARCH_SIGNAL_ONLY',
    ).length,
    officialEligibleRows: rows.filter(
      (row): boolean => row.promotionEvidenceStatus === 'OFFICIAL_CANDIDATE_AVAILABLE',
    ).length,
    dynamicModelRows: rows.filter(
      (row): boolean => row.modelAvailabilityStatus === 'DYNAMIC_MODEL_AVAILABLE',
    ).length,
    fallbackModelRows: rows.filter(
      (row): boolean => row.modelAvailabilityStatus === 'BASELINE_FALLBACK_ONLY',
    ).length,
    noModelEvidenceRows: rows.filter(
      (row): boolean => row.modelAvailabilityStatus === 'NO_MODEL_EVIDENCE',
    ).length,
    terminalDecisionCoverageRate:
      maturedScheduled.length > 0 ? covered.length / maturedScheduled.length : null,
    researchSignalRate:
      rows.length > 0
        ? rows.filter((row): boolean => row.promotionEvidenceStatus === 'RESEARCH_SIGNAL_ONLY')
            .length / rows.length
        : null,
    officialEligibilityRate:
      rows.length > 0
        ? rows.filter(
            (row): boolean => row.promotionEvidenceStatus === 'OFFICIAL_CANDIDATE_AVAILABLE',
          ).length / rows.length
        : null,
    dynamicModelCoverageRate:
      modelEvaluated.length > 0
        ? rows.filter((row): boolean => row.modelAvailabilityStatus === 'DYNAMIC_MODEL_AVAILABLE')
            .length / modelEvaluated.length
        : null,
  };
}

function countsBy(
  rows: readonly DecisionOpportunityAuditRow[],
  keyFor: (row: DecisionOpportunityAuditRow) => string,
): Array<{ key: string; rows: number }> {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, rows: count }))
    .sort((left, right): number => right.rows - left.rows || left.key.localeCompare(right.key));
}

export function aggregateDecisionOpportunityAudit(
  rows: readonly DecisionOpportunityAuditRow[],
): DecisionOpportunityAuditReport {
  const horizons = new Map<number, DecisionOpportunityAuditRow[]>();

  for (const row of rows) {
    const values = horizons.get(row.checkpointMinutes) ?? [];
    values.push(row);
    horizons.set(row.checkpointMinutes, values);
  }

  return {
    version: DECISION_OPPORTUNITY_AUDIT_VERSION,
    overall: metrics(rows),
    byHorizon: [...horizons.entries()]
      .map(([checkpointMinutes, values]): DecisionOpportunityGroup => ({
        key: `T-${checkpointMinutes}`,
        checkpointMinutes,
        ...metrics(values),
      }))
      .sort(
        (left, right): number => (right.checkpointMinutes ?? 0) - (left.checkpointMinutes ?? 0),
      ),
    byPaperDecisionLinkStatus: countsBy(rows, (row): string => row.paperDecisionLinkStatus),
    byOpportunityClassification: countsBy(rows, (row): string => row.opportunityClassification),
    byModelAvailability: countsBy(rows, (row): string => row.modelAvailabilityStatus),
    byPrimaryReason: countsBy(rows, (row): string => row.primaryReason),
    paperOnly: true,
    appendOnlyDerivedReadModel: true,
    officialBestBetChanged: false,
    automaticPromotion: false,
    automaticBetPlacement: false,
    realMoneyExecution: false,
  };
}
