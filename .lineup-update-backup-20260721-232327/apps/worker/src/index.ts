import 'dotenv/config';
import cron from 'node-cron';
import { prisma } from '@football-ai/database';
import { executeJob } from './jobs.js';

const enabled = (process.env.WORKER_SCHEDULER_ENABLED ?? 'true').toLowerCase() === 'true';

if (!enabled) {
  console.log('[worker] scheduler disabled; process will stay alive for manual inspection.');
} else {
  const schedules = [
    [process.env.FIXTURE_SYNC_CRON ?? '0 */6 * * *', 'sync-fixtures'],
    [process.env.ODDS_SYNC_CRON ?? '*/15 * * * *', 'sync-odds'],
    [process.env.PREDICTION_SYNC_CRON ?? '5 */1 * * *', 'sync-predictions'],
    [process.env.RECOMMENDATION_CRON ?? '*/15 * * * *', 'generate'],
    [process.env.SETTLEMENT_CRON ?? '10 */1 * * *', 'settle'],
  ] as const;

  for (const [expression, command] of schedules) {
    if (!cron.validate(expression)) throw new Error(`Invalid cron expression for ${command}: ${expression}`);
    cron.schedule(expression, () => void executeJob(command), { timezone: 'Asia/Ho_Chi_Minh' });
    console.log(`[worker] scheduled ${command}: ${expression}`);
  }

  setTimeout(() => void executeJob('generate'), 5_000);
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] received ${signal}; shutting down.`);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
