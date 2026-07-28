import { prisma } from '@football-ai/database';

type CheckpointRow = {
  horizonMinutes: number;
  horizonLabel: string;
  dueAt: Date;
  status: string;
  attempts: number;
  attemptedAt: Date | null;
  completedAt: Date | null;
  normalizedOdds: number;
  insertedOdds: number;
  pitUsableOdds: number;
  errorMessage: string | null;
};

function checkpointState(now: Date, row: CheckpointRow): string {
  const deltaMinutes = (row.dueAt.getTime() - now.getTime()) / 60_000;

  if (row.completedAt != null) return `TERMINAL_${row.status}`;
  if (deltaMinutes > 1) return `FUTURE_${Math.round(deltaMinutes)}m`;
  if (deltaMinutes >= -8) return 'DUE_WINDOW';
  return 'MISSED_WINDOW_PENDING_CLEANUP';
}

async function main(): Promise<void> {
  const now = new Date();
  const until = new Date(now.getTime() + 36 * 60 * 60 * 1000);

  const fixtures = await prisma.fixture.findMany({
    where: {
      status: 'UPCOMING',
      kickoffAt: { gt: now, lte: until },
    },
    include: {
      league: true,
      homeTeam: true,
      awayTeam: true,
    },
    orderBy: { kickoffAt: 'asc' },
    take: 80,
  });

  console.log(
    JSON.stringify(
      {
        command: 'personal-odds-diagnostics-r4.3.3',
        generatedAt: now.toISOString(),
        windowHours: 36,
        note:
          'Shows ALL fresh-odds horizons. DUE_WINDOW uses the collector defaults: lead=1m, tolerance=8m.',
      },
      null,
      2,
    ),
  );

  for (const fixture of fixtures) {
    const [checkpointsRaw, odds] = await Promise.all([
      prisma.apiFootballFreshOddsCheckpoint.findMany({
        where: { providerFixtureId: fixture.apiFixtureId },
        orderBy: [{ dueAt: 'asc' }, { horizonMinutes: 'desc' }],
      }),
      prisma.apiFootballOddsSnapshot.findMany({
        where: {
          providerFixtureId: fixture.apiFixtureId,
          observedAt: {
            gte: new Date(now.getTime() - 6 * 60 * 60 * 1000),
            lte: now,
          },
        },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        take: 5000,
      }),
    ]);

    const checkpoints = checkpointsRaw as CheckpointRow[];
    const markets = new Map<string, number>();

    for (const row of odds) {
      markets.set(row.marketType, (markets.get(row.marketType) ?? 0) + 1);
    }

    const latest = odds[0] ?? null;

    const nextOpenCheckpoint =
      checkpoints.find(
        (row: CheckpointRow): boolean =>
          row.completedAt == null && row.dueAt.getTime() >= now.getTime() - 8 * 60_000,
      ) ?? null;

    const dueNow = checkpoints.filter(
      (row: CheckpointRow): boolean =>
        row.completedAt == null &&
        row.dueAt.getTime() >= now.getTime() - 8 * 60_000 &&
        row.dueAt.getTime() <= now.getTime() + 1 * 60_000,
    );

    const missedOpen = checkpoints.filter(
      (row: CheckpointRow): boolean =>
        row.completedAt == null &&
        row.dueAt.getTime() < now.getTime() - 8 * 60_000,
    );

    console.log(
      JSON.stringify(
        {
          localFixtureId: fixture.id,
          providerFixtureId: fixture.apiFixtureId,
          league: `${fixture.league.name} ${fixture.league.season}`,
          match: `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`,
          kickoffAt: fixture.kickoffAt.toISOString(),
          minutesToKickoff: Math.round(
            (fixture.kickoffAt.getTime() - now.getTime()) / 60_000,
          ),
          odds: {
            rowsLast6h: odds.length,
            pitUsableRows: odds.filter((row) => row.pitUsable).length,
            markets: Object.fromEntries(markets),
            latestObservedAt: latest?.observedAt.toISOString() ?? null,
            latestSourceUpdatedAt: latest?.sourceUpdatedAt?.toISOString() ?? null,
          },
          checkpointSummary: {
            total: checkpoints.length,
            dueNow: dueNow.length,
            missedOpen: missedOpen.length,
            nextOpen:
              nextOpenCheckpoint == null
                ? null
                : {
                    horizon: nextOpenCheckpoint.horizonLabel,
                    dueAt: nextOpenCheckpoint.dueAt.toISOString(),
                    status: nextOpenCheckpoint.status,
                    state: checkpointState(now, nextOpenCheckpoint),
                  },
          },
          checkpoints: checkpoints.map((row: CheckpointRow) => ({
            horizon: row.horizonLabel,
            horizonMinutes: row.horizonMinutes,
            dueAt: row.dueAt.toISOString(),
            status: row.status,
            state: checkpointState(now, row),
            attempts: row.attempts,
            attemptedAt: row.attemptedAt?.toISOString() ?? null,
            completedAt: row.completedAt?.toISOString() ?? null,
            normalizedOdds: row.normalizedOdds,
            insertedOdds: row.insertedOdds,
            pitUsableOdds: row.pitUsableOdds,
            errorMessage: row.errorMessage,
          })),
          recommendedAction:
            dueNow.length > 0
              ? 'RUN_FRESH_ODDS_TICK_NOW'
              : missedOpen.length > 0
                ? 'RUN_TICK_TO_CLOSE_MISSED_THEN_KEEP_DAEMON_RUNNING'
                : nextOpenCheckpoint != null
                  ? 'KEEP_DAEMON_RUNNING_FOR_NEXT_CHECKPOINT'
                  : odds.length > 0
                    ? 'ODDS_ALREADY_AVAILABLE'
                    : 'NO_OPEN_CHECKPOINT_FOUND',
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
