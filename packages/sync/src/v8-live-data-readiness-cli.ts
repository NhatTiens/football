import { prisma } from '@football-ai/database';
import { getV8LiveDataReadiness } from './v8-live-data-readiness.js';

getV8LiveDataReadiness()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'READY_FOR_SHADOW_INPUT') process.exitCode = 2;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());

