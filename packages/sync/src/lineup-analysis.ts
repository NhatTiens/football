import {
  analyzeFixtureLineups,
  type LineupAdjustment,
  type LineupAnalysisRules,
  type LineupPositionGroup,
  type MissingRegularPlayer,
  type TeamLineupEvidence,
} from '@football-ai/engine';
import { prisma } from '@football-ai/database';

interface SnapshotPlayerRow {
  isStarter: boolean;
  position: string | null;
  player: {
    id: number;
    name: string;
    defaultPosition: string | null;
  };
}

interface SnapshotRow {
  id: number;
  fixtureId: number;
  teamId: number;
  formation: string | null;
  isConfirmed: boolean;
  starterCount: number;
  capturedAt: Date;
  players: SnapshotPlayerRow[];
  fixture?: {
    id: number;
    kickoffAt: Date;
  };
}

export function positionGroup(value?: string | null): LineupPositionGroup {
  const normalized = (value ?? '').trim().toUpperCase();
  if (!normalized) return 'UNKNOWN';
  if (
    normalized === 'G' ||
    normalized === 'GK' ||
    normalized.includes('GOALKEEPER')
  ) {
    return 'GOALKEEPER';
  }
  if (
    normalized === 'D' ||
    normalized === 'DF' ||
    normalized.includes('DEFENDER') ||
    normalized.includes('BACK')
  ) {
    return 'DEFENDER';
  }
  if (
    normalized === 'M' ||
    normalized === 'MF' ||
    normalized.includes('MIDFIELDER')
  ) {
    return 'MIDFIELDER';
  }
  if (
    normalized === 'F' ||
    normalized === 'FW' ||
    normalized === 'A' ||
    normalized.includes('FORWARD') ||
    normalized.includes('ATTACKER') ||
    normalized.includes('STRIKER') ||
    normalized.includes('WINGER')
  ) {
    return 'ATTACKER';
  }
  return 'UNKNOWN';
}

function latestSnapshotPerFixture(rows: SnapshotRow[]): SnapshotRow[] {
  const latest = new Map<number, SnapshotRow>();
  for (const row of rows) {
    const previous = latest.get(row.fixtureId);
    if (!previous || row.capturedAt > previous.capturedAt) {
      latest.set(row.fixtureId, row);
    }
  }
  return [...latest.values()].sort(
    (a, b) =>
      (b.fixture?.kickoffAt.getTime() ?? 0) -
      (a.fixture?.kickoffAt.getTime() ?? 0),
  );
}

async function buildTeamEvidence(input: {
  fixtureId: number;
  teamId: number;
  teamName: string;
  kickoffAt: Date;
  asOf: Date;
  historyLookback: number;
}): Promise<TeamLineupEvidence> {
  const current = (await prisma.fixtureLineupSnapshot.findFirst({
    where: {
      fixtureId: input.fixtureId,
      teamId: input.teamId,
      capturedAt: { lte: input.asOf },
    },
    include: {
      players: {
        include: { player: true },
        orderBy: [{ isStarter: 'desc' }, { lineupOrder: 'asc' }],
      },
    },
    orderBy: { capturedAt: 'desc' },
  })) as SnapshotRow | null;

  const historyRows = (await prisma.fixtureLineupSnapshot.findMany({
    where: {
      teamId: input.teamId,
      isConfirmed: true,
      capturedAt: { lte: input.asOf },
      fixture: {
        kickoffAt: { lt: input.kickoffAt },
      },
    },
    include: {
      fixture: { select: { id: true, kickoffAt: true } },
      players: {
        where: { isStarter: true },
        include: { player: true },
      },
    },
    orderBy: { capturedAt: 'desc' },
    take: Math.max(20, input.historyLookback * 4),
  })) as SnapshotRow[];

  const history = latestSnapshotPerFixture(historyRows).slice(
    0,
    input.historyLookback,
  );
  const currentStarters = new Set(
    (current?.players ?? [])
      .filter((row) => row.isStarter)
      .map((row) => row.player.id),
  );
  const previousStarters = new Set(
    (history[0]?.players ?? [])
      .filter((row) => row.isStarter)
      .map((row) => row.player.id),
  );
  const previousLineupOverlap =
    current && history.length > 0
      ? [...currentStarters].filter((id) => previousStarters.has(id)).length
      : null;

  const starts = new Map<
    number,
    {
      playerName: string;
      starts: number;
      position: string | null;
    }
  >();
  for (const snapshot of history) {
    for (const row of snapshot.players.filter((player) => player.isStarter)) {
      const existing = starts.get(row.player.id);
      starts.set(row.player.id, {
        playerName: row.player.name,
        starts: (existing?.starts ?? 0) + 1,
        position:
          row.position ?? row.player.defaultPosition ?? existing?.position ?? null,
      });
    }
  }

  const rankedRegulars = [...starts.entries()]
    .map(([playerId, row]) => ({
      playerId,
      playerName: row.playerName,
      starts: row.starts,
      historyMatches: history.length,
      startRate: history.length > 0 ? row.starts / history.length : 0,
      positionGroup: positionGroup(row.position),
    }))
    .sort((a, b) => b.starts - a.starts || a.playerId - b.playerId)
    .slice(0, 11);

  const missingRegulars: MissingRegularPlayer[] = rankedRegulars.filter(
    (player) =>
      player.startRate >= 0.45 && !currentStarters.has(player.playerId),
  );

  return {
    teamId: input.teamId,
    teamName: input.teamName,
    confirmed: Boolean(current?.isConfirmed && current.starterCount >= 11),
    starterCount: current?.starterCount ?? 0,
    formation: current?.formation ?? null,
    historyMatches: history.length,
    previousLineupOverlap,
    rotationCount:
      previousLineupOverlap === null ? null : Math.max(0, 11 - previousLineupOverlap),
    missingRegulars,
  };
}

export async function getFixtureLineupAnalysis(input: {
  fixtureId: number;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  kickoffAt: Date;
  asOf: Date;
  historyLookback: number;
  rules: LineupAnalysisRules;
}): Promise<LineupAdjustment> {
  const [home, away] = await Promise.all([
    buildTeamEvidence({
      fixtureId: input.fixtureId,
      teamId: input.homeTeamId,
      teamName: input.homeTeamName,
      kickoffAt: input.kickoffAt,
      asOf: input.asOf,
      historyLookback: input.historyLookback,
    }),
    buildTeamEvidence({
      fixtureId: input.fixtureId,
      teamId: input.awayTeamId,
      teamName: input.awayTeamName,
      kickoffAt: input.kickoffAt,
      asOf: input.asOf,
      historyLookback: input.historyLookback,
    }),
  ]);

  return analyzeFixtureLineups({ home, away, rules: input.rules });
}
