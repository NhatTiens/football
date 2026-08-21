import { access, readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = process.cwd();
const read = async (path) => readFile(join(root, path), 'utf8');
const requireFile = async (path) => access(join(root, path));
const assert = (condition, message) => {
  if (!condition) throw new Error(`[automatic-pipeline-v1] ${message}`);
};

const requiredFiles = [
  'packages/sync/src/automatic-pipeline-core.ts',
  'packages/sync/src/automatic-pipeline-engine.ts',
  'packages/sync/tests/automatic-pipeline-core.test.ts',
  'apps/web/app/admin/automation/page.tsx',
  'deploy/pm2-ecosystem.config.cjs',
  'docs/AUTOMATIC_PIPELINE.md',
];
await Promise.all(requiredFiles.map(requireFile));

const [syncIndex, automaticEngine, quotaPreload, workerJobs, workerIndex, apiServer, apiApp, upcoming, realtimeClient, resultWorker, resultRunner, realtimeServer, pm2] =
  await Promise.all([
    read('packages/sync/src/index.ts'),
    read('packages/sync/src/automatic-pipeline-engine.ts'),
    read('scripts/api-football-quota-preload.mjs'),
    read('apps/worker/src/jobs.ts'),
    read('apps/worker/src/index.ts'),
    read('apps/api/src/server.ts'),
    read('apps/api/src/app.ts'),
    read('apps/web/components/UpcomingPredictionBoard.tsx'),
    read('apps/web/components/RealtimeHistoryRefresh.tsx'),
    read('packages/sync/src/history-result-worker.ts'),
    read('packages/sync/src/history-result-runner.ts'),
    read('apps/api/src/realtime-server.ts'),
    read('deploy/pm2-ecosystem.config.cjs'),
  ]);

assert(syncIndex.includes("export * from './automatic-pipeline-core.js';"), 'sync core export missing');
assert(syncIndex.includes("export * from './automatic-pipeline-engine.js';"), 'sync engine export missing');
assert(automaticEngine.includes('automation.pipeline.lease'), 'durable pipeline lease missing');
assert(automaticEngine.includes('AUTOMATIC_COMPETITION_DISCOVERY_INTERVAL_MINUTES'), 'competition discovery cache cadence missing');
assert(automaticEngine.includes('automation.prediction-retry.state'), 'durable prediction retry state missing');
assert(automaticEngine.includes('predictionRetryDelayMinutes'), 'prediction retry backoff missing');
assert(automaticEngine.includes("SKIPPED_QUOTA_RESERVE"), 'quota reserve gate missing from provider-heavy phases');
assert(automaticEngine.includes("externalPrediction: { is: null }"), 'prediction queue does not filter already-predicted fixtures');
assert(automaticEngine.includes("status: 'UPCOMING'"), 'prediction queue is not restricted to upcoming fixtures');
assert(automaticEngine.includes('kickoffAt: { gt: now'), 'prediction queue can include started fixtures');
assert(automaticEngine.includes("emitRealtime('PREDICTION_CREATED'"), 'prediction-created realtime event missing');
assert(automaticEngine.includes("emitRealtime('DATA_SYNC_COMPLETED'"), 'sync-completed realtime event missing');
assert(automaticEngine.includes("jobName: 'admin-force-sync-request'"), 'admin force-sync audit log missing');
assert(quotaPreload.includes('API_FOOTBALL_PRIORITY_CONTEXT'), 'quota manager priority context missing');
assert(quotaPreload.includes("API_FOOTBALL_DAILY_LIMIT', 7500"), 'hard 7,500/day quota default missing');
assert(workerJobs.includes("'automatic-pipeline-cycle'"), 'automatic worker command missing');
assert(workerJobs.includes('runAutomaticPipelineCycle'), 'automatic worker handler missing');
assert(workerIndex.includes('AUTOMATIC_PIPELINE_ENABLED'), 'automatic scheduler switch missing');
assert(workerIndex.includes("'*/2 * * * *'"), 'automatic scheduler default cadence missing');
assert(workerIndex.includes("../../../scripts/api-football-quota-preload.mjs"), 'worker quota preload missing');
assert(apiServer.includes("../../../scripts/api-football-quota-preload.mjs"), 'standard API quota preload missing');
assert(resultRunner.includes("../../../scripts/api-football-quota-preload.mjs"), 'result worker quota preload missing');
assert(realtimeServer.includes("../../../scripts/api-football-quota-preload.mjs"), 'realtime API quota preload missing');

assert(apiApp.includes("'/api/automation/status'"), 'public automation status endpoint missing');
assert(apiApp.includes("'/api/admin/automation/status'"), 'admin automation status endpoint missing');
assert(apiApp.includes("'/api/admin/automation/force-sync'"), 'admin force-sync endpoint missing');
assert(apiApp.includes('adminForceSyncLimiter'), 'admin force-sync rate limiter missing');
assert(apiApp.includes('queueAutomaticForceSync'), 'admin force-sync is not queue-backed');
assert(apiApp.includes('AUTOMATION_MANAGED'), 'manual public refresh route is not disabled');
assert(!apiApp.includes('refreshPersonalUpcomingAnalysis,'), 'HTTP app still imports manual provider refresh');

for (const label of ['Lấy lịch thật & phân tích', 'Làm mới từ DB', '/personal/upcoming/refresh']) {
  assert(!upcoming.includes(label), `user UI still contains manual trigger: ${label}`);
}
assert(upcoming.includes('Hệ thống tự động cập nhật'), 'automatic UI status missing');
assert(upcoming.includes('Đang cập nhật dữ liệu'), 'sync-in-progress UI missing');
assert(upcoming.includes('Đang phân tích'), 'prediction-in-progress UI missing');
assert(upcoming.includes('football-ai:realtime'), 'upcoming page realtime listener missing');
assert(upcoming.includes('/automation/status'), 'upcoming page backend automation status fetch missing');

assert(realtimeClient.includes('new WebSocket'), 'WebSocket client missing');
assert(realtimeClient.includes('REALTIME_RECONNECTED'), 'reconnect snapshot refresh missing');
assert(realtimeClient.includes('REALTIME_FALLBACK_POLL'), 'backend-only fallback polling missing');
assert(realtimeClient.includes('football-ai:realtime'), 'shared realtime browser event missing');
assert(realtimeClient.includes('/automation/status'), 'realtime fallback does not use backend status API');
assert(!realtimeClient.includes('v3.football.api-sports.io'), 'realtime client contains direct API-Football host');

assert(resultWorker.includes("eventType: 'PREDICTION_RESULT_UPDATED'"), 'standard result event missing');
assert(resultWorker.includes("eventType: 'MATCH_FINISHED'"), 'match-finished realtime event missing');
assert(resultWorker.includes("eventType: 'history_updated'"), 'legacy history event must remain compatible');
assert(resultWorker.includes("PAPER_BET_RESULT_MINUTES_AFTER_KICKOFF', 105, 100, 110"), '105-minute result schedule contract changed');
assert(resultWorker.includes('[7, 10, 15, 20, 30, 45, 60]'), 'result retry backoff contract missing');
assert(resultWorker.includes("decisionType: 'BEST_BET'"), 'result worker no longer restricted to stored predictions');

assert(realtimeServer.includes('recordRealtimeHeartbeat'), 'realtime heartbeat monitoring missing');
assert(realtimeServer.includes('clients.size'), 'realtime client count monitoring missing');
assert(pm2.includes('football-api-realtime'), 'PM2 API/realtime process missing');
assert(pm2.includes('football-worker'), 'PM2 automatic worker missing');
assert(pm2.includes('football-result-worker'), 'PM2 result worker missing');
assert(pm2.includes('football-web'), 'PM2 web process missing');
assert(!pm2.includes('npm run dev'), 'production process config depends on dev mode');

const WEB_SOURCE_ROOTS = [
  'apps/web/app',
  'apps/web/components',
  'apps/web/lib',
  'apps/web/tests',
];
const WEB_SOURCE_FILES = [
  'apps/web/next.config.ts',
  'apps/web/eslint.config.mjs',
  'apps/web/next-env.d.ts',
];
const IGNORED_SOURCE_DIRECTORIES = new Set([
  '.next',
  'node_modules',
  'coverage',
  'dist',
  'build',
  '.turbo',
]);

async function webSourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_SOURCE_DIRECTORIES.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await webSourceFiles(path)));
    else if (/\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const webFiles = [];
for (const sourceRoot of WEB_SOURCE_ROOTS) {
  webFiles.push(...(await webSourceFiles(join(root, sourceRoot))));
}
for (const sourceFile of WEB_SOURCE_FILES) {
  webFiles.push(join(root, sourceFile));
}

for (const path of webFiles) {
  const source = await readFile(path, 'utf8');
  assert(
    !/(?:fetch|axios\.(?:get|post)|new\s+WebSocket)\s*\([^\n]{0,200}(?:v3\.football\.api-sports\.io|api-football\.com)/i.test(source),
    `frontend directly references API-Football network host in ${relative(root, path)}`,
  );
  assert(!source.includes('window.location.reload('), `browser hard reload found in ${relative(root, path)}`);
  assert(!source.includes('/personal/upcoming/refresh'), `manual user refresh endpoint referenced in ${relative(root, path)}`);
}

console.log('AUTOMATIC_PIPELINE_V1_STATIC_VERIFY_PASS');
