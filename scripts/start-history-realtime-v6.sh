#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec npx concurrently -n api,worker,result,web -c auto \
  "node scripts/run-with-env.mjs npx tsx apps/api/src/realtime-server.ts" \
  "node scripts/run-with-env.mjs npx tsx apps/worker/src/quota-runner.ts" \
  "node scripts/run-with-env.mjs npx tsx packages/sync/src/history-result-runner.ts" \
  "npm run start -w @football-ai/web"
