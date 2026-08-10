import { prisma } from '@football-ai/database';
import {
  calibrationSummary,
  loadCalibrationRuntime,
  writeCalibrationArtifacts,
} from './calibration-uncertainty-engine.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'coverage';
  if (command === 'coverage' || command === 'audit') {
    const runtime = await loadCalibrationRuntime();
    console.log(JSON.stringify({ command, ...calibrationSummary(runtime) }, null, 2));
    if (runtime.status !== 'READY_FOR_DECISION_ENGINE') process.exitCode = 2;
    return;
  }
  if (command === 'export') {
    const result = await writeCalibrationArtifacts();
    console.log(
      JSON.stringify(
        {
          command,
          directory: result.directory,
          manifestPath: result.manifestPath,
          calibratorsPath: result.calibratorsPath,
          predictionsPath: result.predictionsPath,
          hashesPath: result.hashesPath,
          ...calibrationSummary(result.runtime),
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

