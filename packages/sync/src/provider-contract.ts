export const BETA1A_PROVIDER_VERSION = 'v7.0-beta.1A-provider-replay-v1';

export const BETA1A_REPLAY_POLICY_VERSION = 'historical-replay-non-promotional-v1';

export const BETA1A_REPLAY_EVIDENCE_CLASS = 'REPLAY_ONLY_NON_PROMOTIONAL';

export type FootballProviderMode = 'REPLAY' | 'LIVE';

export type ProviderCapabilityName =
  'FIXTURES' | 'RESULTS' | 'TEAM_METRICS' | 'ODDS' | 'STANDINGS' | 'INJURIES' | 'LINEUPS';

export type ReplaySchedulerEventType =
  | 'FIXTURE_DISCOVERY'
  | 'FUNDAMENTALS_REFRESH'
  | 'T90_SHADOW_TRIGGER'
  | 'T30_OBSERVATION'
  | 'T5_OBSERVATION'
  | 'RESULT_SETTLEMENT';

export type MatchWinnerClass = 'HOME' | 'DRAW' | 'AWAY';

export interface MatchWinnerProbabilities {
  HOME: number;
  DRAW: number;
  AWAY: number;
}

export interface ProviderCapabilities {
  FIXTURES: boolean;
  RESULTS: boolean;
  TEAM_METRICS: boolean;
  ODDS: boolean;
  STANDINGS: boolean;
  INJURIES: boolean;
  LINEUPS: boolean;
  historicalFrom: string | null;
  historicalTo: string | null;
  live: boolean;
}

export interface NormalizedProviderFixture {
  fixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
}

export interface ProviderPrematchSnapshot {
  fixtureId: number;
  asOf: Date;
  teamMetricSnapshotCount: number;
  oddsSnapshotCount: number;
  latestTeamMetricCapturedAt: Date | null;
  latestOddsCapturedAt: Date | null;
}

export interface ProviderResultSnapshot {
  fixtureId: number;
  availableAt: Date;
  homeGoals: number;
  awayGoals: number;
}

export interface ReplaySchedulerEvent {
  type: ReplaySchedulerEventType;
  scheduledAt: Date;
  prematch: boolean;
}

export interface FootballDataProvider {
  readonly key: string;
  readonly mode: FootballProviderMode;
  capabilities(): ProviderCapabilities;
  health(): Promise<{
    status: 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
    details: Record<string, unknown>;
  }>;
  listFixtures(input: {
    dateFrom: Date;
    dateTo: Date;
    limit?: number;
  }): Promise<NormalizedProviderFixture[]>;
  getPrematchSnapshot(input: { fixtureId: number; asOf: Date }): Promise<ProviderPrematchSnapshot>;
  getResult(input: { fixtureId: number; asOf: Date }): Promise<ProviderResultSnapshot | null>;
}

export function parseFootballProviderMode(value: string | undefined): FootballProviderMode {
  const normalized = value?.trim().toUpperCase() ?? 'REPLAY';

  if (normalized === 'REPLAY' || normalized === 'LIVE') {
    return normalized;
  }

  throw new Error(`Unsupported FOOTBALL_PROVIDER_MODE: ${value ?? ''}`);
}

export function resultAvailableAt(kickoffAt: Date, lagMinutes = 180): Date {
  if (!(kickoffAt instanceof Date) || !Number.isFinite(kickoffAt.getTime())) {
    throw new TypeError('kickoffAt must be a valid Date.');
  }

  if (!Number.isFinite(lagMinutes) || lagMinutes < 0) {
    throw new RangeError('lagMinutes must be non-negative.');
  }

  return new Date(kickoffAt.getTime() + lagMinutes * 60_000);
}

export function buildReplaySchedulerPlan(
  kickoffAt: Date,
  resultLagMinutes = 180,
): ReplaySchedulerEvent[] {
  const minute = 60_000;

  return [
    {
      type: 'FIXTURE_DISCOVERY',
      scheduledAt: new Date(kickoffAt.getTime() - 180 * minute),
      prematch: true,
    },
    {
      type: 'FUNDAMENTALS_REFRESH',
      scheduledAt: new Date(kickoffAt.getTime() - 120 * minute),
      prematch: true,
    },
    {
      type: 'T90_SHADOW_TRIGGER',
      scheduledAt: new Date(kickoffAt.getTime() - 90 * minute),
      prematch: true,
    },
    {
      type: 'T30_OBSERVATION',
      scheduledAt: new Date(kickoffAt.getTime() - 30 * minute),
      prematch: true,
    },
    {
      type: 'T5_OBSERVATION',
      scheduledAt: new Date(kickoffAt.getTime() - 5 * minute),
      prematch: true,
    },
    {
      type: 'RESULT_SETTLEMENT',
      scheduledAt: resultAvailableAt(kickoffAt, resultLagMinutes),
      prematch: false,
    },
  ];
}

export function assertReplaySchedulerPlan(kickoffAt: Date, events: ReplaySchedulerEvent[]): void {
  if (events.length === 0) {
    throw new Error('Replay scheduler plan cannot be empty.');
  }

  for (let index = 0; index < events.length; index += 1) {
    const current = events[index]!;

    if (current.prematch && current.scheduledAt.getTime() >= kickoffAt.getTime()) {
      throw new Error(`${current.type} must occur before kickoff.`);
    }

    if (index > 0 && current.scheduledAt.getTime() <= events[index - 1]!.scheduledAt.getTime()) {
      throw new Error('Replay scheduler events must be strictly chronological.');
    }
  }
}

export function pointInTimeSafe(capturedAt: Date | null, predictionAsOf: Date): boolean {
  return capturedAt == null || capturedAt.getTime() <= predictionAsOf.getTime();
}

export function classifyMatchWinner(homeGoals: number, awayGoals: number): MatchWinnerClass {
  if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) {
    throw new TypeError('Goals must be finite numbers.');
  }

  return homeGoals > awayGoals ? 'HOME' : homeGoals === awayGoals ? 'DRAW' : 'AWAY';
}

export function normalizeReplayProbabilities(
  input: MatchWinnerProbabilities,
): MatchWinnerProbabilities {
  const values = [
    Math.max(0, Number.isFinite(input.HOME) ? input.HOME : 0),
    Math.max(0, Number.isFinite(input.DRAW) ? input.DRAW : 0),
    Math.max(0, Number.isFinite(input.AWAY) ? input.AWAY : 0),
  ];
  const total = values.reduce((sum, value) => sum + value, 0);

  if (total <= 1e-12) {
    return {
      HOME: 1 / 3,
      DRAW: 1 / 3,
      AWAY: 1 / 3,
    };
  }

  return {
    HOME: values[0]! / total,
    DRAW: values[1]! / total,
    AWAY: values[2]! / total,
  };
}

export function replayBrierScore(
  probabilities: MatchWinnerProbabilities,
  actual: MatchWinnerClass,
): number {
  const normalized = normalizeReplayProbabilities(probabilities);

  return (
    (normalized.HOME - (actual === 'HOME' ? 1 : 0)) ** 2 +
    (normalized.DRAW - (actual === 'DRAW' ? 1 : 0)) ** 2 +
    (normalized.AWAY - (actual === 'AWAY' ? 1 : 0)) ** 2
  );
}

export function replayLogLoss(
  probabilities: MatchWinnerProbabilities,
  actual: MatchWinnerClass,
): number {
  const normalized = normalizeReplayProbabilities(probabilities);

  return -Math.log(Math.max(1e-12, normalized[actual]));
}

export function replayEvidenceCanPromote(evidenceClass: string): false {
  void evidenceClass;
  return false;
}
