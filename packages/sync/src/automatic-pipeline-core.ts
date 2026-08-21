export const AUTOMATIC_PIPELINE_VERSION = 'v1.0-backend-owned-fixture-prediction-result-realtime';

export type ApiFootballPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
export type AutomaticForceScope = 'FULL' | 'FIXTURES' | 'PREDICTIONS' | 'CONTEXT' | 'ODDS';

export interface FixtureCadenceInput {
  nearestKickoffMinutes: number | null;
  quotaRemaining: number | null;
  quotaLimit?: number;
}

export interface AutomaticPhaseDecisionInput {
  nowMs: number;
  lastSuccessMs: number | null;
  minimumIntervalMinutes: number;
  forced?: boolean;
}

export interface AutomaticQuotaState {
  limit: number;
  used: number;
  remaining: number;
  pressure: 'NORMAL' | 'CONSERVE' | 'CRITICAL';
}

export function clampInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

export function automaticQuotaState(input: {
  limit?: number | null | undefined;
  used?: number | null | undefined;
  remaining?: number | null | undefined;
}): AutomaticQuotaState {
  const limit = clampInteger(input.limit ?? 7500, 7500, 1, 7500);
  const used = clampInteger(input.used ?? 0, 0, 0, limit);
  const remaining = clampInteger(input.remaining ?? Math.max(0, limit - used), Math.max(0, limit - used), 0, limit);
  const ratio = remaining / limit;
  return {
    limit,
    used,
    remaining,
    pressure: ratio <= 0.05 ? 'CRITICAL' : ratio <= 0.15 ? 'CONSERVE' : 'NORMAL',
  };
}

export function fixtureDiscoveryIntervalMinutes(input: FixtureCadenceInput): number {
  const quota = automaticQuotaState({
    limit: input.quotaLimit ?? 7500,
    remaining: input.quotaRemaining ?? undefined,
  });
  const nearest = input.nearestKickoffMinutes;

  let minutes = 360;
  if (nearest != null && Number.isFinite(nearest)) {
    if (nearest <= 120) minutes = 10;
    else if (nearest <= 24 * 60) minutes = 30;
    else if (nearest <= 72 * 60) minutes = 90;
  }

  if (quota.pressure === 'CONSERVE') return Math.max(minutes, 180);
  if (quota.pressure === 'CRITICAL') return Math.max(minutes, 360);
  return minutes;
}

export function shouldRunAutomaticPhase(input: AutomaticPhaseDecisionInput): boolean {
  if (input.forced) return true;
  if (input.lastSuccessMs == null) return true;
  const minimumAgeMs = Math.max(1, input.minimumIntervalMinutes) * 60_000;
  return input.nowMs - input.lastSuccessMs >= minimumAgeMs;
}

export function priorityReserveFloor(priority: ApiFootballPriority): number {
  if (priority === 'CRITICAL') return 0;
  if (priority === 'HIGH') return 100;
  if (priority === 'LOW') return 750;
  return 250;
}

export function resultRetryDelayMinutes(attempt: number): number {
  const schedule = [7, 10, 15, 20, 30, 45, 60] as const;
  const index = Math.max(0, Math.min(schedule.length - 1, Math.trunc(attempt) - 1));
  return schedule[index]!;
}

export function predictionRetryDelayMinutes(attempt: number): number {
  const schedule = [5, 10, 20, 30, 60, 120, 180] as const;
  const index = Math.max(0, Math.min(schedule.length - 1, Math.trunc(attempt) - 1));
  return schedule[index]!;
}

export function normalizeForceScope(value: unknown): AutomaticForceScope {
  const normalized = String(value ?? 'FULL').toUpperCase();
  if (normalized === 'FIXTURES') return 'FIXTURES';
  if (normalized === 'PREDICTIONS') return 'PREDICTIONS';
  if (normalized === 'CONTEXT') return 'CONTEXT';
  if (normalized === 'ODDS') return 'ODDS';
  return 'FULL';
}

export function forceScopeIncludes(scope: AutomaticForceScope, phase: Exclude<AutomaticForceScope, 'FULL'>): boolean {
  return scope === 'FULL' || scope === phase;
}
