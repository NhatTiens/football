import { prisma } from '@football-ai/database';

import {
  PAPER_BET_OPERATIONS_VERSION,
  parsePaperBetOperationsTickSeconds,
} from './paper-bet-operations-core.js';
import {
  getPaperBetOperationsReadiness,
  getPaperBetReliabilityAccumulation,
  runPaperBetOperationsCycle,
} from './paper-bet-operations-engine.js';

type AnyRecord = Record<string, unknown>;

function record(value: unknown): AnyRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

function positiveIntegerArgument(name: string, fallback: number, maximum: number): number {
  const raw = argument(name);
  if (raw == null) return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
  }

  return value;
}

function fixtureArgument(): number | null {
  const raw = argument('--fixture');
  if (raw == null) return null;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('--fixture must be a positive provider fixture id.');
  }

  return value;
}

function reliabilityEveryCycles(): number {
  const raw = process.env.PAPER_BET_OPERATIONS_RELIABILITY_EVERY_CYCLES;
  if (raw == null || raw.trim() === '') return 20;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2880) {
    throw new Error(
      'PAPER_BET_OPERATIONS_RELIABILITY_EVERY_CYCLES must be an integer from 1 to 2880.',
    );
  }

  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function cycleSummary(value: Record<string, unknown>): Record<string, unknown> {
  const snapshots = record(value.snapshots);
  const decisions = record(value.decisions);

  return {
    event: 'R4.10.2.11.2B_PAPER_BET_OPERATIONS_HEARTBEAT',
    version: PAPER_BET_OPERATIONS_VERSION,
    executedAt: value.executedAt,
    snapshots: {
      planned: snapshots?.planned ?? 0,
      inserted: snapshots?.inserted ?? 0,
      duplicates: snapshots?.duplicates ?? 0,
      waiting: snapshots?.waiting ?? 0,
      skipped: snapshots?.skipped ?? 0,
    },
    decisions: {
      providerFixturesScanned: decisions?.providerFixturesScanned ?? 0,
      dueEvents: decisions?.dueEvents ?? 0,
      existingDecisions: decisions?.existingDecisions ?? 0,
      decisionsRecorded: decisions?.decisionsRecorded ?? 0,
      bestBets: decisions?.bestBets ?? 0,
      noBets: decisions?.noBets ?? 0,
      skippedNoOdds: decisions?.skippedNoOdds ?? 0,
      skippedNoModel: decisions?.skippedNoModel ?? 0,
      skippedNoCandidates: decisions?.skippedNoCandidates ?? 0,
      errors: decisions?.errors ?? [],
    },
    safety: value.safety,
  };
}

function reliabilitySummary(value: Record<string, unknown>): Record<string, unknown> {
  const historical = record(value.historicalReplay);
  const live = record(value.livePaperEvidence);
  const progress = Array.isArray(live?.progress) ? live.progress : [];

  return {
    event: 'R4.10.2.11.2C_RELIABILITY_HEARTBEAT',
    version: PAPER_BET_OPERATIONS_VERSION,
    generatedAt: value.generatedAt,
    targetRowsPerMarketHorizon: value.targetRowsPerMarketHorizon,
    historicalReplay: {
      evaluationFixtures: historical?.evaluationFixtures ?? 0,
      diagnosticEligibleMarkets: historical?.diagnosticEligibleMarkets ?? [],
      blockedMarkets: historical?.blockedMarkets ?? [],
    },
    livePaperEvidence: {
      snapshotRowsRead: live?.snapshotRowsRead ?? 0,
      selectedCandidateRows: live?.selectedCandidateRows ?? 0,
      progress,
    },
    safety: value.safety,
  };
}

async function daemon(): Promise<void> {
  const tickSeconds = parsePaperBetOperationsTickSeconds(
    process.env.PAPER_BET_OPERATIONS_TICK_SECONDS,
  );
  const reliabilityCycles = reliabilityEveryCycles();
  let stopping = false;
  let cycleNumber = 0;

  const stop = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    console.log(
      JSON.stringify({
        event: 'R4.10.2.11.2B_PAPER_BET_OPERATIONS_STOPPING',
        signal,
        stoppedAt: new Date().toISOString(),
      }),
    );
  };

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  console.log(
    JSON.stringify({
      event: 'R4.10.2.11.2B_PAPER_BET_OPERATIONS_DAEMON_STARTED',
      version: PAPER_BET_OPERATIONS_VERSION,
      startedAt: new Date().toISOString(),
      tickSeconds,
      reliabilityEveryCycles: reliabilityCycles,
      appendOnly: true,
      pitSafe: true,
      paperOnly: true,
      externalApiCalled: false,
      databaseWriteAuthorized: true,
      automaticBetPlacement: false,
      realMoneyExecution: false,
    }),
  );

  while (!stopping) {
    const startedAt = Date.now();
    cycleNumber += 1;

    try {
      const cycle = await runPaperBetOperationsCycle({
        now: new Date(),
      });
      console.log(JSON.stringify(cycleSummary(cycle)));

      if (cycleNumber === 1 || cycleNumber % reliabilityCycles === 0) {
        const reliability = await getPaperBetReliabilityAccumulation({
          now: new Date(),
        });
        console.log(JSON.stringify(reliabilitySummary(reliability)));
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'R4.10.2.11.2B_PAPER_BET_OPERATIONS_CYCLE_FAILED',
          version: PAPER_BET_OPERATIONS_VERSION,
          failedAt: new Date().toISOString(),
          error: error instanceof Error ? (error.stack ?? error.message) : String(error),
          externalApiCalled: false,
          realMoneyExecution: false,
        }),
      );
    }

    const waitMs = Math.max(1000, tickSeconds * 1000 - (Date.now() - startedAt));
    if (!stopping) await sleep(waitMs);
  }
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'readiness').trim().toLowerCase();

  if (command === 'readiness') {
    const fixture = fixtureArgument();
    const result = await getPaperBetOperationsReadiness({
      hoursAhead: positiveIntegerArgument('--hours-ahead', 48, 720),
      maximumFixtures: positiveIntegerArgument('--max-fixtures', 30, 100),
      maximumOddsAgeMinutes: positiveIntegerArgument('--max-odds-age', 360, 1440),
      providerFixtureIds: fixture == null ? undefined : [fixture],
    });
    const summaryOnly = process.argv.includes('--summary-only');
    console.log(
      JSON.stringify(
        summaryOnly
          ? {
              ...result,
              rows: undefined,
              detailRowsIncluded: false,
            }
          : {
              ...result,
              detailRowsIncluded: true,
            },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'reliability') {
    const result = await getPaperBetReliabilityAccumulation({
      hours: positiveIntegerArgument('--hours', 8760, 87_600),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'once') {
    const result = await runPaperBetOperationsCycle({
      now: new Date(),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'daemon') {
    await daemon();
    return;
  }

  throw new Error(`Unsupported command: ${command}. Use readiness, reliability, once, or daemon.`);
}

let exitCode = 0;

try {
  await main();
} catch (error) {
  exitCode = 2;
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
} finally {
  await prisma.$disconnect();
  process.exitCode = exitCode;
}
