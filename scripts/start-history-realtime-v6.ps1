$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host 'Starting realtime API + quota-managed worker + durable result worker + web...'

npx concurrently -n api,worker,result,web -c auto `
  "node scripts/run-with-env.mjs npx tsx watch apps/api/src/realtime-server.ts" `
  "node scripts/run-with-env.mjs npx tsx watch apps/worker/src/quota-runner.ts" `
  "node scripts/run-with-env.mjs npx tsx watch packages/sync/src/history-result-runner.ts" `
  "npm run dev -w @football-ai/web"

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
