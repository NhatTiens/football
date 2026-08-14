import '../../../scripts/api-football-quota-preload.mjs';
import 'dotenv/config';

process.env.HISTORY_RESULT_WORKER_OWNER = 'true';
process.env.HISTORY_RESULT_EXCLUSIVE_MODE = 'true';

const [{ prisma }, { runHistoryResultWorker }] = await Promise.all([
  import('@football-ai/database'),
  import('./history-result-worker.js'),
]);

const intervalMs = Math.max(
  60_000,
  Number(process.env.HISTORY_RESULT_WORKER_INTERVAL_MS ?? 300_000),
);

let running = false;
let stopped = false;

async function tick(): Promise<void> {
  if (running || stopped) return;
  running = true;
  try {
    const result = await runHistoryResultWorker();
    console.log('[history-result-worker]', JSON.stringify(result));
  } catch (error) {
    console.error('[history-result-worker] cycle failed', error);
  } finally {
    running = false;
  }
}

void tick();
const timer = setInterval(() => void tick(), intervalMs);

async function shutdown(signal: string): Promise<void> {
  stopped = true;
  clearInterval(timer);
  console.log(`[history-result-worker] received ${signal}; shutting down.`);
  while (running) await new Promise((resolve) => setTimeout(resolve, 100));
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
