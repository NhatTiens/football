import { describe, expect, it } from 'vitest';

import {
  PointInTimeAudit,
  PointInTimeLeakageError,
  createPredictionContext,
  estimateFixtureResultAvailableAt,
  latestAvailableAtOrBefore,
} from '../src/point-in-time.js';

describe('point-in-time contract', () => {
  const kickoffAt = new Date('2026-07-23T12:00:00.000Z');
  const predictionAsOf = new Date('2026-07-23T10:30:00.000Z');

  it('creates a deterministic prediction context', () => {
    const context = createPredictionContext({
      fixtureId: 101,
      kickoffAt,
      predictionAsOf,
      mode: 'BACKTEST',
    });

    expect(context.horizonMinutes).toBe(90);
    expect(context.predictionAsOf.toISOString()).toBe('2026-07-23T10:30:00.000Z');
  });

  it('rejects prediction times after kickoff', () => {
    expect(() =>
      createPredictionContext({
        fixtureId: 101,
        kickoffAt,
        predictionAsOf: new Date('2026-07-23T12:00:00.001Z'),
        mode: 'BACKTEST',
      }),
    ).toThrow(/cannot be after kickoffAt/);
  });

  it('accepts a feature available exactly at predictionAsOf', () => {
    const audit = new PointInTimeAudit(
      createPredictionContext({
        fixtureId: 101,
        kickoffAt,
        predictionAsOf,
        mode: 'BACKTEST',
      }),
    );

    audit.register('EXTERNAL_PREDICTION', 'fixture:101', new Date(predictionAsOf));

    expect(audit.summary().observationCount).toBe(1);
  });

  it('throws on a feature one millisecond in the future', () => {
    const audit = new PointInTimeAudit(
      createPredictionContext({
        fixtureId: 101,
        kickoffAt,
        predictionAsOf,
        mode: 'BACKTEST',
      }),
    );

    expect(() =>
      audit.register('TEAM_METRIC', 'fixture:80:team:9', new Date(predictionAsOf.getTime() + 1)),
    ).toThrow(PointInTimeLeakageError);
  });

  it('selects only the latest row available at the replay time', () => {
    const rows = [
      { id: 1, capturedAt: new Date('2026-07-23T09:00:00.000Z') },
      { id: 2, capturedAt: new Date('2026-07-23T10:30:00.000Z') },
      { id: 3, capturedAt: new Date('2026-07-23T10:30:00.001Z') },
    ];

    expect(latestAvailableAtOrBefore(rows, predictionAsOf, (row) => row.capturedAt)?.id).toBe(2);
  });

  it('uses a conservative result availability lag', () => {
    expect(
      estimateFixtureResultAvailableAt(new Date('2026-07-23T06:00:00.000Z'), 180).toISOString(),
    ).toBe('2026-07-23T09:00:00.000Z');
  });

  it('reports source-level provenance', () => {
    const audit = new PointInTimeAudit(
      createPredictionContext({
        fixtureId: 101,
        kickoffAt,
        predictionAsOf,
        mode: 'BACKTEST',
      }),
    );

    audit.register('LINEUP', 'lineup:home', new Date('2026-07-23T10:00:00.000Z'));
    audit.register('LINEUP', 'lineup:away', new Date('2026-07-23T10:10:00.000Z'));

    const summary = audit.summary();
    expect(summary.sources.LINEUP?.count).toBe(2);
    expect(summary.sources.LINEUP?.maxAvailableAt?.toISOString()).toBe('2026-07-23T10:10:00.000Z');
  });
});
