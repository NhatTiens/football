// R4.10.2.8_RECOMMENDATION_EXPLAINABILITY

type AnyRecord = Record<string, unknown>;

export type ExplainableCandidate = {
  marketType: string | null;
  selection: string | null;
  lineValue: number | null;
  decimalOdds: number | null;
  bookmakerName: string | null;
  modelProbability: number | null;
  fairMarketProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  adjustedModelProbability: number | null;
  conservativeProbability: number | null;
  conservativeEdge: number | null;
  conservativeExpectedValue: number | null;
  riskAdjustedScore: number | null;
  signalTier: string | null;
  modelSource: string | null;
  modelConfidenceTier: string | null;
  modelHistorySampleSize: number | null;
  reliabilityStatus: string | null;
  eligible: boolean;
  rejectionReasons: string[];
};

function record(value: unknown): AnyRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : null;
}

function finiteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function text(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function stringArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function candidateLike(value: AnyRecord): boolean {
  const hasMarket = typeof value.marketType === 'string' || typeof value.marketCode === 'string';
  const hasSelection = typeof value.selection === 'string' || typeof value.selectionCode === 'string';
  const hasScientificField = [
    value.modelProbability,
    value.fairMarketProbability,
    value.conservativeExpectedValue,
    value.riskAdjustedScore,
    value.signalTier,
  ].some((item) => item != null);
  return hasMarket && hasSelection && hasScientificField;
}

function normalizeCandidate(value: AnyRecord): ExplainableCandidate {
  const eligible = value.currentSignalEligible === true || value.eligible === true;
  const reasons = stringArray(
    value.currentSignalRejectionReasons,
    value.rejectionReasons,
    value.blockReasons,
    value.eligibilityReasons,
    value.rawSignalRejectionReasons,
  );
  const auditReasons = reasons.length > 0 ? reasons : (!eligible ? stringArray(value.reasons) : []);
  return {
    marketType: text(value.marketType, value.marketCode),
    selection: text(value.selection, value.selectionCode),
    lineValue: finiteNumber(value.lineValue),
    decimalOdds: finiteNumber(value.decimalOdds, value.odds),
    bookmakerName: text(value.bookmakerName, value.bookmaker),
    modelProbability: finiteNumber(value.modelProbability),
    fairMarketProbability: finiteNumber(value.fairMarketProbability, value.marketProbability, value.consensusProbability),
    edge: finiteNumber(value.edge, value.rawEdge),
    expectedValue: finiteNumber(value.expectedValue, value.rawExpectedValue),
    adjustedModelProbability: finiteNumber(value.adjustedModelProbability),
    conservativeProbability: finiteNumber(value.conservativeProbability),
    conservativeEdge: finiteNumber(value.conservativeEdge),
    conservativeExpectedValue: finiteNumber(value.conservativeExpectedValue),
    riskAdjustedScore: finiteNumber(value.riskAdjustedScore, value.recommendationScore),
    signalTier: text(value.signalTier),
    modelSource: text(value.modelSource),
    modelConfidenceTier: text(value.modelConfidenceTier, value.confidenceTier),
    modelHistorySampleSize: finiteNumber(value.modelHistorySampleSize, value.historySampleSize),
    reliabilityStatus: text(value.reliabilityStatus),
    eligible,
    rejectionReasons: auditReasons,
  };
}

function extractCandidates(root: unknown): ExplainableCandidate[] {
  const found: ExplainableCandidate[] = [];
  const seen = new Set<object>();
  function visit(value: unknown, depth: number): void {
    if (depth > 10 || value == null || typeof value !== 'object') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const object = value as AnyRecord;
    if (candidateLike(object)) found.push(normalizeCandidate(object));
    for (const [key, child] of Object.entries(object)) {
      if (/candidate|analysis|audit|rank|result|recommendation/i.test(key)) visit(child, depth + 1);
    }
  }
  visit(root, 0);
  const unique = new Map<string, ExplainableCandidate>();
  for (const candidate of found) {
    const key = [candidate.marketType, candidate.selection, candidate.lineValue, candidate.bookmakerName, candidate.decimalOdds].join('|');
    unique.set(key, candidate);
  }
  return [...unique.values()];
}

function normalizedMarketCode(marketType: string | null, lineValue: number | null): string | null {
  const market = marketType?.toUpperCase() ?? '';
  if (market === 'MATCH_WINNER' || market === 'HDA' || market === '1X2') return 'HDA';
  if (market === 'BTTS' || market.includes('BOTH_TEAMS')) return 'BTTS';
  if (market.includes('TOTAL_GOALS_1_5') || lineValue === 1.5) return 'OVER_UNDER_1_5';
  if (market.includes('TOTAL_GOALS_2_5') || lineValue === 2.5) return 'OVER_UNDER_2_5';
  if (market.includes('TOTAL_GOALS_3_5') || lineValue === 3.5) return 'OVER_UNDER_3_5';
  return null;
}

function scoreCandidate(candidate: ExplainableCandidate, selection: AnyRecord, marketCode: string): number {
  if (normalizedMarketCode(candidate.marketType, candidate.lineValue) !== marketCode) return -1_000;
  if ((candidate.selection ?? '').toUpperCase() !== String(selection.code ?? '').toUpperCase()) return -1_000;
  let score = 10;
  const odds = finiteNumber(selection.decimalOdds);
  if (odds != null && candidate.decimalOdds != null && Math.abs(odds - candidate.decimalOdds) < 0.0001) score += 100;
  if (typeof selection.bookmakerName === 'string' && candidate.bookmakerName === selection.bookmakerName) score += 100;
  if (candidate.riskAdjustedScore != null) score += candidate.riskAdjustedScore;
  return score;
}

function mergeSelection(selectionValue: unknown, marketCode: string, candidates: ExplainableCandidate[]): AnyRecord {
  const selection = record(selectionValue) ?? {};
  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, selection, marketCode) }))
    .filter((entry) => entry.score > -1_000)
    .sort((left, right) => right.score - left.score);
  const candidate = ranked[0]?.candidate;
  if (!candidate) return { ...selection };
  return {
    ...selection,
    modelProbability: candidate.modelProbability,
    fairMarketProbability: candidate.fairMarketProbability,
    edge: candidate.edge,
    expectedValue: candidate.expectedValue,
    adjustedModelProbability: candidate.adjustedModelProbability,
    conservativeProbability: candidate.conservativeProbability,
    conservativeEdge: candidate.conservativeEdge,
    conservativeExpectedValue: candidate.conservativeExpectedValue,
    riskAdjustedScore: candidate.riskAdjustedScore,
    signalTier: candidate.signalTier,
    modelSource: candidate.modelSource,
    modelConfidenceTier: candidate.modelConfidenceTier,
    modelHistorySampleSize: candidate.modelHistorySampleSize,
    reliabilityStatus: candidate.reliabilityStatus,
    eligible: candidate.eligible,
    rejectionReasons: candidate.rejectionReasons,
    valueExplainabilityWired: true,
  };
}

export function attachCurrentRecommendationExplainability<T extends AnyRecord>(payload: T, analysis: unknown): T & AnyRecord {
  const candidates = extractCandidates(analysis);
  const markets = Array.isArray(payload.marketPredictions) ? payload.marketPredictions : [];
  let wiredSelections = 0;
  const enrichedMarkets = markets.map((marketValue) => {
    const market = record(marketValue) ?? {};
    const marketCode = typeof market.code === 'string' ? market.code : '';
    const selections = Array.isArray(market.selections) ? market.selections : [];
    const enrichedSelections = selections.map((selection) => {
      const enriched = mergeSelection(selection, marketCode, candidates);
      if (enriched.valueExplainabilityWired === true) wiredSelections += 1;
      return enriched;
    });
    const evaluated = enrichedSelections.some((selection) => finiteNumber(selection.modelProbability) != null);
    const anyEligible = enrichedSelections.some((selection) => selection.eligible === true);
    return {
      ...market,
      selections: enrichedSelections,
      status: evaluated ? (anyEligible ? 'EVALUATED_VALUE_AVAILABLE' : 'EVALUATED_NO_VALUE') : market.status,
    };
  });

  const originalStatus = typeof payload.currentRecommendationStatus === 'string' ? payload.currentRecommendationStatus : null;
  let consistentStatus = originalStatus;
  let consistencyError: string | null = null;
  if (originalStatus === 'NO_VALUE_SIGNAL' && candidates.length === 0) {
    consistentStatus = 'NO_MODEL';
    consistencyError = 'NO_VALUE_SIGNAL_WITHOUT_CANDIDATE_AUDIT';
  } else if (originalStatus === 'NO_VALUE_SIGNAL' && wiredSelections === 0) {
    consistentStatus = 'MAPPING_MISMATCH';
    consistencyError = 'CANDIDATE_AUDIT_FOUND_BUT_SELECTION_WIRING_FAILED';
  }

  return {
    ...payload,
    marketPredictions: enrichedMarkets,
    currentRecommendationStatus: consistentStatus,
    currentRecommendationError: payload.currentRecommendationError ?? consistencyError,
    currentRecommendationExplainability: {
      version: 'v7.0-r4.10.2.8-recommendation-explainability-v1',
      originalStatus,
      consistentStatus,
      candidateAuditCount: candidates.length,
      wiredSelections,
      consistencyError,
      officialBestBetChanged: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
    },
  };
}
