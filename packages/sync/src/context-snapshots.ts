import { createHash } from 'node:crypto';
import { prisma, type InputJsonValue } from '@football-ai/database';

export const FIXTURE_CONTEXT_DATA_TYPES = ['INJURY', 'LINEUP'] as const;
export type FixtureContextDataType = (typeof FIXTURE_CONTEXT_DATA_TYPES)[number];

export interface InjurySnapshotInputRow {
  teamId: number;
  apiPlayerId: number;
  playerName: string;
  reason?: string | null;
  injuryType?: string | null;
  rawPayload?: unknown;
}

export interface InjurySnapshotPlayerAsOf {
  teamId: number;
  apiPlayerId: number;
  playerName: string;
  reason: string | null;
  injuryType: string | null;
  capturedAt: Date;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function normalizeInjurySnapshotRows(
  rows: readonly InjurySnapshotInputRow[],
): InjurySnapshotInputRow[] {
  return [...rows]
    .filter(
      (row) =>
        Number.isInteger(row.teamId) &&
        row.teamId > 0 &&
        Number.isInteger(row.apiPlayerId) &&
        row.apiPlayerId > 0 &&
        row.playerName.trim().length > 0,
    )
    .map((row) => ({
      teamId: row.teamId,
      apiPlayerId: row.apiPlayerId,
      playerName: row.playerName.trim(),
      reason: row.reason?.trim() || null,
      injuryType: row.injuryType?.trim() || null,
      rawPayload: row.rawPayload,
    }))
    .sort(
      (left, right) =>
        left.teamId - right.teamId ||
        left.apiPlayerId - right.apiPlayerId,
    );
}

export function injurySnapshotContentHash(
  rows: readonly InjurySnapshotInputRow[],
): string {
  return stableHash(
    normalizeInjurySnapshotRows(rows).map((row) => ({
      teamId: row.teamId,
      apiPlayerId: row.apiPlayerId,
      playerName: row.playerName,
      reason: row.reason ?? null,
      injuryType: row.injuryType ?? null,
    })),
  );
}

export async function saveFixtureContextCoverageSnapshot(input: {
  fixtureId: number;
  dataType: FixtureContextDataType;
  capturedAt: Date;
  responseCount: number;
  metadata?: unknown;
}): Promise<void> {
  const metadata = input.metadata ?? {};
  await prisma.fixtureContextCoverageSnapshot.create({
    data: {
      fixtureId: input.fixtureId,
      dataType: input.dataType,
      capturedAt: input.capturedAt,
      responseCount: Math.max(0, Math.floor(input.responseCount)),
      contentHash: stableHash({
        fixtureId: input.fixtureId,
        dataType: input.dataType,
        capturedAt: input.capturedAt.toISOString(),
        responseCount: input.responseCount,
        metadata,
      }),
      metadata: metadata as InputJsonValue,
    },
  });
}

export async function getFixtureContextCoverageAsOf(input: {
  fixtureId: number;
  dataType: FixtureContextDataType;
  predictionAsOf: Date;
}): Promise<{ capturedAt: Date; responseCount: number } | null> {
  return prisma.fixtureContextCoverageSnapshot.findFirst({
    where: {
      fixtureId: input.fixtureId,
      dataType: input.dataType,
      capturedAt: { lte: input.predictionAsOf },
    },
    select: {
      capturedAt: true,
      responseCount: true,
    },
    orderBy: { capturedAt: 'desc' },
  });
}

export async function saveFixtureInjurySnapshot(input: {
  fixtureId: number;
  capturedAt: Date;
  rows: readonly InjurySnapshotInputRow[];
  rawPayload?: unknown;
}): Promise<{ id: number; playerCount: number; contentHash: string }> {
  const normalized = normalizeInjurySnapshotRows(input.rows);
  const contentHash = injurySnapshotContentHash(normalized);

  const snapshot = await prisma.fixtureInjurySnapshot.create({
    data: {
      fixtureId: input.fixtureId,
      capturedAt: input.capturedAt,
      playerCount: normalized.length,
      contentHash,
      rawPayload: (input.rawPayload ?? normalized) as InputJsonValue,
      players: {
        create: normalized.map((row) => ({
          teamId: row.teamId,
          apiPlayerId: row.apiPlayerId,
          playerName: row.playerName,
          reason: row.reason ?? null,
          injuryType: row.injuryType ?? null,
          rawPayload: (row.rawPayload ?? {}) as InputJsonValue,
        })),
      },
    },
    select: {
      id: true,
      playerCount: true,
      contentHash: true,
    },
  });

  return snapshot;
}

export async function getFixtureInjurySnapshotAsOf(input: {
  fixtureId: number;
  predictionAsOf: Date;
}): Promise<{
  id: number;
  capturedAt: Date;
  playerCount: number;
  players: InjurySnapshotPlayerAsOf[];
} | null> {
  const snapshot = await prisma.fixtureInjurySnapshot.findFirst({
    where: {
      fixtureId: input.fixtureId,
      capturedAt: { lte: input.predictionAsOf },
    },
    include: {
      players: {
        orderBy: [{ teamId: 'asc' }, { apiPlayerId: 'asc' }],
      },
    },
    orderBy: { capturedAt: 'desc' },
  });

  if (!snapshot) return null;

  return {
    id: snapshot.id,
    capturedAt: snapshot.capturedAt,
    playerCount: snapshot.playerCount,
    players: snapshot.players.map((row: {
      teamId: number;
      apiPlayerId: number;
      playerName: string;
      reason: string | null;
      injuryType: string | null;
    }) => ({
      teamId: row.teamId,
      apiPlayerId: row.apiPlayerId,
      playerName: row.playerName,
      reason: row.reason,
      injuryType: row.injuryType,
      capturedAt: snapshot.capturedAt,
    })),
  };
}
