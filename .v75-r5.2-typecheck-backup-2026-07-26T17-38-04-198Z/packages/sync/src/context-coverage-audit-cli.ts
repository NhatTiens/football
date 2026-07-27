import { FixtureStatus, prisma } from '@football-ai/database';
import { getRepeatedContextConfig } from './repeated-context-core.js';

function percent(value: number, total: number): string {
  if (total <= 0) return 'n/a';
  return `${((value / total) * 100).toFixed(1)}%`;
}

const config = getRepeatedContextConfig();
const now = new Date();
const maximumHorizon = Math.max(...config.horizonsMinutes);
const fixtures = await prisma.fixture.findMany({
  where: {
    status: FixtureStatus.UPCOMING,
    kickoffAt: {
      gt: now,
      lte: new Date(
        now.getTime() +
          (maximumHorizon + 180) * 60_000,
      ),
    },
  },
  select: {
    id: true,
    kickoffAt: true,
  },
  orderBy: { kickoffAt: 'asc' },
  take: 200,
});

const fixtureIds = fixtures.map((fixture) => fixture.id);
const [contextRows, checkpoints] = fixtureIds.length
  ? await Promise.all([
      prisma.fixtureContextCoverageSnapshot.findMany({
        where: { fixtureId: { in: fixtureIds } },
        select: {
          fixtureId: true,
          dataType: true,
          capturedAt: true,
          responseCount: true,
        },
      }),
      prisma.fixtureContextCollectionCheckpoint.findMany({
        where: { fixtureId: { in: fixtureIds } },
        select: {
          fixtureId: true,
          horizonMinutes: true,
          status: true,
          dueAt: true,
        },
      }),
    ])
  : [[], []];

console.log('R5 Horizon Context Coverage');
console.log(`Upcoming fixtures=${fixtures.length}`);

for (const horizonMinutes of config.horizonsMinutes) {
  const eligible = fixtures.filter(
    (fixture) =>
      fixture.kickoffAt.getTime() -
        horizonMinutes * 60_000 <=
      now.getTime(),
  );

  let lineup = 0;
  let injury = 0;
  let success = 0;

  for (const fixture of eligible) {
    const asOf = new Date(
      fixture.kickoffAt.getTime() -
        horizonMinutes * 60_000,
    );

    if (
      contextRows.some(
        (row) =>
          row.fixtureId === fixture.id &&
          row.dataType === 'LINEUP' &&
          row.capturedAt <= asOf,
      )
    ) {
      lineup += 1;
    }

    if (
      contextRows.some(
        (row) =>
          row.fixtureId === fixture.id &&
          row.dataType === 'INJURY' &&
          row.capturedAt <= asOf,
      )
    ) {
      injury += 1;
    }

    if (
      checkpoints.some(
        (row) =>
          row.fixtureId === fixture.id &&
          row.horizonMinutes === horizonMinutes &&
          row.status === 'SUCCESS',
      )
    ) {
      success += 1;
    }
  }

  console.log(
    `T-${horizonMinutes}: eligible=${eligible.length} checkpointSuccess=${percent(success, eligible.length)} lineupCoverage=${percent(lineup, eligible.length)} injuryCoverage=${percent(injury, eligible.length)}`,
  );
}
