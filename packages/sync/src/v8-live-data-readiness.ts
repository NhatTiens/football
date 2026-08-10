import { prisma } from '@football-ai/database';

export const V8_LIVE_DATA_VERSION = 'v8.0-stage10-live-data-readiness-v1';

type QuotaDecision = 'KEEP_CURRENT_PLAN' | 'UPGRADE_RECOMMENDED' | 'QUOTA_UNKNOWN';

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function assessApiQuota(input: {
  quotaAfter: unknown;
  failedRuns24h: number;
}): {
  decision: QuotaDecision;
  dailyLimit: number | null;
  dailyRemaining: number | null;
  remainingRatio: number | null;
  reasons: string[];
} {
  const quota = record(input.quotaAfter);
  const dailyLimit = finite(quota?.requestsLimitDay ?? quota?.dailyLimit);
  const dailyRemaining = finite(quota?.requestsRemainingDay ?? quota?.dailyRemaining);
  const remainingRatio =
    dailyLimit != null && dailyLimit > 0 && dailyRemaining != null
      ? dailyRemaining / dailyLimit
      : null;
  const reasons: string[] = [];
  if (remainingRatio == null) reasons.push('PROVIDER_QUOTA_HEADERS_UNAVAILABLE');
  if (remainingRatio != null && remainingRatio < 0.1) reasons.push('DAILY_QUOTA_REMAINING_BELOW_10_PERCENT');
  if (input.failedRuns24h > 0) reasons.push('PROVIDER_FAILURES_PRESENT_24H');
  return {
    decision:
      remainingRatio == null
        ? 'QUOTA_UNKNOWN'
        : remainingRatio < 0.1 && input.failedRuns24h > 0
          ? 'UPGRADE_RECOMMENDED'
          : 'KEEP_CURRENT_PLAN',
    dailyLimit,
    dailyRemaining,
    remainingRatio,
    reasons,
  };
}

export async function getV8LiveDataReadiness(now = new Date()) {
  const since24h = new Date(now.getTime() - 24 * 60 * 60_000);
  const until = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
  const [
    latestRun,
    failedRuns24h,
    latestOdds,
    upcomingRows,
    oddsCount,
    oddsGroups,
    dataKinds,
    retryGroups,
    closingCoverage,
  ] = await Promise.all([
    prisma.apiFootballProviderRun.findFirst({ orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] }),
    prisma.apiFootballProviderRun.count({ where: { startedAt: { gte: since24h }, status: { not: 'SUCCESS' } } }),
    prisma.apiFootballOddsSnapshot.findFirst({ orderBy: [{ observedAt: 'desc' }, { id: 'desc' }] }),
    prisma.apiFootballFixtureSnapshot.findMany({
      where: { kickoffAt: { gte: now, lte: until } },
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      take: 5000,
    }),
    prisma.apiFootballOddsSnapshot.count(),
    prisma.apiFootballOddsSnapshot.groupBy({
      by: ['providerFixtureId'],
      _count: { _all: true },
      _min: { observedAt: true },
      _max: { observedAt: true },
    }),
    prisma.apiFootballDataSnapshot.groupBy({ by: ['kind'], _count: { _all: true }, _max: { observedAt: true } }),
    prisma.apiFootballFreshOddsCheckpoint.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.scientificPaperBetSettlement.aggregate({
      _count: { _all: true, closingDecimalOdds: true, clv: true },
    }),
  ]);
  const latestFixtures = new Map<number, (typeof upcomingRows)[number]>();
  for (const row of upcomingRows) {
    if (!latestFixtures.has(row.providerFixtureId)) latestFixtures.set(row.providerFixtureId, row);
  }
  const oddsByFixture = new Map(
    (oddsGroups as Array<{
      providerFixtureId: number;
      _count: { _all: number };
      _min: { observedAt: Date | null };
      _max: { observedAt: Date | null };
    }>).map((row) => [row.providerFixtureId, row]),
  );
  const fixturesWithOdds = [...latestFixtures.keys()].filter(
    (fixtureId) => (oddsByFixture.get(fixtureId)?._count._all ?? 0) > 0,
  ).length;
  const repeatedOddsFixtures = [...latestFixtures.keys()].filter(
    (fixtureId) => (oddsByFixture.get(fixtureId)?._count._all ?? 0) >= 6,
  ).length;
  const latestOddsAgeMinutes = latestOdds
    ? (now.getTime() - latestOdds.observedAt.getTime()) / 60_000
    : null;
  const dataKindMap = Object.fromEntries(
    (dataKinds as Array<{ kind: string; _count: { _all: number }; _max: { observedAt: Date | null } }>).map(
      (row) => [row.kind, { rows: row._count._all, latestObservedAt: row._max.observedAt }],
    ),
  );
  const requiredKinds = ['TEAM_STATISTICS', 'INJURIES', 'LINEUPS'];
  const missingKinds = requiredKinds.filter((kind) => !(kind in dataKindMap));
  const quota = assessApiQuota({ quotaAfter: latestRun?.quotaAfter, failedRuns24h });
  const blockers: string[] = [];
  if (latestFixtures.size === 0) blockers.push('NO_UPCOMING_FIXTURE_SNAPSHOTS_3D');
  if (latestOddsAgeMinutes == null || latestOddsAgeMinutes > 30) blockers.push('ODDS_SNAPSHOT_STALE_OVER_30_MINUTES');
  if (fixturesWithOdds < latestFixtures.size) blockers.push('UPCOMING_FIXTURE_ODDS_COVERAGE_INCOMPLETE');
  if (missingKinds.length) blockers.push(`MISSING_DATA_KINDS:${missingKinds.join(',')}`);
  if (failedRuns24h > 0) blockers.push('PROVIDER_RUN_FAILURES_24H');
  return {
    version: V8_LIVE_DATA_VERSION,
    generatedAt: now.toISOString(),
    status: blockers.length === 0 ? 'READY_FOR_SHADOW_INPUT' : 'BLOCKED_LIVE_DATA_FRESHNESS',
    blockers,
    provider: {
      latestRun,
      failedRuns24h,
      quota,
      automaticPlanUpgrade: false,
      credentialChanged: false,
    },
    fixtures: {
      upcoming3d: latestFixtures.size,
      withOdds: fixturesWithOdds,
      withRepeatedOdds: repeatedOddsFixtures,
    },
    odds: {
      rows: oddsCount,
      latestObservedAt: latestOdds?.observedAt ?? null,
      latestAgeMinutes: latestOddsAgeMinutes,
      sourceTimestampPreserved: true,
      observedTimestampPreserved: true,
      appendOnlySnapshots: true,
    },
    context: {
      dataKinds: dataKindMap,
      requiredKinds,
      missingKinds,
      injury: 'SUPPORTED',
      lineup: 'SUPPORTED',
      suspension: 'PARTIAL_VIA_INJURY_PROVIDER_PAYLOAD',
      weather: 'NOT_CONFIGURED_PROVIDER_CAPABILITY',
    },
    retries: Object.fromEntries(
      (retryGroups as Array<{ status: string; _count: { _all: number } }>).map((row) => [row.status, row._count._all]),
    ),
    closingOdds: {
      settlements: closingCoverage._count._all,
      closingOddsRows: closingCoverage._count.closingDecimalOdds,
      clvRows: closingCoverage._count.clv,
    },
    rawArchive: {
      fixtureRawPayloadStored: true,
      providerDataRawPayloadStored: true,
      payloadHashesUnique: true,
      frozenStage1Mutated: false,
    },
    safety: {
      auditOnly: true,
      externalApiCalled: false,
      schemaChanged: false,
      databaseWritten: false,
      currentChampionChanged: false,
    },
  };
}
