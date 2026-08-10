import { median, removeVig } from '@football-ai/engine';
import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';

export const MULTI_HORIZON_DECISION_VERSION = 'v8.0-stage6-multi-horizon-decision-v1';
export const MULTI_HORIZON_POLICY_VERSION = 'v8.0-stage6-best-bet-policy-v1';

export const MULTI_HORIZON_POLICY = Object.freeze({
  horizonsMinutes: [180, 90, 30, 10, 5] as const,
  minimumOdds: 1.4,
  maximumOdds: 4,
  minimumEdge: 0.03,
  minimumExpectedValue: 0.02,
  minimumReliability: 0.8,
  maximumUncertainty: 0.35,
  maximumOddsAgeMinutes: 360,
  minimumCompleteBookmakers: 1,
  maximumBestBetsPerFixtureHorizon: 1,
});

export type DecisionType = 'BEST_BET' | 'NO_BET';

export interface DecisionOddsQuote {
  oddsSnapshotId: number;
  bookmakerId: number;
  selection: string;
  decimalOdds: number;
  capturedAt: string;
}

export interface DecisionCandidate {
  marketKey: string;
  selection: string;
  line: number | null;
  modelProbability: number;
  pushProbability: number;
  conditionalModelProbability: number;
  fairMarketProbability: number | null;
  odds: number | null;
  oddsSnapshotId: number | null;
  edge: number | null;
  expectedValue: number | null;
  reliability: number;
  uncertainty: number;
  uncertaintyPenalty: number;
  eligible: boolean;
  reasonCodes: string[];
  score: number | null;
}

export interface MultiHorizonDecision {
  version: string;
  decisionId: string;
  fixtureId: number;
  decisionAsOf: string;
  kickoffAt: string;
  horizon: number;
  candidateMarkets: DecisionCandidate[];
  decision: DecisionType;
  selectedCandidate: DecisionCandidate | null;
  modelProbability: number | null;
  fairMarketProbability: number | null;
  odds: number | null;
  edge: number | null;
  reliability: number | null;
  uncertainty: number | null;
  policyVersion: string;
  modelVersion: string;
  reasonCodes: string[];
  riskOverlayApplied: false;
  stage5RowHash: string;
}

export function consensusFairProbabilities(
  bookmakerQuotes: readonly DecisionOddsQuote[][],
): Record<string, number> {
  const bySelection = new Map<string, number[]>();
  for (const quotes of bookmakerQuotes) {
    if (quotes.length < 2) continue;
    const fair = removeVig(quotes.map((quote) => ({ code: quote.selection, odds: quote.decimalOdds })));
    for (const row of fair) {
      const values = bySelection.get(row.code) ?? [];
      values.push(row.fairProbability);
      bySelection.set(row.code, values);
    }
  }
  return Object.fromEntries(
    [...bySelection.entries()].map(([selection, values]) => [selection, median(values)]),
  );
}

export function assessDecisionCandidate(input: {
  marketKey: string;
  selection: string;
  line?: number | null;
  modelProbability: number;
  pushProbability?: number;
  fairMarketProbability?: number | null;
  quote?: DecisionOddsQuote | null;
  reliability: number;
  uncertainty: number;
  uncertaintyPenalty: number;
}): DecisionCandidate {
  const reasons: string[] = [];
  const fairMarketProbability = input.fairMarketProbability ?? null;
  const odds = input.quote?.decimalOdds ?? null;
  const pushProbability = Math.max(0, Math.min(1, input.pushProbability ?? 0));
  const nonPushProbability = Math.max(1e-12, 1 - pushProbability);
  const conditionalModelProbability = input.modelProbability / nonPushProbability;
  const edge =
    fairMarketProbability == null ? null : conditionalModelProbability - fairMarketProbability;
  const lossProbability = Math.max(0, 1 - input.modelProbability - pushProbability);
  const expectedValue =
    odds == null ? null : input.modelProbability * (odds - 1) - lossProbability;
  if (fairMarketProbability == null || odds == null) reasons.push('NO_COMPLETE_PIT_ODDS');
  if (odds != null && odds < MULTI_HORIZON_POLICY.minimumOdds) reasons.push('ODDS_BELOW_MINIMUM');
  if (odds != null && odds > MULTI_HORIZON_POLICY.maximumOdds) reasons.push('ODDS_ABOVE_MAXIMUM');
  if (edge != null && edge < MULTI_HORIZON_POLICY.minimumEdge) reasons.push('EDGE_BELOW_MINIMUM');
  if (expectedValue != null && expectedValue < MULTI_HORIZON_POLICY.minimumExpectedValue) {
    reasons.push('EXPECTED_VALUE_BELOW_MINIMUM');
  }
  if (input.reliability < MULTI_HORIZON_POLICY.minimumReliability) {
    reasons.push('RELIABILITY_BELOW_MINIMUM');
  }
  if (input.uncertainty > MULTI_HORIZON_POLICY.maximumUncertainty) {
    reasons.push('UNCERTAINTY_ABOVE_MAXIMUM');
  }
  const score =
    edge == null || expectedValue == null
      ? null
      : edge * input.reliability + expectedValue * 0.3 - input.uncertaintyPenalty * 0.05;
  return {
    marketKey: input.marketKey,
    selection: input.selection,
    line: input.line ?? null,
    modelProbability: input.modelProbability,
    pushProbability,
    conditionalModelProbability,
    fairMarketProbability,
    odds,
    oddsSnapshotId: input.quote?.oddsSnapshotId ?? null,
    edge,
    expectedValue,
    reliability: input.reliability,
    uncertainty: input.uncertainty,
    uncertaintyPenalty: input.uncertaintyPenalty,
    eligible: reasons.length === 0,
    reasonCodes: reasons,
    score,
  };
}

export function buildMultiHorizonDecision(input: {
  fixtureId: number;
  decisionAsOf: string;
  kickoffAt: string;
  horizon: number;
  candidates: DecisionCandidate[];
  modelVersion: string;
  stage5RowHash: string;
}): MultiHorizonDecision {
  const eligible = input.candidates
    .filter((candidate) => candidate.eligible)
    .sort(
      (left, right) =>
        (right.score ?? Number.NEGATIVE_INFINITY) - (left.score ?? Number.NEGATIVE_INFINITY) ||
        left.marketKey.localeCompare(right.marketKey) ||
        left.selection.localeCompare(right.selection),
    );
  const selectedCandidate = eligible[0] ?? null;
  const content = {
    version: MULTI_HORIZON_DECISION_VERSION,
    fixtureId: input.fixtureId,
    decisionAsOf: input.decisionAsOf,
    kickoffAt: input.kickoffAt,
    horizon: input.horizon,
    candidateMarkets: input.candidates,
    decision: selectedCandidate ? ('BEST_BET' as const) : ('NO_BET' as const),
    selectedCandidate,
    modelProbability: selectedCandidate?.modelProbability ?? null,
    fairMarketProbability: selectedCandidate?.fairMarketProbability ?? null,
    odds: selectedCandidate?.odds ?? null,
    edge: selectedCandidate?.edge ?? null,
    reliability: selectedCandidate?.reliability ?? null,
    uncertainty: selectedCandidate?.uncertainty ?? null,
    policyVersion: MULTI_HORIZON_POLICY_VERSION,
    modelVersion: input.modelVersion,
    reasonCodes: selectedCandidate
      ? ['POLICY_ELIGIBLE_HIGHEST_RISK_ADJUSTED_SCORE']
      : [...new Set(input.candidates.flatMap((candidate) => candidate.reasonCodes))],
    riskOverlayApplied: false as const,
    stage5RowHash: input.stage5RowHash,
  };
  return {
    ...content,
    decisionId: sha256(stableStringify(content)),
  };
}
