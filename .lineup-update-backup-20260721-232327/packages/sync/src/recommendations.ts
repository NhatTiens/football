import {
  buildOddsConsensusOverUnderCandidates,
  type OverUnderQuote,
} from '@football-ai/engine';
import {
  FixtureStatus,
  prisma,
  RecommendationStatus,
  type InputJsonValue,
} from '@football-ai/database';
import { getFixtureHoursAhead, getOverUnderConsensusRules } from './config.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';

interface RawOddsRow {
  id: number;
  bookmakerId: number;
  selectionCode: string;
  selectionName: string;
  lineValue: number | null;
  decimalOdds: number;
  capturedAt: Date;
  bookmaker: { name: string };
  market: { marketCode: string; name: string; marketGroup: string };
}

export function latestOverUnderOddsRows(
  rows: RawOddsRow[],
  targetLine = 2.5,
): OverUnderQuote[] {
  const latest = new Map<string, RawOddsRow>();

  for (const row of rows) {
    if (row.market.marketCode !== 'TOTAL_GOALS_2_5') continue;
    const selectionCode = row.selectionCode.toUpperCase();
    if (selectionCode !== 'OVER' && selectionCode !== 'UNDER') continue;
    const lineValue = row.lineValue ?? targetLine;
    if (Math.abs(lineValue - targetLine) > 0.0001) continue;
    if (!Number.isFinite(row.decimalOdds) || row.decimalOdds <= 1) continue;

    const key = `${row.bookmakerId}:${selectionCode}:${lineValue}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  return [...latest.values()].map((row) => ({
    id: row.id,
    bookmakerId: row.bookmakerId,
    bookmakerName: row.bookmaker.name,
    marketCode: 'TOTAL_GOALS_2_5',
    marketName: row.market.name,
    marketGroup: row.market.marketGroup,
    selectionCode: row.selectionCode.toUpperCase() as 'OVER' | 'UNDER',
    selectionName: row.selectionName,
    lineValue: row.lineValue ?? targetLine,
    decimalOdds: row.decimalOdds,
    capturedAt: row.capturedAt,
  }));
}

export async function generateRecommendations(): Promise<SyncSummary> {
  return runTrackedSync('generate-over-under-odds-consensus', async () => {
    const now = new Date();
    const maximum = new Date(now.getTime() + getFixtureHoursAhead() * 3_600_000);
    const rules = getOverUnderConsensusRules();

    const fixtures = await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.UPCOMING,
        kickoffAt: { gte: now, lte: maximum },
      },
      include: {
        oddsSnapshots: {
          where: { isLive: false },
          include: { bookmaker: true, market: true },
          orderBy: { capturedAt: 'desc' },
        },
      },
      orderBy: { kickoffAt: 'asc' },
    });

    let inserted = 0;
    let processed = 0;
    let noBetFixtures = 0;

    for (const fixture of fixtures) {
      processed += 1;
      const latestOdds = latestOverUnderOddsRows(fixture.oddsSnapshots, rules.lineValue);
      const candidates = buildOddsConsensusOverUnderCandidates({
        odds: latestOdds,
        rules,
        now,
      });

      await prisma.recommendation.updateMany({
        where: {
          fixtureId: fixture.id,
          status: RecommendationStatus.ACTIVE,
          marketCode: 'TOTAL_GOALS_2_5',
        },
        data: { status: RecommendationStatus.EXPIRED },
      });

      if (candidates.length === 0) {
        noBetFixtures += 1;
        continue;
      }

      const expiryByFreshness =
        now.getTime() + Math.min(30, rules.maximumOddsAgeMinutes) * 60_000;
      const expiryBeforeKickoff = fixture.kickoffAt.getTime() - 60_000;
      const expiresAt = new Date(
        Math.max(now.getTime(), Math.min(expiryByFreshness, expiryBeforeKickoff)),
      );

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]!;
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
            modelVersion: 'odds-consensus-leave-one-out-ou-v1',
            reasons: candidate.reasons as InputJsonValue,
            generatedAt: now,
            expiresAt,
          },
        });
        inserted += 1;
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
        mode: 'ODDS_CONSENSUS',
        market: 'TOTAL_GOALS_2_5',
        line: rules.lineValue,
      },
    };
  });
}
