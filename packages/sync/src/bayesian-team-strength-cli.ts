import { prisma } from '@football-ai/database';
import {
  bayesianTeamStrengthSummary,
  loadBayesianTeamStrengthRuntime,
  writeBayesianTeamStrengthArtifacts,
} from './bayesian-team-strength-engine.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'coverage';
  if (command === 'coverage' || command === 'audit') {
    const runtime = await loadBayesianTeamStrengthRuntime();
    console.log(JSON.stringify({ command, ...bayesianTeamStrengthSummary(runtime) }, null, 2));
    if (runtime.status !== 'READY_FOR_PREDICTIVE_MARKETS') process.exitCode = 2;
    return;
  }
  if (command === 'export') {
    const result = await writeBayesianTeamStrengthArtifacts();
    console.log(
      JSON.stringify(
        {
          command,
          directory: result.directory,
          manifestPath: result.manifestPath,
          predictionsPath: result.predictionsPath,
          hashesPath: result.hashesPath,
          ...bayesianTeamStrengthSummary(result.runtime),
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
