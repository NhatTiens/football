import type { LineupAdjustment } from './lineup.js';
import {
  clamp,
  expectedValue,
  impliedProbability,
  median,
  removeVig,
  standardDeviation,
} from './math.js';

export type OverUnderSelection = 'OVER' | 'UNDER';

export interface OverUnderQuote {
  id: number;
  bookmakerId: number;
  bookmakerName: string;
  marketCode: 'TOTAL_GOALS_2_5';
  marketName: string;
  marketGroup: string;
  selectionCode: OverUnderSelection;
  selectionName: string;
  lineValue: number;
  decimalOdds: number;
  capturedAt: Date;
}

export interface OverUnderConsensusRules {
  lineValue: number;
  minimumOdds: number;
  maximumOdds: number;
  minimumExpectedValue: number;
  minimumEdge: number;
  minimumConfidence: number;
  minimumDataQuality: number;
  maximumOddsAgeMinutes: number;
  minimumCompleteBookmakers: number;
  minimumReferenceBookmakers: number;
  maximumProbabilityStddev: number;
  topPerFixture: number;
}

export interface OverUnderConsensusCandidate {
  oddsSnapshotId: number;
  bookmakerId: number;
  bookmakerName: string;
  marketCode: 'TOTAL_GOALS_2_5';
  marketName: string;
  marketGroup: string;
  selectionCode: OverUnderSelection;
  selectionName: string;
  lineValue: number;
  decimalOdds: number;
  modelProbability: number;
  fairMarketProbability: number;
  impliedProbability: number;
  edge: number;
  expectedValue: number;
  confidenceScore: number;
  dataQualityScore: number;
  recommendationScore: number;
  bookmakerCount: number;
  probabilityStddev: number;
  oddsAgeMinutes: number;
  reasons: string[];
}

interface CompletePair {
  bookmakerId: number;
  bookmakerName: string;
  over: OverUnderQuote;
  under: OverUnderQuote;
  fairOver: number;
  fairUnder: number;
}

function buildPairs(quotes: OverUnderQuote[], lineValue: number): CompletePair[] {
  const grouped = new Map<number, OverUnderQuote[]>();
  for (const quote of quotes) {
    if (Math.abs(quote.lineValue - lineValue) > 0.0001) continue;
    grouped.set(quote.bookmakerId, [...(grouped.get(quote.bookmakerId) ?? []), quote]);
  }

  const pairs: CompletePair[] = [];
  for (const rows of grouped.values()) {
    const over = rows.find((row) => row.selectionCode === 'OVER');
    const under = rows.find((row) => row.selectionCode === 'UNDER');
    if (!over || !under) continue;

    const fair = removeVig([
      { code: 'OVER', odds: over.decimalOdds },
      { code: 'UNDER', odds: under.decimalOdds },
    ]);
    const fairOver = fair.find((row) => row.code === 'OVER')?.fairProbability;
    const fairUnder = fair.find((row) => row.code === 'UNDER')?.fairProbability;
    if (fairOver === undefined || fairUnder === undefined) continue;

    pairs.push({
      bookmakerId: over.bookmakerId,
      bookmakerName: over.bookmakerName,
      over,
      under,
      fairOver,
      fairUnder,
    });
  }
  return pairs;
}

function quoteFor(pair: CompletePair, selection: OverUnderSelection): OverUnderQuote {
  return selection === 'OVER' ? pair.over : pair.under;
}

function fairFor(pair: CompletePair, selection: OverUnderSelection): number {
  return selection === 'OVER' ? pair.fairOver : pair.fairUnder;
}

function calculateDataQuality(input: {
  completeBookmakers: number;
  referenceBookmakers: number;
  probabilityStddev: number;
  oddsAgeMinutes: number;
  maximumOddsAgeMinutes: number;
}): number {
  const completeScore = clamp(input.completeBookmakers / 6, 0, 1);
  const referenceScore = clamp(input.referenceBookmakers / 5, 0, 1);
  const stabilityScore = clamp(1 - input.probabilityStddev / 0.06, 0, 1);
  const freshnessScore = clamp(
    1 - Math.max(0, input.oddsAgeMinutes) / input.maximumOddsAgeMinutes,
    0,
    1,
  );
  return clamp(
    completeScore * 0.3 + referenceScore * 0.25 + stabilityScore * 0.3 + freshnessScore * 0.15,
    0,
    1,
  );
}

function calculateConfidence(input: {
  referenceBookmakers: number;
  probabilityStddev: number;
  oddsAgeMinutes: number;
  maximumOddsAgeMinutes: number;
  expectedValue: number;
  edge: number;
}): number {
  const bookmakerScore = clamp(input.referenceBookmakers / 5, 0, 1);
  const stabilityScore = clamp(1 - input.probabilityStddev / 0.05, 0, 1);
  const freshnessScore = clamp(
    1 - Math.max(0, input.oddsAgeMinutes) / input.maximumOddsAgeMinutes,
    0,
    1,
  );
  const evScore = clamp(input.expectedValue / 0.1, 0, 1);
  const edgeScore = clamp(input.edge / 0.06, 0, 1);
  return clamp(
    bookmakerScore * 0.25 +
      stabilityScore * 0.3 +
      freshnessScore * 0.15 +
      evScore * 0.15 +
      edgeScore * 0.15,
    0,
    1,
  );
}

export function buildOddsConsensusOverUnderCandidates(input: {
  odds: OverUnderQuote[];
  rules: OverUnderConsensusRules;
  now: Date;
  lineupAnalysis?: LineupAdjustment;
}): OverUnderConsensusCandidate[] {
  if (input.lineupAnalysis?.blockRecommendation) return [];
  const pairs = buildPairs(input.odds, input.rules.lineValue);
  if (pairs.length < input.rules.minimumCompleteBookmakers) return [];

  const candidates: OverUnderConsensusCandidate[] = [];
  for (const candidatePair of pairs) {
    const references = pairs.filter((pair) => pair.bookmakerId !== candidatePair.bookmakerId);
    if (references.length < input.rules.minimumReferenceBookmakers) continue;

    for (const selection of ['OVER', 'UNDER'] as const) {
      const quote = quoteFor(candidatePair, selection);
      const referenceProbabilities = references.map((pair) => fairFor(pair, selection));
      const marketConsensusProbability = median(referenceProbabilities);
      const lineupAdjustment = input.lineupAnalysis?.overProbabilityAdjustment ?? 0;
      const consensusProbability = clamp(
        marketConsensusProbability + (selection === 'OVER' ? lineupAdjustment : -lineupAdjustment),
        0.01,
        0.99,
      );
      const probabilityStddev = standardDeviation(referenceProbabilities);
      const bookmakerFairProbability = fairFor(candidatePair, selection);
      const selectionEdge = consensusProbability - bookmakerFairProbability;
      const selectionEv = expectedValue(consensusProbability, quote.decimalOdds);
      const oddsAgeMinutes = (input.now.getTime() - quote.capturedAt.getTime()) / 60_000;
      const baseDataQualityScore = calculateDataQuality({
        completeBookmakers: pairs.length,
        referenceBookmakers: references.length,
        probabilityStddev,
        oddsAgeMinutes,
        maximumOddsAgeMinutes: input.rules.maximumOddsAgeMinutes,
      });
      const baseConfidenceScore = calculateConfidence({
        referenceBookmakers: references.length,
        probabilityStddev,
        oddsAgeMinutes,
        maximumOddsAgeMinutes: input.rules.maximumOddsAgeMinutes,
        expectedValue: selectionEv,
        edge: selectionEdge,
      });
      const dataQualityScore = clamp(
        baseDataQualityScore * (input.lineupAnalysis?.dataQualityMultiplier ?? 1),
        0,
        1,
      );
      const confidenceScore = clamp(
        baseConfidenceScore * (input.lineupAnalysis?.confidenceMultiplier ?? 1),
        0,
        1,
      );
      const stabilityMultiplier = clamp(
        1 - probabilityStddev / input.rules.maximumProbabilityStddev,
        0,
        1,
      );
      const recommendationScore =
        Math.max(0, selectionEv) * confidenceScore * dataQualityScore * stabilityMultiplier;

      if (
        quote.decimalOdds < input.rules.minimumOdds ||
        quote.decimalOdds > input.rules.maximumOdds ||
        selectionEv < input.rules.minimumExpectedValue ||
        selectionEdge < input.rules.minimumEdge ||
        confidenceScore < input.rules.minimumConfidence ||
        dataQualityScore < input.rules.minimumDataQuality ||
        probabilityStddev > input.rules.maximumProbabilityStddev ||
        oddsAgeMinutes > input.rules.maximumOddsAgeMinutes
      ) {
        continue;
      }

      candidates.push({
        oddsSnapshotId: quote.id,
        bookmakerId: quote.bookmakerId,
        bookmakerName: quote.bookmakerName,
        marketCode: 'TOTAL_GOALS_2_5',
        marketName: quote.marketName,
        marketGroup: quote.marketGroup,
        selectionCode: selection,
        selectionName: `${selection === 'OVER' ? 'Over' : 'Under'} ${quote.lineValue}`,
        lineValue: quote.lineValue,
        decimalOdds: quote.decimalOdds,
        modelProbability: consensusProbability,
        fairMarketProbability: bookmakerFairProbability,
        impliedProbability: impliedProbability(quote.decimalOdds),
        edge: selectionEdge,
        expectedValue: selectionEv,
        confidenceScore,
        dataQualityScore,
        recommendationScore,
        bookmakerCount: references.length,
        probabilityStddev,
        oddsAgeMinutes,
        reasons: [
          `Consensus thị trường ${selection} ${(marketConsensusProbability * 100).toFixed(1)}% từ ${references.length} nhà cái tham chiếu.`,
          ...(input.lineupAnalysis?.available
            ? [
                `Xác suất sau phân tích đội hình: ${(consensusProbability * 100).toFixed(1)}%.`,
                ...input.lineupAnalysis.reasons,
              ]
            : []),
          `Không dùng odds của ${quote.bookmakerName} khi tạo xác suất tham chiếu.`,
          `Edge ${(selectionEdge * 100).toFixed(2)} điểm %, EV ${(selectionEv * 100).toFixed(2)}%.`,
          `Độ phân tán xác suất ${(probabilityStddev * 100).toFixed(2)}%.`,
        ],
      });
    }
  }

  const sorted = candidates.sort((a, b) => b.recommendationScore - a.recommendationScore);
  return sorted.slice(0, Math.max(1, input.rules.topPerFixture));
}
