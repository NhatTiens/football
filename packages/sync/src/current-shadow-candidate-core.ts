export const CURRENT_SHADOW_CANDIDATE_VERSION =
  'v7.0-r4.10.2.10-shadow-candidate-ledger-beta2a-v1';

export type CurrentShadowCandidateStatus =
  | 'CURRENT_VALUE_AVAILABLE'
  | 'SHADOW_CANDIDATE'
  | 'NO_SHADOW_CANDIDATE';

export type CurrentShadowConfidenceTier =
  | 'HIGH'
  | 'MEDIUM'
  | 'LIMITED'
  | 'UNKNOWN';

export interface CurrentShadowCandidateAudit {
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
  bookmakerName: string | null;
  modelProbability: number;
  fairMarketProbability: number;
  rawEdge: number;
  rawExpectedValue: number;
  conservativeEdge: number | null;
  conservativeExpectedValue: number | null;
  riskAdjustedScore: number | null;
  quoteAgreementRatio: number | null;
  quoteOutlier: boolean;
  currentSignalEligible: boolean;
  signalTier: string | null;
  modelSource: string | null;
  confidenceTier: CurrentShadowConfidenceTier;
  modelHistorySampleSize: number;
  reliabilityStatus: string | null;
  sourceOddsSnapshotId: number | null;
  rejectionReasons: string[];
  shadowRejectionReasons: string[];
}

export interface CurrentShadowCandidatePolicy {
  version: string;
  minimumOdds: number;
  minimumRawEdge: number;
  minimumRawExpectedValue: number;
  limitedConfidenceMaximumOdds: number;
  mediumConfidenceMaximumOdds: number;
  rejectQuoteOutlier: true;
  ranking:
    'CURRENT_ELIGIBLE_RISK_SCORE_CONSERVATIVE_VALUE_RAW_VALUE_ODDS_ASC';
  paperOnly: true;
  automaticPromotion: false;
}

export interface CurrentShadowCandidateDecision {
  version: string;
  status: CurrentShadowCandidateStatus;
  consideredCandidates: number;
  shadowEligibleCandidates: number;
  selected: CurrentShadowCandidateAudit | null;
  rejectedByReason: Record<string, number>;
  policy: CurrentShadowCandidatePolicy;
  officialBestBetChanged: false;
  automaticBetPlacement: false;
  realMoneyExecution: false;
}

type AnyRecord = Record<string, unknown>;

const POLICY: CurrentShadowCandidatePolicy = {
  version: CURRENT_SHADOW_CANDIDATE_VERSION,
  minimumOdds: 1.4,
  minimumRawEdge: 0.02,
  minimumRawExpectedValue: 0.02,
  limitedConfidenceMaximumOdds: 3.5,
  mediumConfidenceMaximumOdds: 6,
  rejectQuoteOutlier: true,
  ranking:
    'CURRENT_ELIGIBLE_RISK_SCORE_CONSERVATIVE_VALUE_RAW_VALUE_ODDS_ASC',
  paperOnly: true,
  automaticPromotion: false,
};

function record(value: unknown): AnyRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }

  return null;
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function stringArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return value.filter(
        (item: unknown): item is string =>
          typeof item === 'string' && item.length > 0,
      );
    }
  }

  return [];
}

function booleanValue(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }

  return null;
}

function confidenceTier(value: string | null): CurrentShadowConfidenceTier {
  const normalized = value?.toUpperCase() ?? '';

  if (normalized === 'HIGH') return 'HIGH';
  if (normalized === 'MEDIUM') return 'MEDIUM';
  if (normalized === 'LIMITED') return 'LIMITED';

  return 'UNKNOWN';
}

function normalizeCandidate(value: unknown): CurrentShadowCandidateAudit | null {
  const item = record(value);
  if (item == null) return null;

  const marketType = text(item.marketType, item.marketCode);
  const selection = text(item.selection, item.selectionCode);
  const decimalOdds = finiteNumber(item.decimalOdds, item.odds);
  const modelProbability = finiteNumber(item.modelProbability);
  const fairMarketProbability = finiteNumber(
    item.fairMarketProbability,
    item.marketProbability,
    item.consensusProbability,
  );
  const rawEdge = finiteNumber(item.edge, item.rawEdge);
  const rawExpectedValue = finiteNumber(
    item.expectedValue,
    item.rawExpectedValue,
  );

  if (
    marketType == null ||
    selection == null ||
    decimalOdds == null ||
    modelProbability == null ||
    fairMarketProbability == null ||
    rawEdge == null ||
    rawExpectedValue == null
  ) {
    return null;
  }

  const rejectionReasons = stringArray(
    item.currentSignalRejectionReasons,
    item.rejectionReasons,
    item.blockReasons,
    item.eligibilityReasons,
  );

  const tier = confidenceTier(
    text(item.modelConfidenceTier, item.confidenceTier),
  );

  const quoteOutlier =
    booleanValue(item.quoteOutlier) === true ||
    rejectionReasons.some((reason: string): boolean =>
      reason.includes('OUTLIER'),
    );

  const shadowRejectionReasons: string[] = [];

  if (decimalOdds < POLICY.minimumOdds) {
    shadowRejectionReasons.push('SHADOW_ODDS_BELOW_MINIMUM');
  }

  if (rawEdge < POLICY.minimumRawEdge) {
    shadowRejectionReasons.push('SHADOW_RAW_EDGE_BELOW_MINIMUM');
  }

  if (rawExpectedValue < POLICY.minimumRawExpectedValue) {
    shadowRejectionReasons.push('SHADOW_RAW_EV_BELOW_MINIMUM');
  }

  if (quoteOutlier) {
    shadowRejectionReasons.push('SHADOW_BOOKMAKER_QUOTE_OUTLIER');
  }

  if (
    tier === 'LIMITED' &&
    decimalOdds > POLICY.limitedConfidenceMaximumOdds
  ) {
    shadowRejectionReasons.push(
      'SHADOW_LIMITED_CONFIDENCE_ODDS_CAP_EXCEEDED',
    );
  }

  if (
    tier === 'MEDIUM' &&
    decimalOdds > POLICY.mediumConfidenceMaximumOdds
  ) {
    shadowRejectionReasons.push(
      'SHADOW_MEDIUM_CONFIDENCE_ODDS_CAP_EXCEEDED',
    );
  }

  return {
    marketType,
    selection,
    lineValue: finiteNumber(item.lineValue),
    decimalOdds,
    bookmakerName: text(item.bookmakerName, item.bookmaker),
    modelProbability,
    fairMarketProbability,
    rawEdge,
    rawExpectedValue,
    conservativeEdge: finiteNumber(item.conservativeEdge),
    conservativeExpectedValue: finiteNumber(
      item.conservativeExpectedValue,
    ),
    riskAdjustedScore: finiteNumber(
      item.riskAdjustedScore,
      item.recommendationScore,
    ),
    quoteAgreementRatio: finiteNumber(item.quoteAgreementRatio),
    quoteOutlier,
    currentSignalEligible:
      booleanValue(item.currentSignalEligible, item.eligible) === true,
    signalTier: text(item.signalTier),
    modelSource: text(item.modelSource),
    confidenceTier: tier,
    modelHistorySampleSize:
      Math.max(
        0,
        Math.trunc(
          finiteNumber(
            item.modelHistorySampleSize,
            item.historySampleSize,
          ) ?? 0,
        ),
      ),
    reliabilityStatus: text(item.reliabilityStatus),
    sourceOddsSnapshotId: finiteNumber(item.sourceOddsSnapshotId),
    rejectionReasons,
    shadowRejectionReasons,
  };
}

function descendingNullable(left: number | null, right: number | null): number {
  return (right ?? Number.NEGATIVE_INFINITY) -
    (left ?? Number.NEGATIVE_INFINITY);
}

export function compareCurrentShadowCandidates(
  left: CurrentShadowCandidateAudit,
  right: CurrentShadowCandidateAudit,
): number {
  return (
    Number(right.currentSignalEligible) -
      Number(left.currentSignalEligible) ||
    descendingNullable(left.riskAdjustedScore, right.riskAdjustedScore) ||
    descendingNullable(
      left.conservativeExpectedValue,
      right.conservativeExpectedValue,
    ) ||
    descendingNullable(left.conservativeEdge, right.conservativeEdge) ||
    descendingNullable(left.quoteAgreementRatio, right.quoteAgreementRatio) ||
    right.rawExpectedValue - left.rawExpectedValue ||
    right.rawEdge - left.rawEdge ||
    left.decimalOdds - right.decimalOdds ||
    left.marketType.localeCompare(right.marketType) ||
    left.selection.localeCompare(right.selection) ||
    (left.lineValue ?? -1) - (right.lineValue ?? -1)
  );
}

function rejectedByReason(
  candidates: CurrentShadowCandidateAudit[],
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const candidate of candidates) {
    for (const reason of candidate.shadowRejectionReasons) {
      result[reason] = (result[reason] ?? 0) + 1;
    }
  }

  return Object.fromEntries(
    Object.entries(result).sort(
      (left: [string, number], right: [string, number]): number =>
        left[0].localeCompare(right[0]),
    ),
  );
}

export function selectCurrentShadowCandidate(
  values: readonly unknown[],
): CurrentShadowCandidateDecision {
  const candidates = values
    .map(normalizeCandidate)
    .filter(
      (candidate): candidate is CurrentShadowCandidateAudit =>
        candidate != null,
    );

  const shadowEligible = candidates
    .filter(
      (candidate: CurrentShadowCandidateAudit): boolean =>
        candidate.shadowRejectionReasons.length === 0,
    )
    .sort(compareCurrentShadowCandidates);

  const selected = shadowEligible[0] ?? null;

  return {
    version: CURRENT_SHADOW_CANDIDATE_VERSION,
    status:
      selected == null
        ? 'NO_SHADOW_CANDIDATE'
        : selected.currentSignalEligible
          ? 'CURRENT_VALUE_AVAILABLE'
          : 'SHADOW_CANDIDATE',
    consideredCandidates: candidates.length,
    shadowEligibleCandidates: shadowEligible.length,
    selected,
    rejectedByReason: rejectedByReason(candidates),
    policy: POLICY,
    officialBestBetChanged: false,
    automaticBetPlacement: false,
    realMoneyExecution: false,
  };
}
