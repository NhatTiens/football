# Automatic fixture / prediction / result / realtime pipeline

Production ownership is backend-only:

`API-Football -> automatic worker -> DB -> prediction/background processing -> durable result worker -> realtime outbox -> WebSocket -> frontend snapshot refresh`.

## Safety contracts

- User UI never calls API-Football and has no fixture/prediction sync buttons.
- `POST /api/personal/upcoming/refresh` is disabled with `AUTOMATION_MANAGED`.
- Fixture identity remains `Fixture.apiFixtureId @unique`; provider prediction remains one-to-one by fixture.
- Automatic prediction selects only `UPCOMING` fixtures whose kickoff is still in the future and whose external prediction is absent.
- Result ownership remains the durable `ResultUpdateJob` worker. It only follows fixtures that already had a stored paper prediction; it never creates a post-kickoff prediction.
- All API-Football network requests in worker processes are intercepted by the central `ApiQuotaDaily` preloader with hard maximum `7500/day`.
- Provider cadence is state-aware. Fixture discovery is throttled according to nearest kickoff and remaining quota; fresh-odds/context collectors retain their database checkpoints.
- A durable `AppSetting` lease prevents multiple automatic workers from running the same pipeline concurrently. The lease expires after crashes and is reclaimable after restart.
- DB/outbox writes happen before realtime publication. WebSocket sends only lightweight invalidation events; clients fetch fresh snapshots from backend APIs.

## Default schedule

The worker wakes every 2 minutes (`AUTOMATIC_PIPELINE_CRON`, default `*/2 * * * *`) but provider-heavy fixture discovery is independently throttled:

- <= 2 hours to nearest kickoff: 10 minutes
- <= 24 hours: 30 minutes
- <= 72 hours: 90 minutes
- otherwise: 360 minutes
- quota remaining <= 15%: at least 180 minutes
- quota remaining <= 5%: at least 360 minutes

Current competition/season discovery is cached for 12 hours by default, so the 10–90 minute fixture cadence does not repeatedly rediscover seasons. Provider prediction misses/errors are persisted in `automation.prediction-retry.state` and back off 5 → 10 → 20 → 30 → 60 → 120 → 180 minutes instead of retrying every scheduler wake-up. Fresh odds and repeated context use their existing due/checkpoint logic. Result checks retain the existing 105-minute first check and bounded backoff.

## Admin force sync

`POST /api/admin/automation/force-sync` is admin-only and rate-limited. It writes a durable force request; it does not call API-Football or model code inside the HTTP request. The next worker cycle claims it and still goes through the quota manager.

Legacy `/api/admin/sync/{fixtures,odds,lineups,predictions}` endpoints are converted into background force requests for compatibility and return HTTP 202.

## Monitoring

- Public safe summary: `GET /api/automation/status`
- Admin detail: `GET /api/admin/automation/status`
- Admin page: `/admin/automation`

Status includes the active pipeline phase (fixtures/predictions/context/paper), last fixture/prediction/result sync, API calls used/remaining, API errors, failed jobs, prediction/result queue counts, scheduler heartbeat, worker heartbeat and realtime connection count.

## Production process manager

After `npm run build`, run the API+WebSocket server, automatic worker, durable result worker and web process under a supervisor such as PM2:

```powershell
npx pm2 start deploy/pm2-ecosystem.config.cjs
npx pm2 save
```

`npm run dev` is not a production dependency.
