import { createHash } from 'node:crypto';

import { prisma } from '@football-ai/database';

export type SnapshotStorage = 'SNAPSHOT' | 'CURRENT_FALLBACK';

export interface ExternalPredictionSnapshotValue {
  homeProbability: number | null | undefined;
  drawProbability: number | null | undefined;
  awayProbability: number | null | undefined;
  advice: string | null | undefined;
  predictedWinner: string | null | undefined;
}

export interface FixtureTeamMetricSnapshotValue {
  expectedGoals: number | null | undefined;
  expectedGoalsSource: string | null | undefined;
  shots: number | null | undefined;
  shotsOnGoal: number | null | undefined;
  possession: number | null | undefined;
  corners: number | null | undefined;
  fouls: number | null | undefined;
  yellowCards: number | null | undefined;
  redCards: number | null | undefined;
}

export interface ExternalPredictionPointInTimeRow {
  homeProbability: number | null;
  drawProbability: number | null;
  awayProbability: number | null;
  capturedAt: Date;
  storage: SnapshotStorage;
}

export interface FixtureTeamMetricPointInTimeRow {
  fixtureId: number;
  teamId: number;
  expectedGoals: number | null;
  shotsOnGoal: number | null;
  capturedAt: Date;
  storage: SnapshotStorage;
}

interface SelectableSnapshot {
  id: number;
  capturedAt: Date;
}

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date.`);
  }
}

function normalizeForHash(value: unknown): unknown {
  if (value === undefined || value === null) return null;

  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }

  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForHash(entry));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeForHash(entry)]),
    );
  }

  return String(value);
}

export function stableSnapshotHash(kind: string, value: unknown): string {
  const payload = JSON.stringify({
    kind,
    version: 1,
    value: normalizeForHash(value),
  });

  return createHash('sha256').update(payload).digest('hex');
}

export function externalPredictionSnapshotHash(input: ExternalPredictionSnapshotValue): string {
  return stableSnapshotHash('EXTERNAL_PREDICTION', {
    homeProbability: input.homeProbability ?? null,
    drawProbability: input.drawProbability ?? null,
    awayProbability: input.awayProbability ?? null,
    advice: input.advice ?? null,
    predictedWinner: input.predictedWinner ?? null,
  });
}

export function fixtureTeamMetricSnapshotHash(input: FixtureTeamMetricSnapshotValue): string {
  return stableSnapshotHash('FIXTURE_TEAM_METRIC', {
    expectedGoals: input.expectedGoals ?? null,
    expectedGoalsSource: input.expectedGoalsSource ?? null,
    shots: input.shots ?? null,
    shotsOnGoal: input.shotsOnGoal ?? null,
    possession: input.possession ?? null,
    corners: input.corners ?? null,
    fouls: input.fouls ?? null,
    yellowCards: input.yellowCards ?? null,
    redCards: input.redCards ?? null,
  });
}

export function selectLatestSnapshotsAsOf<T extends SelectableSnapshot>(
  rows: readonly T[],
  predictionAsOf: Date,
  keyOf: (row: T) => string,
): T[] {
  assertValidDate(predictionAsOf, 'predictionAsOf');

  const selected = new Map<string, T>();
  const ordered = [...rows]
    .filter((row) => {
      assertValidDate(row.capturedAt, 'capturedAt');
      return row.capturedAt.getTime() <= predictionAsOf.getTime();
    })
    .sort((left, right) => {
      const byTime = right.capturedAt.getTime() - left.capturedAt.getTime();
      return byTime !== 0 ? byTime : right.id - left.id;
    });

  for (const row of ordered) {
    const key = keyOf(row);
    if (!selected.has(key)) selected.set(key, row);
  }

  return [...selected.values()].sort((left, right) => keyOf(left).localeCompare(keyOf(right)));
}

export async function getExternalPredictionSnapshotAsOf(input: {
  fixtureId: number;
  predictionAsOf: Date;
}): Promise<ExternalPredictionPointInTimeRow | null> {
  assertValidDate(input.predictionAsOf, 'predictionAsOf');

  const snapshot = await prisma.externalPredictionSnapshot.findFirst({
    where: {
      fixtureId: input.fixtureId,
      capturedAt: { lte: input.predictionAsOf },
    },
    select: {
      homeProbability: true,
      drawProbability: true,
      awayProbability: true,
      capturedAt: true,
    },
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
  });

  if (snapshot) {
    return {
      homeProbability: snapshot.homeProbability,
      drawProbability: snapshot.drawProbability,
      awayProbability: snapshot.awayProbability,
      capturedAt: snapshot.capturedAt,
      storage: 'SNAPSHOT',
    };
  }

  const fallback = await prisma.externalPrediction.findFirst({
    where: {
      fixtureId: input.fixtureId,
      capturedAt: { lte: input.predictionAsOf },
    },
    select: {
      homeProbability: true,
      drawProbability: true,
      awayProbability: true,
      capturedAt: true,
    },
    orderBy: { capturedAt: 'desc' },
  });

  return fallback
    ? {
        homeProbability: fallback.homeProbability,
        drawProbability: fallback.drawProbability,
        awayProbability: fallback.awayProbability,
        capturedAt: fallback.capturedAt,
        storage: 'CURRENT_FALLBACK',
      }
    : null;
}

export async function getFixtureTeamMetricSnapshotsAsOf(input: {
  fixtureIds: readonly number[];
  predictionAsOf: Date;
}): Promise<FixtureTeamMetricPointInTimeRow[]> {
  assertValidDate(input.predictionAsOf, 'predictionAsOf');

  const fixtureIds = [...new Set(input.fixtureIds)];
  if (fixtureIds.length === 0) return [];

  const snapshotRows = (await prisma.fixtureTeamMetricSnapshot.findMany({
    where: {
      fixtureId: { in: fixtureIds },
      capturedAt: { lte: input.predictionAsOf },
    },
    select: {
      id: true,
      fixtureId: true,
      teamId: true,
      expectedGoals: true,
      shotsOnGoal: true,
      capturedAt: true,
    },
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
  })) as Array<{
    id: number;
    fixtureId: number;
    teamId: number;
    expectedGoals: number | null;
    shotsOnGoal: number | null;
    capturedAt: Date;
  }>;

  const selectedSnapshots = selectLatestSnapshotsAsOf(
    snapshotRows,
    input.predictionAsOf,
    (row) => `${row.fixtureId}:${row.teamId}`,
  );
  const selectedKeys = new Set(selectedSnapshots.map((row) => `${row.fixtureId}:${row.teamId}`));

  const fallbackRows = (await prisma.fixtureTeamMetric.findMany({
    where: {
      fixtureId: { in: fixtureIds },
      capturedAt: { lte: input.predictionAsOf },
    },
    select: {
      fixtureId: true,
      teamId: true,
      expectedGoals: true,
      shotsOnGoal: true,
      capturedAt: true,
    },
  })) as Array<{
    fixtureId: number;
    teamId: number;
    expectedGoals: number | null;
    shotsOnGoal: number | null;
    capturedAt: Date;
  }>;

  return [
    ...selectedSnapshots.map((row) => ({
      fixtureId: row.fixtureId,
      teamId: row.teamId,
      expectedGoals: row.expectedGoals,
      shotsOnGoal: row.shotsOnGoal,
      capturedAt: row.capturedAt,
      storage: 'SNAPSHOT' as const,
    })),
    ...fallbackRows
      .filter((row) => !selectedKeys.has(`${row.fixtureId}:${row.teamId}`))
      .map((row) => ({
        ...row,
        storage: 'CURRENT_FALLBACK' as const,
      })),
  ].sort((left, right) => left.fixtureId - right.fixtureId || left.teamId - right.teamId);
}
