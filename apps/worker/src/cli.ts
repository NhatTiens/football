import 'dotenv/config';
import { prisma } from '@football-ai/database';
import { executeJob, type WorkerCommand } from './jobs.js';

const command = (process.argv[2] ?? 'full') as WorkerCommand;
const supported: WorkerCommand[] = [
  'sync-fixtures',
  'sync-odds',
  'sync-predictions',
  'generate',
  'settle',
  'backtest',
  'full',
];

if (!supported.includes(command)) {
  console.error(`Unknown command: ${command}. Supported: ${supported.join(', ')}`);
  process.exitCode = 1;
} else {
  executeJob(command)
    .catch(() => {
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
