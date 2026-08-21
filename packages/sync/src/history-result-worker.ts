import { randomUUID } from 'node:crypto';

import { prisma, type InputJsonValue } from '@football-ai/database';

import { apiFootballGet } from './api-football-client.js';
import { normalizeApiFootballFixtures } from './api-football-contract.js';
import {
  settlePaperBetSelection,
  SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
} from './paper-bet-ledger-core.js';
import { deterministicHash } from './scientific-evaluation-contract.js';

function jsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

function integerEnv(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function historyResultRetryDelayMinutes(attempts: number): number {
  const schedule = [7, 10, 15, 20, 30, 45, 60];
  return schedule[Math.min(Math.max(attempts - 1, 0), schedule.length - 1)]!;
}

export async function runHistoryResultWorker(): Promise<{
  considered: number;
  settled: number;
  skippedNotFinal: number;
  skippedNoFulltimeScore: number;
  completedWithoutCall: number;
}> {
  const now = new Date();
  const firstCheckMinutes = integerEnv('PAPER_BET_RESULT_MINUTES_AFTER_KICKOFF', 105, 100, 110);
  const configuredMaxAttempts = integerEnv('PAPER_BET_RESULT_MAX_ATTEMPTS', 12, 1, 48);
  const lockTtlMinutes = integerEnv('PAPER_BET_RESULT_LOCK_TTL_MINUTES', 5, 2, 30);
  const dueLimit = integerEnv('PAPER_BET_RESULT_DUE_LIMIT', 25, 1, 100);

  // Only predictions that already exist are eligible. This intentionally never
  // creates a prediction for a fixture that has already started.
  const openDecisions = await prisma.scientificPaperBetDecision.findMany({
    where: {
      decisionType: 'BEST_BET',
      settlement: null,
    },
    select: {
      providerFixtureId: true,
      kickoffAt: true,
    },
    orderBy: { kickoffAt: 'asc' },
    take: 2000,
  });

  const fixtureKickoff = new Map<number, Date>();
  for (const decision of openDecisions) {
    const previous = fixtureKickoff.get(decision.providerFixtureId);
    if (previous == null || decision.kickoffAt.getTime() < previous.getTime()) {
      fixtureKickoff.set(decision.providerFixtureId, decision.kickoffAt);
    }
  }

  if (fixtureKickoff.size > 0) {
    await prisma.resultUpdateJob.createMany({
      data: [...fixtureKickoff.entries()].map(([providerFixtureId, kickoffAt]) => ({
        providerFixtureId,
        kickoffAt,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: configuredMaxAttempts,
        nextCheckAt: new Date(kickoffAt.getTime() + firstCheckMinutes * 60_000),
      })),
      skipDuplicates: true,
    });
  }

  // Restart recovery: stale PROCESSING rows are made eligible again.
  const lockExpiredBefore = new Date(now.getTime() - lockTtlMinutes * 60_000);
  await prisma.resultUpdateJob.updateMany({
    where: {
      status: 'PROCESSING',
      OR: [{ lockedAt: null }, { lockedAt: { lt: lockExpiredBefore } }],
    },
    data: {
      status: 'RETRY',
      lockedAt: null,
      lockToken: null,
      nextCheckAt: now,
      lastError: 'Recovered stale result-update lock after restart/timeout.',
    },
  });

  const dueJobs = await prisma.resultUpdateJob.findMany({
    where: {
      status: { in: ['PENDING', 'RETRY'] },
      nextCheckAt: { lte: now },
    },
    orderBy: [{ nextCheckAt: 'asc' }, { id: 'asc' }],
    take: dueLimit,
  });

  let settled = 0;
  let skippedNotFinal = 0;
  let skippedNoFulltimeScore = 0;
  let completedWithoutCall = 0;

  const reschedule = async (input: {
    jobId: number;
    lockToken: string;
    attempts: number;
    maxAttempts: number;
    providerStatus: string | null;
    error: string;
  }): Promise<void> => {
    const exhausted = input.attempts >= input.maxAttempts;
    await prisma.resultUpdateJob.updateMany({
      where: {
        id: input.jobId,
        status: 'PROCESSING',
        lockToken: input.lockToken,
      },
      data: {
        status: exhausted ? 'EXHAUSTED' : 'RETRY',
        nextCheckAt: exhausted
          ? new Date('2999-01-01T00:00:00.000Z')
          : new Date(Date.now() + historyResultRetryDelayMinutes(input.attempts) * 60_000),
        lockedAt: null,
        lockToken: null,
        lastProviderStatus: input.providerStatus,
        lastError: input.error.slice(0, 4000),
      },
    });
  };

  for (const job of dueJobs) {
    const maxAttempts = Math.max(1, job.maxAttempts || configuredMaxAttempts);
    if (job.attempts >= maxAttempts) {
      await prisma.resultUpdateJob.updateMany({
        where: { id: job.id, status: { in: ['PENDING', 'RETRY'] } },
        data: {
          status: 'EXHAUSTED',
          nextCheckAt: new Date('2999-01-01T00:00:00.000Z'),
          lastError: `Maximum result checks reached (${maxAttempts}).`,
        },
      });
      continue;
    }

    const lockToken = randomUUID();
    const claimedAt = new Date();
    const claim = await prisma.resultUpdateJob.updateMany({
      where: {
        id: job.id,
        status: { in: ['PENDING', 'RETRY'] },
        nextCheckAt: { lte: claimedAt },
        OR: [{ lockedAt: null }, { lockedAt: { lt: lockExpiredBefore } }],
      },
      data: {
        status: 'PROCESSING',
        lockedAt: claimedAt,
        lockToken,
        lastCheckedAt: claimedAt,
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    if (claim.count !== 1) continue;

    const claimed = await prisma.resultUpdateJob.findUnique({
      where: { id: job.id },
      select: { attempts: true, maxAttempts: true },
    });
    const attempts = claimed?.attempts ?? job.attempts + 1;
    const effectiveMaxAttempts = Math.max(1, claimed?.maxAttempts ?? maxAttempts);

    try {
      const pendingDecisions = await prisma.scientificPaperBetDecision.findMany({
        where: {
          providerFixtureId: job.providerFixtureId,
          decisionType: 'BEST_BET',
          settlement: null,
        },
        orderBy: { decisionAsOf: 'asc' },
      });

      if (pendingDecisions.length === 0) {
        await prisma.resultUpdateJob.updateMany({
          where: { id: job.id, status: 'PROCESSING', lockToken },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            nextCheckAt: new Date('2999-01-01T00:00:00.000Z'),
            lockedAt: null,
            lockToken: null,
            lastError: null,
          },
        });
        completedWithoutCall += 1;
        continue;
      }

      // The quota preloader (installed by history-result-runner.ts and the safe
      // launch script) reserves one daily quota unit immediately before fetch().
      const request = await apiFootballGet(
        '/fixtures',
        { id: job.providerFixtureId, timezone: 'UTC' },
        { maxAttempts: 1 },
      );
      const fixture = normalizeApiFootballFixtures(request.payload)[0];

      if (!fixture) {
        skippedNotFinal += 1;
        await reschedule({
          jobId: job.id,
          lockToken,
          attempts,
          maxAttempts: effectiveMaxAttempts,
          providerStatus: null,
          error: 'Provider returned no fixture row.',
        });
        continue;
      }

      if (!['FT', 'AET', 'PEN'].includes(fixture.statusShort)) {
        skippedNotFinal += 1;
        await reschedule({
          jobId: job.id,
          lockToken,
          attempts,
          maxAttempts: effectiveMaxAttempts,
          providerStatus: fixture.statusShort,
          error: `Fixture is not final yet: ${fixture.statusShort}.`,
        });
        continue;
      }

      if (fixture.fulltimeHomeGoals == null || fixture.fulltimeAwayGoals == null) {
        skippedNoFulltimeScore += 1;
        await reschedule({
          jobId: job.id,
          lockToken,
          attempts,
          maxAttempts: effectiveMaxAttempts,
          providerStatus: fixture.statusShort,
          error: 'Fixture is final but full-time score is missing.',
        });
        continue;
      }

      const settlementRows = pendingDecisions.map(
        (decision: {
          id: number;
          providerFixtureId: number;
          selectedMarket: string | null;
          selectedSelection: string | null;
          decimalOdds: number | null;
          lineValue: number | null;
        }) => {
        if (
          decision.selectedMarket == null ||
          decision.selectedSelection == null ||
          decision.decimalOdds == null
        ) {
          throw new Error(`BEST_BET decision ${decision.id} is missing selected bet fields.`);
        }

        const settlement = settlePaperBetSelection({
          marketType: decision.selectedMarket,
          selection: decision.selectedSelection,
          lineValue: decision.lineValue,
          homeGoals: fixture.fulltimeHomeGoals!,
          awayGoals: fixture.fulltimeAwayGoals!,
          decimalOdds: decision.decimalOdds,
          stakeUnits: 1,
        });
        const settlementPayload = {
          ledgerVersion: SCIENTIFIC_PAPER_BET_LEDGER_VERSION,
          decisionId: decision.id,
          providerFixtureId: decision.providerFixtureId,
          fixture,
          settlement,
          sourceObservedAt: request.observedAt.toISOString(),
          closingOdds: null,
          clv: null,
        };

        return {
          decisionId: decision.id,
          providerFixtureId: decision.providerFixtureId,
          settledAt: new Date(),
          sourceFixtureObservedAt: request.observedAt,
          statusShort: fixture.statusShort,
          fulltimeHomeGoals: fixture.fulltimeHomeGoals!,
          fulltimeAwayGoals: fixture.fulltimeAwayGoals!,
          result: settlement.result,
          stakeUnits: settlement.stakeUnits,
          profitUnits: settlement.profitUnits,
          closingDecimalOdds: null,
          closingFairProbability: null,
          clv: null,
          settlementPayload: jsonValue(settlementPayload),
          settlementHash: deterministicHash('SCIENTIFIC_PAPER_BET_SETTLEMENT', settlementPayload),
        };
      });

      const fixtureSnapshotPayload = {
        providerFixtureId: fixture.providerFixtureId,
        providerLeagueId: fixture.providerLeagueId,
        season: fixture.season,
        kickoffAt: fixture.kickoffAt.toISOString(),
        statusShort: fixture.statusShort,
        fulltimeHomeGoals: fixture.fulltimeHomeGoals,
        fulltimeAwayGoals: fixture.fulltimeAwayGoals,
        observedAt: request.observedAt.toISOString(),
      };

      const insertedCount = await prisma.$transaction(async (transaction: typeof prisma) => {
        await transaction.apiFootballFixtureSnapshot.createMany({
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
              rawPayload: jsonValue(request.payload),
              payloadHash: deterministicHash('HISTORY_RESULT_FIXTURE_SNAPSHOT', fixtureSnapshotPayload),
            },
          ],
          skipDuplicates: true,
        });

        const inserted = await transaction.scientificPaperBetSettlement.createMany({
          data: settlementRows,
          skipDuplicates: true,
        });

        const completed = await transaction.resultUpdateJob.updateMany({
          where: { id: job.id, status: 'PROCESSING', lockToken },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            nextCheckAt: new Date('2999-01-01T00:00:00.000Z'),
            lockedAt: null,
            lockToken: null,
            lastProviderStatus: fixture.statusShort,
            lastError: null,
          },
        });
        if (completed.count !== 1) {
          throw new Error(`Lost result-update lock for fixture ${job.providerFixtureId}.`);
        }

        await transaction.realtimeOutbox.create({
          data: {
            eventType: 'history_updated',
            aggregateId: String(job.providerFixtureId),
            payload: jsonValue({
              event: 'history_updated',
              version: 1,
              providerFixtureId: job.providerFixtureId,
              changed: ['result', 'settlement'],
              score: { home: fixture.fulltimeHomeGoals, away: fixture.fulltimeAwayGoals },
              statusShort: fixture.statusShort,
              occurredAt: new Date().toISOString(),
            }),
          },
        });

        await transaction.realtimeOutbox.create({
          data: {
            eventType: 'MATCH_FINISHED',
            aggregateId: String(job.providerFixtureId),
            payload: jsonValue({
              event: 'MATCH_FINISHED',
              type: 'MATCH_FINISHED',
              version: 1,
              fixtureId: String(job.providerFixtureId),
              providerFixtureId: job.providerFixtureId,
              statusShort: fixture.statusShort,
              score: { home: fixture.fulltimeHomeGoals, away: fixture.fulltimeAwayGoals },
              occurredAt: new Date().toISOString(),
            }),
          },
        });

        await transaction.realtimeOutbox.create({
          data: {
            eventType: 'PREDICTION_RESULT_UPDATED',
            aggregateId: String(job.providerFixtureId),
            payload: jsonValue({
              event: 'PREDICTION_RESULT_UPDATED',
              type: 'PREDICTION_RESULT_UPDATED',
              version: 1,
              fixtureId: String(job.providerFixtureId),
              providerFixtureId: job.providerFixtureId,
              changed: ['result', 'settlement'],
              score: { home: fixture.fulltimeHomeGoals, away: fixture.fulltimeAwayGoals },
              statusShort: fixture.statusShort,
              occurredAt: new Date().toISOString(),
            }),
          },
        });

        return inserted.count;
      });

      settled += insertedCount;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('[api-football-quota] BLOCKED')) {
        await prisma.resultUpdateJob.updateMany({
          where: { id: job.id, status: 'PROCESSING', lockToken },
          data: {
            status: 'RETRY',
            attempts: { decrement: 1 },
            nextCheckAt: new Date(Date.now() + 60 * 60_000),
            lockedAt: null,
            lockToken: null,
            lastError: message.slice(0, 4000),
          },
        });
        continue;
      }

      await reschedule({
        jobId: job.id,
        lockToken,
        attempts,
        maxAttempts: effectiveMaxAttempts,
        providerStatus: null,
        error: message,
      });
    }
  }

  return {
    considered: dueJobs.length,
    settled,
    skippedNotFinal,
    skippedNoFulltimeScore,
    completedWithoutCall,
  };
}
