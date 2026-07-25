import { prisma } from '@football-ai/database';

import {
  getLiveScientificPaperBetCoverage,
  runLiveScientificPaperBetCycle,
  runLiveScientificPaperBetDecisions,
} from './real-odds-paper-bet-engine.js';

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'coverage').trim().toLowerCase();

  if (command === 'decide') {
    console.dir(await runLiveScientificPaperBetDecisions(), {
      depth: null,
    });
    return;
  }

  if (command === 'cycle') {
    console.dir(await runLiveScientificPaperBetCycle(), {
      depth: null,
    });
    return;
  }

  if (command === 'coverage') {
    console.dir(await getLiveScientificPaperBetCoverage(), {
      depth: null,
    });
    return;
  }

  throw new Error(`Unsupported command: ${command}. Use decide, cycle, or coverage.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
