import { prisma } from '@football-ai/database';

import { planUnallocatedScientificPaperStakes } from './bankroll-risk-engine.js';
import { discoverEarlyPrematchOdds } from './early-odds-discovery.js';
import {
  collectFreshOddsDue,
  planFreshOddsCheckpoints,
} from './fresh-odds-collector-engine.js';
import {
  getPersonalUpcomingAnalysis,
  refreshPersonalUpcomingAnalysis,
} from './personal-console-engine.js';
import { runLiveScientificPaperBetDecisions } from './real-odds-paper-bet-engine.js';
import { syncRepeatedFixtureContext } from './repeated-context.js';
import {
  rebuildScientificElo,
  syncScientificInjuries,
  syncScientificStatistics,
} from './scientific-sync.js';

import {
  captureDueCurrentSignalSnapshots,
} from './current-signal-snapshot-engine.js';

const VERSION = 'v7.0-r4.7-early-odds-market-movement';

function integerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];

  if (raw == null || raw.trim() === '') return fallback;

  const value = Number(raw);

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return value;
}

function enabledEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];

  if (raw == null || raw.trim() === '') return fallback;

  const normalized = raw.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;

  throw new Error(`${name} must be true/false or 1/0.`);
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function stage<T>(
  label: string,
  action: () => Promise<T>,
): Promise<T | null> {
  const startedAt = Date.now();

  try {
    const result = await action();
    const durationMs = Date.now() - startedAt;
    console.log(`[science] ${label}: OK (${durationMs}ms)`);
    return result;
  } catch (error) {
    console.error(
      `[science] ${label}: FAILED`,
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    return null;
  }
}

async function runRiskOverlay(): Promise<void> {
  try {
    await planUnallocatedScientificPaperStakes({ limit: 300 });
    console.log('[science] bankroll/risk overlay: OK');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (reason.startsWith('NO_FROZEN_RISK_POLICY')) {
      console.log(`[science] bankroll/risk overlay: SKIPPED (${reason})`);
      return;
    }

    throw error;
  }
}

let lastBestBetCount: number | null = null;

async function reportBestBetCount(days: number): Promise<void> {
  const analysis = await getPersonalUpcomingAnalysis({
    days,
    limit: 300,
  });

  const counts = recordOf(analysis.counts);
  const bestBetCount = numberOf(counts?.bestBets) ?? 0;
  const noBetCount = numberOf(counts?.noBets) ?? 0;
  const fixtureCount = numberOf(counts?.fixtures) ?? 0;

  if (bestBetCount !== lastBestBetCount) {
    console.log(
      `[science] scientific board: fixtures=${fixtureCount} ` +
        `BEST_BET=${bestBetCount} NO_BET=${noBetCount}`,
    );

    if (bestBetCount === 0) {
      console.log(
        '[science] No BEST BET currently passed the scientific/reliability gates.',
      );
    }

    lastBestBetCount = bestBetCount;
  }
}

async function main(): Promise<void> {
  const enabled = enabledEnv('DEV_SCIENTIFIC_AUTOPILOT_ENABLED', true);

  if (!enabled) {
    console.log(
      '[science] DEV_SCIENTIFIC_AUTOPILOT_ENABLED=false; autopilot disabled.',
    );
    return;
  }

  const tickSeconds = integerEnv(
    'DEV_SCIENTIFIC_AUTOPILOT_TICK_SECONDS',
    60,
    30,
    600,
  );
  const planMinutes = integerEnv(
    'DEV_SCIENTIFIC_AUTOPILOT_PLAN_MINUTES',
    15,
    1,
    180,
  );
  const refreshMinutes = integerEnv(
    'DEV_SCIENTIFIC_AUTOPILOT_REFRESH_MINUTES',
    120,
    30,
    1440,
  );
  const injuryWarmupMinutes = integerEnv(
    'DEV_SCIENTIFIC_AUTOPILOT_INJURY_MINUTES',
    60,
    15,
    360,
  );
  const statisticsMinutes = integerEnv(
    'DEV_SCIENTIFIC_AUTOPILOT_STATISTICS_MINUTES',
    60,
    15,
    360,
  );
  const days = integerEnv(
    'DEV_SCIENTIFIC_AUTOPILOT_DAYS',
    30,
    1,
    30,
  );

  console.log('============================================================');
  console.log(`Football AI ${VERSION}`);
  console.log('COMPLETE SCIENTIFIC DATA AUTOPILOT: ENABLED');
  console.log('============================================================');
  console.log(
    `[science] fast loop=${tickSeconds}s ` +
      `odds plan=${planMinutes}m ` +
      `fixtures/predictions refresh=${refreshMinutes}m`,
  );
  console.log(
    `[science] general injuries=${injuryWarmupMinutes}m ` +
      `historical fixture statistics=${statisticsMinutes}m ` +
      `window=${days}d`,
  );
  console.log(
    '[science] Exact PIT context horizons are controlled by ' +
      'SCIENTIFIC_CONTEXT_HORIZONS_MINUTES (default 90,30,5).',
  );
  console.log(
    '[science] External API calls and DB writes are ENABLED while npm run dev is running.',
  );
  console.log(
    '[science] No synthetic odds. No automatic model promotion. ' +
      'No real-money execution. No automatic bet placement.',
  );

  let stopping = false;
  let lastPlanAt = 0;
  let lastRefreshAt = 0;
  let lastInjuryWarmupAt = 0;
  let lastStatisticsAt = 0;

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;

    stopping = true;
    console.log(`[science] received ${signal}; shutting down.`);
    await prisma.$disconnect();
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  while (!stopping) {
    const cycleStartedAt = Date.now();

    // 1) Refresh the current competition/fixture/prediction universe.
    if (
      lastRefreshAt === 0 ||
      cycleStartedAt - lastRefreshAt >= refreshMinutes * 60_000
    ) {
      const refreshed = await stage(
        'current fixtures + provider predictions + fresh-odds bootstrap',
        async () =>
          refreshPersonalUpcomingAnalysis({
            days,
          }),
      );

      if (refreshed != null) {
        lastRefreshAt = Date.now();
        lastPlanAt = Date.now();
      } else if (lastRefreshAt === 0) {
        // Do not hammer the provider every minute if startup discovery fails.
        lastRefreshAt = Date.now() - Math.max(
          0,
          refreshMinutes * 60_000 - 15 * 60_000,
        );
      }
    }

    // 2) Provider-aligned early odds discovery.
    // API-Football documents pre-match odds 1–14 days ahead and a ~3h
    // update cadence. The function self-throttles per fixture, so this
    // fast-loop call makes zero API requests when no fixture is due.
    await stage(
      'early pre-match odds discovery 1-14d / 3h cadence',
      async () => discoverEarlyPrematchOdds(new Date()),
    );

    // 3) Keep historical fixture statistics/xG coverage growing incrementally.
    if (
      lastStatisticsAt === 0 ||
      Date.now() - lastStatisticsAt >= statisticsMinutes * 60_000
    ) {
      const stats = await stage(
        'historical fixture statistics/xG incremental sync',
        syncScientificStatistics,
      );

      if (stats != null) {
        await stage(
          'rebuild Elo from finished fixtures',
          rebuildScientificElo,
        );
        lastStatisticsAt = Date.now();
      }
    }

    // 4) Warm injury data outside the exact decision horizons.
    if (
      lastInjuryWarmupAt === 0 ||
      Date.now() - lastInjuryWarmupAt >= injuryWarmupMinutes * 60_000
    ) {
      const injuries = await stage(
        'general upcoming injury warmup',
        async () =>
          syncScientificInjuries({
            now: new Date(),
          }),
      );

      if (injuries != null) {
        lastInjuryWarmupAt = Date.now();
      }
    }

    // 5) Exact PIT context comes BEFORE odds/decision.
    //    Default horizons: T-90 / T-30 / T-5.
    await stage(
      'PIT lineup + injury context T-90/T-30/T-5',
      async () =>
        syncRepeatedFixtureContext({
          now: new Date(),
        }),
    );

    // 6) Maintain fresh-odds checkpoint plan.
    if (
      lastPlanAt === 0 ||
      Date.now() - lastPlanAt >= planMinutes * 60_000
    ) {
      const planned = await stage(
        'fresh odds checkpoint plan',
        async () => planFreshOddsCheckpoints(new Date()),
      );

      if (planned != null) {
        lastPlanAt = Date.now();
      }
    }

    // 7) Collect real odds only when checkpoint is DUE.
    await stage(
      'collect DUE real fresh odds T-180/T-90/T-30/T-10/T-5',
      async () => collectFreshOddsDue(new Date()),
    );

    // 8) Decision always runs AFTER context + odds in this fast cycle.
    // Current research signals are snapshotted after fresh odds/context
    // and before the official BEST BET decision. This ledger is append-only.
    await stage(
      'current signal snapshot ledger T-180/T-90/T-60/T-30/T-5',
      async () =>
        captureDueCurrentSignalSnapshots({
          now: new Date(),
        }),
    );

    await stage(
      'scientific HDA/BTTS/O-U BEST BET / NO BET decision',
      async () =>
        runLiveScientificPaperBetDecisions({
          now: new Date(),
        }),
    );

    // 9) Paper bankroll/risk overlay.
    await stage(
      'bankroll/risk plan',
      runRiskOverlay,
    );

    await stage(
      'BEST BET board status',
      async () => reportBestBetCount(days),
    );

    const elapsed = Date.now() - cycleStartedAt;
    const waitMs = Math.max(
      1_000,
      tickSeconds * 1_000 - elapsed,
    );

    await sleep(waitMs);
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      '[science] fatal autopilot error:',
      error instanceof Error ? (error.stack ?? error.message) : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
