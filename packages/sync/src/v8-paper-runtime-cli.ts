import { prisma } from '@football-ai/database';
import {
  getV8PaperRuntimeCoverage,
  loadV8CalibrationRegistry,
  runV8PaperRuntime,
  settleV8PaperFromArchive,
} from './v8-paper-runtime-engine.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'readiness';
  if (command === 'readiness') {
    const registry = loadV8CalibrationRegistry();
    console.log(
      JSON.stringify(
        {
          command,
          status: 'READY_FOR_PARALLEL_PAPER',
          calibrationArtifactPath: registry.path,
          calibrationArtifactHash: registry.hash,
          calibrators: registry.calibrators.length,
          writeEnabled: process.env.V8_PAPER_WRITE_ENABLED === 'true',
          appendOnly: true,
          pointInTime: true,
          paperOnly: true,
          externalApiCalled: false,
          schemaChanged: false,
          currentChampionChanged: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === 'preview') {
    console.log(JSON.stringify(await runV8PaperRuntime({ dryRun: true }), null, 2));
    return;
  }
  if (command === 'once') {
    console.log(JSON.stringify(await runV8PaperRuntime(), null, 2));
    return;
  }
  if (command === 'settle-archive') {
    console.log(JSON.stringify(await settleV8PaperFromArchive(), null, 2));
    return;
  }
  if (command === 'coverage') {
    console.log(JSON.stringify(await getV8PaperRuntimeCoverage(), null, 2));
    return;
  }
  throw new Error('Unsupported command. Use readiness, preview, once, settle-archive, or coverage.');
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

