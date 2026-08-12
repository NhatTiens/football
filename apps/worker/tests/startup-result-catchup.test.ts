import { describe, expect, it, vi } from 'vitest';
import {
  runResultStartupCatchUp,
  wasWorkerJobSkipped,
} from '../src/startup-result-catchup';

describe('result startup catch-up', () => {
  it('recognizes skipped results', () => {
    expect(wasWorkerJobSkipped({ skipped: true })).toBe(true);
    expect(wasWorkerJobSkipped({ skipped: false })).toBe(false);
  });

  it('runs immediately when free', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const sleep = vi.fn(async () => undefined);
    await expect(
      runResultStartupCatchUp({ execute, sleep, maxAttempts: 3, retryDelayMs: 250 }),
    ).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries if worker is busy', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ skipped: true })
      .mockResolvedValueOnce({ skipped: true })
      .mockResolvedValueOnce({ settled: 2 });
    const sleep = vi.fn(async () => undefined);

    await expect(
      runResultStartupCatchUp({ execute, sleep, maxAttempts: 5, retryDelayMs: 250 }),
    ).resolves.toEqual({ settled: 2 });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});
