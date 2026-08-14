import { readFile, access } from 'node:fs/promises';

const requiredFiles = [
  'packages/database/prisma/migrations/20260814230000_history_realtime_v6/migration.sql',
  'packages/sync/src/history-result-worker.ts',
  'packages/sync/src/history-result-runner.ts',
  'scripts/api-football-quota-preload.mjs',
  'apps/api/src/realtime-server.ts',
  'apps/web/components/RealtimeHistoryRefresh.tsx',
  'apps/worker/src/quota-runner.ts',
];

function fail(message) {
  throw new Error(`[history-realtime-v6 verify] ${message}`);
}

async function text(path) {
  return readFile(path, 'utf8');
}

for (const file of requiredFiles) await access(file);

const schema = await text('packages/database/prisma/schema.prisma');
for (const model of ['ResultUpdateJob', 'ApiQuotaDaily', 'RealtimeOutbox']) {
  if (!schema.includes(`model ${model} {`)) fail(`missing Prisma model ${model}`);
}

const migration = await text(requiredFiles[0]);
for (const table of ['ResultUpdateJob', 'ApiQuotaDaily', 'RealtimeOutbox']) {
  if (!migration.includes(`CREATE TABLE \`${table}\``)) fail(`migration missing ${table}`);
}

const worker = await text('packages/sync/src/history-result-worker.ts');
const workerAssertions = [
  ["decisionType: 'BEST_BET'", 'worker must only use stored BEST_BET predictions'],
  ['settlement: null', 'worker must only use unsettled predictions'],
  ["PAPER_BET_RESULT_MINUTES_AFTER_KICKOFF', 105, 100, 110", '105-minute first check missing'],
  ['[7, 10, 15, 20, 30, 45, 60]', 'retry backoff schedule missing'],
  ["status: 'PROCESSING'", 'processing lock state missing'],
  ['lockToken', 'per-fixture lock token missing'],
  ["status: 'COMPLETED'", 'completed terminal state missing'],
  ["eventType: 'history_updated'", 'history outbox event missing'],
  ["{ maxAttempts: 1 }", 'result API call must not retry internally'],
];
for (const [needle, message] of workerAssertions) if (!worker.includes(needle)) fail(message);
if (/scientificPaperBetDecision\.(create|createMany|upsert)\s*\(/.test(worker)) {
  fail('result worker must never create predictions');
}

const workerRunner = await text('apps/worker/src/quota-runner.ts');
if (!workerRunner.includes("PAPER_BET_SETTLEMENT_CRON = '0 0 1 1 *'")) fail('legacy settlement cron is not disabled in quota runner');
if (!workerRunner.includes("HISTORY_RESULT_EXCLUSIVE_MODE = 'true'")) fail('exclusive result ownership missing');

const quota = await text('scripts/api-football-quota-preload.mjs');
for (const needle of [
  "API_FOOTBALL_DAILY_LIMIT', 7500",
  'apiQuotaDaily.updateMany',
  'remaining: { decrement: 1 }',
  'used: { increment: 1 }',
  '[api-football-quota] BLOCKED',
  'HISTORY_RESULT_EXCLUSIVE_MODE',
  '[history-result-owned]',
]) {
  if (!quota.includes(needle)) fail(`quota preloader missing: ${needle}`);
}

const realtime = await text('apps/api/src/realtime-server.ts');
for (const needle of ["requestUrl.pathname !== '/ws'", 'realtimeOutbox.findMany', "event: 'connected'"]) {
  if (!realtime.includes(needle)) fail(`realtime server missing: ${needle}`);
}

const client = await text('apps/web/components/RealtimeHistoryRefresh.tsx');
for (const needle of ["payload.event === 'history_updated'", 'router.refresh()', '75_000', 'new WebSocket']) {
  if (!client.includes(needle)) fail(`realtime client missing: ${needle}`);
}
if (/window\.location\.reload|location\.reload/.test(client)) fail('browser reload is forbidden');

const layout = await text('apps/web/app/layout.tsx');
if (!layout.includes('<RealtimeHistoryRefresh />')) fail('root layout does not mount realtime client');

const ledger = await text('packages/sync/src/paper-bet-ledger-engine.ts');
if (!ledger.includes('Refusing to create paper prediction')) fail('post-kickoff prediction guard missing');

console.log('HISTORY_REALTIME_V6_STATIC_VERIFY_PASS');
