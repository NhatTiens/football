import { prisma } from '@football-ai/database';

import {
  getHistoricalBestBetBenchmarkCoverage,
  runHistoricalBestBetBenchmark,
  type HistoricalBenchmarkOptions,
} from './historical-best-bet-benchmark-engine.js';

function argsMap(): Map<string, string> {
  return new Map(
    process.argv.slice(3).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, '').split('=');
      return [key ?? '', rest.join('=')];
    }),
  );
}

function parseDate(value: string | undefined, label: string): Date | undefined {
  if (value == null || value === '') return undefined;
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${label}: ${value}`);
  return date;
}

function parseEndDate(value: string | undefined): Date | undefined {
  if (value == null || value === '') return undefined;
  const date = new Date(value.includes('T') ? value : `${value}T23:59:59.999Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid --to: ${value}`);
  return date;
}

function parseNumber(value: string | undefined, label: string): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'coverage').trim().toLowerCase();
  const args = argsMap();
  const options: HistoricalBenchmarkOptions = {
    dateFrom: parseDate(args.get('from'), '--from'),
    dateTo: parseEndDate(args.get('to')),
    maxOddsAgeMinutes: parseNumber(args.get('max-odds-age-minutes'), '--max-odds-age-minutes'),
    fixtureLimit: parseNumber(args.get('limit'), '--limit'),
  };

  if (command === 'coverage') {
    console.dir(await getHistoricalBestBetBenchmarkCoverage(options), { depth: null });
    return;
  }
  if (command === 'benchmark') {
    console.dir(await runHistoricalBestBetBenchmark(options), { depth: null });
    return;
  }
  throw new Error(`Unsupported command: ${command}. Use coverage or benchmark.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
