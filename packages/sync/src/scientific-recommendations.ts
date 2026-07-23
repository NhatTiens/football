import {
  clamp,
  impliedProbability,
  median,
  normalizeProbabilities,
  removeVig,
  standardDeviation,
  type LatestOdds,
  type SupportedMarketCode,
} from '@football-ai/engine';
import {
  FixtureStatus,
  prisma,
  RecommendationStatus,
  type InputJsonValue,
} from '@football-ai/database';
import { getFixtureHoursAhead, getRecommendationRules } from './config.js';
import { getScientificFixtureAnalysis, type ScientificFixtureAnalysis } from './scientific-features.js';
import {
  SCIENTIFIC_MODEL_VERSION,
  calibrateTotalProbability,
  poissonGoalMarkets,
} from './scientific-model.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';
import {
  ScientificRejectionDiagnostics,
  selectCorrelationControlledCandidates,
} from './scientific-v61.js';
import {
  SCIENTIFIC_STAKING_VERSION,
  allocateScientificStakePortfolio,
  formatScientificStakeReason,
  getScientificBankrollConfig,
  summarizeScientificBankrollConfig,
} from './scientific-bankroll.js';

interface OddsSnapshotRow {
  id: number;
  bookmakerId: number;
  selectionCode: string;
  selectionName: string;
  lineValue: number | null;
  decimalOdds: number;
  capturedAt: Date;
  isLive: boolean;
  bookmaker: { name: string };
  market: {
    marketCode: string;
    name: string;
    marketGroup: string;
  };
}

interface CompleteMarket {
  bookmakerId: number;
  bookmakerName: string;
  rows: Map<string, LatestOdds>;
  fairProbabilities: Map<string, number>;
}

export interface ScientificRecommendationCandidate {
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
  reasons: string[];
  marketKey: string;
  correlationCluster: string;
}

export interface ScientificRecommendationRules {
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
  modelWeight: number;
  marketWeight: number;
  maximumPerFixture: number;
  maximumPerMarket: number;
  maximumPerCorrelationCluster: number;
  allowQuarterLines: boolean;
}

function numberEnvironment(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanEnvironment(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') return fallback;
  return value.trim().toLowerCase() === 'true';
}

function integerEnvironment(name: string, fallback: number): number {
  return Math.max(0, Math.floor(numberEnvironment(name, fallback)));
}

export function getScientificRules(): ScientificRecommendationRules {
  const base = getRecommendationRules();
  const modelWeight = clamp(
    numberEnvironment('SCIENTIFIC_MODEL_WEIGHT', 0.65),
    0,
    1,
  );
  const marketWeight = clamp(
    numberEnvironment('SCIENTIFIC_MARKET_WEIGHT', 0.35),
    0,
    1,
  );
  const weightTotal = Math.max(0.0001, modelWeight + marketWeight);
  return {
    minimumOdds: numberEnvironment('SCIENTIFIC_MIN_ODDS', base.minimumOdds),
    maximumOdds: numberEnvironment('SCIENTIFIC_MAX_ODDS', base.maximumOdds),
    minimumExpectedValue: numberEnvironment(
      'SCIENTIFIC_MIN_EV',
      Math.min(base.minimumExpectedValue, 0.035),
    ),
    minimumEdge: numberEnvironment(
      'SCIENTIFIC_MIN_EDGE',
      Math.min(base.minimumEdge, 0.02),
    ),
    minimumConfidence: numberEnvironment(
      'SCIENTIFIC_MIN_CONFIDENCE',
      Math.min(base.minimumConfidence, 0.45),
    ),
    minimumDataQuality: numberEnvironment(
      'SCIENTIFIC_MIN_DATA_QUALITY',
      Math.min(base.minimumDataQuality, 0.4),
    ),
    maximumOddsAgeMinutes: numberEnvironment(
      'SCIENTIFIC_MAX_ODDS_AGE_MINUTES',
      base.maximumOddsAgeMinutes,
    ),
    minimumCompleteBookmakers: Math.max(
      2,
      integerEnvironment('SCIENTIFIC_MIN_COMPLETE_BOOKMAKERS', 3),
    ),
    minimumReferenceBookmakers: Math.max(
      1,
      integerEnvironment('SCIENTIFIC_MIN_REFERENCE_BOOKMAKERS', 2),
    ),
    maximumProbabilityStddev: numberEnvironment(
      'SCIENTIFIC_MAX_PROBABILITY_STDDEV',
      0.055,
    ),
    modelWeight: modelWeight / weightTotal,
    marketWeight: marketWeight / weightTotal,
    maximumPerFixture: Math.max(
      1,
      integerEnvironment('SCIENTIFIC_MAX_PER_FIXTURE', 3),
    ),
    maximumPerMarket: Math.max(
      1,
      integerEnvironment('SCIENTIFIC_MAX_PER_MARKET', 1),
    ),
    maximumPerCorrelationCluster: Math.max(
      1,
      integerEnvironment('SCIENTIFIC_MAX_PER_CORRELATION_CLUSTER', 1),
    ),
    allowQuarterLines: booleanEnvironment(
      'SCIENTIFIC_ALLOW_ASIAN_QUARTER_LINES',
      false,
    ),
  };
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.0001;
}

function isQuarterLine(lineValue: number): boolean {
  const fraction = Math.abs(lineValue - Math.floor(lineValue));
  return approximatelyEqual(fraction, 0.25) || approximatelyEqual(fraction, 0.75);
}

function requiredSelections(marketCode: SupportedMarketCode): string[] {
  if (marketCode === 'MATCH_WINNER') return ['HOME', 'DRAW', 'AWAY'];
  if (marketCode === 'BTTS') return ['YES', 'NO'];
  return ['OVER', 'UNDER'];
}

function marketKey(row: LatestOdds): string {
  return `${row.marketCode}:${row.lineValue ?? ''}`;
}

export function latestScientificOddsRows(rows: OddsSnapshotRow[]): LatestOdds[] {
  const latest = new Map<string, OddsSnapshotRow>();
  const sorted = [...rows].sort(
    (left, right) => right.capturedAt.getTime() - left.capturedAt.getTime(),
  );
  for (const row of sorted) {
    if (row.isLive) continue;
    if (!['MATCH_WINNER', 'TOTAL_GOALS_2_5', 'BTTS'].includes(row.market.marketCode)) {
      continue;
    }
    const key = [
      row.bookmakerId,
      row.market.marketCode,
      row.selectionCode,
      row.lineValue ?? '',
    ].join(':');
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()].map((row) => ({
    id: row.id,
    bookmakerId: row.bookmakerId,
    bookmakerName: row.bookmaker.name,
    marketCode: row.market.marketCode as SupportedMarketCode,
    marketName: row.market.name,
    marketGroup: row.market.marketGroup,
    selectionCode: row.selectionCode,
    selectionName: row.selectionName,
    lineValue: row.lineValue,
    decimalOdds: row.decimalOdds,
    capturedAt: row.capturedAt,
  }));
}

function buildCompleteMarkets(rows: LatestOdds[]): CompleteMarket[] {
  const marketCode = rows[0]?.marketCode;
  if (!marketCode) return [];
  const expected = requiredSelections(marketCode);
  const byBookmaker = new Map<number, LatestOdds[]>();
  for (const row of rows) {
    const collection = byBookmaker.get(row.bookmakerId) ?? [];
    collection.push(row);
    byBookmaker.set(row.bookmakerId, collection);
  }
  const complete: CompleteMarket[] = [];

  for (const bookmakerRows of byBookmaker.values()) {
    const selectionRows = expected.map((selectionCode) =>
      bookmakerRows.find((row) => row.selectionCode === selectionCode),
    );
    if (selectionRows.some((row) => row === undefined)) continue;
    const definiteRows = selectionRows.filter(
      (row): row is LatestOdds => row !== undefined,
    );
    const fair = removeVig(
      definiteRows.map((row) => ({
        code: row.selectionCode,
        odds: row.decimalOdds,
      })),
    );
    complete.push({
      bookmakerId: definiteRows[0]!.bookmakerId,
      bookmakerName: definiteRows[0]!.bookmakerName,
      rows: new Map(definiteRows.map((row) => [row.selectionCode, row])),
      fairProbabilities: new Map(
        fair.map((selection) => [selection.code, selection.fairProbability]),
      ),
    });
  }

  return complete;
}

function scientificProbabilities(
  analysis: ScientificFixtureAnalysis,
  marketCode: SupportedMarketCode,
  lineValue: number | null,
): {
  probabilities: Record<string, number>;
  pushProbability: number;
} {
  if (marketCode === 'MATCH_WINNER') {
    return { probabilities: analysis.matchWinner, pushProbability: 0 };
  }
  if (marketCode === 'BTTS') {
    return { probabilities: analysis.btts, pushProbability: 0 };
  }
  const line = lineValue ?? 2.5;
  const poisson = poissonGoalMarkets(
    analysis.homeExpectedGoals,
    analysis.awayExpectedGoals,
    line,
  );
  const poisson25 = poissonGoalMarkets(
    analysis.homeExpectedGoals,
    analysis.awayExpectedGoals,
    2.5,
  );
  const overConditional = calibrateTotalProbability({
    lineProbability: poisson.total.overConditional,
    poissonOver25: poisson25.total.overConditional,
    modelOver25: analysis.modelPrediction?.over25.OVER,
    calibrationWeight: 0.4,
    modelUncertainty: analysis.modelPrediction?.uncertainty?.over25,
    dataQuality: analysis.dataQualityScore,
  });
  return {
    probabilities: normalizeProbabilities({
      OVER: overConditional,
      UNDER: 1 - overConditional,
    }),
    pushProbability: poisson.total.push,
  };
}

function blendProbabilities(input: {
  scientific: Record<string, number>;
  market: Record<string, number>;
  modelWeight: number;
  marketWeight: number;
}): Record<string, number> {
  const keys = new Set([
    ...Object.keys(input.scientific),
    ...Object.keys(input.market),
  ]);
  const blended: Record<string, number> = {};
  for (const key of keys) {
    blended[key] =
      (input.scientific[key] ?? 0) * input.modelWeight +
      (input.market[key] ?? 0) * input.marketWeight;
  }
  return normalizeProbabilities(blended);
}

function exactExpectedValue(input: {
  selectionCode: string;
  probability: number;
  pushProbability: number;
  decimalOdds: number;
}): number {
  const nonPush = 1 - clamp(input.pushProbability, 0, 0.95);
  const winProbability = input.probability * nonPush;
  const lossProbability = (1 - input.probability) * nonPush;
  return winProbability * (input.decimalOdds - 1) - lossProbability;
}

function correlationCluster(candidate: ScientificRecommendationCandidate): string {
  if (
    (candidate.marketCode === 'TOTAL_GOALS_2_5' &&
      candidate.selectionCode === 'OVER') ||
    (candidate.marketCode === 'BTTS' && candidate.selectionCode === 'YES')
  ) {
    return 'GOALS_HIGH';
  }
  if (
    (candidate.marketCode === 'TOTAL_GOALS_2_5' &&
      candidate.selectionCode === 'UNDER') ||
    (candidate.marketCode === 'BTTS' && candidate.selectionCode === 'NO')
  ) {
    return 'GOALS_LOW';
  }
  return `${candidate.marketCode}:${candidate.selectionCode}`;
}

export function buildScientificCandidates(input: {
  odds: LatestOdds[];
  analysis: ScientificFixtureAnalysis;
  now: Date;
  rules?: ScientificRecommendationRules;
  diagnostics?: ScientificRejectionDiagnostics;
}): ScientificRecommendationCandidate[] {
  const rules = input.rules ?? getScientificRules();
  const diagnostics = input.diagnostics;
  // PREDICTION_AI_V61_REJECTION_DIAGNOSTICS
  if (input.analysis.lineupAnalysis.blockRecommendation) {
    diagnostics?.reject('LINEUP_BLOCKED');
    return [];
  }
  const grouped = new Map<string, LatestOdds[]>();
  for (const row of input.odds) {
    if (
      row.marketCode === 'TOTAL_GOALS_2_5' &&
      row.lineValue != null &&
      isQuarterLine(row.lineValue) &&
      !rules.allowQuarterLines
    ) {
      diagnostics?.reject('QUARTER_LINE_DISABLED');
      continue;
    }
    const key = marketKey(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const candidates: ScientificRecommendationCandidate[] = [];

  for (const [key, rows] of grouped) {
    const representative = rows[0];
    if (!representative) continue;
    const allCompleteMarkets = buildCompleteMarkets(rows);
    const completeMarkets = allCompleteMarkets.filter((market) => {
      const ages = [...market.rows.values()].map(
        (row) => (input.now.getTime() - row.capturedAt.getTime()) / 60_000,
      );
      return Math.max(...ages) <= rules.maximumOddsAgeMinutes;
    });
    diagnostics?.reject(
      'STALE_COMPLETE_MARKET',
      allCompleteMarkets.length - completeMarkets.length,
    );
    if (completeMarkets.length < rules.minimumCompleteBookmakers) {
      diagnostics?.reject('INSUFFICIENT_COMPLETE_BOOKMAKERS');
      continue;
    }

    for (const candidateMarket of completeMarkets) {
      const references = completeMarkets.filter(
        (market) => market.bookmakerId !== candidateMarket.bookmakerId,
      );
      if (references.length < rules.minimumReferenceBookmakers) {
        diagnostics?.reject('INSUFFICIENT_REFERENCE_BOOKMAKERS');
        continue;
      }
      const referenceConsensus: Record<string, number> = {};
      const dispersion: Record<string, number> = {};
      for (const selectionCode of requiredSelections(representative.marketCode)) {
        const probabilities = references
          .map((market) => market.fairProbabilities.get(selectionCode))
          .filter((value): value is number => value !== undefined);
        if (probabilities.length === 0) continue;
        referenceConsensus[selectionCode] = median(probabilities);
        dispersion[selectionCode] = standardDeviation(probabilities);
      }
      const scientific = scientificProbabilities(
        input.analysis,
        representative.marketCode,
        representative.lineValue,
      );
      const blended = blendProbabilities({
        scientific: scientific.probabilities,
        market: referenceConsensus,
        modelWeight: rules.modelWeight,
        marketWeight: rules.marketWeight,
      });

      for (const selectionCode of requiredSelections(representative.marketCode)) {
        const quote = candidateMarket.rows.get(selectionCode);
        const candidateFair = candidateMarket.fairProbabilities.get(selectionCode);
        const rawModelProbability = blended[selectionCode];
      // PREDICTION_AI_V6_RAW_PROBABILITY_GUARD: skip incomplete probability maps before arithmetic.
      if (rawModelProbability === undefined) {
        diagnostics?.reject('MISSING_PROBABILITY_OR_QUOTE');
        continue;
      }
      // PREDICTION_AI_V6_CONSERVATIVE_EV: chỉ nhận value còn tồn tại sau khi trừ độ bất định.
      const predictionUncertainty =
        representative.marketCode === 'MATCH_WINNER'
          ? input.analysis.modelPrediction?.uncertainty?.matchWinner ?? 0
          : representative.marketCode === 'BTTS'
            ? input.analysis.modelPrediction?.uncertainty?.btts ?? 0
            : input.analysis.modelPrediction?.uncertainty?.over25 ?? 0;
      const uncertaintyPenalty = numberEnvironment(
        'SCIENTIFIC_UNCERTAINTY_PENALTY',
        0.65,
      );
      const modelProbability = clamp(
        rawModelProbability - predictionUncertainty * uncertaintyPenalty,
        0.001,
        0.999,
      );
        const scientificProbability = scientific.probabilities[selectionCode];
        const marketProbability = referenceConsensus[selectionCode];
        if (
          !quote ||
          candidateFair === undefined ||
          modelProbability === undefined ||
          scientificProbability === undefined ||
          marketProbability === undefined
        ) {
        diagnostics?.reject('MISSING_PROBABILITY_OR_QUOTE');
        continue;
        }
        const oddsAgeMinutes =
          (input.now.getTime() - quote.capturedAt.getTime()) / 60_000;
        const probabilityStddev = dispersion[selectionCode] ?? 0;
        const agreementScore = clamp(
          1 - Math.abs(scientificProbability - marketProbability) * 2.5,
          0,
          1,
        );
        const freshnessScore = clamp(
          1 - oddsAgeMinutes / Math.max(rules.maximumOddsAgeMinutes, 1),
          0,
          1,
        );
        const stabilityScore = clamp(
          1 -
            probabilityStddev /
              Math.max(rules.maximumProbabilityStddev, 0.0001),
          0,
          1,
        );
        const bookmakerScore = clamp(references.length / 5, 0.2, 1);
        const confidenceScore = clamp(
          input.analysis.confidenceScore * 0.42 +
            agreementScore * 0.23 +
            stabilityScore * 0.2 +
            bookmakerScore * 0.1 +
            freshnessScore * 0.05,
          0,
          1,
        );
        const dataQualityScore = clamp(
          input.analysis.dataQualityScore * 0.6 +
            bookmakerScore * 0.2 +
            stabilityScore * 0.12 +
            freshnessScore * 0.08,
          0,
          1,
        );
        const edge = modelProbability - candidateFair;
        const expectedValue = exactExpectedValue({
          selectionCode,
          probability: modelProbability,
          pushProbability: scientific.pushProbability,
          decimalOdds: quote.decimalOdds,
        });
        const recommendationScore =
          Math.max(0, expectedValue) *
          confidenceScore *
          dataQualityScore *
          (0.7 + agreementScore * 0.3);
      if (
        quote.decimalOdds < rules.minimumOdds ||
        quote.decimalOdds > rules.maximumOdds
      ) {
        diagnostics?.reject('ODDS_OUT_OF_RANGE');
        continue;
      }
      if (expectedValue < rules.minimumExpectedValue) {
        diagnostics?.reject('EXPECTED_VALUE_LOW');
        continue;
      }
      if (edge < rules.minimumEdge) {
        diagnostics?.reject('EDGE_LOW');
        continue;
      }
      if (confidenceScore < rules.minimumConfidence) {
        diagnostics?.reject('CONFIDENCE_LOW');
        continue;
      }
      if (dataQualityScore < rules.minimumDataQuality) {
        diagnostics?.reject('DATA_QUALITY_LOW');
        continue;
      }
      if (probabilityStddev > rules.maximumProbabilityStddev) {
        diagnostics?.reject('PROBABILITY_DISPERSION_HIGH');
        continue;
      }
      if (oddsAgeMinutes > rules.maximumOddsAgeMinutes) {
        diagnostics?.reject('ODDS_TOO_OLD');
        continue;
      }

        const candidate: ScientificRecommendationCandidate = {
          oddsSnapshotId: quote.id,
          bookmakerId: quote.bookmakerId,
          bookmakerName: quote.bookmakerName,
          marketCode: quote.marketCode,
          marketName: quote.marketName,
          marketGroup: quote.marketGroup,
          selectionCode,
          selectionName: quote.selectionName,
          lineValue: quote.lineValue,
          decimalOdds: quote.decimalOdds,
          modelProbability,
          fairMarketProbability: candidateFair,
          impliedProbability: impliedProbability(quote.decimalOdds),
          edge,
          expectedValue,
          confidenceScore,
          dataQualityScore,
          recommendationScore,
          reasons: [
            `Mô hình khoa học ${(scientificProbability * 100).toFixed(1)}%, consensus tham chiếu ${(marketProbability * 100).toFixed(1)}%.`,
            `Xác suất tổng hợp thô ${(rawModelProbability * 100).toFixed(1)}%, sau phạt bất định ${(modelProbability * 100).toFixed(1)}%, fair của nhà cái ${(candidateFair * 100).toFixed(1)}%.`,
            `EV ${(expectedValue * 100).toFixed(1)}%, edge ${(edge * 100).toFixed(1)} điểm %.`,
            `Loại ${quote.bookmakerName} khỏi consensus; dùng ${references.length} nhà cái tham chiếu.`,
            ...(scientific.pushProbability > 0.001
              ? [`Xác suất hoàn tiền ước tính ${(scientific.pushProbability * 100).toFixed(1)}%.`]
              : []),
            ...input.analysis.reasons,
          ],
          marketKey: key,
          correlationCluster: '',
        };
        candidate.correlationCluster = correlationCluster(candidate);
        candidates.push(candidate);
      }
    }
  }

  return selectCorrelationControlledCandidates(
    candidates,
    {
      maximumPerFixture: rules.maximumPerFixture,
      maximumPerMarket: rules.maximumPerMarket,
      maximumPerCorrelationCluster: rules.maximumPerCorrelationCluster,
    },
    diagnostics,
  );
}

export async function generateScientificRecommendations(): Promise<SyncSummary> {
  return runTrackedSync('generate-scientific-recommendations', async () => {
    const now = new Date();
    const maximumKickoff = new Date(
      now.getTime() + getFixtureHoursAhead() * 3_600_000,
    );
    const rules = getScientificRules();
    const rejectionDiagnostics = new ScientificRejectionDiagnostics();
    // PREDICTION_AI_V62_DYNAMIC_STAKING
    const stakingConfig = getScientificBankrollConfig();
    const dailyExposureByDate = new Map<string, number>();
    let totalRecommendedStakeUnits = 0;
    let totalRecommendedStakeAmount: number | null =
      stakingConfig.bankrollAmount == null ? null : 0;
    const fixtures = await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.UPCOMING,
        kickoffAt: { gte: now, lte: maximumKickoff },
      },
      include: {
        homeTeam: true,
        awayTeam: true,
        oddsSnapshots: {
          where: { isLive: false },
          include: { bookmaker: true, market: true },
          orderBy: { capturedAt: 'desc' },
        },
      },
      orderBy: { kickoffAt: 'asc' },
    });
    let processed = 0;
    let inserted = 0;
    let noBetFixtures = 0;
    const marketCounts: Record<string, number> = {};

    for (const fixture of fixtures) {
      processed += 1;
      const odds = latestScientificOddsRows(fixture.oddsSnapshots);
      const analysis = await getScientificFixtureAnalysis({
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        homeTeamName: fixture.homeTeam.name,
        awayTeamName: fixture.awayTeam.name,
        kickoffAt: fixture.kickoffAt,
        asOf: now,
        useMachineLearning: true,
      });
      const candidates = buildScientificCandidates({
        odds,
        analysis,
        now,
        rules,
        diagnostics: rejectionDiagnostics,
      });
      const stakePortfolio = allocateScientificStakePortfolio({
        candidates,
        config: stakingConfig,
        currentBankrollUnits: stakingConfig.bankrollUnits,
        peakBankrollUnits: stakingConfig.bankrollUnits,
        currentDailyExposureUnits:
          (dailyExposureByDate.get(
            fixture.kickoffAt.toISOString().slice(0, 10),
          ) ?? 0) +
          (fixture.kickoffAt.toISOString().slice(0, 10) ===
          now.toISOString().slice(0, 10)
            ? stakingConfig.currentDailyExposureUnits
            : 0),
      });
      for (const [reason, count] of Object.entries(
        stakePortfolio.rejectionReasons,
      )) {
        rejectionDiagnostics.reject(reason, count);
      }
      const sizedCandidates = stakePortfolio.bets;
      const exposureDateKey = fixture.kickoffAt.toISOString().slice(0, 10);
      dailyExposureByDate.set(
        exposureDateKey,
        (dailyExposureByDate.get(exposureDateKey) ?? 0) +
          stakePortfolio.totalStakeUnits,
      );
      totalRecommendedStakeUnits += stakePortfolio.totalStakeUnits;
      if (totalRecommendedStakeAmount != null) {
        totalRecommendedStakeAmount += stakePortfolio.totalStakeAmount ?? 0;
      }
      await prisma.recommendation.updateMany({
        where: {
          fixtureId: fixture.id,
          status: RecommendationStatus.ACTIVE,
        },
        data: { status: RecommendationStatus.EXPIRED },
      });
      if (sizedCandidates.length === 0) {
        noBetFixtures += 1;
        continue;
      }
      const expiresAt = new Date(
        Math.max(
          now.getTime(),
          Math.min(
            now.getTime() + Math.min(30, rules.maximumOddsAgeMinutes) * 60_000,
            fixture.kickoffAt.getTime() - 60_000,
          ),
        ),
      );

      for (let index = 0; index < sizedCandidates.length; index += 1) {
        const { candidate, stakePlan } = sizedCandidates[index]!;
        await prisma.recommendation.create({
          data: {
            fixtureId: fixture.id,
            bookmakerId: candidate.bookmakerId,
            oddsSnapshotId: candidate.oddsSnapshotId,
            marketCode: candidate.marketCode,
            marketName: candidate.marketName,
            marketGroup: candidate.marketGroup,
            selectionCode: candidate.selectionCode,
            selectionName: candidate.selectionName,
            lineValue: candidate.lineValue,
            decimalOdds: candidate.decimalOdds,
            modelProbability: candidate.modelProbability,
            fairMarketProbability: candidate.fairMarketProbability,
            impliedProbability: candidate.impliedProbability,
            edge: candidate.edge,
            expectedValue: candidate.expectedValue,
            confidenceScore: candidate.confidenceScore,
            dataQualityScore: candidate.dataQualityScore,
            recommendationScore: candidate.recommendationScore,
            rankNumber: index + 1,
            modelVersion: SCIENTIFIC_MODEL_VERSION,
            reasons: [
              ...candidate.reasons,
              formatScientificStakeReason(stakePlan),
            ] as unknown as InputJsonValue,
            generatedAt: now,
            expiresAt,
          },
        });
        inserted += 1;
        marketCounts[candidate.marketCode] =
          (marketCounts[candidate.marketCode] ?? 0) + 1;
      }
    }

    await prisma.recommendation.updateMany({
      where: {
        status: RecommendationStatus.ACTIVE,
        expiresAt: { lte: now },
      },
      data: { status: RecommendationStatus.EXPIRED },
    });

    return {
      processed,
      inserted,
      updated: 0,
      metadata: {
        fixtures: fixtures.length,
        noBetFixtures,
        marketCounts,
        modelVersion: SCIENTIFIC_MODEL_VERSION,
        modelWeight: rules.modelWeight,
        marketWeight: rules.marketWeight,
          rejectionDiagnostics: rejectionDiagnostics.snapshot() as unknown as InputJsonValue,
          staking: {
            version: SCIENTIFIC_STAKING_VERSION,
            config: summarizeScientificBankrollConfig(stakingConfig),
            totalRecommendedStakeUnits,
            totalRecommendedStakeAmount,
            dailyExposureByDate: Object.fromEntries(dailyExposureByDate),
          } as unknown as InputJsonValue,
      },
    };
  });
}
