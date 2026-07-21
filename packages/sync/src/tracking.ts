import type { ApiFootballResult } from '@football-ai/api-football';
import { prisma, SyncStatus, type InputJsonValue } from '@football-ai/database';

export interface SyncSummary {
  processed: number;
  inserted: number;
  updated: number;
  metadata?: InputJsonValue;
}

export async function trackApiResult<T>(endpoint: string, result: ApiFootballResult<T>): Promise<void> {
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
    throw error;
  }
}
