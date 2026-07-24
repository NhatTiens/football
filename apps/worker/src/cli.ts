import 'dotenv/config';
import { prisma } from '@football-ai/database';
import { executeJob, type WorkerCommand } from './jobs.js';

const command = (process.argv[2] ?? 'full') as WorkerCommand;
const supported: WorkerCommand[] = [
  'sync-fixtures',
  'sync-odds',
  'sync-odds-repeated',
  'odds-coverage',
  'fundamentals-backfill',
  'fundamentals-coverage',
  'ml-feature-backfill',
  'ml-train',
  'ml-score-validation',
  'ml-coverage',
  'scientific-baseline-freeze',
  'scientific-evaluate',
  'scientific-evaluation-coverage',
  'scientific-promotion-report',
  'scientific-diagnostic-run',
  'scientific-diagnostic-coverage',
  'scientific-development-report',
  'scientific-shadow-freeze',
  'scientific-shadow-capture',
  'scientific-shadow-evaluate',
  'scientific-shadow-coverage',
  'scientific-shadow-report',
  'provider-health',
  'provider-replay-run',
  'provider-replay-coverage',
  'provider-replay-report',
  'historical-data-audit-run',
  'historical-data-audit-coverage',
  'historical-data-audit-report',
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
