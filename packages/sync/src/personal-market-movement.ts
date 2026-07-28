import { prisma } from '@football-ai/database';

import {
  analyzeMatchWinnerOddsMovement,
  type OddsMovementRow,
} from './odds-movement.js';

export interface PersonalMarketMovementSummary {
  source: 'API_FOOTBALL_PIT_SNAPSHOT';
  available: boolean;
  movementAvailable: boolean;
  bookmakerCount: number;
  matchedBookmakerCount: number;
  openingConsensus: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  } | null;
  currentConsensus: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  } | null;
  movement: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  };
  recentMovement: {
    HOME: number;
    DRAW: number;
    AWAY: number;
  };
  steamMoveDetected: boolean;
  steamDirection: 'HOME' | 'DRAW' | 'AWAY' | 'NONE';
  steamStrength: number;
  lateMove: boolean;
  qualityScore: number;
  observedFrom: string | null;
  observedTo: string | null;
  reasons: string[];
}

interface FixtureInput {
  localFixtureId: number;
  providerFixtureId: number;
  kickoffAt: Date;
}

interface ApiOddsRow {
  id: number;
  providerFixtureId: number;
  bookmakerId: number;
  bookmakerName: string;
  selection: string;
  decimalOdds: number;
  observedAt: Date;
  sourceUpdatedAt: Date | null;
}

export async function getPersonalMarketMovementSummaries(input: {
  fixtures: FixtureInput[];
  predictionAsOf: Date;
}): Promise<Map<number, PersonalMarketMovementSummary>> {
  const result = new Map<number, PersonalMarketMovementSummary>();

  if (input.fixtures.length === 0) return result;

  const providerFixtureIds = input.fixtures.map(
    (fixture: FixtureInput): number => fixture.providerFixtureId,
  );

  const rows = (await prisma.apiFootballOddsSnapshot.findMany({
    where: {
      providerFixtureId: { in: providerFixtureIds },
      marketType: 'MATCH_WINNER',
      selection: { in: ['HOME', 'DRAW', 'AWAY'] },
      pitUsable: true,
      observedAt: { lte: input.predictionAsOf },
      OR: [
        { sourceUpdatedAt: null },
        { sourceUpdatedAt: { lte: input.predictionAsOf } },
      ],
    },
    select: {
      id: true,
      providerFixtureId: true,
      bookmakerId: true,
      bookmakerName: true,
      selection: true,
      decimalOdds: true,
      observedAt: true,
      sourceUpdatedAt: true,
    },
    orderBy: [
      { providerFixtureId: 'asc' },
      { observedAt: 'asc' },
      { id: 'asc' },
    ],
    take: 50000,
  })) as ApiOddsRow[];

  const grouped = new Map<number, ApiOddsRow[]>();

  for (const row of rows) {
    grouped.set(
      row.providerFixtureId,
      [...(grouped.get(row.providerFixtureId) ?? []), row],
    );
  }

  for (const fixture of input.fixtures) {
    const fixtureRows = grouped.get(fixture.providerFixtureId) ?? [];

    const movementRows: OddsMovementRow[] = fixtureRows.map(
      (row: ApiOddsRow): OddsMovementRow => ({
        // Negative IDs keep API-Football audit keys separate from the
        // provider-neutral OddsSnapshot numeric namespace.
        id: -row.id,
        bookmakerId: row.bookmakerId,
        bookmakerName: row.bookmakerName,
        selectionCode: row.selection,
        decimalOdds: row.decimalOdds,
        // Provider sourceUpdatedAt represents the actual odds version time.
        // Fall back to our first observation only when unavailable.
        capturedAt: row.sourceUpdatedAt ?? row.observedAt,
      }),
    );

    const analysis = analyzeMatchWinnerOddsMovement({
      fixtureId: fixture.localFixtureId,
      kickoffAt: fixture.kickoffAt,
      predictionAsOf: input.predictionAsOf,
      rows: movementRows,
    });

    result.set(fixture.providerFixtureId, {
      source: 'API_FOOTBALL_PIT_SNAPSHOT',
      available: analysis.available,
      movementAvailable: analysis.movementAvailable,
      bookmakerCount: analysis.bookmakerCount,
      matchedBookmakerCount: analysis.matchedBookmakerCount,
      openingConsensus: analysis.openingConsensus,
      currentConsensus: analysis.currentConsensus,
      movement: analysis.movement,
      recentMovement: analysis.recentMovement,
      steamMoveDetected: analysis.steamMoveDetected,
      steamDirection: analysis.steamDirection,
      steamStrength: analysis.steamStrength,
      lateMove: analysis.lateMove,
      qualityScore: analysis.qualityScore,
      observedFrom: analysis.observedFrom?.toISOString() ?? null,
      observedTo: analysis.observedTo?.toISOString() ?? null,
      reasons: analysis.reasons,
    });
  }

  return result;
}
