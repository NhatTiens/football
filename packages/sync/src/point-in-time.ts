export type PredictionMode = 'LIVE' | 'BACKTEST' | 'REPLAY';

export type FeatureSource =
  | 'FIXTURE_RESULT'
  | 'TEAM_METRIC'
  | 'INJURY'
  | 'LINEUP'
  | 'EXTERNAL_PREDICTION'
  | 'MODEL_ARTIFACT'
  | 'ODDS'
  | 'COVERAGE';

export type FeatureMetadataValue = string | number | boolean | null;

export interface PredictionContext {
  fixtureId: number;
  kickoffAt: Date;
  predictionAsOf: Date;
  mode: PredictionMode;
  horizonMinutes: number;
}

export interface FeatureObservationInput {
  key: string;
  availableAt: Date;
  metadata?: Record<string, FeatureMetadataValue>;
}

export interface FeatureObservation extends FeatureObservationInput {
  source: FeatureSource;
}

export interface PointInTimeSourceSummary {
  count: number;
  maxAvailableAt: Date | null;
}

export interface PointInTimeAuditSummary {
  fixtureId: number;
  mode: PredictionMode;
  predictionAsOf: Date;
  horizonMinutes: number;
  observationCount: number;
  maxAvailableAt: Date | null;
  sources: Partial<Record<FeatureSource, PointInTimeSourceSummary>>;
}

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date.`);
  }
}

export class PointInTimeLeakageError extends Error {
  readonly fixtureId: number;
  readonly source: FeatureSource;
  readonly featureKey: string;
  readonly availableAt: Date;
  readonly predictionAsOf: Date;

  constructor(input: {
    fixtureId: number;
    source: FeatureSource;
    featureKey: string;
    availableAt: Date;
    predictionAsOf: Date;
  }) {
    super(
      `Point-in-time leakage for fixture ${input.fixtureId}: ` +
        `${input.source}/${input.featureKey} became available at ` +
        `${input.availableAt.toISOString()}, after predictionAsOf ` +
        `${input.predictionAsOf.toISOString()}.`,
    );
    this.name = 'PointInTimeLeakageError';
    this.fixtureId = input.fixtureId;
    this.source = input.source;
    this.featureKey = input.featureKey;
    this.availableAt = input.availableAt;
    this.predictionAsOf = input.predictionAsOf;
  }
}

export function createPredictionContext(input: {
  fixtureId: number;
  kickoffAt: Date;
  predictionAsOf: Date;
  mode: PredictionMode;
}): PredictionContext {
  assertValidDate(input.kickoffAt, 'kickoffAt');
  assertValidDate(input.predictionAsOf, 'predictionAsOf');

  if (!Number.isInteger(input.fixtureId) || input.fixtureId <= 0) {
    throw new RangeError('fixtureId must be a positive integer.');
  }

  if (input.predictionAsOf.getTime() > input.kickoffAt.getTime()) {
    throw new RangeError(
      `predictionAsOf ${input.predictionAsOf.toISOString()} cannot be after ` +
        `kickoffAt ${input.kickoffAt.toISOString()}.`,
    );
  }

  return {
    fixtureId: input.fixtureId,
    kickoffAt: new Date(input.kickoffAt),
    predictionAsOf: new Date(input.predictionAsOf),
    mode: input.mode,
    horizonMinutes: Math.max(
      0,
      Math.round((input.kickoffAt.getTime() - input.predictionAsOf.getTime()) / 60_000),
    ),
  };
}

export function isAvailableAtOrBefore(availableAt: Date, predictionAsOf: Date): boolean {
  assertValidDate(availableAt, 'availableAt');
  assertValidDate(predictionAsOf, 'predictionAsOf');
  return availableAt.getTime() <= predictionAsOf.getTime();
}

export function assertAvailableAt(input: {
  context: PredictionContext;
  source: FeatureSource;
  key: string;
  availableAt: Date;
}): void {
  assertValidDate(input.availableAt, 'availableAt');

  if (!isAvailableAtOrBefore(input.availableAt, input.context.predictionAsOf)) {
    throw new PointInTimeLeakageError({
      fixtureId: input.context.fixtureId,
      source: input.source,
      featureKey: input.key,
      availableAt: input.availableAt,
      predictionAsOf: input.context.predictionAsOf,
    });
  }
}

export function estimateFixtureResultAvailableAt(
  kickoffAt: Date,
  availabilityLagMinutes: number,
): Date {
  assertValidDate(kickoffAt, 'kickoffAt');

  if (!Number.isFinite(availabilityLagMinutes) || availabilityLagMinutes < 0) {
    throw new RangeError('availabilityLagMinutes must be a non-negative finite number.');
  }

  return new Date(kickoffAt.getTime() + availabilityLagMinutes * 60_000);
}

export function latestAvailableAtOrBefore<T>(
  rows: readonly T[],
  predictionAsOf: Date,
  getAvailableAt: (row: T) => Date,
): T | null {
  assertValidDate(predictionAsOf, 'predictionAsOf');

  let selected: T | null = null;
  let selectedTime = Number.NEGATIVE_INFINITY;

  for (const row of rows) {
    const availableAt = getAvailableAt(row);
    assertValidDate(availableAt, 'availableAt');

    const time = availableAt.getTime();
    if (time <= predictionAsOf.getTime() && time > selectedTime) {
      selected = row;
      selectedTime = time;
    }
  }

  return selected;
}

export class PointInTimeAudit {
  private readonly observations: FeatureObservation[] = [];

  constructor(readonly context: PredictionContext) {}

  register(
    source: FeatureSource,
    key: string,
    availableAt: Date,
    metadata?: Record<string, FeatureMetadataValue>,
  ): void {
    assertAvailableAt({
      context: this.context,
      source,
      key,
      availableAt,
    });

    this.observations.push({
      source,
      key,
      availableAt: new Date(availableAt),
      ...(metadata === undefined ? {} : { metadata: { ...metadata } }),
    });
  }

  registerMany(source: FeatureSource, observations: Iterable<FeatureObservationInput>): void {
    for (const observation of observations) {
      this.register(source, observation.key, observation.availableAt, observation.metadata);
    }
  }

  list(): readonly FeatureObservation[] {
    return this.observations.map((observation) => ({
      source: observation.source,
      key: observation.key,
      availableAt: new Date(observation.availableAt),
      ...(observation.metadata === undefined ? {} : { metadata: { ...observation.metadata } }),
    }));
  }

  summary(): PointInTimeAuditSummary {
    const sources: Partial<Record<FeatureSource, PointInTimeSourceSummary>> = {};
    let maxAvailableAt: Date | null = null;

    for (const observation of this.observations) {
      const current: PointInTimeSourceSummary = sources[observation.source] ?? {
        count: 0,
        maxAvailableAt: null,
      };
      const currentMax = current.maxAvailableAt;

      current.count += 1;
      if (currentMax == null || observation.availableAt.getTime() > currentMax.getTime()) {
        current.maxAvailableAt = new Date(observation.availableAt);
      }
      sources[observation.source] = current;

      if (maxAvailableAt == null || observation.availableAt.getTime() > maxAvailableAt.getTime()) {
        maxAvailableAt = new Date(observation.availableAt);
      }
    }

    return {
      fixtureId: this.context.fixtureId,
      mode: this.context.mode,
      predictionAsOf: new Date(this.context.predictionAsOf),
      horizonMinutes: this.context.horizonMinutes,
      observationCount: this.observations.length,
      maxAvailableAt,
      sources,
    };
  }
}
