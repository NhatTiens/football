import { randomUUID } from 'node:crypto';
import { FixtureStatus, prisma } from '@football-ai/database';
import { syncLineups } from './lineups.js';
import { syncScientificInjuries } from './scientific-sync.js';
import {
  classifyContextCheckpoint,
  getContextDueAt,
  getRepeatedContextConfig,
  type ContextCheckpointStatus,
  type RepeatedContextConfig,
} from './repeated-context-core.js';
import { runTrackedSync, type SyncSummary } from './tracking.js';

interface RepeatedContextOptions {
  now?: Date;
  horizonsMinutes?: number[];
  maximumFixturesPerRun?: number;
}

async function ensureCheckpoints(
  now: Date,
  config: RepeatedContextConfig,
): Promise<number> {
  const maximumHorizon = Math.max(...config.horizonsMinutes);
  const maximumKickoff = new Date(
    now.getTime() +
      (maximumHorizon +
        config.dueLeadMinutes +
        config.dueToleranceMinutes +
        15) *
        60_000,
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
      const existing =
        await prisma.fixtureContextCollectionCheckpoint.findUnique({
          where: {
            fixtureId_horizonMinutes: {
              fixtureId: fixture.id,
              horizonMinutes,
            },
          },
          select: { id: true, status: true },
        });

      const dueAt = getContextDueAt(
        fixture.kickoffAt,
        horizonMinutes,
      );

      if (!existing) {
        await prisma.fixtureContextCollectionCheckpoint.create({
          data: {
            fixtureId: fixture.id,
            horizonMinutes,
            dueAt,
            status: 'PENDING',
          },
        });
        created += 1;
      } else if (
        !['SUCCESS', 'MISSED'].includes(existing.status)
      ) {
        await prisma.fixtureContextCollectionCheckpoint.update({
          where: { id: existing.id },
          data: { dueAt },
        });
      }
    }
  }

  return created;
}

async function closeMissed(
  now: Date,
  config: RepeatedContextConfig,
): Promise<number> {
  const candidates =
    await prisma.fixtureContextCollectionCheckpoint.findMany({
      where: {
        status: {
          in: ['PENDING', 'RETRY', 'FAILED'],
        },
        completedAt: null,
      },
      select: {
        id: true,
        dueAt: true,
      },
      take: 500,
    });

  let missed = 0;
  for (const checkpoint of candidates) {
    if (
      classifyContextCheckpoint({
        now,
        dueAt: checkpoint.dueAt,
        dueLeadMinutes: config.dueLeadMinutes,
        dueToleranceMinutes: config.dueToleranceMinutes,
      }) !== 'MISSED'
    ) {
      continue;
    }

    await prisma.fixtureContextCollectionCheckpoint.update({
      where: { id: checkpoint.id },
      data: {
        status: 'MISSED',
        completedAt: now,
        errorMessage: 'Context collection window missed.',
      },
    });
    missed += 1;
  }
  return missed;
}

export async function syncRepeatedFixtureContext(
  options: RepeatedContextOptions = {},
): Promise<SyncSummary> {
  return runTrackedSync(
    'sync-repeated-fixture-context',
    async () => {
      const now = options.now ?? new Date();
      const base = getRepeatedContextConfig();
      const config: RepeatedContextConfig = {
        ...base,
        ...(options.horizonsMinutes
          ? {
              horizonsMinutes: [
                ...new Set(options.horizonsMinutes),
              ].sort((a, b) => b - a),
            }
          : {}),
        ...(options.maximumFixturesPerRun
          ? {
              maximumFixturesPerRun:
                options.maximumFixturesPerRun,
            }
          : {}),
      };

      const created = await ensureCheckpoints(now, config);
      const missed = await closeMissed(now, config);
      const candidates =
        await prisma.fixtureContextCollectionCheckpoint.findMany({
          where: {
            status: { in: ['PENDING', 'RETRY', 'FAILED'] },
            completedAt: null,
            dueAt: {
              lte: new Date(
                now.getTime() +
                  config.dueLeadMinutes * 60_000,
              ),
              gte: new Date(
                now.getTime() -
                  config.dueToleranceMinutes * 60_000,
              ),
            },
          },
          include: {
            fixture: {
              select: {
                id: true,
                kickoffAt: true,
              },
            },
          },
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          take: config.maximumFixturesPerRun,
        });

      let processed = 0;
      let inserted = 0;
      let updated = 0;
      let failed = 0;

      for (const checkpoint of candidates) {
        const classification = classifyContextCheckpoint({
          now,
          dueAt: checkpoint.dueAt,
          dueLeadMinutes: config.dueLeadMinutes,
          dueToleranceMinutes: config.dueToleranceMinutes,
        });
        if (classification !== 'DUE') continue;

        const lockToken = randomUUID();
        const claimed =
          await prisma.fixtureContextCollectionCheckpoint.updateMany({
            where: {
              id: checkpoint.id,
              status: {
                in: ['PENDING', 'RETRY', 'FAILED'],
              },
              completedAt: null,
            },
            data: {
              status: 'RUNNING',
              attemptedAt: now,
              attempts: { increment: 1 },
              lockToken,
              errorMessage: null,
            },
          });

        if (claimed.count !== 1) continue;

        try {
          const [lineupSummary, injurySummary] =
            await Promise.all([
              syncLineups({
                fixtureIds: [checkpoint.fixture.id],
              }),
              syncScientificInjuries({
                fixtureIds: [checkpoint.fixture.id],
                now,
              }),
            ]);

          const lineupProcessed = lineupSummary.processed;
          const injuryProcessed = injurySummary.processed;

          await prisma.fixtureContextCollectionCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
              status: 'SUCCESS',
              completedAt: new Date(),
              lineupProcessed,
              injuryProcessed,
              lockToken: null,
              errorMessage: null,
            },
          });

          processed += 1;
          inserted +=
            lineupSummary.inserted + injurySummary.inserted;
          updated +=
            lineupSummary.updated + injurySummary.updated;
        } catch (error) {
          const attempts = checkpoint.attempts + 1;
          const status: ContextCheckpointStatus =
            attempts >= config.maximumAttempts
              ? 'FAILED'
              : 'RETRY';

          await prisma.fixtureContextCollectionCheckpoint.update({
            where: { id: checkpoint.id },
            data: {
              status,
              lockToken: null,
              errorMessage:
                error instanceof Error
                  ? error.message.slice(0, 4000)
                  : String(error).slice(0, 4000),
            },
          });
          failed += 1;
        }
      }

      return {
        processed,
        inserted,
        updated,
        metadata: {
          createdCheckpoints: created,
          missedCheckpoints: missed,
          candidateCheckpoints: candidates.length,
          failed,
          horizonsMinutes: config.horizonsMinutes,
          maximumFixturesPerRun:
            config.maximumFixturesPerRun,
        },
      };
    },
  );
}
