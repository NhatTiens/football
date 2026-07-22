import 'dotenv/config';
import { prisma } from '@football-ai/database';

function toNumber(value: unknown): number {
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

async function main() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error('DATABASE_URL is missing');
  }

  const currentDatabase = new URL(url).pathname.replace(/^\//, '');

  console.log('\nCurrent database:', currentDatabase);
  console.log('Searching MySQL schemas...\n');

  const summaries = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      TABLE_SCHEMA AS databaseName,
      COUNT(*) AS tableCount,
      SUM(LOWER(TABLE_NAME) = 'fixture') AS hasFixture,
      SUM(LOWER(TABLE_NAME) IN ('oddssnapshot', 'odds_snapshot')) AS hasOdds,
      SUM(LOWER(TABLE_NAME) = 'recommendation') AS hasRecommendation,
      SUM(LOWER(TABLE_NAME) IN (
        'fixturelineupsnapshot',
        'fixture_lineup_snapshot'
      )) AS hasLineup
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA NOT IN (
      'information_schema',
      'mysql',
      'performance_schema',
      'sys'
    )
    GROUP BY TABLE_SCHEMA
    ORDER BY tableCount DESC
  `);

  console.table(
    summaries.map((row) => ({
      database: row.databaseName,
      tables: toNumber(row.tableCount),
      fixture: toNumber(row.hasFixture),
      odds: toNumber(row.hasOdds),
      recommendation: toNumber(row.hasRecommendation),
      lineup: toNumber(row.hasLineup),
    })),
  );

  const relatedTables = await prisma.$queryRawUnsafe<any[]>(`
    SELECT
      TABLE_SCHEMA AS databaseName,
      TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA NOT IN (
      'information_schema',
      'mysql',
      'performance_schema',
      'sys'
    )
    AND (
      LOWER(TABLE_NAME) LIKE '%fixture%'
      OR LOWER(TABLE_NAME) LIKE '%odds%'
      OR LOWER(TABLE_NAME) LIKE '%recommend%'
      OR LOWER(TABLE_NAME) LIKE '%lineup%'
    )
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);

  console.log('\nRelevant tables:\n');
  console.table(relatedTables);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
