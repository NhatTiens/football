export const DEFAULT_CONTEXT_HORIZONS_MINUTES = [90, 30, 5] as const;

export type ContextCheckpointStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'RETRY'
  | 'MISSED'
  | 'FAILED';

export interface RepeatedContextConfig {
  horizonsMinutes: number[];
  dueLeadMinutes: number;
  dueToleranceMinutes: number;
  maximumFixturesPerRun: number;
  maximumAttempts: number;
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envHorizons(name: string, fallback: readonly number[]): number[] {
  const raw = process.env[name];
  const values = (raw ?? fallback.join(','))
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 1)
    .map((value) => Math.floor(value));
  return [...new Set(values)].sort((a, b) => b - a);
}

export function getRepeatedContextConfig(): RepeatedContextConfig {
  return {
    horizonsMinutes: envHorizons(
      'SCIENTIFIC_CONTEXT_HORIZONS_MINUTES',
      DEFAULT_CONTEXT_HORIZONS_MINUTES,
    ),
    dueLeadMinutes: Math.max(
      0,
      Math.floor(envNumber('SCIENTIFIC_CONTEXT_DUE_LEAD_MINUTES', 4)),
    ),
    dueToleranceMinutes: Math.max(
      1,
      Math.floor(envNumber('SCIENTIFIC_CONTEXT_DUE_TOLERANCE_MINUTES', 12)),
    ),
    maximumFixturesPerRun: Math.max(
      1,
      Math.floor(envNumber('SCIENTIFIC_CONTEXT_MAX_FIXTURES_PER_RUN', 4)),
    ),
    maximumAttempts: Math.max(
      1,
      Math.floor(envNumber('SCIENTIFIC_CONTEXT_MAX_ATTEMPTS', 3)),
    ),
  };
}

export function getContextDueAt(
  kickoffAt: Date,
  horizonMinutes: number,
): Date {
  return new Date(kickoffAt.getTime() - horizonMinutes * 60_000);
}

export function classifyContextCheckpoint(input: {
  now: Date;
  dueAt: Date;
  dueLeadMinutes: number;
  dueToleranceMinutes: number;
}): 'EARLY' | 'DUE' | 'MISSED' {
  const earlyBoundary =
    input.now.getTime() + input.dueLeadMinutes * 60_000;
  const missedBoundary =
    input.now.getTime() - input.dueToleranceMinutes * 60_000;

  if (input.dueAt.getTime() > earlyBoundary) return 'EARLY';
  if (input.dueAt.getTime() < missedBoundary) return 'MISSED';
  return 'DUE';
}
