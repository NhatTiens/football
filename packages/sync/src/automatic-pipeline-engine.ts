import { randomUUID } from 'node:crypto';

import { prisma } from '@football-ai/database';

import {
  AUTOMATIC_PIPELINE_VERSION,
  automaticQuotaState,
  fixtureDiscoveryIntervalMinutes,
  forceScopeIncludes,
  normalizeForceScope,
  predictionRetryDelayMinutes,
  priorityReserveFloor,
  shouldRunAutomaticPhase,
  type ApiFootballPriority,
  type AutomaticForceScope,
} from './automatic-pipeline-core.js';
import {
  discoverCurrentPriorityCompetitions,
  isDemoCompetitionName,
  type CurrentCompetition,
} from './current-competition-discovery.js';
import {
  collectFreshOddsDue,
  discoverFreshOddsFixtures,
  planFreshOddsCheckpoints,
} from './fresh-odds-collector-engine.js';
import { syncFixtures } from './fixtures.js';
import { runPaperBetOperationsCycle } from './paper-bet-operations-engine.js';
import { syncPredictions } from './predictions.js';
import { syncRepeatedFixtureContext } from './repeated-context.js';

const db = prisma as any;
const DAY_MS = 86_400_000;
const LEASE_KEY = 'automation.pipeline.lease';
const STATUS_KEY = 'automation.pipeline.status';
const DISCOVERY_STATE_KEY = 'automation.fixture-discovery.state';
const COMPETITION_STATE_KEY = 'automation.current-competitions';
const FORCE_REQUEST_KEY = 'automation.force-sync.request';
const WORKER_HEARTBEAT_KEY = 'automation.worker.heartbeat';
const REALTIME_HEARTBEAT_KEY = 'automation.realtime.heartbeat';
const FRESH_DISCOVERY_STATE_KEY = 'automation.fresh-provider-discovery.state';
const PREDICTION_RETRY_STATE_KEY = 'automation.prediction-retry.state';

interface JsonRecord {
  [key: string]: unknown;
}

interface ForceRequest extends JsonRecord {
  requestId: string;
  status: 'PENDING' | 'COMPLETED';
  scope: AutomaticForceScope;
  requestedAt: string;
  requestedBy: string;
  sourceIp: string | null;
  userAgent: string | null;
}

interface PipelineLease extends JsonRecord {
  token: string;
  lockedUntil: string;
  owner: string;
}

interface AutomaticRunOptions {
  now?: Date;
  force?: boolean;
  scope?: AutomaticForceScope;
  reason?: string;
}

interface ForceSyncRequestInput {
  scope?: AutomaticForceScope;
  requestedBy: string;
  sourceIp?: string | null;
  userAgent?: string | null;
}

function asRecord(value: unknown): JsonRecord {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  return {};
}

function dateFromRecord(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return raw.trim().toLowerCase() !== 'false';
}

function quotaDateUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function getSetting(key: string): Promise<JsonRecord | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row ? asRecord(row.value) : null;
}

async function putSetting(key: string, value: JsonRecord): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function acquireLease(now: Date): Promise<string | null> {
  const token = randomUUID();
  const ttlSeconds = integerEnv('AUTOMATIC_PIPELINE_LEASE_TTL_SECONDS', 900, 120, 3_600);
  const lockedUntil = new Date(now.getTime() + ttlSeconds * 1_000);
  const owner = `${process.pid}:${process.env.HOSTNAME ?? 'worker'}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await db.appSetting.findUnique({ where: { key: LEASE_KEY } });
    if (!existing) {
      try {
        await db.appSetting.create({
          data: {
            key: LEASE_KEY,
            value: { token, lockedUntil: lockedUntil.toISOString(), owner },
          },
        });
        return token;
      } catch {
        continue;
      }
    }

    const lease = asRecord(existing.value) as PipelineLease;
    const currentExpiry = dateFromRecord(lease.lockedUntil);
    if (currentExpiry && currentExpiry.getTime() > now.getTime()) return null;

    const claim = await db.appSetting.updateMany({
      where: { key: LEASE_KEY, updatedAt: existing.updatedAt },
      data: { value: { token, lockedUntil: lockedUntil.toISOString(), owner } },
    });
    if (claim.count === 1) return token;
  }
  return null;
}

async function releaseLease(token: string): Promise<void> {
  const existing = await db.appSetting.findUnique({ where: { key: LEASE_KEY } });
  if (!existing) return;
  const lease = asRecord(existing.value) as PipelineLease;
  if (lease.token !== token) return;
  await db.appSetting.update({
    where: { key: LEASE_KEY },
    data: {
      value: {
        ...lease,
        token: '',
        lockedUntil: new Date(0).toISOString(),
        releasedAt: new Date().toISOString(),
      },
    },
  });
}

async function renewLease(token: string, now = new Date()): Promise<void> {
  const existing = await db.appSetting.findUnique({ where: { key: LEASE_KEY } });
  if (!existing) throw new Error('AUTOMATIC_PIPELINE_LEASE_MISSING');
  const lease = asRecord(existing.value) as PipelineLease;
  if (lease.token !== token) throw new Error('AUTOMATIC_PIPELINE_LEASE_LOST');
  const ttlSeconds = integerEnv('AUTOMATIC_PIPELINE_LEASE_TTL_SECONDS', 900, 120, 3_600);
  const updated = await db.appSetting.updateMany({
    where: { key: LEASE_KEY, updatedAt: existing.updatedAt },
    data: {
      value: {
        ...lease,
        lockedUntil: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
        renewedAt: now.toISOString(),
      },
    },
  });
  if (updated.count !== 1) throw new Error('AUTOMATIC_PIPELINE_LEASE_RENEW_CONFLICT');
}

async function withProviderPriority<T>(priority: ApiFootballPriority, callback: () => Promise<T>): Promise<T> {
  const previous = process.env.API_FOOTBALL_PRIORITY_CONTEXT;
  process.env.API_FOOTBALL_PRIORITY_CONTEXT = priority;
  try {
    return await callback();
  } finally {
    if (previous == null) delete process.env.API_FOOTBALL_PRIORITY_CONTEXT;
    else process.env.API_FOOTBALL_PRIORITY_CONTEXT = previous;
  }
}

async function emitRealtime(event: string, aggregateId: string, payload: JsonRecord = {}): Promise<void> {
  await db.realtimeOutbox.create({
    data: {
      eventType: event,
      aggregateId,
      payload: {
        event,
        type: event,
        version: 1,
        occurredAt: new Date().toISOString(),
        ...payload,
      },
    },
  });
}

async function latestQuota(now: Date): Promise<{ dailyLimit: number; used: number; remaining: number } | null> {
  try {
    const row = await db.apiQuotaDaily.findUnique({ where: { quotaDate: quotaDateUtc(now) } });
    if (row) return row;
  } catch {
    // fall through to usage aggregation
  }
  // PREDICTION_AI_V7_QUOTA: if no ApiQuotaDaily row exists yet (older data),
  // derive the quota from today's ApiUsage rows so the dashboard shows real
  // numbers instead of the 7500 default.
  try {
    const todayStart = new Date(`${quotaDateUtc(now)}T00:00:00.000Z`);
    const usages = await db.apiUsage.findMany({
      where: { requestDate: { gte: todayStart } },
      select: { dailyLimit: true, dailyRemaining: true },
      orderBy: { id: 'desc' },
      take: 100,
    });
    const latest = usages.find(
      (usage: { dailyLimit: number | null; dailyRemaining: number | null }) =>
        usage.dailyLimit != null && usage.dailyRemaining != null,
    );
    if (latest?.dailyLimit != null && latest.dailyRemaining != null) {
      return {
        dailyLimit: latest.dailyLimit,
        used: Math.max(0, latest.dailyLimit - latest.dailyRemaining),
        remaining: latest.dailyRemaining,
      };
    }
  } catch {
    // ignore aggregation errors
  }
  return null;
}

function quotaStateFromRow(
  row: { dailyLimit: number; used: number; remaining: number } | null,
) {
  return automaticQuotaState({
    limit: row?.dailyLimit ?? 7500,
    used: row?.used ?? 0,
    remaining: row?.remaining ?? 7500,
  });
}

async function nearestUpcomingKickoff(now: Date): Promise<Date | null> {
  const row = await db.fixture.findFirst({
    where: { status: 'UPCOMING', kickoffAt: { gt: now } },
    select: { kickoffAt: true },
    orderBy: { kickoffAt: 'asc' },
  });
  return row?.kickoffAt ?? null;
}

async function readForceRequest(): Promise<ForceRequest | null> {
  const value = await getSetting(FORCE_REQUEST_KEY);
  if (!value || value.status !== 'PENDING' || typeof value.requestId !== 'string') return null;
  return {
    ...value,
    requestId: value.requestId,
    status: 'PENDING',
    scope: normalizeForceScope(value.scope),
    requestedAt: typeof value.requestedAt === 'string' ? value.requestedAt : new Date(0).toISOString(),
    requestedBy: typeof value.requestedBy === 'string' ? value.requestedBy : 'unknown',
    sourceIp: typeof value.sourceIp === 'string' ? value.sourceIp : null,
    userAgent: typeof value.userAgent === 'string' ? value.userAgent : null,
  };
}

async function markForceRequestCompleted(request: ForceRequest, finishedAt: Date): Promise<void> {
  await putSetting(FORCE_REQUEST_KEY, {
    ...request,
    status: 'COMPLETED',
    completedAt: finishedAt.toISOString(),
  });
}

function normalizeStoredCompetitions(value: unknown): CurrentCompetition[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): CurrentCompetition | null => {
      const row = asRecord(entry);
      const apiLeagueId = Number(row.apiLeagueId);
      const season = Number(row.season);
      const name = typeof row.name === 'string' ? row.name : '';
      if (!Number.isInteger(apiLeagueId) || apiLeagueId <= 0 || !Number.isInteger(season) || season <= 0 || !name) {
        return null;
      }
      return { apiLeagueId, season, name } as CurrentCompetition;
    })
    .filter((entry): entry is CurrentCompetition => entry != null);
}

async function resolveCurrentCompetitions(now: Date, forced: boolean): Promise<{
  competitions: CurrentCompetition[];
  source: 'CACHE' | 'PROVIDER' | 'STALE_CACHE_FALLBACK';
}> {
  const state = await getSetting(COMPETITION_STATE_KEY);
  const cached = normalizeStoredCompetitions(state?.competitions);
  const lastDiscovery = dateFromRecord(state?.providerDiscoveredAt ?? state?.updatedAt);
  const refreshMinutes = integerEnv('AUTOMATIC_COMPETITION_DISCOVERY_INTERVAL_MINUTES', 720, 60, 1_440);
  const cacheFresh =
    !forced &&
    cached.length > 0 &&
    lastDiscovery != null &&
    now.getTime() - lastDiscovery.getTime() < refreshMinutes * 60_000;

  if (cacheFresh) return { competitions: cached, source: 'CACHE' };

  try {
    const discovery = await withProviderPriority('NORMAL', () =>
      discoverCurrentPriorityCompetitions({ maximumSea: 8, maximumAsia: 8 }),
    );
    if (discovery.competitions.length === 0) throw new Error('NO_CURRENT_PRIORITY_COMPETITIONS_FOUND');
    await putSetting(COMPETITION_STATE_KEY, {
      updatedAt: now.toISOString(),
      providerDiscoveredAt: now.toISOString(),
      refreshMinutes,
      competitions: discovery.competitions.map((competition: CurrentCompetition) => ({
        apiLeagueId: competition.apiLeagueId,
        season: competition.season,
        name: competition.name,
      })),
    });
    return { competitions: discovery.competitions, source: 'PROVIDER' };
  } catch (error) {
    if (cached.length > 0) {
      return { competitions: cached, source: 'STALE_CACHE_FALLBACK' };
    }
    throw error;
  }
}

async function runFreshProviderDiscoveryIfDue(input: {
  now: Date;
  forced: boolean;
  providerLeagueIds: string;
  localInserted: number;
}): Promise<JsonRecord> {
  const state = await getSetting(FRESH_DISCOVERY_STATE_KEY);
  const lastSuccess = dateFromRecord(state?.lastSuccessAt);
  const nextRetryAt = dateFromRecord(state?.nextRetryAt);
  const intervalMinutes = integerEnv('AUTOMATIC_FRESH_DISCOVERY_INTERVAL_MINUTES', 360, 60, 1_440);
  if (!input.forced && input.localInserted === 0 && nextRetryAt && nextRetryAt.getTime() > input.now.getTime()) {
    return { status: 'SKIPPED_BACKOFF', nextRetryAt: nextRetryAt.toISOString() };
  }
  const due = shouldRunAutomaticPhase({
    nowMs: input.now.getTime(),
    lastSuccessMs: lastSuccess?.getTime() ?? null,
    minimumIntervalMinutes: intervalMinutes,
    forced: input.forced || input.localInserted > 0,
  });
  if (!due) {
    return {
      status: 'SKIPPED_NOT_DUE',
      intervalMinutes,
      lastSuccessAt: lastSuccess?.toISOString() ?? null,
    };
  }

  const previousFreshLeagueIds = process.env.FRESH_ODDS_LEAGUE_IDS;
  try {
    process.env.FRESH_ODDS_LEAGUE_IDS = input.providerLeagueIds;
    try {
      const result = await withProviderPriority('NORMAL', () => discoverFreshOddsFixtures());
      const finishedAt = new Date();
      await putSetting(FRESH_DISCOVERY_STATE_KEY, {
        lastSuccessAt: finishedAt.toISOString(),
        intervalMinutes,
        trigger: input.localInserted > 0 ? 'NEW_LOCAL_FIXTURES' : input.forced ? 'FORCED' : 'CADENCE',
      });
      return { status: 'SUCCESS', intervalMinutes, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retryMinutes = integerEnv('AUTOMATIC_FRESH_DISCOVERY_ERROR_RETRY_MINUTES', 30, 5, 180);
      const retryAt = new Date(input.now.getTime() + retryMinutes * 60_000);
      await putSetting(FRESH_DISCOVERY_STATE_KEY, {
        ...(state ?? {}),
        lastErrorAt: new Date().toISOString(),
        nextRetryAt: retryAt.toISOString(),
        error: message.slice(0, 1000),
      });
      return { status: 'ERROR_RETRY_SCHEDULED', retryMinutes, nextRetryAt: retryAt.toISOString() };
    }
  } finally {
    if (previousFreshLeagueIds == null) delete process.env.FRESH_ODDS_LEAGUE_IDS;
    else process.env.FRESH_ODDS_LEAGUE_IDS = previousFreshLeagueIds;
  }
}

async function runFixtureDiscovery(now: Date, forced: boolean): Promise<JsonRecord> {
  const quota = await latestQuota(now);
  const quotaState = quotaStateFromRow(quota);
  if (quotaState.remaining <= priorityReserveFloor('HIGH')) {
    return { status: 'SKIPPED_QUOTA_RESERVE', quota: quotaState };
  }
  const nearestKickoff = await nearestUpcomingKickoff(now);
  const nearestMinutes = nearestKickoff == null ? null : Math.max(0, (nearestKickoff.getTime() - now.getTime()) / 60_000);
  const cadence = fixtureDiscoveryIntervalMinutes({
    nearestKickoffMinutes: nearestMinutes,
    quotaRemaining: quota?.remaining ?? null,
    quotaLimit: quota?.dailyLimit ?? 7500,
  });
  const state = await getSetting(DISCOVERY_STATE_KEY);
  const lastSuccess = dateFromRecord(state?.lastSuccessAt);
  const nextRetryAt = dateFromRecord(state?.nextRetryAt);
  if (!forced && nextRetryAt && nextRetryAt.getTime() > now.getTime()) {
    return { status: 'SKIPPED_BACKOFF', nextRetryAt: nextRetryAt.toISOString(), cadenceMinutes: cadence };
  }
  const due = shouldRunAutomaticPhase({
    nowMs: now.getTime(),
    lastSuccessMs: lastSuccess?.getTime() ?? null,
    minimumIntervalMinutes: cadence,
    forced,
  });
  if (!due) {
    return { status: 'SKIPPED_NOT_DUE', cadenceMinutes: cadence, lastSuccessAt: lastSuccess?.toISOString() ?? null };
  }

  const syncRun = await db.syncRun.create({ data: { jobName: 'automatic-fixture-sync', status: 'RUNNING' } });
  try {
    const days = integerEnv('AUTOMATIC_FIXTURE_WINDOW_DAYS', 14, 2, 30);
    const to = new Date(now.getTime() + days * DAY_MS);
    const competitionState = await resolveCurrentCompetitions(now, forced);
    const configurations = competitionState.competitions.map((competition: CurrentCompetition) => ({
      leagueId: competition.apiLeagueId,
      season: competition.season,
    }));
    const fixtureSync = await withProviderPriority('HIGH', () =>
      syncFixtures({
        from: now.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        leagueConfigurations: configurations,
      }),
    );

    const providerLeagueIds = competitionState.competitions
      .map((competition: CurrentCompetition) => competition.apiLeagueId)
      .join(',');
    const localInserted = Number((fixtureSync as { inserted?: number }).inserted ?? 0);
    const freshDiscovery = await runFreshProviderDiscoveryIfDue({
      now,
      forced,
      providerLeagueIds,
      localInserted,
    });

    const newFixtures = await db.fixture.findMany({
      where: { createdAt: { gte: syncRun.startedAt }, kickoffAt: { gt: now } },
      select: { apiFixtureId: true },
      take: 200,
    });
    for (const fixture of newFixtures) {
      await emitRealtime('FIXTURE_CREATED', String(fixture.apiFixtureId), {
        fixtureId: String(fixture.apiFixtureId),
      });
    }
    await emitRealtime('FIXTURE_UPDATED', 'batch', { source: 'automatic-fixture-sync' });

    const finishedAt = new Date();
    await putSetting(DISCOVERY_STATE_KEY, {
      lastSuccessAt: finishedAt.toISOString(),
      cadenceMinutes: cadence,
      nearestKickoffAt: nearestKickoff?.toISOString() ?? null,
      nextRetryAt: null,
      error: null,
    });
    await db.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'SUCCESS',
        finishedAt,
        processed: newFixtures.length,
        metadata: { automatic: true, cadenceMinutes: cadence, competitionSource: competitionState.source, fixtureSync, freshDiscovery },
      },
    });
    return { status: 'SUCCESS', cadenceMinutes: cadence, competitionSource: competitionState.source, createdFixtures: newFixtures.length, fixtureSync, freshDiscovery };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryMinutes = integerEnv('AUTOMATIC_FIXTURE_ERROR_RETRY_MINUTES', 15, 5, 120);
    const retryAt = new Date(now.getTime() + retryMinutes * 60_000);
    await putSetting(DISCOVERY_STATE_KEY, {
      ...(state ?? {}),
      lastErrorAt: new Date().toISOString(),
      nextRetryAt: retryAt.toISOString(),
      error: message.slice(0, 1000),
    });
    await db.syncRun.update({
      where: { id: syncRun.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message.slice(0, 4000) },
    });
    throw error;
  }
}

function predictionRetryEntry(value: unknown): { attempts: number; nextRetryAt: Date | null } {
  const row = asRecord(value);
  return {
    attempts: Number.isInteger(Number(row.attempts)) ? Math.max(0, Number(row.attempts)) : 0,
    nextRetryAt: dateFromRecord(row.nextRetryAt),
  };
}

async function savePredictionRetryState(state: JsonRecord): Promise<void> {
  const cutoff = Date.now() - 7 * DAY_MS;
  for (const [key, value] of Object.entries(state)) {
    const retry = predictionRetryEntry(value);
    if (retry.nextRetryAt && retry.nextRetryAt.getTime() < cutoff) delete state[key];
  }
  await putSetting(PREDICTION_RETRY_STATE_KEY, state);
}

async function runPredictionQueue(now: Date): Promise<JsonRecord> {
  const quotaState = quotaStateFromRow(await latestQuota(now));
  if (quotaState.remaining <= priorityReserveFloor('HIGH')) {
    return { status: 'SKIPPED_QUOTA_RESERVE', quota: quotaState };
  }

  const syncRun = await db.syncRun.create({ data: { jobName: 'automatic-prediction-sync', status: 'RUNNING' } });
  const retryState = (await getSetting(PREDICTION_RETRY_STATE_KEY)) ?? {};
  let attempted: any[] = [];
  try {
    const horizonDays = integerEnv('AUTOMATIC_PREDICTION_WINDOW_DAYS', 14, 1, 30);
    const batchSize = integerEnv('AUTOMATIC_PREDICTION_BATCH_SIZE', 24, 1, 100);
    const fixtures = await db.fixture.findMany({
      where: {
        status: 'UPCOMING',
        kickoffAt: { gt: now, lte: new Date(now.getTime() + horizonDays * DAY_MS) },
        externalPrediction: { is: null },
        league: { enabled: true },
      },
      select: { id: true, apiFixtureId: true, kickoffAt: true, league: { select: { name: true } } },
      orderBy: { kickoffAt: 'asc' },
      take: Math.min(500, batchSize * 5),
    });
    const eligible = fixtures.filter((fixture: any) => !isDemoCompetitionName(String(fixture.league?.name ?? '')));
    attempted = eligible
      .filter((fixture: any) => {
        const retry = predictionRetryEntry(retryState[String(fixture.id)]);
        return retry.nextRetryAt == null || retry.nextRetryAt.getTime() <= now.getTime();
      })
      .slice(0, batchSize);

    if (attempted.length === 0) {
      await db.syncRun.update({
        where: { id: syncRun.id },
        data: {
          status: 'SUCCESS',
          finishedAt: new Date(),
          processed: 0,
          metadata: { automatic: true, queueEmpty: eligible.length === 0, waitingRetry: eligible.length > 0 },
        },
      });
      return { status: eligible.length === 0 ? 'QUEUE_EMPTY' : 'WAITING_RETRY', processed: 0 };
    }

    const result = await withProviderPriority('HIGH', () =>
      syncPredictions({ fixtureIds: attempted.map((fixture: any) => fixture.id) }),
    );
    const completed = await db.fixture.findMany({
      where: { id: { in: attempted.map((fixture: any) => fixture.id) }, externalPrediction: { isNot: null } },
      select: { id: true, apiFixtureId: true },
    });
    const completedIds = new Set<number>(completed.map((fixture: any) => Number(fixture.id)));
    for (const fixture of attempted) {
      const key = String(fixture.id);
      if (completedIds.has(Number(fixture.id))) {
        delete retryState[key];
        continue;
      }
      const previous = predictionRetryEntry(retryState[key]);
      const attempts = previous.attempts + 1;
      const delayMinutes = predictionRetryDelayMinutes(attempts);
      retryState[key] = {
        attempts,
        nextRetryAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
        providerFixtureId: fixture.apiFixtureId,
        lastAttemptAt: now.toISOString(),
        reason: 'PROVIDER_PREDICTION_NOT_AVAILABLE',
      };
    }
    await savePredictionRetryState(retryState);

    for (const fixture of completed) {
      await emitRealtime('PREDICTION_CREATED', String(fixture.apiFixtureId), {
        fixtureId: String(fixture.apiFixtureId),
      });
    }

    await db.syncRun.update({
      where: { id: syncRun.id },
      data: {
        status: 'SUCCESS',
        finishedAt: new Date(),
        processed: attempted.length,
        updated: completed.length,
        metadata: { automatic: true, result },
      },
    });
    return { status: 'SUCCESS', requested: attempted.length, completed: completed.length, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const fixture of attempted) {
      const key = String(fixture.id);
      const previous = predictionRetryEntry(retryState[key]);
      const attempts = previous.attempts + 1;
      const delayMinutes = predictionRetryDelayMinutes(attempts);
      retryState[key] = {
        attempts,
        nextRetryAt: new Date(now.getTime() + delayMinutes * 60_000).toISOString(),
        providerFixtureId: fixture.apiFixtureId,
        lastAttemptAt: now.toISOString(),
        error: message.slice(0, 1000),
      };
    }
    if (attempted.length > 0) await savePredictionRetryState(retryState);
    await db.syncRun.update({
      where: { id: syncRun.id },
      data: { status: 'FAILED', finishedAt: new Date(), errorMessage: message.slice(0, 4000) },
    });
    throw error;
  }
}

async function runContextAndOdds(
  now: Date,
  scope: AutomaticForceScope,
  quota: ReturnType<typeof automaticQuotaState>,
): Promise<JsonRecord> {
  const result: JsonRecord = {};
  const wantsContext = scope === 'FULL' || forceScopeIncludes(scope, 'CONTEXT');
  const wantsOdds = scope === 'FULL' || forceScopeIncludes(scope, 'ODDS');

  if (wantsContext) {
    result.context =
      quota.pressure === 'CRITICAL'
        ? { status: 'SKIPPED_QUOTA_CRITICAL' }
        : await withProviderPriority('NORMAL', () => syncRepeatedFixtureContext({ now }));
  }
  if (wantsOdds) {
    result.freshPlan = await planFreshOddsCheckpoints(now);
    result.freshCollect =
      quota.pressure === 'CRITICAL'
        ? { status: 'SKIPPED_QUOTA_CRITICAL' }
        : await withProviderPriority('NORMAL', () => collectFreshOddsDue(now));
  }
  return result;
}

export async function queueAutomaticForceSync(input: ForceSyncRequestInput): Promise<JsonRecord> {
  const now = new Date();
  const existing = await readForceRequest();
  if (existing) {
    return { accepted: true, background: true, alreadyPending: true, ...existing };
  }
  const request: ForceRequest = {
    requestId: randomUUID(),
    status: 'PENDING',
    scope: normalizeForceScope(input.scope),
    requestedAt: now.toISOString(),
    requestedBy: input.requestedBy,
    sourceIp: input.sourceIp ?? null,
    userAgent: input.userAgent ?? null,
  };
  await putSetting(FORCE_REQUEST_KEY, request);
  await db.syncRun.create({
    data: {
      jobName: 'admin-force-sync-request',
      status: 'SUCCESS',
      finishedAt: now,
      metadata: request,
    },
  });
  return { accepted: true, background: true, ...request };
}

async function updateRunningPhase(input: {
  runId: string;
  startedAt: Date;
  scope: AutomaticForceScope;
  forced: boolean;
  phase: 'STARTING' | 'FIXTURES' | 'PREDICTIONS' | 'CONTEXT_ODDS' | 'PAPER';
  reason?: string;
}): Promise<void> {
  await putSetting(STATUS_KEY, {
    version: AUTOMATIC_PIPELINE_VERSION,
    status: 'RUNNING',
    runId: input.runId,
    startedAt: input.startedAt.toISOString(),
    scope: input.scope,
    forced: input.forced,
    phase: input.phase,
    ...(input.reason ? { reason: input.reason } : {}),
  });
  await putSetting(WORKER_HEARTBEAT_KEY, {
    status: 'RUNNING',
    runId: input.runId,
    startedAt: input.startedAt.toISOString(),
    heartbeatAt: new Date().toISOString(),
    scope: input.scope,
    phase: input.phase,
  });
}

export async function runAutomaticPipelineCycle(options: AutomaticRunOptions = {}): Promise<JsonRecord> {
  if (!booleanEnv('AUTOMATIC_PIPELINE_ENABLED', true)) return { status: 'DISABLED' };

  const now = options.now ?? new Date();
  const leaseToken = await acquireLease(now);
  if (!leaseToken) return { status: 'SKIPPED_LOCKED' };

  const startedAt = new Date();
  const forceRequest = await readForceRequest();
  const forced = options.force === true || forceRequest != null;
  const scope = options.scope ?? forceRequest?.scope ?? 'FULL';
  const runId = randomUUID();

  await updateRunningPhase({
    runId,
    startedAt,
    scope,
    forced,
    phase: 'STARTING',
    reason: options.reason ?? (forceRequest ? 'ADMIN_FORCE_SYNC' : 'SCHEDULED'),
  });

  try {
    const quotaSnapshot = quotaStateFromRow(await latestQuota(now));
    const phases: JsonRecord = {};

    if (scope === 'FULL' || forceScopeIncludes(scope, 'FIXTURES')) {
      await updateRunningPhase({ runId, startedAt, scope, forced, phase: 'FIXTURES' });
      phases.fixtures = await runFixtureDiscovery(now, forced);
      await renewLease(leaseToken);
    }
    if (scope === 'FULL' || forceScopeIncludes(scope, 'PREDICTIONS')) {
      await updateRunningPhase({ runId, startedAt, scope, forced, phase: 'PREDICTIONS' });
      phases.predictions = await runPredictionQueue(now);
      await renewLease(leaseToken);
    }
    await updateRunningPhase({ runId, startedAt, scope, forced, phase: 'CONTEXT_ODDS' });
    Object.assign(phases, await runContextAndOdds(now, scope, quotaSnapshot));
    await renewLease(leaseToken);

    // This operation is DB/checkpoint driven and does not wait on a user HTTP request.
    if (scope === 'FULL') {
      await updateRunningPhase({ runId, startedAt, scope, forced, phase: 'PAPER' });
      phases.paper = await runPaperBetOperationsCycle({ now });
      await renewLease(leaseToken);
    }

    const finishedAt = new Date();
    if (forceRequest) await markForceRequestCompleted(forceRequest, finishedAt);
    await emitRealtime('DATA_SYNC_COMPLETED', runId, {
      runId,
      scope,
      forced,
      finishedAt: finishedAt.toISOString(),
    });
    await putSetting(STATUS_KEY, {
      version: AUTOMATIC_PIPELINE_VERSION,
      status: 'SUCCESS',
      runId,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      lastSuccessAt: finishedAt.toISOString(),
      scope,
      forced,
      quota: quotaSnapshot,
      phases,
    });
    await putSetting(WORKER_HEARTBEAT_KEY, {
      status: 'IDLE',
      runId,
      heartbeatAt: finishedAt.toISOString(),
      lastSuccessAt: finishedAt.toISOString(),
    });
    return { status: 'SUCCESS', runId, scope, forced, quota: quotaSnapshot, phases };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedAt = new Date();
    await putSetting(STATUS_KEY, {
      version: AUTOMATIC_PIPELINE_VERSION,
      status: 'ERROR',
      runId,
      startedAt: startedAt.toISOString(),
      failedAt: failedAt.toISOString(),
      scope,
      forced,
      error: message.slice(0, 2000),
    });
    await putSetting(WORKER_HEARTBEAT_KEY, {
      status: 'ERROR',
      runId,
      heartbeatAt: failedAt.toISOString(),
      error: message.slice(0, 1000),
    });
    throw error;
  } finally {
    await releaseLease(leaseToken);
  }
}

export async function recordRealtimeHeartbeat(input: { clients: number; now?: Date }): Promise<void> {
  const now = input.now ?? new Date();
  await putSetting(REALTIME_HEARTBEAT_KEY, {
    status: 'RUNNING',
    clients: Math.max(0, Math.trunc(input.clients)),
    heartbeatAt: now.toISOString(),
  });
}

export async function getAutomaticPipelineStatus(options: { includeAdminDetails?: boolean } = {}): Promise<JsonRecord> {
  const now = new Date();
  const todayStart = new Date(`${quotaDateUtc(now)}T00:00:00.000Z`);
  const yesterday = new Date(now.getTime() - DAY_MS);
  const [status, worker, realtime, forceRequest, quota, fixtureSync, predictionSync, lastResult, predictionQueue, resultPending, resultProcessing, resultFailed, apiErrors, failedJobs] =
    await Promise.all([
      getSetting(STATUS_KEY),
      getSetting(WORKER_HEARTBEAT_KEY),
      getSetting(REALTIME_HEARTBEAT_KEY),
      getSetting(FORCE_REQUEST_KEY),
      latestQuota(now),
      db.syncRun.findFirst({ where: { jobName: 'automatic-fixture-sync', status: 'SUCCESS' }, orderBy: { finishedAt: 'desc' } }),
      db.syncRun.findFirst({ where: { jobName: 'automatic-prediction-sync', status: 'SUCCESS' }, orderBy: { finishedAt: 'desc' } }),
      db.resultUpdateJob.findFirst({ where: { status: 'COMPLETED' }, orderBy: { completedAt: 'desc' }, select: { completedAt: true } }),
      db.fixture.count({ where: { status: 'UPCOMING', kickoffAt: { gt: now }, externalPrediction: { is: null } } }),
      db.resultUpdateJob.count({ where: { status: { in: ['PENDING', 'RETRY'] } } }),
      db.resultUpdateJob.count({ where: { status: 'PROCESSING' } }),
      db.resultUpdateJob.count({ where: { status: 'FAILED' } }),
      db.apiUsage.count({ where: { requestDate: { gte: todayStart }, errorMessage: { not: null } } }),
      db.syncRun.count({ where: { status: 'FAILED', startedAt: { gte: yesterday } } }),
    ]);

  const quotaState = quotaStateFromRow(quota);
  const response: JsonRecord = {
    version: AUTOMATIC_PIPELINE_VERSION,
    status: status?.status ?? 'STARTING',
    automatic: true,
    lastUpdated: status?.finishedAt ?? status?.lastSuccessAt ?? status?.startedAt ?? null,
    lastSuccessfulFixtureSync: fixtureSync?.finishedAt?.toISOString?.() ?? null,
    lastSuccessfulPredictionSync: predictionSync?.finishedAt?.toISOString?.() ?? null,
    lastSuccessfulResultSync: lastResult?.completedAt?.toISOString?.() ?? null,
    apiQuota: quotaState,
    apiErrorsToday: apiErrors,
    predictionQueue: { pending: predictionQueue },
    resultQueue: { pending: resultPending, processing: resultProcessing, failed: resultFailed },
    failedJobs24h: failedJobs,
    worker: worker ?? { status: 'STARTING' },
    scheduler: status ?? { status: 'STARTING' },
    realtime: realtime ?? { status: 'STARTING', clients: 0 },
    forceSyncPending: forceRequest?.status === 'PENDING',
  };

  if (options.includeAdminDetails) {
    response.forceRequest = forceRequest;
    response.pipelineDetails = status;
  }
  return response;
}
