import { prisma } from '@football-ai/database';
import {
  collectFreshOddsDue,
  discoverFreshOddsFixtures,
  freshOddsReadiness,
  getFreshOddsCoverage,
  planFreshOddsCheckpoints,
  runFreshOddsOnce,
} from './fresh-odds-collector-engine.js';
import { FRESH_ODDS_COLLECTOR_VERSION } from './fresh-odds-collector-core.js';

function integerEnv(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}.`);
  return value;
}

function print(value: unknown): void {
  console.dir(value, { depth: null });
}

async function daemon(): Promise<void> {
  const intervalSeconds = integerEnv('FRESH_ODDS_DAEMON_INTERVAL_SECONDS', 60, 30);
  const discoverEveryMinutes = integerEnv('FRESH_ODDS_DISCOVERY_INTERVAL_MINUTES', 360, 15);
  const planEveryMinutes = integerEnv('FRESH_ODDS_PLAN_INTERVAL_MINUTES', 15, 1);
  console.log(`[fresh-odds] ${FRESH_ODDS_COLLECTOR_VERSION} daemon started.`);
  console.log(`[fresh-odds] tick=${intervalSeconds}s plan=${planEveryMinutes}m discover=${discoverEveryMinutes}m`);
  console.log('[fresh-odds] Ctrl+C to stop. No real-money execution; no automatic model promotion.');

  let lastDiscover = 0;
  let lastPlan = 0;
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[fresh-odds] received ${signal}; shutting down.`);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  while (!stopping) {
    const started = Date.now();
    try {
      if (started - lastDiscover >= discoverEveryMinutes * 60_000) {
        print(await discoverFreshOddsFixtures());
        lastDiscover = Date.now();
      }
      if (started - lastPlan >= planEveryMinutes * 60_000) {
        print(await planFreshOddsCheckpoints());
        lastPlan = Date.now();
      }
      print(await collectFreshOddsDue());
    } catch (error) {
      console.error('[fresh-odds] daemon cycle failed:', error);
    }
    const wait = Math.max(1_000, intervalSeconds * 1_000 - (Date.now() - started));
    await new Promise<void>((resolve) => setTimeout(resolve, wait));
  }
}

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'readiness').trim().toLowerCase();
  if (command === 'readiness') print(await freshOddsReadiness());
  else if (command === 'discover') print(await discoverFreshOddsFixtures());
  else if (command === 'plan') print(await planFreshOddsCheckpoints());
  else if (command === 'tick') print(await collectFreshOddsDue());
  else if (command === 'coverage') print(await getFreshOddsCoverage());
  else if (command === 'once') print(await runFreshOddsOnce());
  else if (command === 'daemon') await daemon();
  else throw new Error(`Unknown fresh odds command: ${command}. Supported: readiness, discover, plan, tick, coverage, once, daemon.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if ((process.argv[2] ?? '').trim().toLowerCase() !== 'daemon') await prisma.$disconnect();
  });
