import { prisma } from '@football-ai/database';
import { getScientificDashboard } from './scientific-dashboard.js';

async function main(): Promise<void> {
  const report = await getScientificDashboard(prisma as any);
  console.dir(report, { depth: null });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
