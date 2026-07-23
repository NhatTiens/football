export const REPEATED_ODDS_STATUSES = [
  'PENDING',
  'RUNNING',
  'SUCCESS',
  'EMPTY',
  'RETRY',
  'FAILED',
  'SKIPPED',
] as const;

export type RepeatedOddsStatus = (typeof REPEATED_ODDS_STATUSES)[number];

export type RepeatedOddsWindowState = 'NOT_DUE' | 'DUE' | 'MISSED' | 'AFTER_KICKOFF';

export interface RepeatedOddsCollectionConfig {
  horizonsMinutes: number[];
  dueToleranceMinutes: number;
  dueLeadMinutes: number;
  maximumFixturesPerRun: number;
  lockMinutes: number;
  retryMinutes: number;
  maximumAttempts: number;
  dailyRequestReserve: number;
  minuteRequestReserve: number;
}

export interface QuotaObservation {
  requestDate: Date;
  dailyRemaining: number | null;
  minuteRemaining: number | null;
}

export interface QuotaDecision {
  allowed: boolean;
  reason: 'OK' | 'DAILY_RESERVE' | 'MINUTE_RESERVE';
}

export interface CollectionOutcomeInput {
  now: Date;
  dueAt: Date;
  dueToleranceMinutes: number;
  attempts: number;
  maximumAttempts: number;
  retryMinutes: number;
  processed: number;
  errorMessage?: string;
}

export interface CollectionOutcome {
  status: 'SUCCESS' | 'EMPTY' | 'RETRY' | 'FAILED';
  completedAt: Date | null;
  nextRetryAt: Date | null;
  errorMessage: string | null;
}

function assertFiniteInteger(value: number, label: string, minimum = 0): number {
  if (!Number.isInteger(value) || !Number.isFinite(value) || value < minimum) {
    throw new RangeError(`${label} must be an integer >= ${minimum}.`);
  }
  return value;
}

function validDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date.`);
  }
}

function numberEnvironment(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseRepeatedOddsHorizons(
  value = process.env.ODDS_REPEATED_HORIZONS_MINUTES ?? '1440,360,180,90,30,10',
): number[] {
  const horizons = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(Number);

  if (horizons.length === 0) {
    throw new Error('ODDS_REPEATED_HORIZONS_MINUTES cannot be empty.');
  }

  for (const horizon of horizons) {
    assertFiniteInteger(horizon, 'Repeated odds horizon', 1);
  }

  return [...new Set(horizons)].sort((left, right) => right - left);
}

export function getRepeatedOddsCollectionConfig(): RepeatedOddsCollectionConfig {
  return {
    horizonsMinutes: parseRepeatedOddsHorizons(),
    dueToleranceMinutes: assertFiniteInteger(
      Math.round(numberEnvironment('ODDS_REPEATED_DUE_TOLERANCE_MINUTES', 12)),
      'ODDS_REPEATED_DUE_TOLERANCE_MINUTES',
      1,
    ),
    dueLeadMinutes: assertFiniteInteger(
      Math.round(numberEnvironment('ODDS_REPEATED_DUE_LEAD_MINUTES', 2)),
      'ODDS_REPEATED_DUE_LEAD_MINUTES',
      0,
    ),
    maximumFixturesPerRun: assertFiniteInteger(
      Math.round(numberEnvironment('ODDS_REPEATED_MAX_FIXTURES_PER_RUN', 8)),
      'ODDS_REPEATED_MAX_FIXTURES_PER_RUN',
      1,
    ),
    lockMinutes: assertFiniteInteger(
      Math.round(numberEnvironment('ODDS_REPEATED_LOCK_MINUTES', 15)),
      'ODDS_REPEATED_LOCK_MINUTES',
      1,
    ),
    retryMinutes: assertFiniteInteger(
      Math.round(numberEnvironment('ODDS_REPEATED_RETRY_MINUTES', 4)),
      'ODDS_REPEATED_RETRY_MINUTES',
      1,
    ),
    maximumAttempts: assertFiniteInteger(
      Math.round(numberEnvironment('ODDS_REPEATED_MAX_ATTEMPTS', 3)),
      'ODDS_REPEATED_MAX_ATTEMPTS',
      1,
    ),
    dailyRequestReserve: assertFiniteInteger(
      Math.round(numberEnvironment('ODDS_REPEATED_DAILY_REQUEST_RESERVE', 50)),
      'ODDS_REPEATED_DAILY_REQUEST_RESERVE',
      0,
    ),
    minuteRequestReserve: assertFiniteInteger(
      Math.round(numberEnvironment('ODDS_REPEATED_MINUTE_REQUEST_RESERVE', 2)),
      'ODDS_REPEATED_MINUTE_REQUEST_RESERVE',
      0,
    ),
  };
}

export function getRepeatedOddsDueAt(kickoffAt: Date, horizonMinutes: number): Date {
  validDate(kickoffAt, 'kickoffAt');
  assertFiniteInteger(horizonMinutes, 'horizonMinutes', 1);
  return new Date(kickoffAt.getTime() - horizonMinutes * 60_000);
}

export function buildRepeatedOddsCheckpointKey(fixtureId: number, horizonMinutes: number): string {
  assertFiniteInteger(fixtureId, 'fixtureId', 1);
  assertFiniteInteger(horizonMinutes, 'horizonMinutes', 1);
  return `${fixtureId}:T-${horizonMinutes}`;
}

export function classifyRepeatedOddsWindow(input: {
  now: Date;
  kickoffAt: Date;
  dueAt: Date;
  dueToleranceMinutes: number;
  dueLeadMinutes: number;
}): RepeatedOddsWindowState {
  validDate(input.now, 'now');
  validDate(input.kickoffAt, 'kickoffAt');
  validDate(input.dueAt, 'dueAt');

  if (input.now.getTime() >= input.kickoffAt.getTime()) {
    return 'AFTER_KICKOFF';
  }

  const opensAt = input.dueAt.getTime() - input.dueLeadMinutes * 60_000;
  const closesAt = input.dueAt.getTime() + input.dueToleranceMinutes * 60_000;

  if (input.now.getTime() < opensAt) {
    return 'NOT_DUE';
  }

  if (input.now.getTime() > closesAt) {
    return 'MISSED';
  }

  return 'DUE';
}

function sameUtcDate(left: Date, right: Date): boolean {
  return (
    left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate()
  );
}

export function evaluateRepeatedOddsQuota(input: {
  now: Date;
  observation: QuotaObservation | null;
  dailyRequestReserve: number;
  minuteRequestReserve: number;
}): QuotaDecision {
  validDate(input.now, 'now');

  if (!input.observation) {
    return { allowed: true, reason: 'OK' };
  }

  validDate(input.observation.requestDate, 'observation.requestDate');

  if (
    sameUtcDate(input.now, input.observation.requestDate) &&
    input.observation.dailyRemaining != null &&
    input.observation.dailyRemaining <= input.dailyRequestReserve
  ) {
    return {
      allowed: false,
      reason: 'DAILY_RESERVE',
    };
  }

  const ageMs = input.now.getTime() - input.observation.requestDate.getTime();

  if (
    ageMs >= 0 &&
    ageMs <= 120_000 &&
    input.observation.minuteRemaining != null &&
    input.observation.minuteRemaining <= input.minuteRequestReserve
  ) {
    return {
      allowed: false,
      reason: 'MINUTE_RESERVE',
    };
  }

  return { allowed: true, reason: 'OK' };
}

export function resolveRepeatedOddsOutcome(input: CollectionOutcomeInput): CollectionOutcome {
  validDate(input.now, 'now');
  validDate(input.dueAt, 'dueAt');

  if (input.processed > 0) {
    return {
      status: 'SUCCESS',
      completedAt: new Date(input.now),
      nextRetryAt: null,
      errorMessage: null,
    };
  }

  const windowClosed =
    input.now.getTime() >= input.dueAt.getTime() + input.dueToleranceMinutes * 60_000;
  const exhausted = input.attempts >= input.maximumAttempts;

  if (windowClosed || exhausted) {
    return {
      status: input.errorMessage ? 'FAILED' : 'EMPTY',
      completedAt: new Date(input.now),
      nextRetryAt: null,
      errorMessage: input.errorMessage ?? 'API returned no usable pre-match odds.',
    };
  }

  return {
    status: 'RETRY',
    completedAt: null,
    nextRetryAt: new Date(input.now.getTime() + input.retryMinutes * 60_000),
    errorMessage: input.errorMessage ?? 'API returned no usable pre-match odds; retry scheduled.',
  };
}
