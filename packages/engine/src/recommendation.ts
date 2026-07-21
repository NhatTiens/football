import {
  clamp,
  edge,
  expectedValue,
  impliedProbability,
  median,
  removeVig,
  standardDeviation,
} from './math.js';

export type SupportedMarketCode = 'MATCH_WINNER' | 'TOTAL_GOALS_2_5' | 'BTTS';

export interface LatestOdds {
  id: number;
  bookmakerId: number;
  bookmakerName: string;
  marketCode: SupportedMarketCode;
  marketName: string;
  marketGroup: string;
  selectionCode: string;
  selectionName: string;
  lineValue: number | null;
  decimalOdds: number;
  capturedAt: Date;
}

export interface RecommendationRules {
  minimumOdds: number;
  maximumOdds: number;
  minimumExpectedValue: number;
  minimumEdge: number;
  minimumConfidence: number;
  minimumDataQuality: number;
  maximumOddsAgeMinutes: number;
  minimumBookmakers: number;
  topPerFixture: number;
}

export interface RecommendationCandidate {
  oddsSnapshotId: number;
  bookmakerId: number;
  bookmakerName: string;
  marketCode: SupportedMarketCode;
  marketName: string;
  marketGroup: string;
  selectionCode: string;
  selectionName: string;
  lineValue: number | null;
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
  reasons: string[];
}

export interface ModelProbabilitySet {
  MATCH_WINNER: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  TOTAL_GOALS_2_5: Record<'OVER' | 'UNDER', number>;
  BTTS: Record<'YES' | 'NO', number>;
}

interface MarketConsensus {
  fairBySelection: Map<string, number>;
  bookmakerCount: number;
  priceDispersionBySelection: Map<string, number>;
}

function requiredSelections(marketCode: SupportedMarketCode): string[] {
  if (marketCode === 'MATCH_WINNER') return ['HOME', 'DRAW', 'AWAY'];
  if (marketCode === 'TOTAL_GOALS_2_5') return ['OVER', 'UNDER'];
  return ['YES', 'NO'];
}

function createConsensus(marketCode: SupportedMarketCode, rows: LatestOdds[]): MarketConsensus | null {
  const expected = requiredSelections(marketCode);
  const byBookmaker = new Map<number, LatestOdds[]>();
  for (const row of rows) {
    const collection = byBookmaker.get(row.bookmakerId) ?? [];
    collection.push(row);
    byBookmaker.set(row.bookmakerId, collection);
  }

  const fairValues = new Map<string, number[]>();
  const oddsValues = new Map<string, number[]>();
  let completeBookmakers = 0;

  for (const bookmakerRows of byBookmaker.values()) {
    const selected = expected.map((code) => bookmakerRows.find((row) => row.selectionCode === code));
    if (selected.some((row) => !row)) continue;
    completeBookmakers += 1;
    const fair = removeVig(
      selected.map((row) => ({ code: row!.selectionCode, odds: row!.decimalOdds })),
    );
    for (const item of fair) {
      fairValues.set(item.code, [...(fairValues.get(item.code) ?? []), item.fairProbability]);
    }
    for (const row of selected) {
      oddsValues.set(row!.selectionCode, [
        ...(oddsValues.get(row!.selectionCode) ?? []),
        row!.decimalOdds,
      ]);
    }
  }

  if (completeBookmakers === 0) return null;

  return {
    bookmakerCount: completeBookmakers,
    fairBySelection: new Map(
      [...fairValues.entries()].map(([selection, values]) => [selection, median(values)]),
    ),
    priceDispersionBySelection: new Map(
      [...oddsValues.entries()].map(([selection, values]) => [selection, standardDeviation(values)]),
    ),
  };
}

function confidenceScore(input: {
  bookmakerCount: number;
  historySampleSize: number;
  dataQualityScore: number;
  modelAgreement?: number;
  priceDispersion: number;
}): number {
  const bookmakerScore = clamp(input.bookmakerCount / 4, 0.25, 1);
  const sampleScore = clamp(input.historySampleSize / 10, 0.25, 1);
  const agreementScore = input.modelAgreement ?? 0.75;
  const stabilityScore = clamp(1 - input.priceDispersion / 0.5, 0.35, 1);
  return clamp(
    bookmakerScore * 0.2 +
      sampleScore * 0.25 +
      input.dataQualityScore * 0.25 +
      agreementScore * 0.2 +
      stabilityScore * 0.1,
    0,
    1,
  );
}

function modelProbability(
  marketCode: SupportedMarketCode,
  selectionCode: string,
  probabilities: ModelProbabilitySet,
): number | undefined {
  if (marketCode === 'MATCH_WINNER') {
    return probabilities.MATCH_WINNER[selectionCode as 'HOME' | 'DRAW' | 'AWAY'];
  }
  if (marketCode === 'TOTAL_GOALS_2_5') {
    return probabilities.TOTAL_GOALS_2_5[selectionCode as 'OVER' | 'UNDER'];
  }
  return probabilities.BTTS[selectionCode as 'YES' | 'NO'];
}

function correlationCluster(candidate: RecommendationCandidate): string {
  if (candidate.marketCode === 'TOTAL_GOALS_2_5' && candidate.selectionCode === 'OVER') return 'GOALS_HIGH';
  if (candidate.marketCode === 'BTTS' && candidate.selectionCode === 'YES') return 'GOALS_HIGH';
  if (candidate.marketCode === 'TOTAL_GOALS_2_5' && candidate.selectionCode === 'UNDER') return 'GOALS_LOW';
  if (candidate.marketCode === 'BTTS' && candidate.selectionCode === 'NO') return 'GOALS_LOW';
  return `${candidate.marketCode}:${candidate.selectionCode}`;
}

export function buildRecommendationCandidates(input: {
  odds: LatestOdds[];
  probabilities: ModelProbabilitySet;
  rules: RecommendationRules;
  now: Date;
  historySampleSize: number;
  dataQualityScore: number;
  matchWinnerAgreement?: Record<'HOME' | 'DRAW' | 'AWAY', number>;
}): RecommendationCandidate[] {
  const markets = new Map<SupportedMarketCode, LatestOdds[]>();
  for (const row of input.odds) {
    markets.set(row.marketCode, [...(markets.get(row.marketCode) ?? []), row]);
  }

  const candidates: RecommendationCandidate[] = [];

  for (const [marketCode, rows] of markets.entries()) {
    const consensus = createConsensus(marketCode, rows);
    if (!consensus || consensus.bookmakerCount < input.rules.minimumBookmakers) continue;

    for (const selectionCode of requiredSelections(marketCode)) {
      const selectionRows = rows.filter((row) => row.selectionCode === selectionCode);
      const best = selectionRows.sort((a, b) => b.decimalOdds - a.decimalOdds)[0];
      const probability = modelProbability(marketCode, selectionCode, input.probabilities);
      const fair = consensus.fairBySelection.get(selectionCode);
      if (!best || probability === undefined || fair === undefined) continue;

      const ageMinutes = (input.now.getTime() - best.capturedAt.getTime()) / 60_000;
      const selectionEdge = edge(probability, fair);
      const selectionEv = expectedValue(probability, best.decimalOdds);
      const agreement =
        marketCode === 'MATCH_WINNER'
          ? input.matchWinnerAgreement?.[selectionCode as 'HOME' | 'DRAW' | 'AWAY']
          : undefined;
      const confidence = confidenceScore({
        bookmakerCount: consensus.bookmakerCount,
        historySampleSize: input.historySampleSize,
        dataQualityScore: input.dataQualityScore,
        modelAgreement: agreement,
        priceDispersion: consensus.priceDispersionBySelection.get(selectionCode) ?? 0,
      });
      const recommendationScore = Math.max(0, selectionEv) * confidence * input.dataQualityScore;

      if (
        best.decimalOdds < input.rules.minimumOdds ||
        best.decimalOdds > input.rules.maximumOdds ||
        selectionEv < input.rules.minimumExpectedValue ||
        selectionEdge < input.rules.minimumEdge ||
        confidence < input.rules.minimumConfidence ||
        input.dataQualityScore < input.rules.minimumDataQuality ||
        ageMinutes > input.rules.maximumOddsAgeMinutes
      ) {
        continue;
      }

      candidates.push({
        oddsSnapshotId: best.id,
        bookmakerId: best.bookmakerId,
        bookmakerName: best.bookmakerName,
        marketCode,
        marketName: best.marketName,
        marketGroup: best.marketGroup,
        selectionCode,
        selectionName: best.selectionName,
        lineValue: best.lineValue,
        decimalOdds: best.decimalOdds,
        modelProbability: probability,
        fairMarketProbability: fair,
        impliedProbability: impliedProbability(best.decimalOdds),
        edge: selectionEdge,
        expectedValue: selectionEv,
        confidenceScore: confidence,
        dataQualityScore: input.dataQualityScore,
        recommendationScore,
        bookmakerCount: consensus.bookmakerCount,
        reasons: [
          `EV dự kiến ${(selectionEv * 100).toFixed(1)}%.`,
          `Xác suất mô hình cao hơn thị trường ${(selectionEdge * 100).toFixed(1)} điểm %.`,
          `So sánh ${consensus.bookmakerCount} nhà cái, chọn giá tốt nhất ${best.decimalOdds.toFixed(2)}.`,
          `Điểm tin cậy ${(confidence * 100).toFixed(0)}%, chất lượng dữ liệu ${(input.dataQualityScore * 100).toFixed(0)}%.`,
        ],
      });
    }
  }

  const sorted = candidates.sort((a, b) => b.recommendationScore - a.recommendationScore);
  const selected: RecommendationCandidate[] = [];
  const usedClusters = new Set<string>();
  for (const candidate of sorted) {
    const cluster = correlationCluster(candidate);
    if (usedClusters.has(cluster)) continue;
    selected.push(candidate);
    usedClusters.add(cluster);
    if (selected.length >= input.rules.topPerFixture) break;
  }
  return selected;
}
