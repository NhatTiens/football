import { createHash } from 'node:crypto';
import type { LineupPlayerResponse, LineupResponse } from '@football-ai/api-football';
import {
  FixtureStatus,
  prisma,
  type InputJsonValue,
} from '@football-ai/database';
import { getApiFootballClient } from './client.js';
import {
  getLineupHistoryImportDays,
  getLineupSyncHoursAhead,
} from './config.js';
import {
  runTrackedSync,
  trackApiResult,
  type SyncSummary,
} from './tracking.js';

interface SaveLineupSummary {
  processed: number;
  inserted: number;
  updated: number;
}

function normalizePlayerRows(
  rows: LineupPlayerResponse[] | undefined,
  isStarter: boolean,
): Array<{
  apiPlayerId: number;
  name: string;
  shirtNumber: number | null;
  position: string | null;
  grid: string | null;
  photoUrl: string | null;
  isStarter: boolean;
  lineupOrder: number;
}> {
  return (rows ?? [])
    .map((entry, index) => ({
      apiPlayerId: Number(entry.player.id),
      name: String(entry.player.name ?? '').trim(),
      shirtNumber:
        entry.player.number === null || entry.player.number === undefined
          ? null
          : Number(entry.player.number),
      position: entry.player.pos?.trim() || null,
      grid: entry.player.grid?.trim() || null,
      photoUrl: entry.player.photo?.trim() || null,
      isStarter,
      lineupOrder: index + 1,
    }))
    .filter(
      (player) =>
        Number.isInteger(player.apiPlayerId) &&
        player.apiPlayerId > 0 &&
        player.name.length > 0,
    );
}

function lineupHash(item: LineupResponse): string {
  const players = [
    ...normalizePlayerRows(item.startXI, true),
    ...normalizePlayerRows(item.substitutes, false),
  ].map((player) => ({
    id: player.apiPlayerId,
    starter: player.isStarter,
    number: player.shirtNumber,
    position: player.position,
    grid: player.grid,
  }));

  return createHash('sha256')
    .update(
      JSON.stringify({
        teamId: item.team.id,
        formation: item.formation ?? null,
        coachId: item.coach?.id ?? null,
        players,
      }),
    )
    .digest('hex');
}

async function saveLineupResponse(
  fixture: {
    id: number;
    homeTeamId: number;
    awayTeamId: number;
    homeTeam: { id: number; apiTeamId: number; name: string };
    awayTeam: { id: number; apiTeamId: number; name: string };
  },
  item: LineupResponse,
  capturedAt: Date,
): Promise<SaveLineupSummary> {
  const team =
    item.team.id === fixture.homeTeam.apiTeamId
      ? fixture.homeTeam
      : item.team.id === fixture.awayTeam.apiTeamId
        ? fixture.awayTeam
        : null;

  if (!team) {
    return { processed: 0, inserted: 0, updated: 0 };
  }

  const starters = normalizePlayerRows(item.startXI, true);
  const substitutes = normalizePlayerRows(item.substitutes, false);
  const players = [...starters, ...substitutes];
  if (players.length === 0) {
    return { processed: 0, inserted: 0, updated: 0 };
  }

  const contentHash = lineupHash(item);
  const existing = await prisma.fixtureLineupSnapshot.findUnique({
    where: {
      fixtureId_teamId_contentHash: {
        fixtureId: fixture.id,
        teamId: team.id,
        contentHash,
      },
    },
  });

  if (existing) {
    return { processed: players.length, inserted: 0, updated: 0 };
  }

  const playerIds = new Map<number, number>();
  for (const row of players) {
    const player = await prisma.player.upsert({
      where: { apiPlayerId: row.apiPlayerId },
      update: {
        name: row.name,
        photoUrl: row.photoUrl,
        defaultPosition: row.position,
      },
      create: {
        apiPlayerId: row.apiPlayerId,
        name: row.name,
        photoUrl: row.photoUrl,
        defaultPosition: row.position,
      },
    });
    playerIds.set(row.apiPlayerId, player.id);
  }

  await prisma.fixtureLineupSnapshot.create({
    data: {
      fixtureId: fixture.id,
      teamId: team.id,
      formation: item.formation?.trim() || null,
      coachApiId:
        item.coach?.id === null || item.coach?.id === undefined
          ? null
          : Number(item.coach.id),
      coachName: item.coach?.name?.trim() || null,
      isConfirmed: starters.length >= 11,
      starterCount: starters.length,
      substituteCount: substitutes.length,
      contentHash,
      capturedAt,
      rawPayload: item as unknown as InputJsonValue,
      players: {
        create: players.map((row) => ({
          playerId: playerIds.get(row.apiPlayerId)!,
          isStarter: row.isStarter,
          shirtNumber: row.shirtNumber,
          position: row.position,
          grid: row.grid,
          lineupOrder: row.lineupOrder,
        })),
      },
    },
  });

  return { processed: players.length, inserted: 1, updated: 0 };
}

export interface SyncLineupsOptions {
  fixtureIds?: number[];
  includeHistory?: boolean;
}

export async function syncLineups(
  options: SyncLineupsOptions = {},
): Promise<SyncSummary> {
  return runTrackedSync(
    options.includeHistory ? 'sync-lineups-history' : 'sync-lineups',
    async () => {
      const now = new Date();
      const maximum = new Date(
        now.getTime() + getLineupSyncHoursAhead() * 3_600_000,
      );
      const historyMinimum = new Date(
        now.getTime() - getLineupHistoryImportDays() * 86_400_000,
      );

      const fixtures = await prisma.fixture.findMany({
        where: options.fixtureIds
          ? { id: { in: options.fixtureIds } }
          : options.includeHistory
            ? {
                status: FixtureStatus.FINISHED,
                kickoffAt: { gte: historyMinimum, lt: now },
              }
            : {
                status: {
                  in: [
                    FixtureStatus.UPCOMING,
                    FixtureStatus.LIVE,
                    FixtureStatus.FINISHED,
                  ],
                },
                kickoffAt: {
                  gte: new Date(now.getTime() - 6 * 3_600_000),
                  lte: maximum,
                },
              },
        include: {
          homeTeam: true,
          awayTeam: true,
        },
        orderBy: { kickoffAt: 'asc' },
      });

      const client = getApiFootballClient();
      let processed = 0;
      let inserted = 0;
      let updated = 0;
      let fixturesWithLineups = 0;

      for (const fixture of fixtures) {
        const result = await client.getFixtureLineups(fixture.apiFixtureId);
        await trackApiResult('fixtures/lineups', result);
        if (result.data.length > 0) fixturesWithLineups += 1;
        const capturedAt = new Date();
        for (const item of result.data) {
          const summary = await saveLineupResponse(fixture, item, capturedAt);
          processed += summary.processed;
          inserted += summary.inserted;
          updated += summary.updated;
        }
      }

      return {
        processed,
        inserted,
        updated,
        metadata: {
          fixtures: fixtures.length,
          fixturesWithLineups,
          includeHistory: Boolean(options.includeHistory),
        },
      };
    },
  );
}
