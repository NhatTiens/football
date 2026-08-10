import { prisma } from '@football-ai/database';
import {
  hybridDataFoundationSummary,
  loadHybridDataFoundation,
  writeHybridDataFoundationArtifacts,
} from './hybrid-data-foundation-engine.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'coverage';
  if (command === 'coverage') {
    const result = await loadHybridDataFoundation();
    console.log(JSON.stringify(hybridDataFoundationSummary(result), null, 2));
    return;
  }
  if (command === 'audit') {
    const result = await writeHybridDataFoundationArtifacts({ includeDataset: false });
    console.log(
      JSON.stringify(
        {
          command,
          directory: result.directory,
          manifestPath: result.manifestPath,
          findingsPath: result.findingsPath,
          status: result.audit.status,
          rows: result.audit.rows,
          errors: result.audit.errors,
          warnings: result.audit.warnings,
          apiCalled: false,
          schemaChanged: false,
        },
        null,
        2,
      ),
    );
    if (result.audit.status === 'BLOCKED_PIT_OR_CONTRACT') process.exitCode = 2;
    return;
  }
  if (command === 'export') {
    const result = await writeHybridDataFoundationArtifacts({ includeDataset: true });
    console.log(
      JSON.stringify(
        {
          command,
          directory: result.directory,
          manifestPath: result.manifestPath,
          findingsPath: result.findingsPath,
          datasetPath: result.datasetPath,
          hashesPath: result.hashesPath,
          status: result.audit.status,
          rows: result.audit.rows,
          safeRows: result.audit.safeRows,
          datasetFingerprint: result.audit.datasetFingerprint,
          apiCalled: false,
          schemaChanged: false,
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
