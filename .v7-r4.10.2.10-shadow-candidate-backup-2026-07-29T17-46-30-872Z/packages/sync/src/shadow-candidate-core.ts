export const SHADOW_CANDIDATE_LEDGER_VERSION =
  'v7.0-r4.10.2.10-shadow-candidate-daily-ledger-v1';

export type ShadowCandidateClassificationStatus =
  | 'SHADOW_CANDIDATE'
  | 'SHADOW_NO_CANDIDATE';

export type ShadowCandidateTier =
  | 'CURRENT_VALUE_SHADOW'
  | 'PROVISIONAL_VALUE_SHADOW'
  | 'DIAGNOSTIC_TRACKING_SHADOW';

export interface ShadowCandidateInput {
  marketType: string;
  selection: string;
  lineValue?: number | null;
  decimalOdds: number;
  bookmakerName?: string | null;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  conservativeEdge?: number | null;
  conservativeExpectedValue?: number | null;
  riskAdjustedScore?: number | null;
  currentSignalEligible?: boolean;
  officialEligible?: boolean;
  signalTier?: string | null;
  modelSource?: string | null;
  modelConfidenceTier?: string | null;
  modelHistorySampleSize?: number | null;
  quoteOutlier?: boolean;
  currentSignalRejectionReasons?: string[];
  officialRejectionReasons?: string[];
  sourceOddsSnapshotId?: number | null;
  sourceOddsEffectiveAt?: string | null;
}

export interface ShadowCandidateSelection {
  rank: 1;
  shadowTier: ShadowCandidateTier;
  shadowOnly: true;
  shadowEligible: true;
  stakeEligible: false;
  officialEligible: boolean;
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
  bookmakerName: string | null;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  conservativeEdge: number | null;
  conservativeExpectedValue: number | null;
  riskAdjustedScore: number | null;
  signalTier: string | null;
  modelSource: string | null;
  modelConfidenceTier: string | null;
  modelHistorySampleSize: number | null;
  quoteOutlier: boolean;
  currentSignalEligible: boolean;
  currentSignalRejectionReasons: string[];
  officialRejectionReasons: string[];
  sourceOddsSnapshotId: number | null;
  sourceOddsEffectiveAt: string | null;
  selectionReasonCodes: string[];
}

export interface ShadowCandidateClassification {
  version: string;
  providerFixtureId: number;
  checkpointMinutes: number;
  calculatedAt: string;
  analysisStatus: string;
  status: ShadowCandidateClassificationStatus;
  candidateCount: number;
  validCandidateCount: number;
  excludedCandidateCount: number;
  selectionPolicy:
    'CURRENT_VALUE_THEN_RISK_ADJUSTED_THEN_CONSERVATIVE_VALUE_V1';
  selected: ShadowCandidateSelection | null;
  officialBestBetChanged: false;
  automaticBetPlacement: false;
  realMoneyExecution: false;
}

function finite(
  value: number | null | undefined,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  );
}

function optionalFinite(
  value: number | null | undefined,
): number | null {
  return finite(value)
    ? value
    : null;
}

function stringList(
  value: string[] | undefined,
): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is string =>
              typeof item === 'string' &&
              item.length > 0,
          ),
        ),
      ]
    : [];
}

export function isValidShadowCandidate(
  candidate: ShadowCandidateInput,
): boolean {
  return (
    typeof candidate.marketType === 'string' &&
    candidate.marketType.length > 0 &&
    typeof candidate.selection === 'string' &&
    candidate.selection.length > 0 &&
    finite(candidate.decimalOdds) &&
    candidate.decimalOdds > 1 &&
    finite(candidate.modelProbability) &&
    candidate.modelProbability >= 0 &&
    candidate.modelProbability <= 1 &&
    finite(candidate.fairMarketProbability) &&
    candidate.fairMarketProbability >= 0 &&
    candidate.fairMarketProbability <= 1 &&
    finite(candidate.edge) &&
    finite(candidate.expectedValue) &&
    candidate.quoteOutlier !== true
  );
}

function tierRank(
  candidate: ShadowCandidateInput,
): number {
  if (candidate.currentSignalEligible === true) {
    return 3;
  }

  if (
    optionalFinite(
      candidate.conservativeEdge,
    ) != null &&
    optionalFinite(
      candidate.conservativeExpectedValue,
    ) != null &&
    (candidate.conservativeEdge ?? -Infinity) >= 0 &&
    (candidate.conservativeExpectedValue ?? -Infinity) >= 0
  ) {
    return 2;
  }

  return 1;
}

function sortableNumber(
  value: number | null | undefined,
): number {
  return finite(value)
    ? value
    : Number.NEGATIVE_INFINITY;
}

export function compareShadowCandidates(
  left: ShadowCandidateInput,
  right: ShadowCandidateInput,
): number {
  return (
    tierRank(right) -
      tierRank(left) ||
    sortableNumber(
      right.riskAdjustedScore,
    ) -
      sortableNumber(
        left.riskAdjustedScore,
      ) ||
    sortableNumber(
      right.conservativeExpectedValue,
    ) -
      sortableNumber(
        left.conservativeExpectedValue,
      ) ||
    sortableNumber(
      right.conservativeEdge,
    ) -
      sortableNumber(
        left.conservativeEdge,
      ) ||
    right.expectedValue -
      left.expectedValue ||
    right.edge -
      left.edge ||
    (
      right.modelHistorySampleSize ??
      0
    ) -
      (
        left.modelHistorySampleSize ??
        0
      ) ||
    left.decimalOdds -
      right.decimalOdds ||
    left.marketType.localeCompare(
      right.marketType,
    ) ||
    left.selection.localeCompare(
      right.selection,
    ) ||
    (
      left.lineValue ??
      Number.NEGATIVE_INFINITY
    ) -
      (
        right.lineValue ??
        Number.NEGATIVE_INFINITY
      )
  );
}

function shadowTier(
  candidate: ShadowCandidateInput,
): ShadowCandidateTier {
  if (candidate.currentSignalEligible === true) {
    return 'CURRENT_VALUE_SHADOW';
  }

  if (
    optionalFinite(
      candidate.conservativeEdge,
    ) != null &&
    optionalFinite(
      candidate.conservativeExpectedValue,
    ) != null &&
    (candidate.conservativeEdge ?? -Infinity) >= 0 &&
    (candidate.conservativeExpectedValue ?? -Infinity) >= 0
  ) {
    return 'PROVISIONAL_VALUE_SHADOW';
  }

  return 'DIAGNOSTIC_TRACKING_SHADOW';
}

function selectionReasonCodes(
  candidate: ShadowCandidateInput,
): string[] {
  const reasons = [
    'SHADOW_SELECTED_BEST_RISK_ADJUSTED_CANDIDATE',
    'SHADOW_RESEARCH_ONLY_NOT_BEST_BET',
    'SHADOW_STAKE_DISABLED',
  ];

  if (candidate.currentSignalEligible === true) {
    reasons.push(
      'SHADOW_CURRENT_VALUE_GATE_PASSED',
    );
  } else {
    reasons.push(
      'SHADOW_CURRENT_VALUE_GATE_NOT_PASSED',
    );
  }

  if (candidate.officialEligible === true) {
    reasons.push(
      'SHADOW_OFFICIAL_CANDIDATE_OBSERVED_NO_PROMOTION',
    );
  } else {
    reasons.push(
      'SHADOW_OFFICIAL_GATE_NOT_PASSED',
    );
  }

  return reasons;
}

export function buildShadowCandidateClassification(
  input: {
    providerFixtureId: number;
    checkpointMinutes: number;
    calculatedAt: string;
    analysisStatus: string;
    candidates: ShadowCandidateInput[];
  },
): ShadowCandidateClassification {
  const candidates =
    Array.isArray(input.candidates)
      ? input.candidates
      : [];

  const valid =
    candidates
      .filter(
        isValidShadowCandidate,
      )
      .sort(
        compareShadowCandidates,
      );

  const selected =
    valid[0] ??
    null;

  return {
    version:
      SHADOW_CANDIDATE_LEDGER_VERSION,
    providerFixtureId:
      input.providerFixtureId,
    checkpointMinutes:
      input.checkpointMinutes,
    calculatedAt:
      input.calculatedAt,
    analysisStatus:
      input.analysisStatus,
    status:
      selected == null
        ? 'SHADOW_NO_CANDIDATE'
        : 'SHADOW_CANDIDATE',
    candidateCount:
      candidates.length,
    validCandidateCount:
      valid.length,
    excludedCandidateCount:
      Math.max(
        0,
        candidates.length -
          valid.length,
      ),
    selectionPolicy:
      'CURRENT_VALUE_THEN_RISK_ADJUSTED_THEN_CONSERVATIVE_VALUE_V1',
    selected:
      selected == null
        ? null
        : {
            rank: 1,
            shadowTier:
              shadowTier(
                selected,
              ),
            shadowOnly: true,
            shadowEligible: true,
            stakeEligible: false,
            officialEligible:
              selected.officialEligible ===
              true,
            marketType:
              selected.marketType,
            selection:
              selected.selection,
            lineValue:
              selected.lineValue ??
              null,
            decimalOdds:
              selected.decimalOdds,
            bookmakerName:
              selected.bookmakerName ??
              null,
            modelProbability:
              selected.modelProbability,
            fairMarketProbability:
              selected.fairMarketProbability,
            edge:
              selected.edge,
            expectedValue:
              selected.expectedValue,
            conservativeEdge:
              optionalFinite(
                selected.conservativeEdge,
              ),
            conservativeExpectedValue:
              optionalFinite(
                selected.conservativeExpectedValue,
              ),
            riskAdjustedScore:
              optionalFinite(
                selected.riskAdjustedScore,
              ),
            signalTier:
              selected.signalTier ??
              null,
            modelSource:
              selected.modelSource ??
              null,
            modelConfidenceTier:
              selected.modelConfidenceTier ??
              null,
            modelHistorySampleSize:
              selected.modelHistorySampleSize ??
              null,
            quoteOutlier:
              selected.quoteOutlier ===
              true,
            currentSignalEligible:
              selected.currentSignalEligible ===
              true,
            currentSignalRejectionReasons:
              stringList(
                selected.currentSignalRejectionReasons,
              ),
            officialRejectionReasons:
              stringList(
                selected.officialRejectionReasons,
              ),
            sourceOddsSnapshotId:
              selected.sourceOddsSnapshotId ??
              null,
            sourceOddsEffectiveAt:
              selected.sourceOddsEffectiveAt ??
              null,
            selectionReasonCodes:
              selectionReasonCodes(
                selected,
              ),
          },
    officialBestBetChanged:
      false,
    automaticBetPlacement:
      false,
    realMoneyExecution:
      false,
  };
}
