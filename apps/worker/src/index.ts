import 'dotenv/config';
import cron from 'node-cron';
import { prisma } from '@football-ai/database';
import { executeJob } from './jobs.js';
import { buildWorkerScheduleConfiguration } from './schedules.js';
import { runResultStartupCatchUp } from './startup-result-catchup.js';

const enabled = (process.env.WORKER_SCHEDULER_ENABLED ?? 'true').toLowerCase() === 'true';
const { schedules, scienceOwnsProviderSync, scientificCurrentRefreshEnabled } =
  buildWorkerScheduleConfiguration();

if (!enabled) {
  console.log('[worker] scheduler disabled; process will stay alive for manual inspection.');
} else {
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
  setTimeout(
    () => {
      void runStartupRecovery();
    },
    Number(process.env.RESULT_STARTUP_CATCHUP_DELAY_MS ?? 1_500),
  );
}

async function runStartupStage(label: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(`[worker] startup ${label} failed`, error);
  }
}

async function runStartupRecovery(): Promise<void> {
  await runStartupStage('result catch-up', () =>
    runResultStartupCatchUp({
      maxAttempts: Number(process.env.RESULT_STARTUP_CATCHUP_MAX_ATTEMPTS ?? 12),
      retryDelayMs: Number(process.env.RESULT_STARTUP_CATCHUP_RETRY_MS ?? 2_000),
    }),
  );

  if (scientificCurrentRefreshEnabled && !scienceOwnsProviderSync) {
    await runStartupStage('scientific current refresh', () =>
      executeJob('scientific-current-refresh'),
    );
  }

  if (!scienceOwnsProviderSync) {
    await runStartupStage('scientific live cycle', () => executeJob('scientific-live-cycle'));
  }

  await runStartupStage('recommendation generation', () => executeJob('generate'));
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}; shutting down.`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
