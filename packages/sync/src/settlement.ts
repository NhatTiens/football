import {
  FixtureStatus,
  prisma,
  RecommendationStatus,
  SettlementResult,
} from '@football-ai/database';
import { profitForSettlement, settleSelection } from '@football-ai/engine';
import { runTrackedSync, type SyncSummary } from './tracking.js';

export async function settleRecommendations(): Promise<SyncSummary> {
  return runTrackedSync('settle-recommendations', async () => {
    const recommendations = await prisma.recommendation.findMany({
      where: {
        settlementResult: SettlementResult.PENDING,
        status: { in: [RecommendationStatus.ACTIVE, RecommendationStatus.EXPIRED] },
        fixture: {
          status: FixtureStatus.FINISHED,
          homeGoals: { not: null },
          awayGoals: { not: null },
        },
      },
      include: { fixture: true },
    });

    let updated = 0;
    for (const recommendation of recommendations) {
      const resultCode = settleSelection({
        marketCode: recommendation.marketCode,
        selectionCode: recommendation.selectionCode,
        lineValue: recommendation.lineValue,
        homeGoals: recommendation.fixture.homeGoals!,
        awayGoals: recommendation.fixture.awayGoals!,
      });
      const result = resultCode as SettlementResult;
      const profit = profitForSettlement(resultCode, recommendation.decimalOdds, 1);
      await prisma.recommendation.update({
        where: { id: recommendation.id },
        data: {
          status: RecommendationStatus.SETTLED,
          settlementResult: result,
          simulatedProfitUnits: profit,
          settledAt: new Date(),
        },
      });
      updated += 1;
    }

    return { processed: recommendations.length, inserted: 0, updated };
  });
}
