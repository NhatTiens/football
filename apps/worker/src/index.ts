import 'dotenv/config';
import cron from 'node-cron';
import { prisma } from '@football-ai/database';
import { executeJob } from './jobs.js';
import { runResultStartupCatchUp } from './startup-result-catchup.js';

const repeatedOddsEnabled = (process.env.ODDS_REPEATED_ENABLED ?? 'true').toLowerCase() === 'true';
const oddsCommand = repeatedOddsEnabled ? 'sync-odds-repeated' : 'sync-odds';
const oddsCron = repeatedOddsEnabled
  ? (process.env.ODDS_REPEATED_CRON ?? '*/5 * * * *')
  : (process.env.ODDS_SYNC_CRON ?? '*/15 * * * *');

const enabled = (process.env.WORKER_SCHEDULER_ENABLED ?? 'true').toLowerCase() === 'true';
const scienceOwnsProviderSync =
  (process.env.DEV_SCIENCE_OWNS_PROVIDER_SYNC ?? 'false').toLowerCase() === 'true';
const v8PaperRuntimeEnabled =
  (process.env.V8_PAPER_RUNTIME_ENABLED ?? 'false').toLowerCase() === 'true';

if (!enabled) {
  console.log('[worker] scheduler disabled; process will stay alive for manual inspection.');
} else {
  const baseSchedules = scienceOwnsProviderSync
    ? ([
        [process.env.RECOMMENDATION_CRON ?? '*/15 * * * *', 'generate'],
        [
          process.env.PAPER_BET_SETTLEMENT_CRON ?? '*/10 * * * *',
          'paper-bet-ledger-settle',
        ],
        [process.env.SETTLEMENT_CRON ?? '3,13,23,33,43,53 * * * *', 'settle'],
      ] as const)
    : ([
        [process.env.FIXTURE_SYNC_CRON ?? '0 */6 * * *', 'sync-fixtures'],
        [oddsCron, oddsCommand],
        [process.env.PAPER_BET_OPERATIONS_CRON ?? '* * * * *', 'paper-bet-operations-cycle'],
        [process.env.LINEUP_SYNC_CRON ?? '*/10 * * * *', 'sync-lineups'],
        [process.env.PREDICTION_SYNC_CRON ?? '5 */1 * * *', 'sync-predictions'],
        [process.env.RECOMMENDATION_CRON ?? '*/15 * * * *', 'generate'],
        [
          process.env.PAPER_BET_SETTLEMENT_CRON ?? '*/10 * * * *',
          'paper-bet-ledger-settle',
        ],
        [process.env.SETTLEMENT_CRON ?? '3,13,23,33,43,53 * * * *', 'settle'],
      ] as const);
  const schedules: ReadonlyArray<readonly [string, import('./jobs.js').WorkerCommand]> = [
    ...baseSchedules,
    ...(v8PaperRuntimeEnabled
      ? ([[process.env.V8_PAPER_RUNTIME_CRON ?? '* * * * *', 'v8-paper-runtime-cycle']] as const)
      : []),
  ];

  if (scienceOwnsProviderSync) {
    console.log(
      '[worker] DEV_SCIENCE_OWNS_PROVIDER_SYNC=true; ' +
        'provider sync is owned by the dedicated science process.',
    );
  }

  for (const [expression, command] of schedules) {
    if (!cron.validate(expression))
      throw new Error(`Invalid cron expression for ${command}: ${expression}`);
    cron.schedule(expression, () => void executeJob(command), { timezone: 'Asia/Ho_Chi_Minh' });
    console.log(`[worker] scheduled ${command}: ${expression}`);
  }

  // RESULT_STARTUP_CATCHUP_V1
  setTimeout(() => {
    void runResultStartupCatchUp({
      maxAttempts: Number(process.env.RESULT_STARTUP_CATCHUP_MAX_ATTEMPTS ?? 12),
      retryDelayMs: Number(process.env.RESULT_STARTUP_CATCHUP_RETRY_MS ?? 2_000),
    })
      .then(() => executeJob('generate'))
      .catch((error) => {
        console.error('[worker] startup result catch-up failed', error);
      });
  }, Number(process.env.RESULT_STARTUP_CATCHUP_DELAY_MS ?? 1_500));
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}; shutting down.`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
