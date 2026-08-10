import { prisma } from '@football-ai/database';
import { getV8ShadowReleaseGate } from './v8-shadow-release-gate.js';

getV8ShadowReleaseGate()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.promotionEligible) process.exitCode = 2;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
