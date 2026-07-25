import { Router } from 'express';

import { prisma } from '@football-ai/database';
import {
  API_FOOTBALL_ASIA_COUNTRIES,
  API_FOOTBALL_SOUTHEAST_ASIA_COUNTRIES,
  apiFootballLeagueProfile,
  buildVietnamHorizonSchedule,
  parseApiFootballLeagueProfile,
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
    const decisions = await prisma.scientificPaperBetDecision.findMany({
      include: {
        settlement: true,
      },
      orderBy: {
        decisionAsOf: 'desc',
      },
      take: limit,
    });

    response.json({
      timezone: 'Asia/Ho_Chi_Minh',
      data: decisions.map((decision: (typeof decisions)[number]) => ({
        id: decision.id,
        providerFixtureId: decision.providerFixtureId,
        horizonMinutes: decision.horizonMinutes,
        decisionAsOf: decision.decisionAsOf,
        kickoffAt: decision.kickoffAt,
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
        settlement: decision.settlement
          ? {
              result: decision.settlement.result,
              stakeUnits: decision.settlement.stakeUnits,
              profitUnits: decision.settlement.profitUnits,
              fulltimeHomeGoals: decision.settlement.fulltimeHomeGoals,
              fulltimeAwayGoals: decision.settlement.fulltimeAwayGoals,
              clv: decision.settlement.clv,
              settledAt: decision.settlement.settledAt,
            }
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});
