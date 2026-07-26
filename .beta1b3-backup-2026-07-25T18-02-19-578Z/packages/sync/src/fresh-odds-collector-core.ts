export const FRESH_ODDS_COLLECTOR_VERSION = 'v7.0-beta.1B.3-fresh-odds-collector-v1';

export const DEFAULT_FRESH_ODDS_HORIZONS_MINUTES = [180, 90, 30, 10, 5] as const;
export const FRESH_ODDS_CLOSING_PROXY_MINUTES = 5 as const;

export type FreshOddsWindowState = 'NOT_DUE' | 'DUE' | 'MISSED' | 'AFTER_KICKOFF';

export interface FreshOddsQuotaObservation {
  requestsRemainingDay: number | null;
  rateRemainingPerMinute: number | null;
}

export interface FreshOddsQuotaDecision {
  allowed: boolean;
  reason: 'OK' | 'DAILY_RESERVE' | 'MINUTE_RESERVE';
}

function finiteInteger(value: number, label: string, minimum = 0): number {
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

export function parseFreshOddsHorizons(
  value = process.env.FRESH_ODDS_HORIZONS_MINUTES ?? DEFAULT_FRESH_ODDS_HORIZONS_MINUTES.join(','),
): number[] {
  const source: string = value;
  const horizons: number[] = source
    .split(',')
    .map((item: string) => item.trim())
    .filter((item: string) => item.length > 0)
    .map((item: string) => Number(item));
  if (horizons.length === 0) throw new Error('FRESH_ODDS_HORIZONS_MINUTES cannot be empty.');
  for (const horizon of horizons) finiteInteger(horizon, 'fresh odds horizon', 1);
  const unique: number[] = Array.from(new Set<number>(horizons));
  return unique.sort((left: number, right: number) => right - left);
}

export function freshOddsHorizonLabel(horizonMinutes: number): string {
  finiteInteger(horizonMinutes, 'horizonMinutes', 1);
  return horizonMinutes === FRESH_ODDS_CLOSING_PROXY_MINUTES
    ? 'CLOSING_PROXY_T5'
    : `T-${horizonMinutes}`;
}

export function isClosingProxyHorizon(horizonMinutes: number): boolean {
  return horizonMinutes === FRESH_ODDS_CLOSING_PROXY_MINUTES;
}

export function freshOddsDueAt(kickoffAt: Date, horizonMinutes: number): Date {
  validDate(kickoffAt, 'kickoffAt');
  finiteInteger(horizonMinutes, 'horizonMinutes', 1);
  return new Date(kickoffAt.getTime() - horizonMinutes * 60_000);
}

export function classifyFreshOddsWindow(input: {
  now: Date;
  kickoffAt: Date;
  dueAt: Date;
  leadMinutes: number;
  toleranceMinutes: number;
}): FreshOddsWindowState {
  validDate(input.now, 'now');
  validDate(input.kickoffAt, 'kickoffAt');
  validDate(input.dueAt, 'dueAt');
  finiteInteger(input.leadMinutes, 'leadMinutes', 0);
  finiteInteger(input.toleranceMinutes, 'toleranceMinutes', 1);

  if (input.now.getTime() >= input.kickoffAt.getTime()) return 'AFTER_KICKOFF';
  const opensAt = input.dueAt.getTime() - input.leadMinutes * 60_000;
  const closesAt = input.dueAt.getTime() + input.toleranceMinutes * 60_000;
  if (input.now.getTime() < opensAt) return 'NOT_DUE';
  if (input.now.getTime() > closesAt) return 'MISSED';
  return 'DUE';
}

export function evaluateFreshOddsQuota(input: {
  observation: FreshOddsQuotaObservation | null;
  dailyReserve: number;
  minuteReserve: number;
}): FreshOddsQuotaDecision {
  finiteInteger(input.dailyReserve, 'dailyReserve', 0);
  finiteInteger(input.minuteReserve, 'minuteReserve', 0);
  if (input.observation == null) return { allowed: true, reason: 'OK' };
  if (
    input.observation.requestsRemainingDay != null &&
    input.observation.requestsRemainingDay <= input.dailyReserve
  ) {
    return { allowed: false, reason: 'DAILY_RESERVE' };
  }
  if (
    input.observation.rateRemainingPerMinute != null &&
    input.observation.rateRemainingPerMinute <= input.minuteReserve
  ) {
    return { allowed: false, reason: 'MINUTE_RESERVE' };
  }
  return { allowed: true, reason: 'OK' };
}

export function sourceAgeMinutes(input: { observedAt: Date; sourceUpdatedAt: Date | null }): number | null {
  validDate(input.observedAt, 'observedAt');
  if (input.sourceUpdatedAt == null) return null;
  validDate(input.sourceUpdatedAt, 'sourceUpdatedAt');
  return Math.max(0, (input.observedAt.getTime() - input.sourceUpdatedAt.getTime()) / 60_000);
}

export function summarizeSourceAges(values: Array<number | null>): {
  rows: number;
  knownRows: number;
  minimumMinutes: number | null;
  maximumMinutes: number | null;
  averageMinutes: number | null;
} {
  const known = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (known.length === 0) {
    return { rows: values.length, knownRows: 0, minimumMinutes: null, maximumMinutes: null, averageMinutes: null };
  }
  return {
    rows: values.length,
    knownRows: known.length,
    minimumMinutes: Math.min(...known),
    maximumMinutes: Math.max(...known),
    averageMinutes: known.reduce((sum, value) => sum + value, 0) / known.length,
  };
}
