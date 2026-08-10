import { prisma } from '@football-ai/database';
import { getV8MonitoringDashboard } from './v8-monitoring-engine.js';

getV8MonitoringDashboard()
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

