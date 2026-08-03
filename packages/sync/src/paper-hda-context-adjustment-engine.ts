import { FixtureStatus, prisma } from '@football-ai/database';

import { getFixtureInjurySnapshotAsOf } from './context-snapshots.js';
import {
  buildPaperHdaContextAdjustment,
  type PaperHdaContextAdjustment,
  type PaperHdaHeadToHeadObservation,
  type PaperHdaTeamLineupEvidence,
} from './paper-hda-context-adjustment-core.js';

interface HeadToHeadFixtureRow {
  kickoffAt: Date;
  homeTeamId: number;
  awayTeamId: number;
  homeGoals: number | null;
  awayGoals: number | null;
}

export interface PaperHdaContextAdjustmentEngineInput {
  fixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  predictionAsOf: Date;
  baseline: Record<'HOME' | 'DRAW' | 'AWAY', number>;
  homeLineup: PaperHdaTeamLineupEvidence;
  awayLineup: PaperHdaTeamLineupEvidence;
  resultAvailabilityLagMinutes?: number;
  headToHeadLimit?: number;
}

export interface PaperHdaContextAdjustmentEngineResult
  extends PaperHdaContextAdjustment {
  pointInTime: {
    predictionAsOf: string;
    historyAvailableBefore: string;
    injurySnapshotCapturedAt: string | null;
    futureRowsRejected: number;
  };
}

function isSuspension(input: {
  reason: string | null;
  injuryType: string | null;
}): boolean {
  const value = `${input.injuryType ?? ''} ${input.reason ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return [
    'suspend',
    'suspension',
    'disciplin',
    'match ban',
    'red card',
    'yellow card',
    'treo gio',
    'the do',
    'the vang',
  ].some((token) => value.includes(token));
}

function observationFromCurrentHomePerspective(input: {
  row: HeadToHeadFixtureRow;
  currentHomeTeamId: number;
  predictionAsOf: Date;
}): PaperHdaHeadToHeadObservation | null {
  if (input.row.homeGoals == null || input.row.awayGoals == null) return null;

  const currentHomeWasHistoricalHome = input.row.homeTeamId === input.currentHomeTeamId;
  const homeGoals = currentHomeWasHistoricalHome
    ? input.row.homeGoals
    : input.row.awayGoals;
  const awayGoals = currentHomeWasHistoricalHome
    ? input.row.awayGoals
    : input.row.homeGoals;

  return {
    homeGoals,
    awayGoals,
    ageDays:
      (input.predictionAsOf.getTime() - input.row.kickoffAt.getTime()) /
      86_400_000,
  };
}

export async function getPaperHdaContextAdjustment(
  input: PaperHdaContextAdjustmentEngineInput,
): Promise<PaperHdaContextAdjustmentEngineResult> {
  const resultAvailabilityLagMinutes = Math.max(
    0,
    input.resultAvailabilityLagMinutes ?? 180,
  );
  const historyAvailableBefore = new Date(
    input.predictionAsOf.getTime() - resultAvailabilityLagMinutes * 60_000,
  );
  const headToHeadLimit = Math.max(3, Math.min(12, input.headToHeadLimit ?? 8));

  const [headToHeadRows, injurySnapshot] = await Promise.all([
    prisma.fixture.findMany({
      where: {
        id: { not: input.fixtureId },
        leagueId: input.leagueId,
        status: FixtureStatus.FINISHED,
        kickoffAt: { lt: historyAvailableBefore },
        homeGoals: { not: null },
        awayGoals: { not: null },
        OR: [
          {
            homeTeamId: input.homeTeamId,
            awayTeamId: input.awayTeamId,
          },
          {
            homeTeamId: input.awayTeamId,
            awayTeamId: input.homeTeamId,
          },
        ],
      },
      select: {
        kickoffAt: true,
        homeTeamId: true,
        awayTeamId: true,
        homeGoals: true,
        awayGoals: true,
      },
      orderBy: { kickoffAt: 'desc' },
      take: headToHeadLimit,
    }) as Promise<HeadToHeadFixtureRow[]>,
    getFixtureInjurySnapshotAsOf({
      fixtureId: input.fixtureId,
      predictionAsOf: input.predictionAsOf,
    }),
  ]);

  let futureRowsRejected = 0;
  const headToHead: PaperHdaHeadToHeadObservation[] = [];

  for (const row of headToHeadRows) {
    const observation = observationFromCurrentHomePerspective({
      row,
      currentHomeTeamId: input.homeTeamId,
      predictionAsOf: input.predictionAsOf,
    });
    if (observation == null) continue;
    if (observation.ageDays < 0 || row.kickoffAt >= historyAvailableBefore) {
      futureRowsRejected += 1;
      continue;
    }
    headToHead.push(observation);
  }

  const suspensionRows = injurySnapshot?.players.filter(isSuspension) ?? [];
  const adjustment = buildPaperHdaContextAdjustment({
    baseline: input.baseline,
    homeLineup: input.homeLineup,
    awayLineup: input.awayLineup,
    homeSuspensions: suspensionRows.filter(
      (row) => row.teamId === input.homeTeamId,
    ).length,
    awaySuspensions: suspensionRows.filter(
      (row) => row.teamId === input.awayTeamId,
    ).length,
    headToHead,
  });

  return {
    ...adjustment,
    pointInTime: {
      predictionAsOf: input.predictionAsOf.toISOString(),
      historyAvailableBefore: historyAvailableBefore.toISOString(),
      injurySnapshotCapturedAt:
        injurySnapshot?.capturedAt.toISOString() ?? null,
      futureRowsRejected,
    },
  };
}
