import { prisma } from '@football-ai/database';
import {
  bayesianPredictiveMarketsSummary,
  loadBayesianPredictiveMarketsRuntime,
  writeBayesianPredictiveMarketsArtifacts,
} from './bayesian-predictive-markets-engine.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'coverage';
  if (command === 'coverage' || command === 'audit') {
    const runtime = await loadBayesianPredictiveMarketsRuntime();
    console.log(JSON.stringify({ command, ...bayesianPredictiveMarketsSummary(runtime) }, null, 2));
    if (runtime.status !== 'READY_FOR_HYBRID_MODEL') process.exitCode = 2;
    return;
  }
  if (command === 'export') {
    const result = await writeBayesianPredictiveMarketsArtifacts();
    console.log(
      JSON.stringify(
        {
          command,
          directory: result.directory,
          manifestPath: result.manifestPath,
          predictionsPath: result.predictionsPath,
          hashesPath: result.hashesPath,
          ...bayesianPredictiveMarketsSummary(result.runtime),
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
