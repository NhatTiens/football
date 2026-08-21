import {
  ApiFootballError,
  type ApiFootballResult,
  type RateLimitInfo,
} from '@football-ai/api-football';
import { prisma, SyncStatus, type InputJsonValue } from '@football-ai/database';

export interface SyncSummary {
  processed: number;
  inserted: number;
  updated: number;
  metadata?: InputJsonValue;
}

// PREDICTION_AI_V7_QUOTA: API-Football resets its daily counters at UTC midnight.
export function quotaDateUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * PREDICTION_AI_V7_QUOTA: persist the latest daily quota so the dashboard and
 * the automatic pipeline's quota-reserve logic see real numbers instead of the
 * 7500/7500 defaults.
 */
export async function syncQuotaFromRateLimit(rateLimit?: RateLimitInfo): Promise<void> {
  if (!rateLimit?.dailyLimit || rateLimit.dailyRemaining == null) return;
  const quotaDate = quotaDateUtc();
  const used = Math.max(0, rateLimit.dailyLimit - rateLimit.dailyRemaining);
  await prisma.apiQuotaDaily.upsert({
    where: { quotaDate },
    update: {
      dailyLimit: rateLimit.dailyLimit,
      used,
      remaining: rateLimit.dailyRemaining,
    },
    create: {
      quotaDate,
      dailyLimit: rateLimit.dailyLimit,
      used,
      remaining: rateLimit.dailyRemaining,
    },
  });
}

export async function trackApiResult<T>(
  endpoint: string,
  result: ApiFootballResult<T>,
): Promise<void> {
  await prisma.apiUsage.create({
    data: {
      endpoint,
      responseStatus: result.status,
      dailyLimit: result.rateLimit.dailyLimit,
      dailyRemaining: result.rateLimit.dailyRemaining,
      minuteLimit: result.rateLimit.minuteLimit,
      minuteRemaining: result.rateLimit.minuteRemaining,
      durationMs: result.durationMs,
    },
  });
  await syncQuotaFromRateLimit(result.rateLimit);
}

/**
 * PREDICTION_AI_V7_QUOTA: record failed API calls too (e.g. daily request
 * limit reached) so ApiUsage / ApiQuotaDaily stay accurate and the UI shows
 * the real remaining quota instead of the default 7500.
 */
export async function trackApiFailure(endpoint: string, error: unknown): Promise<void> {
  if (!(error instanceof ApiFootballError)) return;
  await prisma.apiUsage.create({
    data: {
      endpoint,
      responseStatus: error.status,
      dailyLimit: error.rateLimit?.dailyLimit,
      dailyRemaining: error.rateLimit?.dailyRemaining,
      minuteLimit: error.rateLimit?.minuteLimit,
      minuteRemaining: error.rateLimit?.minuteRemaining,
      errorMessage: error.message,
    },
  });
  await syncQuotaFromRateLimit(error.rateLimit);
}

export interface ApiQuotaSnapshot {
  dailyLimit: number;
  used: number;
  remaining: number;
}

/**
 * PREDICTION_AI_V7_QUOTA: current daily quota snapshot from ApiQuotaDaily,
 * falling back to today's ApiUsage rows when no quota row exists yet.
 * Returns null when unknown (e.g. brand-new database) — callers treat null
 * as "no constraint" so the first sync can still bootstrap data.
 */
export async function getApiQuotaSnapshot(now = new Date()): Promise<ApiQuotaSnapshot | null> {
  try {
    const row = await prisma.apiQuotaDaily.findUnique({
      where: { quotaDate: quotaDateUtc(now) },
    });
    if (row) {
      return { dailyLimit: row.dailyLimit, used: row.used, remaining: row.remaining };
    }
  } catch {
    // fall through to usage aggregation
  }
  try {
    const todayStart = new Date(`${quotaDateUtc(now)}T00:00:00.000Z`);
    const usages = await prisma.apiUsage.findMany({
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

/** PREDICTION_AI_V7_QUOTA: minimum remaining requests before a job backs off. */
export function apiQuotaReserveFromEnvironment(fallback = 250): number {
  const parsed = Number(process.env.API_QUOTA_MIN_RESERVE);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

/**
 * PREDICTION_AI_V7_QUOTA: whether it is safe to spend API requests right now.
 * When the remaining daily quota is at or below the reserve, jobs that can
 * wait (odds refresh, predictions, lineups, fixtures) should skip and leave
 * the quota for jobs that cannot (settlement, live capture).
 */
export async function apiQuotaAllowsRequest(
  minimumRemaining = apiQuotaReserveFromEnvironment(),
): Promise<boolean> {
  const snapshot = await getApiQuotaSnapshot();
  if (!snapshot) return true;
  return snapshot.remaining > minimumRemaining;
}

export async function runTrackedSync(
  jobName: string,
  callback: () => Promise<SyncSummary>,
): Promise<SyncSummary> {
  const run = await prisma.syncRun.create({
    data: { jobName, status: SyncStatus.RUNNING },
  });

  try {
    const summary = await callback();
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncStatus.SUCCESS,
        finishedAt: new Date(),
        processed: summary.processed,
        inserted: summary.inserted,
        updated: summary.updated,
        metadata: summary.metadata,
      },
    });
    return summary;
  } catch (error) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: SyncStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    // PREDICTION_AI_V7_QUOTA: keep quota tracking accurate on API failures.
    await trackApiFailure(jobName, error);
    throw error;
  }
}
