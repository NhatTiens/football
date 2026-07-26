export const SCIENTIFIC_DASHBOARD_VERSION = 'v7.0-beta.1D-scientific-dashboard-v1';

type PrismaLike = any;

function countMap(rows: Array<{ [key: string]: any; _count: { _all: number } }>, key: string) {
  return Object.fromEntries(rows.map((row) => [String(row[key]), row._count._all]));
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function getScientificDashboard(prisma: PrismaLike): Promise<Record<string, unknown>> {
  const generatedAt = new Date();

  const [
    freshTotal,
    freshCompleted,
    freshStatusGroups,
    freshHorizonGroups,
    latestFresh,
    paperTotal,
    bestBetCount,
    noBetCount,
    paperSettlementCount,
    recentDecisionRows,
    latestRiskPolicy,
    latestLegacyBacktest,
  ] = await Promise.all([
    prisma.apiFootballFreshOddsCheckpoint.count(),
    prisma.apiFootballFreshOddsCheckpoint.count({ where: { completedAt: { not: null } } }),
    prisma.apiFootballFreshOddsCheckpoint.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.apiFootballFreshOddsCheckpoint.groupBy({
      by: ['horizonMinutes', 'horizonLabel', 'status'],
      _count: { _all: true },
      _sum: { normalizedOdds: true, insertedOdds: true, pitUsableOdds: true },
      orderBy: [{ horizonMinutes: 'desc' }, { status: 'asc' }],
    }),
    prisma.apiFootballFreshOddsCheckpoint.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        providerFixtureId: true,
        providerLeagueId: true,
        kickoffAt: true,
        horizonMinutes: true,
        horizonLabel: true,
        dueAt: true,
        status: true,
        attempts: true,
        completedAt: true,
        requestCount: true,
        normalizedOdds: true,
        insertedOdds: true,
        pitUsableOdds: true,
        errorMessage: true,
        updatedAt: true,
      },
    }),
    prisma.scientificPaperBetDecision.count(),
    prisma.scientificPaperBetDecision.count({ where: { decisionType: 'BEST_BET' } }),
    prisma.scientificPaperBetDecision.count({ where: { decisionType: 'NO_BET' } }),
    prisma.scientificPaperBetSettlement.count(),
    prisma.scientificPaperBetDecision.findMany({
      orderBy: [{ decisionAsOf: 'desc' }, { id: 'desc' }],
      take: 30,
      select: {
        id: true,
        providerFixtureId: true,
        localFixtureId: true,
        horizonMinutes: true,
        decisionAsOf: true,
        kickoffAt: true,
        decisionType: true,
        selectedMarket: true,
        selectedSelection: true,
        lineValue: true,
        decimalOdds: true,
        bookmakerName: true,
        modelProbability: true,
        fairMarketProbability: true,
        edge: true,
        expectedValue: true,
        modelVersion: true,
        policyVersion: true,
        decisionHash: true,
        createdAt: true,
      },
    }),
    prisma.scientificBankrollRiskPolicy.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.backtestRun.findFirst({
      where: { status: 'SUCCESS' },
      include: { league: true },
      orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
    }),
  ]);

  const localFixtureIds = [
    ...new Set(
      (recentDecisionRows as Array<{ localFixtureId: number | null }>)
        .map((row) => row.localFixtureId)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];

  const fixtureRows =
    localFixtureIds.length > 0
      ? await prisma.fixture.findMany({
          where: { id: { in: localFixtureIds } },
          include: { league: true, homeTeam: true, awayTeam: true },
        })
      : [];

  const fixtures = new Map(
    fixtureRows.map((row: any) => [
      row.id,
      {
        id: row.id,
        leagueId: row.leagueId,
        league: row.league?.name ?? null,
        homeTeam: row.homeTeam?.name ?? null,
        awayTeam: row.awayTeam?.name ?? null,
        kickoffAt: iso(row.kickoffAt),
      },
    ]),
  );

  const horizonMap = new Map<
    string,
    {
      horizonMinutes: number;
      label: string;
      total: number;
      success: number;
      empty: number;
      retry: number;
      failed: number;
      skipped: number;
      pending: number;
      normalizedOdds: number;
      insertedOdds: number;
      pitUsableOdds: number;
    }
  >();

  for (const raw of freshHorizonGroups as any[]) {
    const key = `${raw.horizonMinutes}:${raw.horizonLabel}`;
    const current =
      horizonMap.get(key) ??
      {
        horizonMinutes: raw.horizonMinutes,
        label: raw.horizonLabel,
        total: 0,
        success: 0,
        empty: 0,
        retry: 0,
        failed: 0,
        skipped: 0,
        pending: 0,
        normalizedOdds: 0,
        insertedOdds: 0,
        pitUsableOdds: 0,
      };
    const count = raw._count?._all ?? 0;
    current.total += count;
    const normalizedStatus = String(raw.status ?? '').toUpperCase();
    if (normalizedStatus === 'SUCCESS') current.success += count;
    else if (normalizedStatus === 'EMPTY') current.empty += count;
    else if (normalizedStatus === 'RETRY') current.retry += count;
    else if (normalizedStatus === 'FAILED') current.failed += count;
    else if (normalizedStatus === 'SKIPPED') current.skipped += count;
    else current.pending += count;
    current.normalizedOdds += raw._sum?.normalizedOdds ?? 0;
    current.insertedOdds += raw._sum?.insertedOdds ?? 0;
    current.pitUsableOdds += raw._sum?.pitUsableOdds ?? 0;
    horizonMap.set(key, current);
  }

  let risk: Record<string, unknown> = {
    policy: null,
    stakeDecisions: {},
    settlements: {},
    metrics: null,
  };

  if (latestRiskPolicy) {
    const [stakeTypeGroups, settlementGroups, stakes, riskSettlements] = await Promise.all([
      prisma.scientificPaperStakeDecision.groupBy({
        by: ['stakeDecisionType'],
        where: { riskPolicyId: latestRiskPolicy.id },
        _count: { _all: true },
      }),
      prisma.scientificBankrollStakeSettlement.groupBy({
        by: ['result'],
        where: { riskPolicyId: latestRiskPolicy.id },
        _count: { _all: true },
      }),
      prisma.scientificPaperStakeDecision.findMany({
        where: { riskPolicyId: latestRiskPolicy.id, stakeDecisionType: 'STAKE' },
        select: {
          id: true,
          evaluatedAt: true,
          stakeUnits: true,
          providerFixtureId: true,
          leagueId: true,
        },
      }),
      prisma.scientificBankrollStakeSettlement.findMany({
        where: { riskPolicyId: latestRiskPolicy.id },
        orderBy: [{ settledAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          stakeDecisionId: true,
          settledAt: true,
          result: true,
          stakeUnits: true,
          profitUnits: true,
          bankrollAfterUnits: true,
          peakBankrollAfterUnits: true,
          drawdownAfterFraction: true,
        },
      }),
    ]);

    const settledStakeIds = new Set(riskSettlements.map((row: any) => row.stakeDecisionId));
    const openStakes = stakes.filter((row: any) => !settledStakeIds.has(row.id));
    const profitUnits = riskSettlements.reduce(
      (sum: number, row: any) => sum + asNumber(row.profitUnits),
      0,
    );
    const settledStakeUnits = riskSettlements.reduce(
      (sum: number, row: any) => sum + asNumber(row.stakeUnits),
      0,
    );
    const totalStakedUnits = stakes.reduce(
      (sum: number, row: any) => sum + asNumber(row.stakeUnits),
      0,
    );
    const startingBankrollUnits = asNumber(latestRiskPolicy.startingBankrollUnits);
    const latestSettlement = riskSettlements[riskSettlements.length - 1];
    const currentBankrollUnits =
      latestSettlement?.bankrollAfterUnits ?? startingBankrollUnits + profitUnits;
    const peakBankrollUnits =
      latestSettlement?.peakBankrollAfterUnits ??
      Math.max(startingBankrollUnits, currentBankrollUnits);
    const currentDrawdownFraction =
      peakBankrollUnits > 0
        ? Math.max(0, (peakBankrollUnits - currentBankrollUnits) / peakBankrollUnits)
        : 0;
    const maximumDrawdownFraction = riskSettlements.reduce(
      (max: number, row: any) => Math.max(max, asNumber(row.drawdownAfterFraction)),
      0,
    );

    const today = generatedAt.toISOString().slice(0, 10);
    const dailyExposureUnits = stakes
      .filter((row: any) => iso(row.evaluatedAt)?.slice(0, 10) === today)
      .reduce((sum: number, row: any) => sum + asNumber(row.stakeUnits), 0);
    const dailyRealizedPnlUnits = riskSettlements
      .filter((row: any) => iso(row.settledAt)?.slice(0, 10) === today)
      .reduce((sum: number, row: any) => sum + asNumber(row.profitUnits), 0);

    risk = {
      policy: {
        id: latestRiskPolicy.id,
        accountKey: latestRiskPolicy.accountKey,
        policyVersion: latestRiskPolicy.policyVersion,
        stakingMode: latestRiskPolicy.stakingMode,
        startingBankrollUnits,
        flatStakeUnits: latestRiskPolicy.flatStakeUnits,
        maximumStakeFraction: latestRiskPolicy.maximumStakeFraction,
        maximumOpenExposureFraction: latestRiskPolicy.maximumOpenExposureFraction,
        maximumDailyExposureFraction: latestRiskPolicy.maximumDailyExposureFraction,
        maximumLeagueExposureFraction: latestRiskPolicy.maximumLeagueExposureFraction,
        maximumDailyLossFraction: latestRiskPolicy.maximumDailyLossFraction,
        drawdownSoftLimit: latestRiskPolicy.drawdownSoftLimit,
        drawdownHardLimit: latestRiskPolicy.drawdownHardLimit,
        createdAt: iso(latestRiskPolicy.createdAt),
        payloadHash: latestRiskPolicy.payloadHash,
      },
      stakeDecisions: countMap(stakeTypeGroups, 'stakeDecisionType'),
      settlements: countMap(settlementGroups, 'result'),
      metrics: {
        startingBankrollUnits,
        currentBankrollUnits,
        peakBankrollUnits,
        profitUnits,
        bankrollReturn:
          startingBankrollUnits > 0 ? profitUnits / startingBankrollUnits : null,
        totalStakeDecisions: stakes.length,
        totalStakedUnits,
        settledStakeUnits,
        yieldRate: settledStakeUnits > 0 ? profitUnits / settledStakeUnits : null,
        openExposureUnits: openStakes.reduce(
          (sum: number, row: any) => sum + asNumber(row.stakeUnits),
          0,
        ),
        dailyExposureUnits,
        dailyRealizedPnlUnits,
        currentDrawdownFraction,
        maximumDrawdownFraction,
      },
    };
  }

  const freshByStatus = countMap(freshStatusGroups, 'status');
  const horizons = [...horizonMap.values()].sort(
    (a, b) => b.horizonMinutes - a.horizonMinutes,
  );
  const freshSuccesses = freshByStatus.SUCCESS ?? 0;

  return {
    version: SCIENTIFIC_DASHBOARD_VERSION,
    generatedAt: generatedAt.toISOString(),
    evidenceClass: 'SCIENTIFIC_DIAGNOSTIC_NON_PROMOTIONAL',
    freshOdds: {
      totalCheckpoints: freshTotal,
      completedCheckpoints: freshCompleted,
      pendingCheckpoints: Math.max(0, freshTotal - freshCompleted),
      byStatus: freshByStatus,
      byHorizon: horizons,
      latestCheckpoint: latestFresh
        ? {
            ...latestFresh,
            kickoffAt: iso(latestFresh.kickoffAt),
            dueAt: iso(latestFresh.dueAt),
            completedAt: iso(latestFresh.completedAt),
            updatedAt: iso(latestFresh.updatedAt),
          }
        : null,
    },
    paper: {
      totalDecisions: paperTotal,
      bestBets: bestBetCount,
      noBets: noBetCount,
      settlements: paperSettlementCount,
      recentDecisions: recentDecisionRows.map((row: any) => ({
        ...row,
        decisionAsOf: iso(row.decisionAsOf),
        kickoffAt: iso(row.kickoffAt),
        createdAt: iso(row.createdAt),
        fixture: row.localFixtureId != null ? fixtures.get(row.localFixtureId) ?? null : null,
      })),
    },
    risk,
    legacyBacktest: latestLegacyBacktest
      ? {
          id: latestLegacyBacktest.id,
          name: latestLegacyBacktest.name,
          status: latestLegacyBacktest.status,
          dateFrom: iso(latestLegacyBacktest.dateFrom),
          dateTo: iso(latestLegacyBacktest.dateTo),
          modelVersion: latestLegacyBacktest.modelVersion,
          totalFixtures: latestLegacyBacktest.totalFixtures,
          totalBets: latestLegacyBacktest.totalBets,
          wins: latestLegacyBacktest.wins,
          losses: latestLegacyBacktest.losses,
          hitRate: latestLegacyBacktest.hitRate,
          profitUnits: latestLegacyBacktest.profitUnits,
          roi: latestLegacyBacktest.roi,
          maximumDrawdown: latestLegacyBacktest.maximumDrawdown,
          brierScore: latestLegacyBacktest.brierScore,
          league: latestLegacyBacktest.league?.name ?? null,
        }
      : null,
    readiness: {
      freshOddsOperational: freshTotal > 0,
      freshOddsSuccessEvidence: freshSuccesses > 0,
      riskPolicyFrozen: latestRiskPolicy != null,
      freshStakeEvidence:
        latestRiskPolicy != null &&
        ((risk as any).stakeDecisions?.STAKE ?? 0) +
          ((risk as any).stakeDecisions?.NO_STAKE ?? 0) >
          0,
      freshSettlementEvidence:
        latestRiskPolicy != null &&
        Object.values((risk as any).settlements ?? {}).reduce(
          (sum: number, value: any) => sum + asNumber(value),
          0,
        ) > 0,
    },
    integrity: {
      readOnlyDashboard: true,
      paperOnly: true,
      syntheticOddsUsedByDashboard: false,
      externalApiCalledByDashboard: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
      automaticPromotion: false,
      sourceBestBetPolicyChanged: false,
      productionRoutingChanged: false,
    },
  };
}
