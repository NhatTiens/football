import type { WorkerCommand } from './jobs.js';
import { executeJob } from './jobs.js';

export function wasWorkerJobSkipped(result: unknown): boolean {
  return Boolean(
    result &&
      typeof result === 'object' &&
      'skipped' in result &&
      (result as { skipped?: unknown }).skipped === true,
  );
}

export async function runResultStartupCatchUp(options: {
  maxAttempts?: number;
  retryDelayMs?: number;
  execute?: (command: WorkerCommand) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
} = {}): Promise<unknown> {
  const maxAttempts = Math.max(1, Math.min(30, options.maxAttempts ?? 12));
  const retryDelayMs = Math.max(250, Math.min(30_000, options.retryDelayMs ?? 2_000));
  const execute = options.execute ?? executeJob;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`[worker] startup result catch-up attempt ${attempt}/${maxAttempts}`);
    const result = await execute('startup-result-catch-up');

    if (!wasWorkerJobSkipped(result)) {
      console.log('[worker] startup result catch-up completed.');
      return result;
    }

    if (attempt < maxAttempts) {
      console.log(`[worker] startup catch-up busy; retry in ${retryDelayMs}ms.`);
      await sleep(retryDelayMs);
    }
  }

  throw new Error(`Startup result catch-up could not acquire worker after ${maxAttempts} attempts.`);
}
