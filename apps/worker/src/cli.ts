import 'dotenv/config';
import { prisma } from '@football-ai/database';
import { executeJob, type WorkerCommand } from './jobs.js';

const command = (process.argv[2] ?? 'full') as WorkerCommand;
const supported: WorkerCommand[] = [
  'sync-fixtures',
  'sync-odds',
  'sync-odds-repeated',
  'odds-coverage',
  'sync-lineups',
  'sync-lineups-history',
  'sync-predictions',
  'sync-scientific-stats',
  'sync-scientific-injuries',
  'rebuild-elo',
  'train-scientific',
  'generate',
  'settle',
  'backtest',
  'scientific-backtest',
  'scientific-walk-forward',
  'scientific-full',
  'full',
];

if (!supported.includes(command)) {
  console.error(`Unknown command: ${command}.\nSupported: ${supported.join(', ')}`);
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
