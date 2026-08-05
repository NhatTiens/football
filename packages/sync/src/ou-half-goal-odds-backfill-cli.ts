import { prisma } from '@football-ai/database';
import { normalizeApiFootballPrematchOdds } from './api-football-contract.js';
import { deterministicHash } from './scientific-evaluation-contract.js';

type RawSnapshotRow = {
  id: number;
  kind: string;
  observedAt: Date;
  rawPayload: unknown;
};

function parseHours(argv: string[]): number {
  const index = argv.indexOf('--hours');
  if (index < 0) return 8760;

  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('--hours must be a positive number.');
  }

  return value;
}

function isIntegerTargetLine(value: number | null): value is 2 | 3 {
  return value === 2 || value === 3;
}

async function main(): Promise<void> {
  const hours = parseHours(process.argv.slice(2));
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  let cursorId = 0;
  let scannedSnapshots = 0;
  let normalizedIntegerOdds = 0;
  let insertedIntegerOdds = 0;

  for (;;) {
    const snapshots = (await prisma.apiFootballDataSnapshot.findMany({
      where: {
        id: { gt: cursorId },
        observedAt: { gte: since },
        kind: {
          in: ['PREMATCH_ODDS_PAGE', 'PREMATCH_ODDS_FIXTURE'],
        },
      },
      select: {
        id: true,
        kind: true,
        observedAt: true,
        rawPayload: true,
      },
      orderBy: { id: 'asc' },
      take: 100,
    })) as RawSnapshotRow[];

    if (snapshots.length === 0) break;

    for (const snapshot of snapshots) {
      scannedSnapshots += 1;
      cursorId = snapshot.id;

      const rows = normalizeApiFootballPrematchOdds(
        snapshot.rawPayload,
        snapshot.observedAt,
      ).filter((row) => row.marketType === 'TOTAL_GOALS' && isIntegerTargetLine(row.lineValue));

      normalizedIntegerOdds += rows.length;

      for (const row of rows) {
        const payloadHash = deterministicHash('API_FOOTBALL_ODDS_SNAPSHOT', {
          providerFixtureId: row.providerFixtureId,
          providerLeagueId: row.providerLeagueId,
          season: row.season,
          kickoffAt: row.kickoffAt.toISOString(),
          sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
          bookmakerId: row.bookmakerId,
          bookmakerName: row.bookmakerName,
          betId: row.betId,
          betName: row.betName,
          marketType: row.marketType,
          selection: row.selection,
          lineValue: row.lineValue,
          decimalOdds: row.decimalOdds,
        });

        const result = await prisma.apiFootballOddsSnapshot.createMany({
          data: [
            {
              providerFixtureId: row.providerFixtureId,
              providerLeagueId: row.providerLeagueId,
              season: row.season,
              kickoffAt: row.kickoffAt,
              sourceUpdatedAt: row.sourceUpdatedAt,
              observedAt: row.observedAt,
              bookmakerId: row.bookmakerId,
              bookmakerName: row.bookmakerName,
              betId: row.betId,
              betName: row.betName,
              marketType: row.marketType,
              selection: row.selection,
              lineValue: row.lineValue,
              decimalOdds: row.decimalOdds,
              pitUsable: row.pitUsable,
              payloadHash,
            },
          ],
          skipDuplicates: true,
        });

        insertedIntegerOdds += result.count;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        command: 'ou-half-goal-odds-backfill',
        hours,
        since: since.toISOString(),
        scannedSnapshots,
        normalizedIntegerOdds,
        insertedIntegerOdds,
        apiCalls: 0,
        schemaChanges: 0,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
