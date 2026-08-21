import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MARKER = 'AUTOMATIC_PIPELINE_V1';

function fail(message) {
  throw new Error(`[automatic-pipeline-v1.5] ${message}`);
}

async function readSource(path) {
  const absolute = resolve(process.cwd(), path);
  const raw = await readFile(absolute, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { absolute, text: raw.replace(/\r\n/g, '\n'), eol };
}

async function writeSource(file, text) {
  await writeFile(file.absolute, text.replace(/\n/g, file.eol), 'utf8');
}

function replaceOnce(text, pattern, replacement, label) {
  if (typeof pattern === 'string') {
    const index = text.indexOf(pattern);
    if (index < 0) fail(`anchor not found (${label})`);
    if (text.indexOf(pattern, index + pattern.length) >= 0) fail(`anchor not unique (${label})`);
    return text.slice(0, index) + replacement + text.slice(index + pattern.length);
  }
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) fail(`${label}: expected one regex match, found ${matches.length}`);
  return text.replace(pattern, replacement);
}

async function updateSyncIndex() {
  const file = await readSource('packages/sync/src/index.ts');
  let text = file.text;
  if (!text.includes("export * from './automatic-pipeline-core.js';")) {
    text = `${text.trimEnd()}\nexport * from './automatic-pipeline-core.js';\nexport * from './automatic-pipeline-engine.js';\n`;
  }
  await writeSource(file, text);
}

async function updateQuotaPreloader() {
  const file = await readSource('scripts/api-football-quota-preload.mjs');
  let text = file.text;
  if (!text.includes('API_FOOTBALL_PRIORITY_CONTEXT')) {
    text = replaceOnce(
      text,
      "  function priorityFor(url) {\n",
      "  function priorityFor(url) {\n    const explicitPriority = String(process.env.API_FOOTBALL_PRIORITY_CONTEXT ?? '').trim().toUpperCase();\n    if (['CRITICAL', 'HIGH', 'NORMAL', 'LOW'].includes(explicitPriority)) return explicitPriority;\n",
      'quota priority context',
    );
  }
  await writeSource(file, text);
}

async function updateWorkerJobs() {
  const file = await readSource('apps/worker/src/jobs.ts');
  let text = file.text;
  if (!text.includes('runAutomaticPipelineCycle,')) {
    text = replaceOnce(
      text,
      '  runPaperBetOperationsCycle,\n',
      '  runPaperBetOperationsCycle,\n  runAutomaticPipelineCycle,\n',
      'worker import',
    );
  }
  if (!text.includes("| 'automatic-pipeline-cycle'")) {
    text = replaceOnce(
      text,
      "  | 'paper-bet-operations-cycle'\n",
      "  | 'paper-bet-operations-cycle'\n  | 'automatic-pipeline-cycle'\n",
      'worker command union',
    );
  }
  if (!text.includes("command === 'automatic-pipeline-cycle'")) {
    text = replaceOnce(
      text,
      "    if (command === 'sync-fixtures') result = await syncFixtures();\n",
      "    if (command === 'automatic-pipeline-cycle') result = await runAutomaticPipelineCycle();\n    else if (command === 'sync-fixtures') result = await syncFixtures();\n",
      'worker handler',
    );
  }
  await writeSource(file, text);
}

async function updateWorkerIndex() {
  const file = await readSource('apps/worker/src/index.ts');
  let text = file.text;

  if (!text.startsWith("import '../../../scripts/api-football-quota-preload.mjs';")) {
    text = `import '../../../scripts/api-football-quota-preload.mjs';\n${text}`;
  }

  // Do not anchor this flag to scienceOwnsProviderSync: the worker index evolves often.
  // The only structural requirement is the scheduler guard itself.
  if (!text.includes('const automaticPipelineEnabled =')) {
    const flag =
      "const automaticPipelineEnabled =\n" +
      "  (process.env.AUTOMATIC_PIPELINE_ENABLED ?? 'true').toLowerCase() === 'true';\n";
    text = replaceOnce(
      text,
      /(?=if \(!enabled\) \{)/,
      flag,
      'automatic scheduler flag',
    );
  }

  // Keep the existing legacy schedule definition intact. Automatic mode schedules one
  // durable orchestration cycle and suppresses only the cron jobs whose work that cycle owns.
  // This is much less brittle than replacing the entire schedules ternary.
  if (!text.includes("const automaticOwnedCommands = new Set<string>([")) {
    const loopAnchor = '  for (const [expression, command] of schedules) {\n';
    const automaticBlock = `  if (automaticPipelineEnabled) {\n    const automaticExpression = process.env.AUTOMATIC_PIPELINE_CRON ?? '*/2 * * * *';\n    if (!cron.validate(automaticExpression)) {\n      throw new Error(\`Invalid cron expression for automatic-pipeline-cycle: \${automaticExpression}\`);\n    }\n    cron.schedule(\n      automaticExpression,\n      () => void executeJob('automatic-pipeline-cycle'),\n      { timezone: 'Asia/Ho_Chi_Minh' },\n    );\n    console.log(\`[worker] scheduled automatic-pipeline-cycle: \${automaticExpression}\`);\n    console.log('[worker] automatic backend pipeline owns fixture/prediction/context/odds orchestration.');\n  }\n\n  const automaticOwnedCommands = new Set<string>([\n    'sync-fixtures',\n    'sync-odds',\n    'sync-odds-repeated',\n    'paper-bet-operations-cycle',\n    'sync-lineups',\n    'sync-predictions',\n  ]);\n\n  for (const [expression, command] of schedules) {\n    if (automaticPipelineEnabled && automaticOwnedCommands.has(command)) {\n      console.log(\`[worker] automatic pipeline owns \${command}; skipping legacy cron.\`);\n      continue;\n    }\n`;
    text = replaceOnce(text, loopAnchor, automaticBlock, 'automatic worker schedule wrapper');
  }

  // Keep the legacy one-shot recommendation startup unchanged. The durable automatic
  // pipeline is independently scheduled by cron above (default every 2 minutes), so
  // restart recovery does not depend on this setTimeout or on any frontend request.

  await writeSource(file, text);
}

async function updateApiServerEntry() {
  const file = await readSource('apps/api/src/server.ts');
  let text = file.text;
  if (!text.startsWith("import '../../../scripts/api-football-quota-preload.mjs';")) {
    text = `import '../../../scripts/api-football-quota-preload.mjs';\n${text}`;
  }
  await writeSource(file, text);
}

async function updateApiApp() {
  const file = await readSource('apps/api/src/app.ts');
  let text = file.text;
  if (text.includes(`// ${MARKER}_API_ROUTES`)) {
    await writeSource(file, text);
    return;
  }

  for (const importName of ['syncFixtures', 'syncOdds', 'syncLineups', 'syncPredictions']) {
    text = text.replace(new RegExp(`\\n  ${importName},`, 'g'), '');
  }
  text = text.replace(/\n  refreshPersonalUpcomingAnalysis,/g, '');
  if (!text.includes('getAutomaticPipelineStatus,')) {
    text = replaceOnce(
      text,
      /(^|\n)(\s*)getPersonalUpcomingAnalysis,\n/,
      (_match, prefix, indent) =>
        `${prefix}${indent}getAutomaticPipelineStatus,\n${indent}queueAutomaticForceSync,\n${indent}getPersonalUpcomingAnalysis,\n`,
      'api automation imports',
    );
  }

  const oldAdminSync =
    /app\.post\(\s*['"]\/api\/admin\/sync\/fixtures['"][\s\S]*?app\.post\(\s*['"]\/api\/admin\/sync\/predictions['"][\s\S]*?\n\);\s*(?=app\.post\(\s*['"]\/api\/admin\/recommendations\/generate['"])/;
  const newAdminSync = `// ${MARKER}_API_ROUTES
const adminForceSyncLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'ADMIN_FORCE_SYNC_RATE_LIMITED' },
});

async function queueAdminForceSync(
  request: Request,
  response: Response,
  scope: 'FULL' | 'FIXTURES' | 'PREDICTIONS' | 'CONTEXT' | 'ODDS',
): Promise<void> {
  const result = await queueAutomaticForceSync({
    scope,
    requestedBy: 'ADMIN',
    sourceIp: request.ip ?? null,
    userAgent: request.header('user-agent') ?? null,
  });
  response.status(202).json(result);
}

app.get(
  '/api/automation/status',
  asyncRoute(async (_request, response) => {
    response.json(await getAutomaticPipelineStatus());
  }),
);
app.get(
  '/api/admin/automation/status',
  requireAdmin,
  asyncRoute(async (_request, response) => {
    response.json(await getAutomaticPipelineStatus({ includeAdminDetails: true }));
  }),
);
app.post(
  '/api/admin/automation/force-sync',
  requireAdmin,
  adminForceSyncLimiter,
  asyncRoute(async (request, response) => {
    await queueAdminForceSync(
      request,
      response,
      String(request.body?.scope ?? 'FULL').toUpperCase() as
        | 'FULL'
        | 'FIXTURES'
        | 'PREDICTIONS'
        | 'CONTEXT'
        | 'ODDS',
    );
  }),
);

app.post(
  '/api/admin/sync/fixtures',
  requireAdmin,
  adminForceSyncLimiter,
  asyncRoute(async (request, response) => queueAdminForceSync(request, response, 'FIXTURES')),
);
app.post(
  '/api/admin/sync/odds',
  requireAdmin,
  adminForceSyncLimiter,
  asyncRoute(async (request, response) => queueAdminForceSync(request, response, 'ODDS')),
);
app.post(
  '/api/admin/sync/lineups',
  requireAdmin,
  adminForceSyncLimiter,
  asyncRoute(async (request, response) => queueAdminForceSync(request, response, 'CONTEXT')),
);
app.post(
  '/api/admin/sync/predictions',
  requireAdmin,
  adminForceSyncLimiter,
  asyncRoute(async (request, response) =>
    queueAdminForceSync(request, response, 'PREDICTIONS'),
  ),
);

`;
  text = replaceOnce(text, oldAdminSync, newAdminSync, 'admin sync route block');

  const publicRefresh = /app\.post\(\n  '\/api\/personal\/upcoming\/refresh',[\s\S]*?\n\);\n\n(?=app\.get\('\/api\/personal\/prediction-chat\/capabilities')/;
  const disabledRefresh = `app.post('/api/personal/upcoming/refresh', (_request, response) => {\n  response.status(409).json({\n    error: 'AUTOMATION_MANAGED',\n    message: 'Fixture sync and prediction are managed automatically by the backend worker.',\n  });\n});\n\n`;
  text = replaceOnce(text, publicRefresh, disabledRefresh, 'disable user refresh route');

  await writeSource(file, text);
}

const realtimeHistorySource = `'use client';\n\nimport { useEffect, useRef } from 'react';\nimport { usePathname, useRouter } from 'next/navigation';\n\nconst apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\\/$/, '');\n\nfunction realtimeUrl(): string {\n  const configured = process.env.NEXT_PUBLIC_WS_URL?.trim();\n  if (configured) return configured;\n\n  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';\n  const localDevelopment =\n    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&\n    window.location.port === '3000';\n  const host = localDevelopment ? \`\${window.location.hostname}:4000\` : window.location.host;\n  return \`\${protocol}//\${host}/ws\`;\n}\n\ntype RealtimePayload = Record<string, unknown> & { event?: string; type?: string };\n\nfunction dispatchRealtime(payload: RealtimePayload): void {\n  window.dispatchEvent(new CustomEvent('football-ai:realtime', { detail: payload }));\n}\n\nexport function RealtimeHistoryRefresh() {\n  const pathname = usePathname();\n  const router = useRouter();\n  const pathnameRef = useRef(pathname);\n\n  useEffect(() => {\n    pathnameRef.current = pathname;\n  }, [pathname]);\n\n  useEffect(() => {\n    let stopped = false;\n    let socket: WebSocket | null = null;\n    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;\n    let fallbackTimer: ReturnType<typeof setInterval> | null = null;\n    let reconnectAttempt = 0;\n\n    const refreshHistory = (eventName: string) => {\n      if (\n        pathnameRef.current?.startsWith('/history') &&\n        ['history_updated', 'PREDICTION_RESULT_UPDATED', 'MATCH_FINISHED', 'SNAPSHOT_REQUIRED'].includes(\n          eventName,\n        )\n      ) {\n        router.refresh();\n      }\n    };\n\n    const fetchLatestSnapshot = async (reason: string) => {\n      try {\n        const response = await fetch(\`\${apiUrl}/automation/status\`, { cache: 'no-store' });\n        const status = response.ok ? ((await response.json()) as Record<string, unknown>) : null;\n        const payload: RealtimePayload = {\n          event: 'SNAPSHOT_REQUIRED',\n          type: 'SNAPSHOT_REQUIRED',\n          reason,\n          status,\n          occurredAt: new Date().toISOString(),\n        };\n        dispatchRealtime(payload);\n        refreshHistory('SNAPSHOT_REQUIRED');\n      } catch {\n        // Backend-only fallback is best effort. The next reconnect/tick retries.\n      }\n    };\n\n    const stopFallback = () => {\n      if (fallbackTimer) clearInterval(fallbackTimer);\n      fallbackTimer = null;\n    };\n\n    const startFallback = () => {\n      if (fallbackTimer) return;\n      void fetchLatestSnapshot('REALTIME_DISCONNECTED');\n      fallbackTimer = setInterval(\n        () => void fetchLatestSnapshot('REALTIME_FALLBACK_POLL'),\n        75_000,\n      );\n    };\n\n    const connect = () => {\n      if (stopped) return;\n      socket = new WebSocket(realtimeUrl());\n\n      socket.addEventListener('open', () => {\n        const reconnected = reconnectAttempt > 0;\n        reconnectAttempt = 0;\n        stopFallback();\n        void fetchLatestSnapshot(reconnected ? 'REALTIME_RECONNECTED' : 'REALTIME_CONNECTED');\n      });\n\n      socket.addEventListener('message', (message) => {\n        try {\n          const payload = JSON.parse(String(message.data)) as RealtimePayload;\n          const eventName = String(payload.event ?? payload.type ?? 'UNKNOWN');\n          dispatchRealtime({ ...payload, event: eventName, type: eventName });\n          refreshHistory(eventName);\n        } catch {\n          // Ignore non-JSON websocket messages.\n        }\n      });\n\n      socket.addEventListener('close', () => {\n        if (stopped) return;\n        startFallback();\n        const baseDelay = Math.min(30_000, 2_000 * 2 ** reconnectAttempt);\n        const jitter = Math.floor(Math.random() * 750);\n        reconnectAttempt += 1;\n        reconnectTimer = setTimeout(connect, baseDelay + jitter);\n      });\n\n      socket.addEventListener('error', () => socket?.close());\n    };\n\n    connect();\n    return () => {\n      stopped = true;\n      stopFallback();\n      if (reconnectTimer) clearTimeout(reconnectTimer);\n      socket?.close();\n    };\n  }, [router]);\n\n  return null;\n}\n`;

async function updateRealtimeClient() {
  const file = await readSource('apps/web/components/RealtimeHistoryRefresh.tsx');
  if (file.text.includes('REALTIME_FALLBACK_POLL') && file.text.includes('football-ai:realtime')) return;
  await writeSource(file, realtimeHistorySource);
}

async function updateUpcomingBoard() {
  const file = await readSource('apps/web/components/UpcomingPredictionBoard.tsx');
  let text = file.text;
  if (text.includes(`// ${MARKER}_UPCOMING_UI`)) {
    await writeSource(file, text);
    return;
  }

  if (!/import \{[^}]*\buseEffect\b[^}]*\} from 'react';/.test(text)) {
    text = replaceOnce(
      text,
      /import \{([^}]*)\} from 'react';/,
      (_match, imports) => `import { useEffect,${String(imports).trimStart()} } from 'react';`,
      'upcoming react useEffect import',
    );
  }
  text = text.replace(/\n  CurrentCompetitionGroup,/g, '');
  text = text.replace(/\n  PersonalRefreshResponse,/g, '');

  if (!text.includes('interface AutomaticPipelineStatusDto')) {
    text = replaceOnce(
      text,
      "const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\\/$/, '');\n",
      "const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\\/$/, '');\n\ninterface AutomaticPipelineStatusDto {\n  status: string;\n  phase?: string;\n  lastUpdated: string | null;\n  apiQuota: { limit: number; used: number; remaining: number; pressure: string };\n  predictionQueue: { pending: number };\n  scheduler: { status?: string };\n}\n\n// AUTOMATIC_PIPELINE_V1_UPCOMING_UI\n",
      'upcoming status type',
    );
  }

  text = text.replace(/const GROUPS: Array<\{ value: CurrentCompetitionGroup; label: string; description: string \}> = \[[\s\S]*?\n\];\n(?=function isAseanSeniorCompetition)/, '');
  text = text.replace(/  const \[selectedGroups, setSelectedGroups\] = useState<CurrentCompetitionGroup\[]>\(\[[\s\S]*?\n  \]\);\n/, '');
  text = text.replace(/  const \[lastDiscovery, setLastDiscovery\] = useState<PersonalRefreshResponse\['discovery'\] \| null>\([\s\S]*?\n  \);\n/, '');

  if (!text.includes('const [automationStatus, setAutomationStatus]')) {
    text = replaceOnce(
      text,
      '  const [message, setMessage] = useState<string | null>(null);\n',
      '  const [message, setMessage] = useState<string | null>(null);\n  const [automationStatus, setAutomationStatus] = useState<AutomaticPipelineStatusDto | null>(null);\n',
      'upcoming automation state',
    );
  }

  const functionsThroughReturn = /  function toggleGroup\([\s\S]*?\n  return \(/;
  const effectAndReturn = `  useEffect(() => {\n    let stopped = false;\n    let refreshing = false;\n\n    const loadSnapshot = async (showLoading: boolean) => {\n      if (stopped || refreshing) return;\n      refreshing = true;\n      if (showLoading) setLoading(true);\n      try {\n        const [statusResponse, analysisResponse] = await Promise.all([\n          fetch(\`\${apiUrl}/automation/status\`, { cache: 'no-store' }),\n          fetch(\`\${apiUrl}/personal/upcoming-analysis?days=\${encodeURIComponent(days)}&limit=300\`, {\n            cache: 'no-store',\n          }),\n        ]);\n        if (!analysisResponse.ok) throw new Error(\`HTTP \${analysisResponse.status}\`);\n        const analysis = (await analysisResponse.json()) as PersonalUpcomingAnalysisDto;\n        if (!stopped) setData(analysis);\n        if (statusResponse.ok) {\n          const status = (await statusResponse.json()) as AutomaticPipelineStatusDto;\n          if (!stopped) setAutomationStatus(status);\n        }\n        if (!stopped) setMessage(null);\n      } catch (error) {\n        if (!stopped) {\n          setMessage(\n            error instanceof Error\n              ? error.message\n              : 'Dữ liệu đang được đồng bộ lại. Hệ thống sẽ tự thử lại.',\n          );\n        }\n      } finally {\n        refreshing = false;\n        if (!stopped && showLoading) setLoading(false);\n      }\n    };\n\n    const realtimeHandler = (event: Event) => {\n      const detail = (event as CustomEvent<{ event?: string }>).detail;\n      const eventName = detail?.event ?? '';\n      if (\n        [\n          'FIXTURE_CREATED',\n          'FIXTURE_UPDATED',\n          'PREDICTION_CREATED',\n          'PREDICTION_UPDATED',\n          'MATCH_FINISHED',\n          'PREDICTION_RESULT_UPDATED',\n          'DATA_SYNC_COMPLETED',\n          'SNAPSHOT_REQUIRED',\n        ].includes(eventName)\n      ) {\n        void loadSnapshot(true);\n      }\n    };\n\n    window.addEventListener('football-ai:realtime', realtimeHandler);\n    void loadSnapshot(false);\n    const fallbackTimer = setInterval(() => void loadSnapshot(false), 75_000);\n    return () => {\n      stopped = true;\n      clearInterval(fallbackTimer);\n      window.removeEventListener('football-ai:realtime', realtimeHandler);\n    };\n  }, [days]);\n\n  return (`;
  text = replaceOnce(text, functionsThroughReturn, effectAndReturn, 'remove manual upcoming handlers');

  const actionPattern = /        <div className="pcr-actions">[\s\S]*?        <\/div>\n      <\/section>/;
  const actionReplacement = `        <div className="pcr-actions" aria-live="polite">\n          <div>\n            <strong>● Hệ thống tự động cập nhật</strong>\n            <small>\n              {automationStatus?.phase === 'PREDICTIONS' || automationStatus?.phase === 'PAPER' || (automationStatus?.predictionQueue.pending ?? 0) > 0\n                ? 'Đang phân tích...'\n                : loading || automationStatus?.status === 'RUNNING'\n                  ? 'Đang cập nhật dữ liệu...'\n                  : 'Dữ liệu mới nhất từ backend'}\n            </small>\n            <small>\n              Đồng bộ lần cuối:{' '}\n              {automationStatus?.lastUpdated ? localTime(automationStatus.lastUpdated) : 'đang khởi động'}\n              {' · '}API còn {automationStatus?.apiQuota.remaining ?? '—'}/{automationStatus?.apiQuota.limit ?? 7500}\n            </small>\n          </div>\n        </div>\n      </section>`;
  text = replaceOnce(text, actionPattern, actionReplacement, 'replace manual hero controls');

  text = replaceOnce(
    text,
    /      <section className="pcr-current-groups">[\s\S]*?(?=      <section className="pcr-kpis">)/,
    '',
    'remove manual group controls',
  );

  text = text.replace(
    /Chưa có fixture thật trong DB cho khoảng này\. Bấm “Lấy lịch thật & phân tích” để đồng bộ\s+trực tiếp từ API-Football\./,
    'Chưa có fixture sắp tới trong DB. Backend worker đang tự đồng bộ và sẽ cập nhật màn hình khi có dữ liệu mới.',
  );

  await writeSource(file, text);
}

async function updateResultWorker() {
  const file = await readSource('packages/sync/src/history-result-worker.ts');
  let text = file.text;
  if (text.includes("eventType: 'PREDICTION_RESULT_UPDATED'")) {
    await writeSource(file, text);
    return;
  }
  const historyOutbox = `        await transaction.realtimeOutbox.create({\n          data: {\n            eventType: 'history_updated',\n            aggregateId: String(job.providerFixtureId),\n            payload: jsonValue({\n              event: 'history_updated',\n              version: 1,\n              providerFixtureId: job.providerFixtureId,\n              changed: ['result', 'settlement'],\n              score: { home: fixture.fulltimeHomeGoals, away: fixture.fulltimeAwayGoals },\n              statusShort: fixture.statusShort,\n              occurredAt: new Date().toISOString(),\n            }),\n          },\n        });\n`;
  const standardized = `${historyOutbox}\n        await transaction.realtimeOutbox.create({\n          data: {\n            eventType: 'MATCH_FINISHED',\n            aggregateId: String(job.providerFixtureId),\n            payload: jsonValue({\n              event: 'MATCH_FINISHED',\n              type: 'MATCH_FINISHED',\n              version: 1,\n              fixtureId: String(job.providerFixtureId),\n              providerFixtureId: job.providerFixtureId,\n              statusShort: fixture.statusShort,\n              score: { home: fixture.fulltimeHomeGoals, away: fixture.fulltimeAwayGoals },\n              occurredAt: new Date().toISOString(),\n            }),\n          },\n        });\n\n        await transaction.realtimeOutbox.create({\n          data: {\n            eventType: 'PREDICTION_RESULT_UPDATED',\n            aggregateId: String(job.providerFixtureId),\n            payload: jsonValue({\n              event: 'PREDICTION_RESULT_UPDATED',\n              type: 'PREDICTION_RESULT_UPDATED',\n              version: 1,\n              fixtureId: String(job.providerFixtureId),\n              providerFixtureId: job.providerFixtureId,\n              changed: ['result', 'settlement'],\n              score: { home: fixture.fulltimeHomeGoals, away: fixture.fulltimeAwayGoals },\n              statusShort: fixture.statusShort,\n              occurredAt: new Date().toISOString(),\n            }),\n          },\n        });\n`;
  text = replaceOnce(text, historyOutbox, standardized, 'result realtime outbox');
  await writeSource(file, text);
}

async function updateRealtimeServer() {
  const file = await readSource('apps/api/src/realtime-server.ts');
  let text = file.text;
  if (!text.includes("import { recordRealtimeHeartbeat } from '@football-ai/sync';")) {
    text = replaceOnce(
      text,
      "import { prisma } from '@football-ai/database';\n",
      "import { prisma } from '@football-ai/database';\nimport { recordRealtimeHeartbeat } from '@football-ai/sync';\n",
      'realtime heartbeat import',
    );
  }
  if (!text.includes('const realtimeHeartbeatTimer =')) {
    text = replaceOnce(
      text,
      'const outboxTimer = setInterval(() => void dispatchRealtimeOutbox(), 1_000);\n',
      `const outboxTimer = setInterval(() => void dispatchRealtimeOutbox(), 1_000);\n\nasync function writeRealtimeHeartbeat(): Promise<void> {\n  try {\n    await recordRealtimeHeartbeat({ clients: clients.size });\n  } catch (error) {\n    console.error('[realtime] heartbeat failed', error);\n  }\n}\n\nvoid writeRealtimeHeartbeat();\nconst realtimeHeartbeatTimer = setInterval(() => void writeRealtimeHeartbeat(), 30_000);\n`,
      'realtime heartbeat timer',
    );
  }
  if (!text.includes('clearInterval(realtimeHeartbeatTimer);')) {
    text = replaceOnce(
      text,
      '  clearInterval(outboxTimer);\n',
      '  clearInterval(outboxTimer);\n  clearInterval(realtimeHeartbeatTimer);\n',
      'realtime heartbeat shutdown',
    );
  }
  await writeSource(file, text);
}

await updateSyncIndex();
await updateQuotaPreloader();
await updateWorkerJobs();
await updateWorkerIndex();
await updateApiServerEntry();
await updateApiApp();
await updateRealtimeClient();
await updateUpcomingBoard();
await updateResultWorker();
await updateRealtimeServer();

console.log('PREDICTIONAI_AUTOMATIC_PIPELINE_V1_5_TRANSFORM_PASS');
