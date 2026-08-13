import { describe, expect, it } from 'vitest';

const trial = await import('../src/trial.ts');

describe('Registration trial anti-abuse', () => {
  it('creates exactly a seven-day trial window for a new identity', () => {
    const now = new Date('2026-08-13T10:00:00.000Z');
    const window = trial.createTrialWindow(now);
    expect(trial.canIssueTrial(null)).toBe(true);
    expect(window.startedAt).toEqual(now);
    expect(window.endsAt.toISOString()).toBe('2026-08-20T10:00:00.000Z');
  });

  it('does not issue trial again and hashes normalized email deterministically', () => {
    expect(trial.canIssueTrial({ used: true })).toBe(false);
    expect(trial.trialIdentityHash(' User@Example.com ')).toBe(
      trial.trialIdentityHash('user@example.com'),
    );
    expect(trial.trialIdentityHash('user@example.com')).toHaveLength(64);
  });
});
