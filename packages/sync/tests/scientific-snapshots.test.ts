import { describe, expect, it } from 'vitest';

import {
  externalPredictionSnapshotHash,
  fixtureTeamMetricSnapshotHash,
  selectLatestSnapshotsAsOf,
} from '../src/scientific-snapshots.js';

describe('append-only scientific snapshots', () => {
  const t90 = new Date('2026-07-23T10:30:00.000Z');
  const t30 = new Date('2026-07-23T11:30:00.000Z');

  const rows = [
    {
      id: 1,
      fixtureId: 50,
      teamId: 7,
      value: 1.1,
      capturedAt: new Date('2026-07-23T10:00:00.000Z'),
    },
    {
      id: 2,
      fixtureId: 50,
      teamId: 7,
      value: 1.4,
      capturedAt: new Date('2026-07-23T11:00:00.000Z'),
    },
    {
      id: 3,
      fixtureId: 50,
      teamId: 7,
      value: 1.6,
      capturedAt: new Date('2026-07-23T11:45:00.000Z'),
    },
    {
      id: 4,
      fixtureId: 50,
      teamId: 8,
      value: 0.9,
      capturedAt: new Date('2026-07-23T10:10:00.000Z'),
    },
  ];

  it('T-90 cannot see the T-30 snapshot', () => {
    const selected = selectLatestSnapshotsAsOf(
      rows,
      t90,
      (row) => `${row.fixtureId}:${row.teamId}`,
    );

    expect(selected.find((row) => row.teamId === 7)?.id).toBe(1);
  });

  it('T-30 sees the newest snapshot already available', () => {
    const selected = selectLatestSnapshotsAsOf(
      rows,
      t30,
      (row) => `${row.fixtureId}:${row.teamId}`,
    );

    expect(selected.find((row) => row.teamId === 7)?.id).toBe(2);
  });

  it('never selects a snapshot from the future', () => {
    const selected = selectLatestSnapshotsAsOf(
      rows,
      t30,
      (row) => `${row.fixtureId}:${row.teamId}`,
    );

    expect(selected.some((row) => row.id === 3)).toBe(false);
    expect(selected.every((row) => row.capturedAt.getTime() <= t30.getTime())).toBe(true);
  });

  it('uses the greatest id as a deterministic tie-breaker', () => {
    const tied = [
      {
        id: 10,
        key: 'fixture:1',
        capturedAt: new Date('2026-07-23T10:00:00.000Z'),
      },
      {
        id: 11,
        key: 'fixture:1',
        capturedAt: new Date('2026-07-23T10:00:00.000Z'),
      },
    ];

    expect(selectLatestSnapshotsAsOf(tied, t90, (row) => row.key)[0]?.id).toBe(11);
  });

  it('produces the same hash for the same external prediction', () => {
    const value = {
      homeProbability: 0.51,
      drawProbability: 0.27,
      awayProbability: 0.22,
      advice: 'Home or draw',
      predictedWinner: 'Home',
    };

    expect(externalPredictionSnapshotHash(value)).toBe(
      externalPredictionSnapshotHash({ ...value }),
    );
  });

  it('changes external hash when a probability changes', () => {
    const baseline = externalPredictionSnapshotHash({
      homeProbability: 0.51,
      drawProbability: 0.27,
      awayProbability: 0.22,
      advice: null,
      predictedWinner: 'Home',
    });
    const changed = externalPredictionSnapshotHash({
      homeProbability: 0.5,
      drawProbability: 0.28,
      awayProbability: 0.22,
      advice: null,
      predictedWinner: 'Home',
    });

    expect(changed).not.toBe(baseline);
  });

  it('deduplicates unchanged metric payloads with a stable hash', () => {
    const metric = {
      expectedGoals: 1.42,
      expectedGoalsSource: 'API',
      shots: 12,
      shotsOnGoal: 5,
      possession: 53,
      corners: 6,
      fouls: 11,
      yellowCards: 2,
      redCards: 0,
    };

    expect(fixtureTeamMetricSnapshotHash(metric)).toBe(
      fixtureTeamMetricSnapshotHash({ ...metric }),
    );
  });
});
