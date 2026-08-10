import { prisma } from '@football-ai/database';
import {
  loadMultiHorizonDecisionRuntime,
  multiHorizonDecisionSummary,
  writeMultiHorizonDecisionArtifacts,
} from './multi-horizon-decision-engine.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'coverage';
  if (command === 'coverage' || command === 'audit') {
    const runtime = await loadMultiHorizonDecisionRuntime();
    console.log(JSON.stringify({ command, ...multiHorizonDecisionSummary(runtime) }, null, 2));
    if (runtime.status !== 'READY_FOR_BACKTEST') process.exitCode = 2;
    return;
  }
  if (command === 'export') {
    const result = await writeMultiHorizonDecisionArtifacts();
    console.log(
      JSON.stringify(
        {
          command,
          directory: result.directory,
          manifestPath: result.manifestPath,
          decisionsPath: result.decisionsPath,
          candidatesPath: result.candidatesPath,
          hashesPath: result.hashesPath,
          ...multiHorizonDecisionSummary(result.runtime),
        },
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(`Unsupported command: ${command}. Use coverage, audit, or export.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

