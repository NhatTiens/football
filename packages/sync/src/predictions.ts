import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';
import { getApiFootballClient } from './client.js';
import { getFixtureHoursAhead } from './config.js';
import { externalPredictionSnapshotHash } from './scientific-snapshots.js';
import { runTrackedSync, trackApiResult, type SyncSummary } from './tracking.js';

function percentage(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value.replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed / 100 : undefined;
}

export async function syncPredictions(
  options: { fixtureIds?: number[] } = {},
): Promise<SyncSummary> {
  return runTrackedSync('sync-predictions', async () => {
    const now = new Date();
    const maximum = new Date(now.getTime() + getFixtureHoursAhead() * 3_600_000);
    const fixtures = await prisma.fixture.findMany({
      where: options.fixtureIds
        ? { id: { in: options.fixtureIds }, status: FixtureStatus.UPCOMING }
        : { status: FixtureStatus.UPCOMING, kickoffAt: { gte: now, lte: maximum } },
      orderBy: { kickoffAt: 'asc' },
    });
    const client = getApiFootballClient();
    let processed = 0;
    let inserted = 0;
    let updated = 0;

    for (const fixture of fixtures) {
      const result = await client.getPredictions(fixture.apiFixtureId);
      await trackApiResult('predictions', result);
      const item = result.data[0];
      if (!item?.predictions) continue;
      processed += 1;
      const existing = await prisma.externalPrediction.findUnique({
        where: { fixtureId: fixture.id },
      });
      const capturedAt = new Date();
      const homeProbability = percentage(item.predictions.percent?.home);
      const drawProbability = percentage(item.predictions.percent?.draw);
      const awayProbability = percentage(item.predictions.percent?.away);
      const advice = item.predictions.advice;
      const predictedWinner = item.predictions.winner?.name;
      const rawPayload = item as unknown as InputJsonValue;
      const payloadHash = externalPredictionSnapshotHash({
        homeProbability,
        drawProbability,
        awayProbability,
        advice,
        predictedWinner,
      });

      await prisma.$transaction([
        prisma.externalPrediction.upsert({
          where: { fixtureId: fixture.id },
          update: {
            homeProbability,
            drawProbability,
            awayProbability,
            advice,
            predictedWinner,
            rawPayload,
            capturedAt,
          },
          create: {
            fixtureId: fixture.id,
            homeProbability,
            drawProbability,
            awayProbability,
            advice,
            predictedWinner,
            rawPayload,
            capturedAt,
          },
        }),
        prisma.externalPredictionSnapshot.createMany({
          data: [
            {
              fixtureId: fixture.id,
              homeProbability,
              drawProbability,
              awayProbability,
              advice,
              predictedWinner,
              rawPayload,
              payloadHash,
              capturedAt,
            },
          ],
          skipDuplicates: true,
        }),
      ]);
      if (existing) updated += 1;
      else inserted += 1;
    }

    return { processed, inserted, updated, metadata: { fixtures: fixtures.length } };
  });
}
