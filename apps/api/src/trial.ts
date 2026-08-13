import crypto from 'node:crypto';

import { FREE_TRIAL_DAYS } from './pricing-core.js';

export interface TrialWindow {
  startedAt: Date;
  endsAt: Date;
}

export function trialIdentityHash(normalizedEmail: string): string {
  return crypto.createHash('sha256').update(normalizedEmail.trim().toLowerCase()).digest('hex');
}

export function createTrialWindow(now: Date = new Date()): TrialWindow {
  return {
    startedAt: now,
    endsAt: new Date(now.getTime() + FREE_TRIAL_DAYS * 86_400_000),
  };
}

export function canIssueTrial(existingClaim: { used: boolean } | null): boolean {
  return existingClaim == null || existingClaim.used === false;
}
