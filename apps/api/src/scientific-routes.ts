import { Router } from 'express';

import { prisma } from '@football-ai/database';
import {
  API_FOOTBALL_ASIA_COUNTRIES,
  API_FOOTBALL_SOUTHEAST_ASIA_COUNTRIES,
  apiFootballLeagueProfile,
  buildShadowSettlementRuntimeReport,
  buildVietnamHorizonSchedule,
  parseApiFootballLeagueProfile,
  type ShadowSettlementRow,
} from '@football-ai/sync';

export const scientificRouter = Router();

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(maximum, parsed);
}

async function latestLeagueProfile() {
  const snapshot = await prisma.apiFootballDataSnapshot.findFirst({
    where: {
      kind: 'LEAGUE_PROFILE_DISCOVERY',
    },
    orderBy: {
      observedAt: 'desc',
    },
    select: {
      observedAt: true,
      rawPayload: true,
    },
  });

  return {
    observedAt: snapshot?.observedAt ?? null,
    leagues: snapshot ? parseApiFootballLeagueProfile(snapshot.rawPayload) : [],
  };
}

scientificRouter.get('/overview', async (_request, response, next) => {
  try {
    const [
      providerRuns,
      successfulRuns,
      fixtureSnapshots,
      oddsSnapshots,
      pitUsableOddsSnapshots,
      dataSnapshots,
      paperBetDecisions,
      paperBestBets,
      paperNoBets,
      settlements,
      wins,
      losses,
      stake,
      profit,
      latestProviderRun,
      latestOdds,
      leagueProfile,
    ] = await Promise.all([
      prisma.apiFootballProviderRun.count(),
      prisma.apiFootballProviderRun.count({
        where: {
          status: 'SUCCESS',
        },
      }),
      prisma.apiFootballFixtureSnapshot.count(),
      prisma.apiFootballOddsSnapshot.count(),
      prisma.apiFootballOddsSnapshot.count({
        where: {
          pitUsable: true,
        },
      }),
      prisma.apiFootballDataSnapshot.count(),
      prisma.scientificPaperBetDecision.count(),
      prisma.scientificPaperBetDecision.count({
        where: {
          decisionType: 'BEST_BET',
        },
      }),
      prisma.scientificPaperBetDecision.count({
        where: {
          decisionType: 'NO_BET',
        },
      }),
      prisma.scientificPaperBetSettlement.count(),
      prisma.scientificPaperBetSettlement.count({
        where: {
          result: 'WIN',
        },
      }),
      prisma.scientificPaperBetSettlement.count({
        where: {
          result: 'LOSS',
        },
      }),
      prisma.scientificPaperBetSettlement.aggregate({
        _sum: {
          stakeUnits: true,
        },
      }),
      prisma.scientificPaperBetSettlement.aggregate({
        _sum: {
          profitUnits: true,
        },
      }),
      prisma.apiFootballProviderRun.findFirst({
        orderBy: {
          startedAt: 'desc',
        },
      }),
      prisma.apiFootballOddsSnapshot.findFirst({
        orderBy: {
          observedAt: 'desc',
        },
        select: {
          observedAt: true,
        },
      }),
      latestLeagueProfile(),
    ]);

    const totalStakeUnits = stake._sum.stakeUnits ?? 0;
    const profitUnits = profit._sum.profitUnits ?? 0;
    const groupCounts = leagueProfile.leagues.reduce<Record<string, number>>(
      (accumulator, league) => {
        accumulator[league.group] = (accumulator[league.group] ?? 0) + 1;

        return accumulator;
      },
      {},
    );

    response.json({
      timezone: 'Asia/Ho_Chi_Minh',
      leagueProfile: apiFootballLeagueProfile(),
      regions: {
        southeastAsia: API_FOOTBALL_SOUTHEAST_ASIA_COUNTRIES,
        asia: API_FOOTBALL_ASIA_COUNTRIES,
      },
      leagues: {
        discovered: leagueProfile.leagues.length,
        groupCounts,
        observedAt: leagueProfile.observedAt,
      },
      provider: {
        providerRuns,
        successfulRuns,
        fixtureSnapshots,
        oddsSnapshots,
        pitUsableOddsSnapshots,
        dataSnapshots,
        latestProviderRun,
        latestOddsObservedAt: latestOdds?.observedAt ?? null,
      },
      paperBet: {
        decisions: paperBetDecisions,
        bestBets: paperBestBets,
        noBets: paperNoBets,
        settlements,
        wins,
        losses,
        openBestBets: paperBestBets - settlements,
        totalStakeUnits,
        profitUnits,
        roi: totalStakeUnits > 0 ? profitUnits / totalStakeUnits : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

scientificRouter.get('/leagues', async (_request, response, next) => {
  try {
    const profile = await latestLeagueProfile();

    response.json({
      timezone: 'Asia/Ho_Chi_Minh',
      leagueProfile: apiFootballLeagueProfile(),
      observedAt: profile.observedAt,
      data: profile.leagues,
    });
  } catch (error) {
    next(error);
  }
});

scientificRouter.get('/fixtures', async (request, response, next) => {
  try {
    const limit = positiveInteger(request.query.limit, 50, 200);
    const now = new Date();
    const rows = await prisma.apiFootballFixtureSnapshot.findMany({
      where: {
        kickoffAt: {
          gte: new Date(now.getTime() - 3 * 60 * 60 * 1000),
        },
      },
      orderBy: {
        observedAt: 'desc',
      },
      take: Math.min(1000, limit * 10),
    });
    const latest = new Map<number, (typeof rows)[number]>();

    for (const row of rows) {
      if (!latest.has(row.providerFixtureId)) {
        latest.set(row.providerFixtureId, row);
      }
    }

    const leagueProfile = await latestLeagueProfile();
    const leagueById = new Map(leagueProfile.leagues.map((league) => [league.id, league]));
    const data = [...latest.values()]
      .sort((left, right) => left.kickoffAt.getTime() - right.kickoffAt.getTime())
      .slice(0, limit)
      .map((row) => {
        const league = leagueById.get(row.providerLeagueId);

        return {
          providerFixtureId: row.providerFixtureId,
          providerLeagueId: row.providerLeagueId,
          leagueName: league?.name ?? `League #${row.providerLeagueId}`,
          leagueGroup: league?.group ?? null,
          leagueCountry: league?.country ?? null,
          homeTeamName: row.homeTeamName,
          awayTeamName: row.awayTeamName,
          statusShort: row.statusShort,
          kickoffUtc: row.kickoffAt.toISOString(),
          ...buildVietnamHorizonSchedule(row.kickoffAt),
          observedAt: row.observedAt,
        };
      });

    response.json({
      timezone: 'Asia/Ho_Chi_Minh',
      data,
    });
  } catch (error) {
    next(error);
  }
});

scientificRouter.get('/bets', async (request, response, next) => {
  try {
    const limit = positiveInteger(request.query.limit, 100, 300);
    const reportAsOf = new Date();
    const [decisions, shadowReport] = await Promise.all([
      prisma.scientificPaperBetDecision.findMany({
        include: {
          settlement: true,
        },
        orderBy: {
          decisionAsOf: 'desc',
        },
        take: limit,
      }),
      buildShadowSettlementRuntimeReport({
        hours: 8760,
        providerFixtureId: null,
        reportAsOf,
        maximumSnapshots: Math.min(3000, limit * 10),
      }),
    ]);
    const paperRows = (shadowReport.rows as ShadowSettlementRow[]).filter(
      (row: ShadowSettlementRow) => row.decisionSource === 'paperShadowRecommendation',
    );
    const providerFixtureIds = [
      ...new Set([
        ...decisions.map((row: { providerFixtureId: number }) => row.providerFixtureId),
        ...paperRows.map((row) => row.providerFixtureId),
      ]),
    ];
    const fixtureSnapshots =
      providerFixtureIds.length === 0
        ? []
        : await prisma.apiFootballFixtureSnapshot.findMany({
            where: {
              providerFixtureId: { in: providerFixtureIds },
              observedAt: { lte: reportAsOf },
            },
            select: {
              providerFixtureId: true,
              homeTeamName: true,
              awayTeamName: true,
              observedAt: true,
            },
            orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
            take: Math.min(10_000, providerFixtureIds.length * 12),
          });
    const fixtureNames = new Map<number, { homeTeamName: string; awayTeamName: string }>();

    for (const fixture of fixtureSnapshots) {
      if (!fixtureNames.has(fixture.providerFixtureId)) {
        fixtureNames.set(fixture.providerFixtureId, {
          homeTeamName: fixture.homeTeamName,
          awayTeamName: fixture.awayTeamName,
        });
      }
    }

    const ledgerRows = decisions.map((decision: (typeof decisions)[number]) => ({
      id: `ledger:${decision.id}`,
      source: 'PAPER_LEDGER' as const,
      providerFixtureId: decision.providerFixtureId,
      horizonMinutes: decision.horizonMinutes,
      decisionAsOf: decision.decisionAsOf.toISOString(),
      kickoffAt: decision.kickoffAt.toISOString(),
      decisionType: decision.decisionType,
      market: decision.selectedMarket,
      selection: decision.selectedSelection,
      lineValue: decision.lineValue,
      decimalOdds: decision.decimalOdds,
      bookmakerName: decision.bookmakerName,
      modelProbability: decision.modelProbability,
      fairMarketProbability: decision.fairMarketProbability,
      edge: decision.edge,
      expectedValue: decision.expectedValue,
      modelVersion: decision.modelVersion,
      policyVersion: decision.policyVersion,
      reliabilityStatus: decision.reliabilityStatus,
      candidateCount: decision.candidateCount,
      rejectedCandidateCount: decision.rejectedCandidateCount,
      sourcePredictionSelection: null,
      sourcePredictionLineValue: null,
      sourcePredictionProbability: null,
      ...fixtureNames.get(decision.providerFixtureId),
      settlement: decision.settlement
        ? {
            result: decision.settlement.result,
            stakeUnits: decision.settlement.stakeUnits,
            profitUnits: decision.settlement.profitUnits,
            fulltimeHomeGoals: decision.settlement.fulltimeHomeGoals,
            fulltimeAwayGoals: decision.settlement.fulltimeAwayGoals,
            clv: decision.settlement.clv,
            settledAt: decision.settlement.settledAt.toISOString(),
          }
        : null,
    }));
    const shadowRows = paperRows.map((row) => ({
      id: `shadow:${row.snapshotId}`,
      source: 'PAPER_SHADOW' as const,
      providerFixtureId: row.providerFixtureId,
      horizonMinutes: row.checkpointMinutes,
      decisionAsOf: row.snapshotAsOf,
      kickoffAt: row.kickoffAt,
      decisionType: 'PAPER_PROPOSAL' as const,
      market: row.marketType,
      selection: row.selection,
      lineValue: row.lineValue,
      decimalOdds: row.decisionOdds,
      bookmakerName: row.bookmakerName,
      modelProbability: row.paperModelProbability,
      fairMarketProbability: row.fairMarketProbability,
      edge: row.edge,
      expectedValue: row.expectedValue,
      modelVersion: row.modelVersion ?? 'UNKNOWN',
      policyVersion: row.paperRecommendationVersion ?? row.version,
      reliabilityStatus: row.shadowTier,
      candidateCount: 1,
      rejectedCandidateCount: 0,
      sourcePredictionSelection: row.sourcePredictionSelection,
      sourcePredictionLineValue: row.sourcePredictionLineValue,
      sourcePredictionProbability: row.sourcePredictionProbability,
      ...fixtureNames.get(row.providerFixtureId),
      settlement:
        row.status === 'SETTLED' &&
        row.settlementResult != null &&
        row.hypotheticalProfitUnits != null &&
        row.outcome.fulltimeHomeGoals != null &&
        row.outcome.fulltimeAwayGoals != null
          ? {
              result: row.settlementResult,
              stakeUnits: row.flatStakeUnits,
              profitUnits: row.hypotheticalProfitUnits,
              fulltimeHomeGoals: row.outcome.fulltimeHomeGoals,
              fulltimeAwayGoals: row.outcome.fulltimeAwayGoals,
              clv: row.clv,
              settledAt: row.outcome.sourceFixtureObservedAt,
            }
          : null,
    }));
    const data = [...ledgerRows, ...shadowRows]
      .sort(
        (left, right) =>
          new Date(right.decisionAsOf).getTime() - new Date(left.decisionAsOf).getTime() ||
          right.id.localeCompare(left.id),
      )
      .slice(0, limit);
    const settledPaperRows = paperRows.filter(
      (row) => row.status === 'SETTLED' && row.settlementResult != null,
    );
    const paperWins = settledPaperRows.filter((row) => row.settlementResult === 'WIN').length;
    const paperLosses = settledPaperRows.filter((row) => row.settlementResult === 'LOSS').length;
    const paperVoids = settledPaperRows.filter((row) => row.settlementResult === 'VOID').length;
    const paperProfitUnits = settledPaperRows.reduce(
      (sum, row) => sum + (row.hypotheticalProfitUnits ?? 0),
      0,
    );
    const gradedPaperRows = paperWins + paperLosses;

    response.json({
      timezone: 'Asia/Ho_Chi_Minh',
      generatedAt: reportAsOf,
      summary: {
        paperProposals: paperRows.length,
        pendingPaperProposals: paperRows.filter((row) => row.status === 'PENDING_OUTCOME').length,
        invalidPaperProposals: paperRows.filter((row) => row.status === 'INVALID_DECISION_LINEAGE')
          .length,
        settledPaperProposals: settledPaperRows.length,
        paperWins,
        paperLosses,
        paperVoids,
        paperHitRate: gradedPaperRows > 0 ? paperWins / gradedPaperRows : null,
        paperProfitUnits,
        paperRoi: settledPaperRows.length > 0 ? paperProfitUnits / settledPaperRows.length : null,
      },
      data,
    });
  } catch (error) {
    next(error);
  }
});
