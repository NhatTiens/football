import { prisma } from '@football-ai/database';
import {
  hybridModelSummary,
  loadHybridModelRuntime,
  writeHybridModelArtifacts,
} from './hybrid-model-engine.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'coverage';
  if (command === 'coverage' || command === 'audit') {
    const runtime = await loadHybridModelRuntime();
    console.log(JSON.stringify({ command, ...hybridModelSummary(runtime) }, null, 2));
    if (runtime.status !== 'READY_FOR_CALIBRATION') process.exitCode = 2;
    return;
  }
  if (command === 'export') {
    const result = await writeHybridModelArtifacts();
    console.log(
      JSON.stringify(
        {
          command,
          directory: result.directory,
          manifestPath: result.manifestPath,
          predictionsPath: result.predictionsPath,
          registryPath: result.registryPath,
          hashesPath: result.hashesPath,
          ...hybridModelSummary(result.runtime),
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
