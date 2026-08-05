import type { PaperOuOppositeLineStrategyAudit } from './paper-ou-opposite-line-core.js';

export const PAPER_SHADOW_RECOMMENDATION_VERSION =
  'v7.0-r4.10.2.11.6-ou-opposite-half-goal-v2';

export const PAPER_SHADOW_FLAT_STAKE_UNITS = 1 as const;

export type PaperShadowRecommendationStatus =
  | 'RAW_VALUE_SHADOW'
  | 'HIERARCHICAL_VALUE_SHADOW'
  | 'BOUNDED_VALUE_SHADOW'
  | 'DIAGNOSTIC_SHADOW'
  | 'NO_CANDIDATE';

export interface PaperShadowCandidateInput {
  marketType: string;
  selection: string;
  lineValue?: number | null;
  decimalOdds: number;
  bookmakerName?: string | null;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  riskAdjustedScore?: number | null;
  quoteOutlier?: boolean;
  reliabilityStatus?: string | null;
  modelSource?: string | null;
  modelVersion?: string | null;
  modelConfidenceTier?: string | null;
  modelHistorySampleSize?: number | null;
  modelDataQualityScore?: number | null;
  dataQualityScore?: number | null;
  sourceOddsSnapshotId?: number | null;
  sourceOddsEffectiveAt?: string | null;
  currentSignalRejectionReasons?: string[];
  officialRejectionReasons?: string[];
  ouOppositeLineStrategy?: PaperOuOppositeLineStrategyAudit | null;
}

export interface PaperShadowRecommendationPolicy {
  version: string;
  rawMinimumOdds: 1.4;
  rawMinimumEdge: 0.04;
  rawMinimumExpectedValue: 0.03;
  hierarchicalMinimumOdds: 1.4;
  hierarchicalMinimumEdge: 0.01;
  hierarchicalMinimumExpectedValue: 0.01;
  boundedMinimumOdds: 1.4;
  boundedMaximumOdds: 3.5;
  boundedMinimumEdge: 0.005;
  boundedMinimumExpectedValue: 0.005;
  boundedMaximumProbabilityAdjustment: 0.01;
  boundedResidualFraction: 0.1;
  fallbackHdaMaximumActionableOdds: 3.5;
  fallbackHdaLongshotTreatment: 'DIAGNOSTIC_ONLY';
  flatStakeUnits: 1;
  prior: 'NO_VIG_MARKET_PRIOR_WITH_MODEL_SIGNAL_SHRINKAGE';
  ranking: 'RAW_THEN_HIERARCHICAL_THEN_BOUNDED_WITH_FALLBACK_HDA_LONGSHOT_QUARANTINE';
  paperOnly: true;
  automaticPromotion: false;
  ouRecommendationStrategy: 'OPPOSITE_SELECTION_SHIFT_HALF_GOAL_CLAMPED_1_5_3_5';
}

export interface PaperShadowCandidateAssessment {
  rank: 1;
  status: Exclude<PaperShadowRecommendationStatus, 'NO_CANDIDATE'>;
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
  bookmakerName: string | null;
  modelProbability: number;
  fairMarketProbability: number;
  rawEdge: number;
  rawExpectedValue: number;
  hierarchicalModelWeight: number;
  hierarchicalProbability: number;
  hierarchicalProbabilityHaircut: number;
  hierarchicalConservativeProbability: number;
  hierarchicalEdge: number;
  hierarchicalExpectedValue: number;
  boundedProbabilityAdjustment: number;
  boundedAdjustedProbability: number;
  boundedEdge: number;
  boundedExpectedValue: number;
  paperScore: number;
  rawValuePassed: boolean;
  hierarchicalValuePassed: boolean;
  boundedValuePassed: boolean;
  paperTrackEligible: boolean;
  hypotheticalFlatStakeUnits: 1;
  stakeEligible: false;
  officialEligible: false;
  reliabilityStatus: string | null;
  modelSource: string | null;
  modelVersion: string | null;
  modelConfidenceTier: string | null;
  modelHistorySampleSize: number;
  modelDataQualityScore: number;
  sourceOddsSnapshotId: number | null;
  sourceOddsEffectiveAt: string | null;
  currentSignalRejectionReasons: string[];
  officialRejectionReasons: string[];
  reasonCodes: string[];
  ouOppositeLineStrategy: PaperOuOppositeLineStrategyAudit | null;
}

export interface PaperShadowRecommendationDecision {
  version: string;
  providerFixtureId: number;
  horizonMinutes: number;
  calculatedAt: string;
  status: PaperShadowRecommendationStatus;
  consideredCandidates: number;
  validCandidates: number;
  rawValueCandidates: number;
  hierarchicalValueCandidates: number;
  boundedValueCandidates: number;
  selected: PaperShadowCandidateAssessment | null;
  policy: PaperShadowRecommendationPolicy;
  pitSafe: true;
  paperOnly: true;
  historicalRowsRewritten: false;
  automaticPromotion: false;
  automaticBetPlacement: false;
  realMoneyExecution: false;
}

const POLICY: PaperShadowRecommendationPolicy = Object.freeze({
  version: PAPER_SHADOW_RECOMMENDATION_VERSION,
  rawMinimumOdds: 1.4,
  rawMinimumEdge: 0.04,
  rawMinimumExpectedValue: 0.03,
  hierarchicalMinimumOdds: 1.4,
  hierarchicalMinimumEdge: 0.01,
  hierarchicalMinimumExpectedValue: 0.01,
  boundedMinimumOdds: 1.4,
  boundedMaximumOdds: 3.5,
  boundedMinimumEdge: 0.005,
  boundedMinimumExpectedValue: 0.005,
  boundedMaximumProbabilityAdjustment: 0.01,
  boundedResidualFraction: 0.1,
  fallbackHdaMaximumActionableOdds: 3.5,
  fallbackHdaLongshotTreatment: 'DIAGNOSTIC_ONLY',
  flatStakeUnits: PAPER_SHADOW_FLAT_STAKE_UNITS,
  prior: 'NO_VIG_MARKET_PRIOR_WITH_MODEL_SIGNAL_SHRINKAGE',
  ranking: 'RAW_THEN_HIERARCHICAL_THEN_BOUNDED_WITH_FALLBACK_HDA_LONGSHOT_QUARANTINE',
  paperOnly: true,
  automaticPromotion: false,
  ouRecommendationStrategy: 'OPPOSITE_SELECTION_SHIFT_HALF_GOAL_CLAMPED_1_5_3_5',
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function probability(value: number): number {
  return clamp(value, 0.001, 0.999);
}

function normalizedStrings(value: string[] | undefined): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0,
          ),
        ),
      ]
    : [];
}

function validCandidate(candidate: PaperShadowCandidateInput): boolean {
  return (
    candidate.quoteOutlier !== true &&
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
    finite(candidate.expectedValue)
  );
}

function confidenceFactor(value: string | null | undefined): number {
  const normalized = value?.trim().toUpperCase() ?? '';

  if (normalized === 'HIGH') return 1;
  if (normalized === 'MEDIUM') return 0.75;
  return 0.45;
}

function reliabilityFactor(value: string | null | undefined): number {
  const normalized = value?.trim().toUpperCase() ?? '';

  return normalized.includes('DIAGNOSTIC_ELIGIBLE') ? 1 : 0.65;
}

function modelSourceFactor(value: string | null | undefined): number {
  return value?.trim().toUpperCase().includes('DYNAMIC_DIXON_COLES') ? 0.65 : 0.25;
}

function dataQuality(candidate: PaperShadowCandidateInput): number {
  const value = candidate.modelDataQualityScore ?? candidate.dataQualityScore ?? 0;

  return finite(value) ? clamp(value, 0, 1) : 0;
}

function historySample(candidate: PaperShadowCandidateInput): number {
  const value = candidate.modelHistorySampleSize ?? 0;

  return finite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function assessCandidate(
  candidate: PaperShadowCandidateInput,
): Omit<PaperShadowCandidateAssessment, 'rank'> {
  const marketProbability = probability(candidate.fairMarketProbability);
  const modelProbability = probability(candidate.modelProbability);
  const sampleSize = historySample(candidate);
  const quality = dataQuality(candidate);
  const historyFactor = clamp(Math.log1p(sampleSize) / Math.log1p(12), 0, 1);
  const confidence = confidenceFactor(candidate.modelConfidenceTier);
  const sourceFactor = modelSourceFactor(candidate.modelSource);
  const modelWeight = clamp(
    0.05 +
      sourceFactor *
        (0.25 + 0.25 * quality + 0.3 * historyFactor + 0.2 * confidence) *
        reliabilityFactor(candidate.reliabilityStatus),
    0.05,
    0.7,
  );
  const hierarchicalProbability = probability(
    marketProbability + modelWeight * (modelProbability - marketProbability),
  );
  const baselineFallback = !candidate.modelSource?.toUpperCase().includes('DYNAMIC_DIXON_COLES');
  const fallbackHdaLongshotQuarantined =
    baselineFallback &&
    candidate.marketType === 'MATCH_WINNER' &&
    candidate.decimalOdds > POLICY.fallbackHdaMaximumActionableOdds;
  const haircut =
    0.005 +
    (1 - quality) * 0.01 +
    (1 - historyFactor) * 0.01 +
    (confidence < 0.5 ? 0.005 : 0) +
    (baselineFallback ? 0.005 : 0);
  const conservativeProbability = probability(hierarchicalProbability - haircut);
  const hierarchicalEdge = conservativeProbability - marketProbability;
  const hierarchicalExpectedValue = conservativeProbability * candidate.decimalOdds - 1;
  const rawValuePassed =
    !fallbackHdaLongshotQuarantined &&
    candidate.decimalOdds >= POLICY.rawMinimumOdds &&
    candidate.edge >= POLICY.rawMinimumEdge &&
    candidate.expectedValue >= POLICY.rawMinimumExpectedValue;
  const hierarchicalValuePassed =
    !fallbackHdaLongshotQuarantined &&
    candidate.decimalOdds >= POLICY.hierarchicalMinimumOdds &&
    hierarchicalEdge >= POLICY.hierarchicalMinimumEdge &&
    hierarchicalExpectedValue >= POLICY.hierarchicalMinimumExpectedValue;
  const boundedProbabilityAdjustment = clamp(
    (modelProbability - conservativeProbability) * POLICY.boundedResidualFraction,
    -POLICY.boundedMaximumProbabilityAdjustment,
    POLICY.boundedMaximumProbabilityAdjustment,
  );
  const boundedAdjustedProbability = probability(
    conservativeProbability + boundedProbabilityAdjustment,
  );
  const boundedEdge = boundedAdjustedProbability - marketProbability;
  const boundedExpectedValue = boundedAdjustedProbability * candidate.decimalOdds - 1;
  const boundedValuePassed =
    candidate.decimalOdds >= POLICY.boundedMinimumOdds &&
    candidate.decimalOdds <= POLICY.boundedMaximumOdds &&
    candidate.edge > 0 &&
    boundedEdge >= POLICY.boundedMinimumEdge &&
    boundedExpectedValue >= POLICY.boundedMinimumExpectedValue;
  const status: Exclude<PaperShadowRecommendationStatus, 'NO_CANDIDATE'> = rawValuePassed
    ? 'RAW_VALUE_SHADOW'
    : hierarchicalValuePassed
      ? 'HIERARCHICAL_VALUE_SHADOW'
      : boundedValuePassed
        ? 'BOUNDED_VALUE_SHADOW'
        : 'DIAGNOSTIC_SHADOW';
  const reasonCodes = [
    'PAPER_ONLY_NO_REAL_MONEY',
    'HIERARCHICAL_MARKET_PRIOR_APPLIED',
    rawValuePassed ? 'RAW_VALUE_GATE_PASSED' : 'RAW_VALUE_GATE_NOT_PASSED',
    hierarchicalValuePassed
      ? 'HIERARCHICAL_VALUE_GATE_PASSED'
      : 'HIERARCHICAL_VALUE_GATE_NOT_PASSED',
    boundedValuePassed ? 'BOUNDED_VALUE_GATE_PASSED' : 'BOUNDED_VALUE_GATE_NOT_PASSED',
    'BOUNDED_PROBABILITY_ADJUSTMENT_MAX_1PP',
    fallbackHdaLongshotQuarantined
      ? 'FALLBACK_HDA_LONGSHOT_DIAGNOSTIC_ONLY'
      : 'FALLBACK_HDA_LONGSHOT_FIREWALL_NOT_TRIGGERED',
    baselineFallback ? 'BASELINE_FALLBACK_RESEARCH_ONLY' : 'DYNAMIC_MODEL_OBSERVED',
    'AUTOMATIC_PROMOTION_DISABLED',
    ...(candidate.ouOppositeLineStrategy
      ? [
          'OU_OPPOSITE_PROTECTED_HALF_GOAL_APPLIED',
          candidate.ouOppositeLineStrategy.boundaryClamped
            ? 'OU_LINE_BOUNDARY_CLAMPED'
            : 'OU_LINE_SHIFTED_HALF_GOAL',
        ]
      : []),
  ];

  return {
    status,
    marketType: candidate.marketType,
    selection: candidate.selection,
    lineValue: candidate.lineValue ?? null,
    decimalOdds: candidate.decimalOdds,
    bookmakerName: candidate.bookmakerName ?? null,
    modelProbability,
    fairMarketProbability: marketProbability,
    rawEdge: candidate.edge,
    rawExpectedValue: candidate.expectedValue,
    hierarchicalModelWeight: modelWeight,
    hierarchicalProbability,
    hierarchicalProbabilityHaircut: haircut,
    hierarchicalConservativeProbability: conservativeProbability,
    hierarchicalEdge,
    hierarchicalExpectedValue,
    boundedProbabilityAdjustment,
    boundedAdjustedProbability,
    boundedEdge,
    boundedExpectedValue,
    paperScore: boundedExpectedValue * 0.6 + boundedEdge * 0.3 + quality * 0.1,
    rawValuePassed,
    hierarchicalValuePassed,
    boundedValuePassed,
    paperTrackEligible: rawValuePassed || hierarchicalValuePassed || boundedValuePassed,
    hypotheticalFlatStakeUnits: PAPER_SHADOW_FLAT_STAKE_UNITS,
    stakeEligible: false,
    officialEligible: false,
    reliabilityStatus: candidate.reliabilityStatus ?? null,
    modelSource: candidate.modelSource ?? null,
    modelVersion: candidate.modelVersion ?? null,
    modelConfidenceTier: candidate.modelConfidenceTier ?? null,
    modelHistorySampleSize: sampleSize,
    modelDataQualityScore: quality,
    sourceOddsSnapshotId: candidate.sourceOddsSnapshotId ?? null,
    sourceOddsEffectiveAt: candidate.sourceOddsEffectiveAt ?? null,
    currentSignalRejectionReasons: normalizedStrings(candidate.currentSignalRejectionReasons),
    officialRejectionReasons: normalizedStrings(candidate.officialRejectionReasons),
    reasonCodes,
    ouOppositeLineStrategy: candidate.ouOppositeLineStrategy ?? null,
  };
}

function statusRank(status: PaperShadowCandidateAssessment['status']): number {
  if (status === 'RAW_VALUE_SHADOW') return 4;
  if (status === 'HIERARCHICAL_VALUE_SHADOW') {
    return 3;
  }
  if (status === 'BOUNDED_VALUE_SHADOW') return 2;
  return 1;
}

function compareAssessments(
  left: Omit<PaperShadowCandidateAssessment, 'rank'>,
  right: Omit<PaperShadowCandidateAssessment, 'rank'>,
): number {
  return (
    statusRank(right.status) - statusRank(left.status) ||
    right.paperScore - left.paperScore ||
    right.hierarchicalExpectedValue - left.hierarchicalExpectedValue ||
    right.hierarchicalEdge - left.hierarchicalEdge ||
    right.rawExpectedValue - left.rawExpectedValue ||
    right.rawEdge - left.rawEdge ||
    left.decimalOdds - right.decimalOdds ||
    left.marketType.localeCompare(right.marketType) ||
    left.selection.localeCompare(right.selection)
  );
}

export function buildPaperShadowRecommendation(input: {
  providerFixtureId: number;
  horizonMinutes: number;
  calculatedAt: string;
  candidates: readonly PaperShadowCandidateInput[];
}): PaperShadowRecommendationDecision {
  const values = Array.isArray(input.candidates) ? input.candidates : [];
  const assessed = values.filter(validCandidate).map(assessCandidate).sort(compareAssessments);
  const selected = assessed[0] ?? null;

  return {
    version: PAPER_SHADOW_RECOMMENDATION_VERSION,
    providerFixtureId: input.providerFixtureId,
    horizonMinutes: input.horizonMinutes,
    calculatedAt: input.calculatedAt,
    status: selected?.status ?? 'NO_CANDIDATE',
    consideredCandidates: values.length,
    validCandidates: assessed.length,
    rawValueCandidates: assessed.filter((candidate): boolean => candidate.rawValuePassed).length,
    hierarchicalValueCandidates: assessed.filter(
      (candidate): boolean => candidate.hierarchicalValuePassed,
    ).length,
    boundedValueCandidates: assessed.filter((candidate): boolean => candidate.boundedValuePassed)
      .length,
    selected:
      selected == null
        ? null
        : {
            rank: 1,
            ...selected,
          },
    policy: POLICY,
    pitSafe: true,
    paperOnly: true,
    historicalRowsRewritten: false,
    automaticPromotion: false,
    automaticBetPlacement: false,
    realMoneyExecution: false,
  };
}
