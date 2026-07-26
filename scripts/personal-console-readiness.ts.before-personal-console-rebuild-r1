import { prisma } from '@football-ai/database';
import { getPersonalUpcomingAnalysis } from '../packages/sync/src/personal-console-engine.js';

async function main(): Promise<void> {
  const analysis = await getPersonalUpcomingAnalysis({ days: 7, limit: 300 });
  console.dir(analysis, { depth: 5 });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
