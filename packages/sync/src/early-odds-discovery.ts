import { prisma, type InputJsonValue } from '@football-ai/database';

import {
  apiFootballGet,
  type ApiFootballRequestResult,
} from './api-football-client.js';
import {
  apiFootballTimezone,
  normalizeApiFootballPrematchOdds,
  type ApiFootballQuotaSnapshot,
} from './api-football-contract.js';
import { isDemoCompetitionName } from './current-competition-discovery.js';
import {
  evaluateFreshOddsQuota,
  type FreshOddsQuotaObservation,
} from './fresh-odds-collector-core.js';
import { deterministicHash } from './scientific-evaluation-contract.js';

export const EARLY_ODDS_DISCOVERY_VERSION =
  'v7.0-r4.7-early-odds-discovery-v1';

const RAW_KIND = 'EARLY_PREMATCH_ODDS_DISCOVERY';

interface EarlyOddsConfig {
  daysAhead: number;
  minimumMinutesToKickoff: number;
  refreshMinutes: number;
  maximumTrackedFixtures: number;
  maximumRequestsPerCycle: number;
  dailyReserve: number;
  minuteReserve: number;
}

interface EarlyFixture {
  id: number;
  apiFixtureId: number;
  kickoffAt: Date;
  league: {
    apiLeagueId: number;
    season: number;
    name: string;
  };
}

function integerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;

  const value = Number(raw);
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

function config(): EarlyOddsConfig {
  return {
    // API-Football documents pre-match odds availability 1–14 days ahead.
    daysAhead: integerEnv('EARLY_ODDS_DAYS_AHEAD', 14, 1, 14),
    // Exact T-180/T-90/T-30/T-10/T-5 collection owns the final 3 hours.
    minimumMinutesToKickoff: integerEnv(
      'EARLY_ODDS_MIN_MINUTES_TO_KICKOFF',
      181,
      181,
      1440,
    ),
    // Provider documentation recommends one pre-match odds call every 3h.
    refreshMinutes: integerEnv(
      'EARLY_ODDS_REFRESH_MINUTES',
      180,
      60,
      720,
    ),
    maximumTrackedFixtures: integerEnv(
      'EARLY_ODDS_MAX_TRACKED_FIXTURES',
      80,
      1,
      500,
    ),
    maximumRequestsPerCycle: integerEnv(
      'EARLY_ODDS_MAX_REQUESTS_PER_CYCLE',
      24,
      1,
      100,
    ),
    dailyReserve: integerEnv(
      'EARLY_ODDS_DAILY_REQUEST_RESERVE',
      1000,
      0,
      7000,
    ),
    minuteReserve: integerEnv(
      'EARLY_ODDS_MINUTE_REQUEST_RESERVE',
      5,
      0,
      1000,
    ),
  };
}

function jsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

function quotaObservation(
  quota: ApiFootballQuotaSnapshot | null,
): FreshOddsQuotaObservation | null {
  if (quota == null) return null;

  return {
    requestsRemainingDay: quota.requestsRemainingDay,
    rateRemainingPerMinute: quota.rateRemainingPerMinute,
  };
}

function quotaFromJson(value: unknown): ApiFootballQuotaSnapshot | null {
  if (
    value == null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return null;
  }

  const row = value as Record<string, unknown>;

  const numberOrNull = (key: string): number | null => {
    const raw = row[key];
    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number(raw)
          : Number.NaN;

    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    requestsLimitDay: numberOrNull('requestsLimitDay'),
    requestsRemainingDay: numberOrNull('requestsRemainingDay'),
    rateLimitPerMinute: numberOrNull('rateLimitPerMinute'),
    rateRemainingPerMinute: numberOrNull('rateRemainingPerMinute'),
  };
}

async function latestKnownQuota(): Promise<ApiFootballQuotaSnapshot | null> {
  const run = await prisma.apiFootballProviderRun.findFirst({
    orderBy: { startedAt: 'desc' },
    select: { quotaAfter: true },
  });

  return quotaFromJson(run?.quotaAfter ?? null);
}

function quotaAllowed(
  quota: ApiFootballQuotaSnapshot | null,
  cfg: EarlyOddsConfig,
) {
  return evaluateFreshOddsQuota({
    observation: quotaObservation(quota),
    dailyReserve: cfg.dailyReserve,
    minuteReserve: cfg.minuteReserve,
  });
}

async function upcomingFixtures(
  now: Date,
  cfg: EarlyOddsConfig,
): Promise<EarlyFixture[]> {
  const from = new Date(
    now.getTime() + cfg.minimumMinutesToKickoff * 60_000,
  );
  const until = new Date(
    now.getTime() + cfg.daysAhead * 86_400_000,
  );
  const minimumSeason = now.getUTCFullYear() - 1;

  const rows = (await prisma.fixture.findMany({
    where: {
      apiFixtureId: { gt: 0 },
      status: 'UPCOMING',
      kickoffAt: {
        gt: from,
        lte: until,
      },
      league: {
        season: { gte: minimumSeason },
      },
    },
    include: {
      league: {
        select: {
          apiLeagueId: true,
          season: true,
          name: true,
        },
      },
    },
    orderBy: { kickoffAt: 'asc' },
    take: Math.max(
      cfg.maximumTrackedFixtures * 3,
      cfg.maximumTrackedFixtures,
    ),
  })) as EarlyFixture[];

  return rows
    .filter(
      (fixture: EarlyFixture): boolean =>
        !isDemoCompetitionName(fixture.league.name),
    )
    .slice(0, cfg.maximumTrackedFixtures);
}

async function lastAttemptsByFixture(
  providerFixtureIds: number[],
): Promise<Map<number, Date>> {
  if (providerFixtureIds.length === 0) {
    return new Map<number, Date>();
  }

  const rows = await prisma.apiFootballDataSnapshot.findMany({
    where: {
      kind: RAW_KIND,
      providerFixtureId: { in: providerFixtureIds },
    },
    select: {
      providerFixtureId: true,
      observedAt: true,
    },
    orderBy: [
      { observedAt: 'desc' },
      { id: 'desc' },
    ],
    take: Math.max(providerFixtureIds.length * 8, 100),
  });

  const result = new Map<number, Date>();

  for (const row of rows) {
    if (
      row.providerFixtureId != null &&
      !result.has(row.providerFixtureId)
    ) {
      result.set(row.providerFixtureId, row.observedAt);
    }
  }

  return result;
}

async function persistRawAttempt(input: {
  request: ApiFootballRequestResult;
  fixture: EarlyFixture;
}): Promise<number> {
  const payloadHash = deterministicHash(
    'API_FOOTBALL_EARLY_PREMATCH_ODDS_RAW',
    {
      providerFixtureId: input.fixture.apiFixtureId,
      providerLeagueId: input.fixture.league.apiLeagueId,
      season: input.fixture.league.season,
      observedAt: input.request.observedAt.toISOString(),
      query: input.request.query,
      payload: input.request.payload,
    },
  );

  const result = await prisma.apiFootballDataSnapshot.createMany({
    data: [
      {
        kind: RAW_KIND,
        providerFixtureId: input.fixture.apiFixtureId,
        providerLeagueId: input.fixture.league.apiLeagueId,
        sourceAsOf: input.request.observedAt,
        observedAt: input.request.observedAt,
        queryPayload: jsonValue({
          ...input.request.query,
          discoveryVersion: EARLY_ODDS_DISCOVERY_VERSION,
          purpose: 'EARLY_OPENING_AND_MOVEMENT',
        }),
        rawPayload: jsonValue(input.request.payload),
        payloadHash,
      },
    ],
    skipDuplicates: true,
  });

  return result.count;
}

async function persistOdds(
  request: ApiFootballRequestResult,
): Promise<{
  normalized: number;
  inserted: number;
  pitUsable: number;
}> {
  const rows = normalizeApiFootballPrematchOdds(
    request.payload,
    request.observedAt,
  );

  let inserted = 0;

  for (const row of rows) {
    // For early discovery we intentionally deduplicate repeated provider
    // versions. observedAt is NOT part of this hash; the first moment we
    // observed a provider version remains the PIT timestamp.
    const payloadHash = deterministicHash(
      'API_FOOTBALL_EARLY_ODDS_VERSION',
      {
        providerFixtureId: row.providerFixtureId,
        providerLeagueId: row.providerLeagueId,
        season: row.season,
        kickoffAt: row.kickoffAt.toISOString(),
        sourceUpdatedAt:
          row.sourceUpdatedAt?.toISOString() ?? null,
        bookmakerId: row.bookmakerId,
        bookmakerName: row.bookmakerName,
        betId: row.betId,
        betName: row.betName,
        marketType: row.marketType,
        selection: row.selection,
        lineValue: row.lineValue,
        decimalOdds: row.decimalOdds,
      },
    );

    const result = await prisma.apiFootballOddsSnapshot.createMany({
      data: [
        {
          providerFixtureId: row.providerFixtureId,
          providerLeagueId: row.providerLeagueId,
          season: row.season,
          kickoffAt: row.kickoffAt,
          sourceUpdatedAt: row.sourceUpdatedAt,
          observedAt: row.observedAt,
          bookmakerId: row.bookmakerId,
          bookmakerName: row.bookmakerName,
          betId: row.betId,
          betName: row.betName,
          marketType: row.marketType,
          selection: row.selection,
          lineValue: row.lineValue,
          decimalOdds: row.decimalOdds,
          pitUsable: row.pitUsable,
          payloadHash,
        },
      ],
      skipDuplicates: true,
    });

    inserted += result.count;
  }

  return {
    normalized: rows.length,
    inserted,
    pitUsable: rows.filter((row) => row.pitUsable).length,
  };
}

export async function discoverEarlyPrematchOdds(
  now = new Date(),
): Promise<Record<string, unknown>> {
  const cfg = config();
  const fixtures = await upcomingFixtures(now, cfg);

  const providerFixtureIds = fixtures.map(
    (fixture: EarlyFixture): number => fixture.apiFixtureId,
  );
  const lastAttempts = await lastAttemptsByFixture(
    providerFixtureIds,
  );

  const eligibleBefore = new Date(
    now.getTime() - cfg.refreshMinutes * 60_000,
  );

  const eligible = fixtures
    .filter((fixture: EarlyFixture): boolean => {
      const attemptedAt = lastAttempts.get(fixture.apiFixtureId);
      return attemptedAt == null || attemptedAt <= eligibleBefore;
    })
    .sort((left: EarlyFixture, right: EarlyFixture): number => {
      const leftAttempt =
        lastAttempts.get(left.apiFixtureId)?.getTime() ??
        Number.NEGATIVE_INFINITY;
      const rightAttempt =
        lastAttempts.get(right.apiFixtureId)?.getTime() ??
        Number.NEGATIVE_INFINITY;

      // Fixtures never attempted come first, then the oldest attempt.
      return (
        leftAttempt - rightAttempt ||
        left.kickoffAt.getTime() - right.kickoffAt.getTime()
      );
    })
    .slice(0, cfg.maximumRequestsPerCycle);

  let quota = await latestKnownQuota();
  let requests = 0;
  let rawAttemptsInserted = 0;
  let normalizedOdds = 0;
  let insertedOdds = 0;
  let pitUsableOdds = 0;
  let fixturesWithOdds = 0;
  let emptyResponses = 0;
  let failedResponses = 0;
  let quotaBlocked: string | null = null;

  const results: Array<Record<string, unknown>> = [];

  for (const fixture of eligible) {
    const guard = quotaAllowed(quota, cfg);

    if (!guard.allowed) {
      quotaBlocked = guard.reason;
      break;
    }

    try {
      const request = await apiFootballGet('/odds', {
        fixture: fixture.apiFixtureId,
        timezone: apiFootballTimezone(),
      });

      requests += 1;
      quota = request.quota;

      rawAttemptsInserted += await persistRawAttempt({
        request,
        fixture,
      });

      const persisted = await persistOdds(request);

      normalizedOdds += persisted.normalized;
      insertedOdds += persisted.inserted;
      pitUsableOdds += persisted.pitUsable;

      if (persisted.normalized > 0) {
        fixturesWithOdds += 1;
      } else {
        emptyResponses += 1;
      }

      results.push({
        providerFixtureId: fixture.apiFixtureId,
        kickoffAt: fixture.kickoffAt.toISOString(),
        status:
          persisted.normalized > 0 ? 'ODDS_AVAILABLE' : 'EMPTY',
        normalizedOdds: persisted.normalized,
        insertedOdds: persisted.inserted,
        pitUsableOdds: persisted.pitUsable,
      });
    } catch (error) {
      failedResponses += 1;

      results.push({
        providerFixtureId: fixture.apiFixtureId,
        kickoffAt: fixture.kickoffAt.toISOString(),
        status: 'FAILED',
        error:
          error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    version: EARLY_ODDS_DISCOVERY_VERSION,
    command: 'early-odds-discovery',
    now: now.toISOString(),
    policy: {
      providerWindowDays: '1-14',
      daysAhead: cfg.daysAhead,
      refreshMinutes: cfg.refreshMinutes,
      minimumMinutesToKickoff: cfg.minimumMinutesToKickoff,
      maximumTrackedFixtures: cfg.maximumTrackedFixtures,
      maximumRequestsPerCycle: cfg.maximumRequestsPerCycle,
    },
    trackedFixtures: fixtures.length,
    dueForRefresh: eligible.length,
    requests,
    rawAttemptsInserted,
    fixturesWithOdds,
    emptyResponses,
    failedResponses,
    normalizedOdds,
    insertedOdds,
    pitUsableOdds,
    quotaBlocked,
    quotaAfter: quota,
    results,
    safety: {
      syntheticOddsUsed: false,
      scientificDecisionCreated: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
      automaticModelPromotion: false,
    },
  };
}

export async function getEarlyOddsCoverage(
  now = new Date(),
): Promise<Record<string, unknown>> {
  const cfg = config();
  const fixtures = await upcomingFixtures(now, cfg);
  const providerFixtureIds = fixtures.map(
    (fixture: EarlyFixture): number => fixture.apiFixtureId,
  );

  if (providerFixtureIds.length === 0) {
    return {
      version: EARLY_ODDS_DISCOVERY_VERSION,
      command: 'early-odds-coverage',
      trackedFixtures: 0,
      fixturesAttempted: 0,
      fixturesWithOdds: 0,
      oddsRows: 0,
      pitUsableOddsRows: 0,
      externalApiCalled: false,
    };
  }

  const [
    attemptFixtures,
    oddsFixtures,
    oddsRows,
    pitRows,
    latestAttempt,
    latestOdds,
  ] = await Promise.all([
    prisma.apiFootballDataSnapshot.findMany({
      where: {
        kind: RAW_KIND,
        providerFixtureId: { in: providerFixtureIds },
      },
      distinct: ['providerFixtureId'],
      select: { providerFixtureId: true },
    }),
    prisma.apiFootballOddsSnapshot.findMany({
      where: {
        providerFixtureId: { in: providerFixtureIds },
      },
      distinct: ['providerFixtureId'],
      select: { providerFixtureId: true },
    }),
    prisma.apiFootballOddsSnapshot.count({
      where: {
        providerFixtureId: { in: providerFixtureIds },
      },
    }),
    prisma.apiFootballOddsSnapshot.count({
      where: {
        providerFixtureId: { in: providerFixtureIds },
        pitUsable: true,
      },
    }),
    prisma.apiFootballDataSnapshot.findFirst({
      where: {
        kind: RAW_KIND,
        providerFixtureId: { in: providerFixtureIds },
      },
      orderBy: { observedAt: 'desc' },
      select: {
        providerFixtureId: true,
        observedAt: true,
      },
    }),
    prisma.apiFootballOddsSnapshot.findFirst({
      where: {
        providerFixtureId: { in: providerFixtureIds },
      },
      orderBy: { observedAt: 'desc' },
      select: {
        providerFixtureId: true,
        observedAt: true,
        sourceUpdatedAt: true,
      },
    }),
  ]);

  return {
    version: EARLY_ODDS_DISCOVERY_VERSION,
    command: 'early-odds-coverage',
    generatedAt: now.toISOString(),
    trackedFixtures: fixtures.length,
    fixturesAttempted: attemptFixtures.length,
    fixturesWithOdds: oddsFixtures.length,
    fixturesWithoutOdds:
      fixtures.length - oddsFixtures.length,
    oddsRows,
    pitUsableOddsRows: pitRows,
    latestAttempt:
      latestAttempt == null
        ? null
        : {
            providerFixtureId: latestAttempt.providerFixtureId,
            observedAt: latestAttempt.observedAt.toISOString(),
          },
    latestOdds:
      latestOdds == null
        ? null
        : {
            providerFixtureId: latestOdds.providerFixtureId,
            observedAt: latestOdds.observedAt.toISOString(),
            sourceUpdatedAt:
              latestOdds.sourceUpdatedAt?.toISOString() ?? null,
          },
    policy: {
      daysAhead: cfg.daysAhead,
      refreshMinutes: cfg.refreshMinutes,
      minimumMinutesToKickoff: cfg.minimumMinutesToKickoff,
    },
    externalApiCalled: false,
    databaseWritten: false,
  };
}
