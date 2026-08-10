import { prisma } from '@football-ai/database';
import {
  championChallengerSummary,
  loadChampionChallengerBacktestRuntime,
  writeChampionChallengerArtifacts,
} from './champion-challenger-backtest-engine.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'report';
  if (command === 'report' || command === 'audit') {
    const runtime = await loadChampionChallengerBacktestRuntime();
    console.log(JSON.stringify({ command, ...championChallengerSummary(runtime) }, null, 2));
    if (runtime.status !== 'READY_FOR_PAPER_RUNTIME') process.exitCode = 2;
    return;
  }
  if (command === 'export') {
    const result = await writeChampionChallengerArtifacts();
    console.log(
      JSON.stringify(
        {
          command,
          directory: result.directory,
          manifestPath: result.manifestPath,
          decisionsPath: result.decisionsPath,
          betsPath: result.betsPath,
          hashesPath: result.hashesPath,
          ...championChallengerSummary(result.runtime),
        },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(`Unsupported command: ${command}. Use report, audit, or export.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

