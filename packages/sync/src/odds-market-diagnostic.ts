import { prisma } from '@football-ai/database';

interface DiagnosticOddsRow {
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
  bookmakerName: string;
  observedAt: Date;
  sourceUpdatedAt: Date | null;
  pitUsable: boolean;
}

interface DiagnosticGroup {
  marketType: string;
  lineValue: number | null;
  selection: string;
  rows: number;
  pitUsableRows: number;
  bookmakers: Set<string>;
  latestObservedAt: Date | null;
  latestSourceUpdatedAt: Date | null;
  latestOdds: number | null;
}

function positiveInteger(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null;

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function main(): Promise<void> {
  const providerFixtureId = positiveInteger(process.argv[2]);

  if (providerFixtureId == null) {
    throw new Error(
      'Usage: npm run odds:market-diagnostic -w @football-ai/sync -- <providerFixtureId>',
    );
  }

  const rows = (await prisma.apiFootballOddsSnapshot.findMany({
    where: { providerFixtureId },
    select: {
      marketType: true,
      selection: true,
      lineValue: true,
      decimalOdds: true,
      bookmakerName: true,
      observedAt: true,
      sourceUpdatedAt: true,
      pitUsable: true,
    },
    orderBy: [
      { observedAt: 'desc' },
      { marketType: 'asc' },
      { lineValue: 'asc' },
      { selection: 'asc' },
    ],
    take: 10000,
  })) as DiagnosticOddsRow[];

  const groups = new Map<string, DiagnosticGroup>();

  for (const row of rows) {
    const key = [
      row.marketType,
      row.lineValue == null ? 'NULL' : row.lineValue.toFixed(3),
      row.selection,
    ].join('|');

    const current: DiagnosticGroup = groups.get(key) ?? {
      marketType: row.marketType,
      lineValue: row.lineValue,
      selection: row.selection,
      rows: 0,
      pitUsableRows: 0,
      bookmakers: new Set<string>(),
      latestObservedAt: null,
      latestSourceUpdatedAt: null,
      latestOdds: null,
    };

    current.rows += 1;

    if (row.pitUsable) {
      current.pitUsableRows += 1;
    }

    current.bookmakers.add(row.bookmakerName);

    if (
      current.latestObservedAt == null ||
      row.observedAt.getTime() > current.latestObservedAt.getTime()
    ) {
      current.latestObservedAt = row.observedAt;
      current.latestSourceUpdatedAt = row.sourceUpdatedAt;
      current.latestOdds = row.decimalOdds;
    }

    groups.set(key, current);
  }

  const summary = [...groups.values()]
    .map((group: DiagnosticGroup) => ({
      marketType: group.marketType,
      lineValue: group.lineValue,
      selection: group.selection,
      rows: group.rows,
      pitUsableRows: group.pitUsableRows,
      bookmakers: group.bookmakers.size,
      latestOdds: group.latestOdds,
      latestObservedAt: group.latestObservedAt?.toISOString() ?? null,
      latestSourceUpdatedAt:
        group.latestSourceUpdatedAt?.toISOString() ?? null,
    }))
    .sort(
      (left, right) =>
        left.marketType.localeCompare(right.marketType) ||
        (left.lineValue ?? -1) - (right.lineValue ?? -1) ||
        left.selection.localeCompare(right.selection),
    );

  const totalGoalsRows = rows.filter(
    (row: DiagnosticOddsRow): boolean =>
      row.marketType === 'TOTAL_GOALS',
  );

  const totalGoals15Rows = totalGoalsRows.filter(
    (row: DiagnosticOddsRow): boolean => row.lineValue === 1.5,
  );

  const totalGoals25Rows = totalGoalsRows.filter(
    (row: DiagnosticOddsRow): boolean => row.lineValue === 2.5,
  );

  const totalGoals35Rows = totalGoalsRows.filter(
    (row: DiagnosticOddsRow): boolean => row.lineValue === 3.5,
  );

  console.log(
    JSON.stringify(
      {
        providerFixtureId,
        totalRows: rows.length,
        totalGoalsRows: totalGoalsRows.length,
        totalGoals15Rows: totalGoals15Rows.length,
        totalGoals25Rows: totalGoals25Rows.length,
        totalGoals35Rows: totalGoals35Rows.length,
        hasSupportedTotalGoals:
          totalGoals15Rows.length > 0 ||
          totalGoals25Rows.length > 0 ||
          totalGoals35Rows.length > 0,
        groups: summary,
        externalApiCalled: false,
        databaseWritten: false,
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
