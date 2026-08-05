import { prisma, type InputJsonValue } from '@football-ai/database';

import { deterministicHash } from './scientific-evaluation-contract.js';
import {
  apiFootballGet,
  apiFootballStatus,
  type ApiFootballRequestResult,
} from './api-football-client.js';
import {
  API_FOOTBALL_PREMATCH_HISTORY_DAYS,
  API_FOOTBALL_PROVIDER_VERSION,
  apiFootballTimezone,
  buildVietnamHorizonSchedule,
  dateStringInTimeZone,
  lastDatesInTimeZone,
  normalizeApiFootballFixtures,
  normalizeApiFootballPrematchOdds,
  parseApiFootballLeagueProfile,
  parseCommaSeparatedIds,
  resolveApiFootballLeagueIds,
  apiFootballLeagueProfile,
  utcDateString,
  type ApiFootballLeagueProfileEntry,
  type ApiFootballQuotaSnapshot,
  type NormalizedApiFootballFixture,
} from './api-football-contract.js';

function jsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }

  return result;
}

function quotaJson(value: ApiFootballQuotaSnapshot | null): InputJsonValue | undefined {
  return value == null ? undefined : jsonValue(value);
}

function fixtureRawItem(payload: unknown, providerFixtureId: number): unknown {
  const envelope =
    payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const response = Array.isArray(envelope?.response) ? envelope.response : [];

  return (
    response.find((item) => {
      if (item == null || typeof item !== 'object') {
        return false;
      }

      const fixture = (item as Record<string, unknown>).fixture;

      return (
        fixture != null &&
        typeof fixture === 'object' &&
        Number((fixture as Record<string, unknown>).id) === providerFixtureId
      );
    }) ?? null
  );
}

async function persistFixtureSnapshots(request: ApiFootballRequestResult): Promise<{
  fixtures: NormalizedApiFootballFixture[];
  inserted: number;
}> {
  const fixtures = normalizeApiFootballFixtures(request.payload);
  let inserted = 0;

  for (const fixture of fixtures) {
    const rawPayload = fixtureRawItem(request.payload, fixture.providerFixtureId);
    const hashPayload = {
      providerFixtureId: fixture.providerFixtureId,
      providerLeagueId: fixture.providerLeagueId,
      season: fixture.season,
      kickoffAt: fixture.kickoffAt.toISOString(),
      statusShort: fixture.statusShort,
      homeProviderTeamId: fixture.homeProviderTeamId,
      awayProviderTeamId: fixture.awayProviderTeamId,
      homeTeamName: fixture.homeTeamName,
      awayTeamName: fixture.awayTeamName,
      homeGoals: fixture.homeGoals,
      awayGoals: fixture.awayGoals,
      fulltimeHomeGoals: fixture.fulltimeHomeGoals,
      fulltimeAwayGoals: fixture.fulltimeAwayGoals,
      rawPayload,
    };
    const payloadHash = deterministicHash('API_FOOTBALL_FIXTURE_SNAPSHOT', hashPayload);

    const result = await prisma.apiFootballFixtureSnapshot.createMany({
      data: [
        {
          providerFixtureId: fixture.providerFixtureId,
          providerLeagueId: fixture.providerLeagueId,
          season: fixture.season,
          kickoffAt: fixture.kickoffAt,
          statusShort: fixture.statusShort,
          homeProviderTeamId: fixture.homeProviderTeamId,
          awayProviderTeamId: fixture.awayProviderTeamId,
          homeTeamName: fixture.homeTeamName,
          awayTeamName: fixture.awayTeamName,
          homeGoals: fixture.homeGoals,
          awayGoals: fixture.awayGoals,
          fulltimeHomeGoals: fixture.fulltimeHomeGoals,
          fulltimeAwayGoals: fixture.fulltimeAwayGoals,
          observedAt: request.observedAt,
          rawPayload: jsonValue(rawPayload),
          payloadHash,
        },
      ],
      skipDuplicates: true,
    });

    inserted += result.count;
  }

  return {
    fixtures,
    inserted,
  };
}

async function persistOdds(
  request: ApiFootballRequestResult,
  leagueFilter: Set<number> | null = null,
): Promise<{
  normalized: number;
  inserted: number;
  providerFixtureIds: number[];
}> {
  const odds = normalizeApiFootballPrematchOdds(request.payload, request.observedAt).filter(
    (row) => leagueFilter == null || leagueFilter.has(row.providerLeagueId),
  );
  let inserted = 0;

  for (const row of odds) {
    const payloadHash = deterministicHash('API_FOOTBALL_ODDS_SNAPSHOT', {
      providerFixtureId: row.providerFixtureId,
      providerLeagueId: row.providerLeagueId,
      season: row.season,
      kickoffAt: row.kickoffAt.toISOString(),
      sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
      bookmakerId: row.bookmakerId,
      bookmakerName: row.bookmakerName,
      betId: row.betId,
      betName: row.betName,
      marketType: row.marketType,
      selection: row.selection,
      lineValue: row.lineValue,
      decimalOdds: row.decimalOdds,
    });

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
    normalized: odds.length,
    inserted,
    providerFixtureIds: [...new Set(odds.map((row) => row.providerFixtureId))],
  };
}

async function persistDataSnapshot(input: {
  kind: string;
  request: ApiFootballRequestResult;
  providerFixtureId?: number;
  providerLeagueId?: number;
  providerTeamId?: number;
  sourceAsOf?: Date;
}): Promise<number> {
  const payloadHash = deterministicHash('API_FOOTBALL_DATA_SNAPSHOT', {
    kind: input.kind,
    providerFixtureId: input.providerFixtureId ?? null,
    providerLeagueId: input.providerLeagueId ?? null,
    providerTeamId: input.providerTeamId ?? null,
    sourceAsOf: input.sourceAsOf?.toISOString() ?? null,
    query: input.request.query,
    payload: input.request.payload,
  });

  const result = await prisma.apiFootballDataSnapshot.createMany({
    data: [
      {
        kind: input.kind,
        providerFixtureId: input.providerFixtureId,
        providerLeagueId: input.providerLeagueId,
        providerTeamId: input.providerTeamId,
        sourceAsOf: input.sourceAsOf,
        observedAt: input.request.observedAt,
        queryPayload: jsonValue(input.request.query),
        rawPayload: jsonValue(input.request.payload),
        payloadHash,
      },
    ],
    skipDuplicates: true,
  });

  return result.count;
}

export async function syncApiFootballFixturesByIds(fixtureIds: number[]): Promise<{
  requestCount: number;
  inserted: number;
}> {
  let requestCount = 0;
  let inserted = 0;

  for (const ids of chunk(fixtureIds, 20)) {
    const request = await apiFootballGet('/fixtures', {
      ids: ids.join('-'),
      timezone: apiFootballTimezone(),
    });

    requestCount += 1;
    inserted += (await persistFixtureSnapshots(request)).inserted;
  }

  return {
    requestCount,
    inserted,
  };
}

function finalQuota(
  previous: ApiFootballQuotaSnapshot | null,
  request: ApiFootballRequestResult,
): ApiFootballQuotaSnapshot {
  return {
    requestsLimitDay: request.quota.requestsLimitDay ?? previous?.requestsLimitDay ?? null,
    requestsRemainingDay:
      request.quota.requestsRemainingDay ?? previous?.requestsRemainingDay ?? null,
    rateLimitPerMinute: request.quota.rateLimitPerMinute ?? previous?.rateLimitPerMinute ?? null,
    rateRemainingPerMinute:
      request.quota.rateRemainingPerMinute ?? previous?.rateRemainingPerMinute ?? null,
  };
}

async function saveProviderRun(input: {
  command: string;
  status: 'SUCCESS' | 'FAILED';
  requestCount: number;
  insertedFixtures: number;
  insertedOdds: number;
  insertedDataSnapshots: number;
  quotaBefore: ApiFootballQuotaSnapshot | null;
  quotaAfter: ApiFootballQuotaSnapshot | null;
  metadata: unknown;
  startedAt: Date;
  errorMessage?: string;
}): Promise<void> {
  const finishedAt = new Date();
  const payload = {
    providerVersion: API_FOOTBALL_PROVIDER_VERSION,
    command: input.command,
    status: input.status,
    requestCount: input.requestCount,
    insertedFixtures: input.insertedFixtures,
    insertedOdds: input.insertedOdds,
    insertedDataSnapshots: input.insertedDataSnapshots,
    quotaBefore: input.quotaBefore,
    quotaAfter: input.quotaAfter,
    metadata: input.metadata,
    startedAt: input.startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    errorMessage: input.errorMessage ?? null,
  };
  const payloadHash = deterministicHash('API_FOOTBALL_PROVIDER_RUN', payload);

  await prisma.apiFootballProviderRun.create({
    data: {
      providerVersion: API_FOOTBALL_PROVIDER_VERSION,
      command: input.command,
      status: input.status,
      requestCount: input.requestCount,
      insertedFixtures: input.insertedFixtures,
      insertedOdds: input.insertedOdds,
      insertedDataSnapshots: input.insertedDataSnapshots,
      quotaBefore: quotaJson(input.quotaBefore),
      quotaAfter: quotaJson(input.quotaAfter),
      metadata: jsonValue(input.metadata),
      payloadHash,
      startedAt: input.startedAt,
      finishedAt,
      errorMessage: input.errorMessage,
    },
  });
}

export async function getApiFootballHealth(): Promise<{
  providerVersion: string;
  status: 'HEALTHY' | 'UNAVAILABLE';
  subscription: unknown;
  requests: unknown;
  quota: ApiFootballQuotaSnapshot;
}> {
  const result = await apiFootballStatus();
  const response = result.payload.response;

  const record =
    response != null && typeof response === 'object' ? (response as Record<string, unknown>) : {};

  return {
    providerVersion: API_FOOTBALL_PROVIDER_VERSION,
    status: 'HEALTHY',
    subscription: record.subscription ?? null,
    requests: record.requests ?? null,
    quota: result.quota,
  };
}

export async function backfillApiFootballOddsHistory(): Promise<{
  providerVersion: string;
  dates: string[];
  requestCount: number;
  insertedFixtures: number;
  normalizedOdds: number;
  insertedOdds: number;
  insertedDataSnapshots: number;
  leagueFilter: number[];
  quotaAfter: ApiFootballQuotaSnapshot | null;
  evidenceClass: 'HISTORICAL_BACKFILL_SOURCE_TIMESTAMPED_NON_FRESH';
}> {
  const startedAt = new Date();
  let requestCount = 0;
  let insertedFixtures = 0;
  let normalizedOdds = 0;
  let insertedOdds = 0;
  let insertedDataSnapshots = 0;
  let quotaBefore: ApiFootballQuotaSnapshot | null = null;
  let quotaAfter: ApiFootballQuotaSnapshot | null = null;

  const leagueIds = parseCommaSeparatedIds(process.env.API_FOOTBALL_BACKFILL_LEAGUE_IDS);
  const leagueFilter = leagueIds.length > 0 ? new Set(leagueIds) : null;
  const maxPagesPerDay = integerEnv('API_FOOTBALL_BACKFILL_MAX_PAGES_PER_DAY', 150);
  const timezone = apiFootballTimezone();
  const dates = lastDatesInTimeZone(new Date(), API_FOOTBALL_PREMATCH_HISTORY_DAYS, timezone);
  const fixtureIds = new Set<number>();

  try {
    for (const date of dates) {
      let page = 1;

      while (page <= maxPagesPerDay) {
        const request = await apiFootballGet('/odds', {
          date,
          page,
          timezone,
        });

        requestCount += 1;
        quotaBefore ??= request.quota;
        quotaAfter = finalQuota(quotaAfter, request);

        insertedDataSnapshots += await persistDataSnapshot({
          kind: 'PREMATCH_ODDS_PAGE',
          request,
        });

        const persisted = await persistOdds(request, leagueFilter);

        normalizedOdds += persisted.normalized;
        insertedOdds += persisted.inserted;

        for (const fixtureId of persisted.providerFixtureIds) {
          fixtureIds.add(fixtureId);
        }

        const paging = request.payload.paging;
        const current = Number(paging?.current ?? page);
        const total = Number(paging?.total ?? current);

        if (!Number.isFinite(total) || current >= total) {
          break;
        }

        page += 1;
      }

      if (page > maxPagesPerDay) {
        throw new Error(
          `API_FOOTBALL_BACKFILL_MAX_PAGES_PER_DAY=${maxPagesPerDay} was reached for ${date}; refusing silent partial backfill.`,
        );
      }
    }

    const fixtureFetch = await syncApiFootballFixturesByIds([...fixtureIds]);

    requestCount += fixtureFetch.requestCount;
    insertedFixtures += fixtureFetch.inserted;

    const metadata = {
      dates,
      leagueFilter: leagueIds,
      normalizedOdds,
      uniqueFixtures: fixtureIds.size,
      evidenceClass: 'HISTORICAL_BACKFILL_SOURCE_TIMESTAMPED_NON_FRESH',
      freshShadowRowsWritten: 0,
      productionRoutingChanged: false,
    };

    await saveProviderRun({
      command: 'ODDS_BACKFILL_7D',
      status: 'SUCCESS',
      requestCount,
      insertedFixtures,
      insertedOdds,
      insertedDataSnapshots,
      quotaBefore,
      quotaAfter,
      metadata,
      startedAt,
    });

    return {
      providerVersion: API_FOOTBALL_PROVIDER_VERSION,
      dates,
      requestCount,
      insertedFixtures,
      normalizedOdds,
      insertedOdds,
      insertedDataSnapshots,
      leagueFilter: leagueIds,
      quotaAfter,
      evidenceClass: 'HISTORICAL_BACKFILL_SOURCE_TIMESTAMPED_NON_FRESH',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await saveProviderRun({
      command: 'ODDS_BACKFILL_7D',
      status: 'FAILED',
      requestCount,
      insertedFixtures,
      insertedOdds,
      insertedDataSnapshots,
      quotaBefore,
      quotaAfter,
      metadata: {
        dates,
        leagueFilter: leagueIds,
      },
      startedAt,
      errorMessage: message,
    });

    throw error;
  }
}

export async function discoverApiFootballLeagueProfile(): Promise<{
  providerVersion: string;
  profile: string;
  timezone: string;
  requestCount: 1;
  insertedDataSnapshots: number;
  discoveredLeagues: number;
  selectedLeagues: number;
  leagues: ApiFootballLeagueProfileEntry[];
  selected: ApiFootballLeagueProfileEntry[];
  selectedLeagueIds: number[];
  countsByGroup: Record<string, number>;
  quotaAfter: ApiFootballQuotaSnapshot;
}> {
  const request = await apiFootballGet('/leagues', {
    current: true,
  });
  const insertedDataSnapshots = await persistDataSnapshot({
    kind: 'LEAGUE_PROFILE_DISCOVERY',
    request,
    sourceAsOf: request.observedAt,
  });
  const leagues = parseApiFootballLeagueProfile(request.payload);
  const maxLeagues = integerEnv('API_FOOTBALL_MAX_LEAGUES_PER_RUN', 36);
  const profile = apiFootballLeagueProfile();
  const profileEntries =
    profile === 'GLOBAL_ASIA'
      ? leagues
      : profile === 'MAJOR_8'
        ? leagues.filter((league) => league.group === 'GLOBAL_MAJOR')
        : (() => {
            throw new Error(
              `Unsupported API_FOOTBALL_LEAGUE_PROFILE=${profile}. Supported: GLOBAL_ASIA, MAJOR_8.`,
            );
          })();
  const staticIds = resolveApiFootballLeagueIds();
  const groupQuota = {
    GLOBAL_MAJOR: 8,
    SOUTHEAST_ASIA: 12,
    AFC: 4,
    ASIA: 12,
  } as const;
  const selectedBase = (['GLOBAL_MAJOR', 'SOUTHEAST_ASIA', 'AFC', 'ASIA'] as const).flatMap(
    (group) =>
      profileEntries.filter((league) => league.group === group).slice(0, groupQuota[group]),
  );
  const selectedIds = new Set(selectedBase.map((league) => league.id));
  const selected = [
    ...selectedBase,
    ...profileEntries.filter((league) => !selectedIds.has(league.id)),
  ].slice(0, maxLeagues);
  const selectedLeagueIds = [
    ...new Set([...staticIds, ...selected.map((league) => league.id)]),
  ].slice(0, maxLeagues);
  const countsByGroup = leagues.reduce<Record<string, number>>((accumulator, league) => {
    accumulator[league.group] = (accumulator[league.group] ?? 0) + 1;

    return accumulator;
  }, {});

  return {
    providerVersion: API_FOOTBALL_PROVIDER_VERSION,
    profile,
    timezone: apiFootballTimezone(),
    requestCount: 1,
    insertedDataSnapshots,
    discoveredLeagues: leagues.length,
    selectedLeagues: selectedLeagueIds.length,
    leagues,
    selected,
    selectedLeagueIds,
    countsByGroup,
    quotaAfter: request.quota,
  };
}

async function fixtureDiscoveryRequests(
  maxFixtures: number,
  leagueIds: number[],
): Promise<ApiFootballRequestResult[]> {
  const fixtureIds = parseCommaSeparatedIds(process.env.API_FOOTBALL_FIXTURE_IDS);

  if (fixtureIds.length > 0) {
    if (fixtureIds.length > 20) {
      throw new Error('API_FOOTBALL_FIXTURE_IDS supports at most 20 ids per live capture run.');
    }

    return [
      await apiFootballGet('/fixtures', {
        ids: fixtureIds.join('-'),
        timezone: apiFootballTimezone(),
      }),
    ];
  }

  if (leagueIds.length === 0) {
    throw new Error('No leagues discovered for the current API_FOOTBALL_LEAGUE_PROFILE.');
  }

  const nextPerLeague = Math.min(99, Math.max(1, maxFixtures));
  const requests: ApiFootballRequestResult[] = [];

  for (const leagueId of leagueIds) {
    requests.push(
      await apiFootballGet('/fixtures', {
        league: leagueId,
        next: nextPerLeague,
        timezone: apiFootballTimezone(),
      }),
    );
  }

  return requests;
}

export async function captureApiFootballLiveWindow(): Promise<{
  providerVersion: string;
  requestCount: number;
  discoveredFixtures: number;
  trackedFixtures: number;
  insertedFixtures: number;
  normalizedOdds: number;
  insertedOdds: number;
  insertedDataSnapshots: number;
  leagueFilter: number[];
  fixtureFilter: number[];
  timezone: string;
  leagueProfile: string;
  discoveredLeagues: number | null;
  selectedLeagues: number;
  schedulesVietnam: Array<{
    providerFixtureId: number;
    homeTeamName: string;
    awayTeamName: string;
    kickoffVietnam: string;
    t180Vietnam: string;
    t90Vietnam: string;
    t30Vietnam: string;
    t5Vietnam: string;
    timezone: 'Asia/Ho_Chi_Minh';
  }>;
  quotaAfter: ApiFootballQuotaSnapshot | null;
}> {
  const startedAt = new Date();
  let requestCount = 0;
  let insertedFixtures = 0;
  let normalizedOdds = 0;
  let insertedOdds = 0;
  let insertedDataSnapshots = 0;
  let quotaBefore: ApiFootballQuotaSnapshot | null = null;
  let quotaAfter: ApiFootballQuotaSnapshot | null = null;

  const fixtureIds = parseCommaSeparatedIds(process.env.API_FOOTBALL_FIXTURE_IDS);
  const fixtureFilter = new Set(fixtureIds);
  const maxFixtures = integerEnv('API_FOOTBALL_MAX_FIXTURES_PER_RUN', 50);
  let leagueIds = resolveApiFootballLeagueIds();
  let leagueDiscovery: Awaited<ReturnType<typeof discoverApiFootballLeagueProfile>> | null = null;
  const captureTeamStats = booleanEnv('API_FOOTBALL_CAPTURE_TEAM_STATS', true);
  const captureInjuries = booleanEnv('API_FOOTBALL_CAPTURE_INJURIES', true);
  const captureLineups = booleanEnv('API_FOOTBALL_CAPTURE_LINEUPS', true);

  try {
    if (fixtureIds.length === 0) {
      leagueDiscovery = await discoverApiFootballLeagueProfile();
      leagueIds = leagueDiscovery.selectedLeagueIds;
      requestCount += leagueDiscovery.requestCount;
      insertedDataSnapshots += leagueDiscovery.insertedDataSnapshots;
      quotaBefore ??= leagueDiscovery.quotaAfter;
      quotaAfter = leagueDiscovery.quotaAfter;
    }

    const leagueFilter = new Set(leagueIds);
    const discoveries = await fixtureDiscoveryRequests(maxFixtures, leagueIds);
    const discoveredFixtureMap = new Map<number, NormalizedApiFootballFixture>();

    for (const discovery of discoveries) {
      requestCount += 1;
      quotaBefore ??= discovery.quota;
      quotaAfter = finalQuota(quotaAfter, discovery);
      insertedDataSnapshots += await persistDataSnapshot({
        kind: 'FIXTURE_DISCOVERY',
        request: discovery,
      });

      const fixturePersistence = await persistFixtureSnapshots(discovery);

      insertedFixtures += fixturePersistence.inserted;

      for (const fixture of fixturePersistence.fixtures) {
        discoveredFixtureMap.set(fixture.providerFixtureId, fixture);
      }
    }

    const daysAhead = integerEnv('API_FOOTBALL_CAPTURE_DAYS_AHEAD', 2);
    const nowMs = Date.now();
    const maximumKickoffMs = addUtcDays(new Date(nowMs), daysAhead).getTime();
    const discoveredFixtures = [...discoveredFixtureMap.values()];
    const trackedFixtures = discoveredFixtures
      .filter(
        (fixture) =>
          (fixtureFilter.size === 0 || fixtureFilter.has(fixture.providerFixtureId)) &&
          (leagueFilter.size === 0 || leagueFilter.has(fixture.providerLeagueId)) &&
          fixture.kickoffAt.getTime() >= nowMs - 30 * 60_000 &&
          fixture.kickoffAt.getTime() <= maximumKickoffMs,
      )
      .sort((left, right) => left.kickoffAt.getTime() - right.kickoffAt.getTime())
      .slice(0, maxFixtures);

    for (const fixture of trackedFixtures) {
      const oddsRequest = await apiFootballGet('/odds', {
        fixture: fixture.providerFixtureId,
        timezone: apiFootballTimezone(),
      });

      requestCount += 1;
      quotaAfter = finalQuota(quotaAfter, oddsRequest);
      insertedDataSnapshots += await persistDataSnapshot({
        kind: 'PREMATCH_ODDS_FIXTURE',
        request: oddsRequest,
        providerFixtureId: fixture.providerFixtureId,
        providerLeagueId: fixture.providerLeagueId,
      });

      const persistedOdds = await persistOdds(oddsRequest);

      normalizedOdds += persistedOdds.normalized;
      insertedOdds += persistedOdds.inserted;

      if (captureTeamStats) {
        for (const teamId of [fixture.homeProviderTeamId, fixture.awayProviderTeamId]) {
          const statsRequest = await apiFootballGet('/teams/statistics', {
            league: fixture.providerLeagueId,
            season: fixture.season,
            team: teamId,
            date: dateStringInTimeZone(oddsRequest.observedAt, apiFootballTimezone()),
          });

          requestCount += 1;
          quotaAfter = finalQuota(quotaAfter, statsRequest);
          insertedDataSnapshots += await persistDataSnapshot({
            kind: 'TEAM_STATISTICS',
            request: statsRequest,
            providerFixtureId: fixture.providerFixtureId,
            providerLeagueId: fixture.providerLeagueId,
            providerTeamId: teamId,
            sourceAsOf: statsRequest.observedAt,
          });
        }
      }

      if (captureInjuries) {
        const injuryRequest = await apiFootballGet('/injuries', {
          fixture: fixture.providerFixtureId,
        });

        requestCount += 1;
        quotaAfter = finalQuota(quotaAfter, injuryRequest);
        insertedDataSnapshots += await persistDataSnapshot({
          kind: 'INJURIES',
          request: injuryRequest,
          providerFixtureId: fixture.providerFixtureId,
          providerLeagueId: fixture.providerLeagueId,
          sourceAsOf: injuryRequest.observedAt,
        });
      }

      const minutesToKickoff = (fixture.kickoffAt.getTime() - Date.now()) / 60_000;

      if (captureLineups && minutesToKickoff <= 120 && minutesToKickoff >= -30) {
        const lineupRequest = await apiFootballGet('/fixtures/lineups', {
          fixture: fixture.providerFixtureId,
        });

        requestCount += 1;
        quotaAfter = finalQuota(quotaAfter, lineupRequest);
        insertedDataSnapshots += await persistDataSnapshot({
          kind: 'LINEUPS',
          request: lineupRequest,
          providerFixtureId: fixture.providerFixtureId,
          providerLeagueId: fixture.providerLeagueId,
          sourceAsOf: lineupRequest.observedAt,
        });
      }
    }

    const metadata = {
      discoveredFixtures: discoveredFixtures.length,
      trackedFixtures: trackedFixtures.length,
      leagueFilter: leagueIds,
      fixtureFilter: fixtureIds,
      captureTeamStats,
      captureInjuries,
      captureLineups,
      maxFixtures,
      normalizedOdds,
      timezone: apiFootballTimezone(),
      leagueProfile: apiFootballLeagueProfile(),
      leagueDiscovery: {
        discoveredLeagues: leagueDiscovery?.discoveredLeagues ?? null,
        selectedLeagues: leagueDiscovery?.selectedLeagues ?? leagueIds.length,
        countsByGroup: leagueDiscovery?.countsByGroup ?? null,
      },
      schedulesVietnam: trackedFixtures.map((fixture) => ({
        providerFixtureId: fixture.providerFixtureId,
        homeTeamName: fixture.homeTeamName,
        awayTeamName: fixture.awayTeamName,
        ...buildVietnamHorizonSchedule(fixture.kickoffAt),
      })),
      freshSourceCapture: true,
      productionRoutingChanged: false,
      automaticPromotion: false,
    };

    await saveProviderRun({
      command: 'LIVE_CAPTURE',
      status: 'SUCCESS',
      requestCount,
      insertedFixtures,
      insertedOdds,
      insertedDataSnapshots,
      quotaBefore,
      quotaAfter,
      metadata,
      startedAt,
    });

    return {
      providerVersion: API_FOOTBALL_PROVIDER_VERSION,
      requestCount,
      discoveredFixtures: discoveredFixtures.length,
      trackedFixtures: trackedFixtures.length,
      insertedFixtures,
      normalizedOdds,
      insertedOdds,
      insertedDataSnapshots,
      leagueFilter: leagueIds,
      fixtureFilter: fixtureIds,
      timezone: apiFootballTimezone(),
      leagueProfile: apiFootballLeagueProfile(),
      discoveredLeagues: leagueDiscovery?.discoveredLeagues ?? null,
      selectedLeagues: leagueDiscovery?.selectedLeagues ?? leagueIds.length,
      schedulesVietnam: trackedFixtures.map((fixture) => ({
        providerFixtureId: fixture.providerFixtureId,
        homeTeamName: fixture.homeTeamName,
        awayTeamName: fixture.awayTeamName,
        ...buildVietnamHorizonSchedule(fixture.kickoffAt),
      })),
      quotaAfter,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await saveProviderRun({
      command: 'LIVE_CAPTURE',
      status: 'FAILED',
      requestCount,
      insertedFixtures,
      insertedOdds,
      insertedDataSnapshots,
      quotaBefore,
      quotaAfter,
      metadata: {
        leagueFilter: leagueIds,
        fixtureFilter: fixtureIds,
        leagueProfile: apiFootballLeagueProfile(),
        leagueIds,
      },
      startedAt,
      errorMessage: message,
    });

    throw error;
  }
}

export async function getApiFootballCoverage(): Promise<{
  providerRuns: number;
  successfulRuns: number;
  fixtureSnapshots: number;
  oddsSnapshots: number;
  pitUsableOddsSnapshots: number;
  dataSnapshots: number;
  paperBetDecisions: number;
  paperBestBets: number;
  paperNoBets: number;
  paperSettlements: number;
  latestProviderRun: unknown;
  latestOddsObservedAt: Date | null;
}> {
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
    paperSettlements,
    latestProviderRun,
    latestOdds,
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
  ]);

  return {
    providerRuns,
    successfulRuns,
    fixtureSnapshots,
    oddsSnapshots,
    pitUsableOddsSnapshots,
    dataSnapshots,
    paperBetDecisions,
    paperBestBets,
    paperNoBets,
    paperSettlements,
    latestProviderRun,
    latestOddsObservedAt: latestOdds?.observedAt ?? null,
  };
}

export async function getApiFootballVietnamSchedule(): Promise<{
  timezone: 'Asia/Ho_Chi_Minh';
  leagueProfile: string;
  configuredLeagueIds: number[];
  fixtures: Array<{
    providerFixtureId: number;
    providerLeagueId: number;
    homeTeamName: string;
    awayTeamName: string;
    kickoffUtc: string;
    kickoffVietnam: string;
    t180Vietnam: string;
    t90Vietnam: string;
    t30Vietnam: string;
    t5Vietnam: string;
  }>;
}> {
  const now = new Date();
  const until = new Date(now.getTime() + 3 * 86_400_000);
  const rows = await prisma.apiFootballFixtureSnapshot.findMany({
    where: {
      kickoffAt: {
        gte: now,
        lte: until,
      },
    },
    orderBy: {
      observedAt: 'desc',
    },
    take: 500,
  });
  const latestByFixture = new Map<number, (typeof rows)[number]>();

  for (const row of rows) {
    if (!latestByFixture.has(row.providerFixtureId)) {
      latestByFixture.set(row.providerFixtureId, row);
    }
  }

  const fixtures = [...latestByFixture.values()]
    .sort((left, right) => left.kickoffAt.getTime() - right.kickoffAt.getTime())
    .map((row) => ({
      providerFixtureId: row.providerFixtureId,
      providerLeagueId: row.providerLeagueId,
      homeTeamName: row.homeTeamName,
      awayTeamName: row.awayTeamName,
      kickoffUtc: row.kickoffAt.toISOString(),
      ...buildVietnamHorizonSchedule(row.kickoffAt),
    }));

  return {
    timezone: 'Asia/Ho_Chi_Minh',
    leagueProfile: apiFootballLeagueProfile(),
    configuredLeagueIds: resolveApiFootballLeagueIds(),
    fixtures,
  };
}
