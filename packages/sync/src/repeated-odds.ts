import { randomUUID } from 'node:crypto';

import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';

import {
  buildRepeatedOddsCheckpointKey,
  classifyRepeatedOddsWindow,
  evaluateRepeatedOddsQuota,
  getRepeatedOddsCollectionConfig,
  getRepeatedOddsDueAt,
  resolveRepeatedOddsOutcome,
  type RepeatedOddsCollectionConfig,
  type RepeatedOddsStatus,
} from './repeated-odds-core.js';
import { syncOdds } from './odds.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';

interface RepeatedOddsOptions {
  now?: Date;
  horizonsMinutes?: number[];
  maximumFixturesPerRun?: number;
}

interface CheckpointRow {
  id: number;
  fixtureId: number;
  horizonMinutes: number;
  dueAt: Date;
  status: string;
  attempts: number;
  nextRetryAt: Date | null;
  updatedAt: Date;
  fixture: {
    apiFixtureId: number;
    kickoffAt: Date;
  };
}

interface CoverageCheckpoint {
  horizonMinutes: number;
  status: string;
  processed: number;
  inserted: number;
}

function jsonMetadata(value: unknown): InputJsonValue {
  return value as InputJsonValue;
}

async function ensureRepeatedOddsCheckpoints(
  now: Date,
  config: RepeatedOddsCollectionConfig,
): Promise<number> {
  const maximumHorizon = Math.max(...config.horizonsMinutes);
  const maximumKickoff = new Date(
    now.getTime() + (maximumHorizon + config.dueToleranceMinutes + config.dueLeadMinutes) * 60_000,
  );
  const fixtures = await prisma.fixture.findMany({
    where: {
      status: FixtureStatus.UPCOMING,
      kickoffAt: {
        gt: now,
        lte: maximumKickoff,
      },
    },
    select: {
      id: true,
      kickoffAt: true,
    },
  });

  let created = 0;

  for (const fixture of fixtures) {
    for (const horizonMinutes of config.horizonsMinutes) {
      const dueAt = getRepeatedOddsDueAt(fixture.kickoffAt, horizonMinutes);
      const existing = await prisma.oddsCollectionCheckpoint.findUnique({
        where: {
          fixtureId_horizonMinutes: {
            fixtureId: fixture.id,
            horizonMinutes,
          },
        },
        select: {
          id: true,
          status: true,
        },
      });

      if (!existing) {
        await prisma.oddsCollectionCheckpoint.create({
          data: {
            fixtureId: fixture.id,
            horizonMinutes,
            dueAt,
            status: 'PENDING',
            metadata: jsonMetadata({
              key: buildRepeatedOddsCheckpointKey(fixture.id, horizonMinutes),
            }),
          },
        });
        created += 1;
      } else if (!['SUCCESS', 'EMPTY', 'SKIPPED'].includes(existing.status)) {
        await prisma.oddsCollectionCheckpoint.update({
          where: { id: existing.id },
          data: { dueAt },
        });
      }
    }
  }

  return created;
}

async function closeMissedCheckpoints(
  now: Date,
  config: RepeatedOddsCollectionConfig,
): Promise<number> {
  const candidates = await prisma.oddsCollectionCheckpoint.findMany({
    where: {
      completedAt: null,
      status: {
        in: ['PENDING', 'RETRY', 'FAILED', 'RUNNING'],
      },
      OR: [
        {
          dueAt: {
            lt: new Date(now.getTime() - config.dueToleranceMinutes * 60_000),
          },
        },
        {
          fixture: {
            kickoffAt: { lte: now },
          },
        },
      ],
    },
    select: {
      id: true,
      dueAt: true,
      horizonMinutes: true,
      fixture: {
        select: {
          kickoffAt: true,
        },
      },
    },
  });

  let skipped = 0;

  for (const checkpoint of candidates) {
    const state = classifyRepeatedOddsWindow({
      now,
      kickoffAt: checkpoint.fixture.kickoffAt,
      dueAt: checkpoint.dueAt,
      dueToleranceMinutes: config.dueToleranceMinutes,
      dueLeadMinutes: config.dueLeadMinutes,
    });

    if (state !== 'MISSED' && state !== 'AFTER_KICKOFF') {
      continue;
    }

    const update = await prisma.oddsCollectionCheckpoint.updateMany({
      where: {
        id: checkpoint.id,
        completedAt: null,
      },
      data: {
        status: 'SKIPPED',
        completedAt: now,
        nextRetryAt: null,
        lockToken: null,
        errorMessage:
          state === 'AFTER_KICKOFF'
            ? 'Collection blocked at or after kickoff.'
            : 'Collection horizon window was missed.',
        metadata: jsonMetadata({
          state,
          horizonMinutes: checkpoint.horizonMinutes,
        }),
      },
    });

    skipped += update.count;
  }

  return skipped;
}

async function loadDueCheckpoints(
  now: Date,
  config: RepeatedOddsCollectionConfig,
  limit: number,
): Promise<CheckpointRow[]> {
  const opensAt = new Date(now.getTime() - config.dueToleranceMinutes * 60_000);
  const closesAt = new Date(now.getTime() + config.dueLeadMinutes * 60_000);
  const staleAt = new Date(now.getTime() - config.lockMinutes * 60_000);

  return (await prisma.oddsCollectionCheckpoint.findMany({
    where: {
      completedAt: null,
      dueAt: {
        gte: opensAt,
        lte: closesAt,
      },
      fixture: {
        status: FixtureStatus.UPCOMING,
        kickoffAt: { gt: now },
      },
      OR: [
        { status: 'PENDING' },
        {
          status: { in: ['RETRY', 'FAILED'] },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        {
          status: 'RUNNING',
          updatedAt: { lte: staleAt },
        },
      ],
    },
    include: {
      fixture: {
        select: {
          apiFixtureId: true,
          kickoffAt: true,
        },
      },
    },
    orderBy: [{ dueAt: 'asc' }, { horizonMinutes: 'desc' }, { id: 'asc' }],
    take: limit,
  })) as CheckpointRow[];
}

async function latestQuotaObservation(): Promise<{
  requestDate: Date;
  dailyRemaining: number | null;
  minuteRemaining: number | null;
} | null> {
  return prisma.apiUsage.findFirst({
    orderBy: {
      requestDate: 'desc',
    },
    select: {
      requestDate: true,
      dailyRemaining: true,
      minuteRemaining: true,
    },
  });
}

async function claimCheckpoint(checkpoint: CheckpointRow, now: Date): Promise<string | null> {
  const lockToken = randomUUID();

  const claim = await prisma.oddsCollectionCheckpoint.updateMany({
    where: {
      id: checkpoint.id,
      status: checkpoint.status,
      updatedAt: checkpoint.updatedAt,
      completedAt: null,
    },
    data: {
      status: 'RUNNING',
      lockToken,
      attemptedAt: now,
      attempts: { increment: 1 },
      errorMessage: null,
    },
  });

  return claim.count === 1 ? lockToken : null;
}

async function finishCheckpoint(input: {
  checkpoint: CheckpointRow;
  lockToken: string;
  now: Date;
  config: RepeatedOddsCollectionConfig;
  processed: number;
  inserted: number;
  errorMessage?: string;
}): Promise<RepeatedOddsStatus> {
  const attempts = input.checkpoint.attempts + 1;
  const outcome = resolveRepeatedOddsOutcome({
    now: input.now,
    dueAt: input.checkpoint.dueAt,
    dueToleranceMinutes: input.config.dueToleranceMinutes,
    attempts,
    maximumAttempts: input.config.maximumAttempts,
    retryMinutes: input.config.retryMinutes,
    processed: input.processed,
    ...(input.errorMessage === undefined ? {} : { errorMessage: input.errorMessage }),
  });

  await prisma.oddsCollectionCheckpoint.updateMany({
    where: {
      id: input.checkpoint.id,
      lockToken: input.lockToken,
    },
    data: {
      status: outcome.status,
      completedAt: outcome.completedAt,
      nextRetryAt: outcome.nextRetryAt,
      lockToken: null,
      processed: input.processed,
      inserted: input.inserted,
      errorMessage: outcome.errorMessage,
      metadata: jsonMetadata({
        key: buildRepeatedOddsCheckpointKey(
          input.checkpoint.fixtureId,
          input.checkpoint.horizonMinutes,
        ),
        apiFixtureId: input.checkpoint.fixture.apiFixtureId,
        kickoffAt: input.checkpoint.fixture.kickoffAt.toISOString(),
        dueAt: input.checkpoint.dueAt.toISOString(),
        observedAt: input.now.toISOString(),
        processed: input.processed,
        inserted: input.inserted,
      }),
    },
  });

  return outcome.status;
}

export async function collectRepeatedOdds(options: RepeatedOddsOptions = {}): Promise<SyncSummary> {
  return runTrackedSync('sync-odds-repeated', async () => {
    const now = options.now ?? new Date();
    const baseConfig = getRepeatedOddsCollectionConfig();
    const config: RepeatedOddsCollectionConfig = {
      ...baseConfig,
      horizonsMinutes: options.horizonsMinutes ?? baseConfig.horizonsMinutes,
      maximumFixturesPerRun: options.maximumFixturesPerRun ?? baseConfig.maximumFixturesPerRun,
    };

    const checkpointsCreated = await ensureRepeatedOddsCheckpoints(now, config);
    const checkpointsSkipped = await closeMissedCheckpoints(now, config);
    const due = await loadDueCheckpoints(now, config, config.maximumFixturesPerRun);

    let processed = 0;
    let inserted = 0;
    let claimed = 0;
    let succeeded = 0;
    let empty = 0;
    let retries = 0;
    let failed = 0;
    let quotaBlocked: string | null = null;

    for (const checkpoint of due) {
      const quota = evaluateRepeatedOddsQuota({
        now: new Date(),
        observation: await latestQuotaObservation(),
        dailyRequestReserve: config.dailyRequestReserve,
        minuteRequestReserve: config.minuteRequestReserve,
      });

      if (!quota.allowed) {
        quotaBlocked = quota.reason;
        break;
      }

      if (new Date().getTime() >= checkpoint.fixture.kickoffAt.getTime()) {
        continue;
      }

      const lockToken = await claimCheckpoint(checkpoint, new Date());

      if (!lockToken) continue;
      claimed += 1;

      try {
        const summary = await syncOdds({
          fixtureIds: [checkpoint.fixtureId],
        });

        processed += summary.processed;
        inserted += summary.inserted;

        const status = await finishCheckpoint({
          checkpoint,
          lockToken,
          now: new Date(),
          config,
          processed: summary.processed,
          inserted: summary.inserted,
        });

        if (status === 'SUCCESS') succeeded += 1;
        else if (status === 'EMPTY') empty += 1;
        else if (status === 'RETRY') retries += 1;
        else if (status === 'FAILED') failed += 1;
      } catch (error) {
        const status = await finishCheckpoint({
          checkpoint,
          lockToken,
          now: new Date(),
          config,
          processed: 0,
          inserted: 0,
          errorMessage: error instanceof Error ? error.message : String(error),
        });

        if (status === 'RETRY') retries += 1;
        else failed += 1;
      }
    }

    return {
      processed,
      inserted,
      updated: succeeded + empty + retries + failed,
      metadata: jsonMetadata({
        horizonsMinutes: config.horizonsMinutes,
        checkpointsCreated,
        checkpointsSkipped,
        due: due.length,
        claimed,
        succeeded,
        empty,
        retries,
        failed,
        quotaBlocked,
      }),
    };
  });
}

export async function getRepeatedOddsCoverage(): Promise<{
  total: number;
  completed: number;
  pending: number;
  byHorizon: Array<{
    horizonMinutes: number;
    total: number;
    success: number;
    empty: number;
    retry: number;
    failed: number;
    skipped: number;
    pending: number;
    processed: number;
    inserted: number;
  }>;
}> {
  const checkpoints = (await prisma.oddsCollectionCheckpoint.findMany({
    select: {
      horizonMinutes: true,
      status: true,
      processed: true,
      inserted: true,
    },
    orderBy: {
      horizonMinutes: 'desc',
    },
  })) as CoverageCheckpoint[];

  const grouped = new Map<
    number,
    {
      horizonMinutes: number;
      total: number;
      success: number;
      empty: number;
      retry: number;
      failed: number;
      skipped: number;
      pending: number;
      processed: number;
      inserted: number;
    }
  >();

  for (const row of checkpoints) {
    const summary = grouped.get(row.horizonMinutes) ?? {
      horizonMinutes: row.horizonMinutes,
      total: 0,
      success: 0,
      empty: 0,
      retry: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      processed: 0,
      inserted: 0,
    };

    summary.total += 1;
    summary.processed += row.processed;
    summary.inserted += row.inserted;

    if (row.status === 'SUCCESS') summary.success += 1;
    else if (row.status === 'EMPTY') summary.empty += 1;
    else if (row.status === 'RETRY') summary.retry += 1;
    else if (row.status === 'FAILED') summary.failed += 1;
    else if (row.status === 'SKIPPED') summary.skipped += 1;
    else summary.pending += 1;

    grouped.set(row.horizonMinutes, summary);
  }

  const byHorizon = [...grouped.values()].sort(
    (left, right) => right.horizonMinutes - left.horizonMinutes,
  );
  const completed = checkpoints.filter((row) =>
    ['SUCCESS', 'EMPTY', 'FAILED', 'SKIPPED'].includes(row.status),
  ).length;

  return {
    total: checkpoints.length,
    completed,
    pending: checkpoints.length - completed,
    byHorizon,
  };
}
