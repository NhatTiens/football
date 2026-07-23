import { pathToFileURL } from 'node:url';

import { prisma, type InputJsonValue, type JsonValue } from '@football-ai/database';

import {
  externalPredictionSnapshotHash,
  fixtureTeamMetricSnapshotHash,
} from './scientific-snapshots.js';

interface ExternalPredictionCurrentRow {
  id: number;
  fixtureId: number;
  homeProbability: number | null;
  drawProbability: number | null;
  awayProbability: number | null;
  advice: string | null;
  predictedWinner: string | null;
  rawPayload: JsonValue | null;
  capturedAt: Date;
}

interface FixtureTeamMetricCurrentRow {
  id: number;
  fixtureId: number;
  teamId: number;
  expectedGoals: number | null;
  expectedGoalsSource: string | null;
  shots: number | null;
  shotsOnGoal: number | null;
  possession: number | null;
  corners: number | null;
  fouls: number | null;
  yellowCards: number | null;
  redCards: number | null;
  rawPayload: JsonValue | null;
  capturedAt: Date;
}

function batchSize(): number {
  const parsed = Number(process.env.SCIENTIFIC_SNAPSHOT_BACKFILL_BATCH);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 500;
}

export async function backfillScientificSnapshots(): Promise<{
  externalPredictionSnapshots: number;
  fixtureTeamMetricSnapshots: number;
}> {
  const take = batchSize();
  let externalCursor = 0;
  let metricCursor = 0;
  let externalPredictionSnapshots = 0;
  let fixtureTeamMetricSnapshots = 0;

  while (true) {
    const rows = (await prisma.externalPrediction.findMany({
      where: { id: { gt: externalCursor } },
      select: {
        id: true,
        fixtureId: true,
        homeProbability: true,
        drawProbability: true,
        awayProbability: true,
        advice: true,
        predictedWinner: true,
        rawPayload: true,
        capturedAt: true,
      },
      orderBy: { id: 'asc' },
      take,
    })) as ExternalPredictionCurrentRow[];

    if (rows.length === 0) break;

    const result = await prisma.externalPredictionSnapshot.createMany({
      data: rows.map((row) => ({
        fixtureId: row.fixtureId,
        homeProbability: row.homeProbability,
        drawProbability: row.drawProbability,
        awayProbability: row.awayProbability,
        advice: row.advice,
        predictedWinner: row.predictedWinner,
        payloadHash: externalPredictionSnapshotHash(row),
        capturedAt: row.capturedAt,
        ...(row.rawPayload == null ? {} : { rawPayload: row.rawPayload as InputJsonValue }),
      })),
      skipDuplicates: true,
    });

    externalPredictionSnapshots += result.count;
    externalCursor = rows.at(-1)?.id ?? externalCursor;
  }

  while (true) {
    const rows = (await prisma.fixtureTeamMetric.findMany({
      where: { id: { gt: metricCursor } },
      select: {
        id: true,
        fixtureId: true,
        teamId: true,
        expectedGoals: true,
        expectedGoalsSource: true,
        shots: true,
        shotsOnGoal: true,
        possession: true,
        corners: true,
        fouls: true,
        yellowCards: true,
        redCards: true,
        rawPayload: true,
        capturedAt: true,
      },
      orderBy: { id: 'asc' },
      take,
    })) as FixtureTeamMetricCurrentRow[];

    if (rows.length === 0) break;

    const result = await prisma.fixtureTeamMetricSnapshot.createMany({
      data: rows.map((row) => ({
        fixtureId: row.fixtureId,
        teamId: row.teamId,
        expectedGoals: row.expectedGoals,
        expectedGoalsSource: row.expectedGoalsSource,
        shots: row.shots,
        shotsOnGoal: row.shotsOnGoal,
        possession: row.possession,
        corners: row.corners,
        fouls: row.fouls,
        yellowCards: row.yellowCards,
        redCards: row.redCards,
        payloadHash: fixtureTeamMetricSnapshotHash(row),
        capturedAt: row.capturedAt,
        ...(row.rawPayload == null ? {} : { rawPayload: row.rawPayload as InputJsonValue }),
      })),
      skipDuplicates: true,
    });

    fixtureTeamMetricSnapshots += result.count;
    metricCursor = rows.at(-1)?.id ?? metricCursor;
  }

  return {
    externalPredictionSnapshots,
    fixtureTeamMetricSnapshots,
  };
}

async function main(): Promise<void> {
  const result = await backfillScientificSnapshots();
  console.log(
    JSON.stringify(
      {
        status: 'SUCCESS',
        ...result,
      },
      null,
      2,
    ),
  );
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  main()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
