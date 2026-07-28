export const CURRENT_RECOMMENDATION_RISK_RANKING_VERSION =
  'v7.0-r4.10.2.6-risk-adjusted-ranking-v1';

export type CurrentRiskModelSource =
  | 'DYNAMIC_DIXON_COLES'
  | 'SCIENTIFIC_BASELINE_FALLBACK';

export type CurrentRiskConfidenceTier =
  | 'HIGH'
  | 'MEDIUM'
  | 'LIMITED';

export type CurrentRiskSignalTier =
  | 'RISK_ADJUSTED_RESEARCH'
  | 'LOW_CONFIDENCE_DIAGNOSTIC';

export interface CurrentRiskQuote {
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
}

export interface CurrentQuoteConsensus {
  quoteCount: number;
  medianOdds: number;
  agreementRatio: number;
  candidateDeviationRatio: number;
  candidateIsHighOutlier: boolean;
}

export interface CurrentRiskAssessmentInput
  extends CurrentRiskQuote {
  modelProbability: number;
  fairMarketProbability: number;
  rawEdge: number;
  rawExpectedValue: number;
  reliabilityStatus: string;
  modelSource: CurrentRiskModelSource;
  confidenceTier: CurrentRiskConfidenceTier;
  historySampleSize: number;
  dataQualityScore: number;
  minimumOdds: number;
  minimumEdge: number;
  minimumExpectedValue: number;
  quoteConsensus: CurrentQuoteConsensus;
}

export interface CurrentRiskAssessment {
  rankingVersion: string;
  signalTier: CurrentRiskSignalTier;
  effectiveModelWeight: number;
  adjustedModelProbability: number;
  probabilityHaircut: number;
  conservativeProbability: number;
  conservativeEdge: number;
  conservativeExpectedValue: number;
  longshotPenalty: number;
  riskAdjustedScore: number;
  quoteCount: number;
  quoteMedianOdds: number;
  quoteAgreementRatio: number;
  quoteDeviationRatio: number;
  quoteOutlier: boolean;
  eligible: boolean;
  rejectionReasons: string[];
}

const QUOTE_AGREEMENT_TOLERANCE_RATIO = 0.12;
const HIGH_QUOTE_OUTLIER_RATIO = 0.18;
const LIMITED_CONFIDENCE_MAXIMUM_ODDS = 3.5;
const MEDIUM_CONFIDENCE_MAXIMUM_ODDS = 6;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteProbability(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0.001, 0.999);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((left: number, right: number): number => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function currentQuoteConsensusKey(input: {
  marketType: string;
  selection: string;
  lineValue: number | null;
}): string {
  return [
    input.marketType,
    input.selection,
    input.lineValue == null ? 'NULL' : input.lineValue.toFixed(3),
  ].join('|');
}

export function buildCurrentQuoteConsensusMap(
  quotes: CurrentRiskQuote[],
): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const quote of quotes) {
    if (!Number.isFinite(quote.decimalOdds) || quote.decimalOdds <= 1) continue;
    const key = currentQuoteConsensusKey(quote);
    const values = grouped.get(key) ?? [];
    values.push(quote.decimalOdds);
    grouped.set(key, values);
  }
  return grouped;
}

export function resolveCurrentQuoteConsensus(input: {
  groupedOdds: Map<string, number[]>;
  quote: CurrentRiskQuote;
}): CurrentQuoteConsensus {
  const values = input.groupedOdds.get(currentQuoteConsensusKey(input.quote)) ?? [input.quote.decimalOdds];
  const medianOdds = median(values);
  const safeMedian = medianOdds > 1 ? medianOdds : input.quote.decimalOdds;
  const agreementCount = values.filter(
    (decimalOdds: number): boolean =>
      Math.abs(decimalOdds / safeMedian - 1) <= QUOTE_AGREEMENT_TOLERANCE_RATIO,
  ).length;
  const candidateDeviationRatio = Math.abs(input.quote.decimalOdds / safeMedian - 1);
  return {
    quoteCount: values.length,
    medianOdds: safeMedian,
    agreementRatio: values.length === 0 ? 0 : agreementCount / values.length,
    candidateDeviationRatio,
    candidateIsHighOutlier:
      values.length >= 3 &&
      input.quote.decimalOdds > safeMedian * (1 + HIGH_QUOTE_OUTLIER_RATIO),
  };
}

function confidenceBaseWeight(confidenceTier: CurrentRiskConfidenceTier): number {
  if (confidenceTier === 'HIGH') return 0.65;
  if (confidenceTier === 'MEDIUM') return 0.45;
  return 0.2;
}

function reliabilityIsUnproven(reliabilityStatus: string): boolean {
  const normalized = reliabilityStatus.toUpperCase();
  return [
    'NO_PROVEN_SKILL',
    'RELIABILITY_REPORT_MISSING',
    'HORIZON_NOT_VALIDATED',
    'FROZEN_T90_REGISTRY_UNAVAILABLE',
  ].some((marker: string): boolean => normalized.includes(marker));
}

function riskSignalTier(input: {
  modelSource: CurrentRiskModelSource;
  confidenceTier: CurrentRiskConfidenceTier;
  historySampleSize: number;
  reliabilityStatus: string;
}): CurrentRiskSignalTier {
  if (
    input.modelSource === 'SCIENTIFIC_BASELINE_FALLBACK' ||
    input.confidenceTier === 'LIMITED' ||
    input.historySampleSize < 3 ||
    reliabilityIsUnproven(input.reliabilityStatus)
  ) {
    return 'LOW_CONFIDENCE_DIAGNOSTIC';
  }
  return 'RISK_ADJUSTED_RESEARCH';
}

export function assessRiskAdjustedCurrentCandidate(
  input: CurrentRiskAssessmentInput,
): CurrentRiskAssessment {
  const modelProbability = finiteProbability(input.modelProbability);
  const marketProbability = finiteProbability(input.fairMarketProbability);
  const dataQuality = clamp(input.dataQualityScore, 0, 1);
  const historyFactor = clamp(
    Math.log1p(Math.max(0, input.historySampleSize)) / Math.log1p(20),
    0,
    1,
  );
  const sourceFactor = input.modelSource === 'DYNAMIC_DIXON_COLES' ? 1 : 0.55;
  let effectiveModelWeight =
    confidenceBaseWeight(input.confidenceTier) *
    sourceFactor *
    (0.35 + 0.35 * dataQuality + 0.3 * historyFactor);
  if (
    input.modelSource === 'SCIENTIFIC_BASELINE_FALLBACK' &&
    input.historySampleSize === 0
  ) {
    effectiveModelWeight = Math.min(effectiveModelWeight, 0.08);
  }
  effectiveModelWeight = clamp(effectiveModelWeight, 0.02, 0.7);

  const adjustedModelProbability = finiteProbability(
    marketProbability + effectiveModelWeight * (modelProbability - marketProbability),
  );
  const lowQuoteCountHaircut =
    input.quoteConsensus.quoteCount >= 3
      ? 0
      : input.quoteConsensus.quoteCount === 2
        ? 0.01
        : 0.02;
  const quoteDisagreementHaircut =
    (1 - clamp(input.quoteConsensus.agreementRatio, 0, 1)) * 0.02;
  const dataQualityHaircut = (1 - dataQuality) * 0.02;
  const historyHaircut = (1 - historyFactor) * 0.02;
  const confidenceHaircut =
    input.confidenceTier === 'HIGH'
      ? 0
      : input.confidenceTier === 'MEDIUM'
        ? 0.0075
        : 0.02;
  const sourceHaircut =
    input.modelSource === 'SCIENTIFIC_BASELINE_FALLBACK' ? 0.015 : 0;
  const longshotProbabilityHaircut =
    input.decimalOdds <= 3
      ? 0
      : Math.min(0.06, (input.decimalOdds - 3) * 0.01);
  const probabilityHaircut =
    0.005 +
    lowQuoteCountHaircut +
    quoteDisagreementHaircut +
    dataQualityHaircut +
    historyHaircut +
    confidenceHaircut +
    sourceHaircut +
    longshotProbabilityHaircut;
  const conservativeProbability = finiteProbability(
    adjustedModelProbability - probabilityHaircut,
  );
  const conservativeEdge = conservativeProbability - marketProbability;
  const conservativeExpectedValue = conservativeProbability * input.decimalOdds - 1;
  const longshotPenalty =
    input.decimalOdds <= 3
      ? 0
      : Math.min(
          0.5,
          (input.decimalOdds - 3) *
            (input.confidenceTier === 'HIGH'
              ? 0.015
              : input.confidenceTier === 'MEDIUM'
                ? 0.03
                : 0.06),
        );
  const riskAdjustedScore =
    conservativeExpectedValue * 0.55 +
    conservativeEdge * 0.35 +
    input.quoteConsensus.agreementRatio * 0.05 +
    dataQuality * 0.05 -
    longshotPenalty -
    (input.quoteConsensus.candidateIsHighOutlier ? 1 : 0);
  const signalTier = riskSignalTier(input);
  const rejectionReasons: string[] = [];

  if (input.decimalOdds < input.minimumOdds) rejectionReasons.push('CURRENT_ODDS_BELOW_MINIMUM');
  if (input.rawEdge < input.minimumEdge) rejectionReasons.push('CURRENT_RAW_EDGE_BELOW_MINIMUM');
  if (input.rawExpectedValue < input.minimumExpectedValue) rejectionReasons.push('CURRENT_RAW_EV_BELOW_MINIMUM');
  if (conservativeEdge < input.minimumEdge) rejectionReasons.push('CURRENT_CONSERVATIVE_EDGE_BELOW_MINIMUM');
  if (conservativeExpectedValue < input.minimumExpectedValue) rejectionReasons.push('CURRENT_CONSERVATIVE_EV_BELOW_MINIMUM');
  if (input.quoteConsensus.candidateIsHighOutlier) rejectionReasons.push('CURRENT_BOOKMAKER_QUOTE_HIGH_OUTLIER');
  if (input.modelSource === 'SCIENTIFIC_BASELINE_FALLBACK') rejectionReasons.push('CURRENT_BASELINE_FALLBACK_RESEARCH_ONLY');
  if (input.confidenceTier === 'LIMITED') rejectionReasons.push('CURRENT_LIMITED_CONFIDENCE_RESEARCH_ONLY');
  if (input.historySampleSize < 3) rejectionReasons.push('CURRENT_MODEL_HISTORY_INSUFFICIENT');
  if (reliabilityIsUnproven(input.reliabilityStatus)) rejectionReasons.push('CURRENT_RELIABILITY_NOT_PROVEN');
  if (
    input.confidenceTier === 'LIMITED' &&
    input.decimalOdds > LIMITED_CONFIDENCE_MAXIMUM_ODDS
  ) rejectionReasons.push('CURRENT_LIMITED_CONFIDENCE_LONGSHOT_BLOCKED');
  if (
    input.confidenceTier === 'MEDIUM' &&
    input.decimalOdds > MEDIUM_CONFIDENCE_MAXIMUM_ODDS
  ) rejectionReasons.push('CURRENT_MEDIUM_CONFIDENCE_LONGSHOT_BLOCKED');
  if (signalTier === 'LOW_CONFIDENCE_DIAGNOSTIC') rejectionReasons.push('CURRENT_LOW_CONFIDENCE_DIAGNOSTIC_ONLY');

  return {
    rankingVersion: CURRENT_RECOMMENDATION_RISK_RANKING_VERSION,
    signalTier,
    effectiveModelWeight,
    adjustedModelProbability,
    probabilityHaircut,
    conservativeProbability,
    conservativeEdge,
    conservativeExpectedValue,
    longshotPenalty,
    riskAdjustedScore,
    quoteCount: input.quoteConsensus.quoteCount,
    quoteMedianOdds: input.quoteConsensus.medianOdds,
    quoteAgreementRatio: input.quoteConsensus.agreementRatio,
    quoteDeviationRatio: input.quoteConsensus.candidateDeviationRatio,
    quoteOutlier: input.quoteConsensus.candidateIsHighOutlier,
    eligible: rejectionReasons.length === 0,
    rejectionReasons: [...new Set(rejectionReasons)],
  };
}

export interface ComparableRiskCandidate {
  currentSignalEligible: boolean;
  riskAdjustedScore: number;
  conservativeExpectedValue: number;
  conservativeEdge: number;
  quoteAgreementRatio: number;
  adjustedModelProbability: number;
  decimalOdds: number;
  marketType: string;
  selection: string;
}

export function compareRiskAdjustedCurrentCandidates(
  left: ComparableRiskCandidate,
  right: ComparableRiskCandidate,
): number {
  return (
    Number(right.currentSignalEligible) - Number(left.currentSignalEligible) ||
    right.riskAdjustedScore - left.riskAdjustedScore ||
    right.conservativeExpectedValue - left.conservativeExpectedValue ||
    right.conservativeEdge - left.conservativeEdge ||
    right.quoteAgreementRatio - left.quoteAgreementRatio ||
    right.adjustedModelProbability - left.adjustedModelProbability ||
    left.decimalOdds - right.decimalOdds ||
    left.marketType.localeCompare(right.marketType) ||
    left.selection.localeCompare(right.selection)
  );
}
