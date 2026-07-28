import { prisma } from '@football-ai/database';
import { getPrioritizedCurrentRecommendationBatch } from './current-recommendation-batch-engine.js';

interface DiagnosticFixtureRow { apiFixtureId: number; kickoffAt: Date; }

function oddsBucket(decimalOdds: number): string {
  if (decimalOdds <= 2) return 'ODDS_LE_2';
  if (decimalOdds <= 3.5) return 'ODDS_2_TO_3_5';
  if (decimalOdds <= 6) return 'ODDS_3_5_TO_6';
  return 'ODDS_GT_6';
}

async function main(): Promise<void> {
  const now = new Date();
  const fixtures = (await prisma.fixture.findMany({
    where: { status: 'UPCOMING', kickoffAt: { gt: now }, apiFixtureId: { gt: 0 } },
    select: { apiFixtureId: true, kickoffAt: true },
    orderBy: { kickoffAt: 'asc' },
    take: 300,
  })) as DiagnosticFixtureRow[];
  const batch = await getPrioritizedCurrentRecommendationBatch({
    fixtures: fixtures.map((fixture: DiagnosticFixtureRow) => ({
      providerFixtureId: fixture.apiFixtureId,
      kickoffAt: fixture.kickoffAt,
    })),
    now,
    maximumFixtures: 180,
    chunkSize: 20,
  });
  const analyses = [...batch.analyses.values()];
  const candidates = analyses.flatMap((analysis) => analysis.candidates.map((candidate) => ({
    providerFixtureId: analysis.providerFixtureId,
    marketType: candidate.marketType,
    selection: candidate.selection,
    lineValue: candidate.lineValue,
    decimalOdds: candidate.decimalOdds,
    rawExpectedValue: candidate.expectedValue,
    rawEdge: candidate.edge,
    rawEligible: candidate.rawSignalEligibleBeforeRiskGuard,
    riskEligible: candidate.currentSignalEligible,
    signalTier: candidate.signalTier,
    conservativeExpectedValue: candidate.conservativeExpectedValue,
    conservativeEdge: candidate.conservativeEdge,
    riskAdjustedScore: candidate.riskAdjustedScore,
    quoteCount: candidate.quoteCount,
    quoteMedianOdds: candidate.quoteMedianOdds,
    quoteOutlier: candidate.quoteOutlier,
    confidenceTier: candidate.modelConfidenceTier,
    modelSource: candidate.modelSource,
    historySampleSize: candidate.modelHistorySampleSize,
    rejectionReasons: candidate.currentSignalRejectionReasons,
  })));
  const recommendations = analyses
    .map((analysis) => analysis.recommendation)
    .filter((recommendation): recommendation is NonNullable<typeof recommendation> => recommendation != null);
  const recommendationOddsDistribution = recommendations.reduce<Record<string, number>>(
    (result, recommendation) => {
      const bucket = oddsBucket(recommendation.decimalOdds);
      result[bucket] = (result[bucket] ?? 0) + 1;
      return result;
    },
    { ODDS_LE_2: 0, ODDS_2_TO_3_5: 0, ODDS_3_5_TO_6: 0, ODDS_GT_6: 0 },
  );
  const rawEligibleRejected = candidates
    .filter((candidate) => candidate.rawEligible && !candidate.riskEligible)
    .sort((left, right) => right.rawExpectedValue - left.rawExpectedValue);
  console.log(JSON.stringify({
    diagnostic: 'R4.10.2.6 LONGSHOT BIAS GUARD AND RISK-ADJUSTED RANKING',
    now: now.toISOString(),
    batch: batch.diagnostics,
    summary: {
      analyses: analyses.length,
      availableRecommendations: recommendations.length,
      candidates: candidates.length,
      rawEligibleBeforeRiskGuard: candidates.filter((candidate) => candidate.rawEligible).length,
      riskEligibleAfterGuard: candidates.filter((candidate) => candidate.riskEligible).length,
      rawEligibleRejectedByGuard: rawEligibleRejected.length,
      lowConfidenceDiagnostics: candidates.filter((candidate) => candidate.signalTier === 'LOW_CONFIDENCE_DIAGNOSTIC').length,
      bookmakerQuoteOutliers: candidates.filter((candidate) => candidate.quoteOutlier).length,
      longshotCandidates: candidates.filter((candidate) => candidate.decimalOdds > 3.5).length,
      longshotRawEligible: candidates.filter((candidate) => candidate.decimalOdds > 3.5 && candidate.rawEligible).length,
      longshotRiskEligible: candidates.filter((candidate) => candidate.decimalOdds > 3.5 && candidate.riskEligible).length,
      recommendationOddsDistribution,
    },
    topRawEligibleRejectedByGuard: rawEligibleRejected.slice(0, 30),
    recommendations: recommendations.map((recommendation) => ({
      providerFixtureId: recommendation.providerFixtureId,
      marketType: recommendation.marketType,
      selection: recommendation.selection,
      decimalOdds: recommendation.decimalOdds,
      rawExpectedValue: recommendation.expectedValue,
      conservativeExpectedValue: recommendation.conservativeExpectedValue,
      conservativeEdge: recommendation.conservativeEdge,
      riskAdjustedScore: recommendation.riskAdjustedScore,
      signalTier: recommendation.signalTier,
      modelSource: recommendation.modelSource,
      confidenceTier: recommendation.modelConfidenceTier,
      historySampleSize: recommendation.modelHistorySampleSize,
      quoteCount: recommendation.quoteCount,
      quoteMedianOdds: recommendation.quoteMedianOdds,
    })),
    safety: { externalApiCalled: false, databaseWritten: false, officialBestBetChanged: false, realMoneyExecution: false },
  }, null, 2));
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
