import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '@football-ai/database';

const schemaPath = './packages/database/prisma/schema.prisma';
const schema = readFileSync(schemaPath, 'utf8');

const models = [
  'Fixture',
  'OddsSnapshot',
  'ExternalPrediction',
  'FixtureLineupSnapshot',
  'Recommendation',
  'ApiUsage',
  'SyncRun',
];

function clientName(modelName: string): string {
  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

function getDateFields(modelName: string): string[] {
  const pattern = new RegExp(
    `model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`,
    'm',
  );

  const match = schema.match(pattern);
  if (!match) return [];

  return match[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\w+)\s+DateTime\??(?:\s|$)/)?.[1])
    .filter((field): field is string => Boolean(field));
}

async function main() {
  console.log('\n=== PHAM VI DU LIEU HIEN CO ===\n');

  for (const modelName of models) {
    const delegate = (prisma as any)[clientName(modelName)];

    if (!delegate) {
      console.log(`${modelName}: Prisma client khong co model nay.`);
      continue;
    }

    const count = await delegate.count();
    const dateFields = getDateFields(modelName);

    console.log(`\n${modelName}: ${count} ban ghi`);

    if (dateFields.length === 0) {
      console.log('  Khong tim thay truong DateTime.');
      continue;
    }

    for (const field of dateFields) {
      try {
        const range = await delegate.aggregate({
          _min: { [field]: true },
          _max: { [field]: true },
        });

        console.log(`  ${field}:`);
        console.log(`    Tu:  ${range._min?.[field] ?? 'khong co'}`);
        console.log(`    Den: ${range._max?.[field] ?? 'khong co'}`);
      } catch (error) {
        console.log(`  ${field}: khong doc duoc`);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

