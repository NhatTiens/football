# Repeated Odds Collection — v7.0-alpha.4

Alpha.4 collects pre-match odds at scientifically defined horizons instead of
calling the complete upcoming-fixture odds pipeline continuously.

Default horizons:

```text
T-1440, T-360, T-180, T-90, T-30, T-10 minutes
```

## Scientific behavior

A persistent `OddsCollectionCheckpoint` records whether each fixture/horizon
was attempted and observed. A successful checkpoint does not require a new
`OddsSnapshot`: when the API returns a complete market but the price and source
timestamp are unchanged, the existing deduplication remains correct and the
checkpoint proves that the horizon was checked.

No collection is allowed at or after kickoff.

## Quota protection

Before each fixture request, the collector inspects the latest `ApiUsage`
observation. It stops before configured daily or minute reserves are consumed.
Each run also has a maximum fixture count.

## Concurrency protection

A database-backed lock token and optimistic `updatedAt` claim prevent two
worker replicas from collecting the same fixture/horizon concurrently. Stale
locks may be reclaimed after the configured timeout.

## Scheduler

When `ODDS_REPEATED_ENABLED=true` (default), the worker schedules
`sync-odds-repeated` instead of the legacy broad `sync-odds` task. The legacy
command is still available for manual use.

## Environment

```text
ODDS_REPEATED_ENABLED=true
ODDS_REPEATED_CRON=*/5 * * * *
ODDS_REPEATED_HORIZONS_MINUTES=1440,360,180,90,30,10
ODDS_REPEATED_DUE_TOLERANCE_MINUTES=12
ODDS_REPEATED_DUE_LEAD_MINUTES=2
ODDS_REPEATED_MAX_FIXTURES_PER_RUN=8
ODDS_REPEATED_LOCK_MINUTES=15
ODDS_REPEATED_RETRY_MINUTES=4
ODDS_REPEATED_MAX_ATTEMPTS=3
ODDS_REPEATED_DAILY_REQUEST_RESERVE=50
ODDS_REPEATED_MINUTE_REQUEST_RESERVE=2
```

## Commands

```powershell
npm run worker -- sync-odds-repeated
npm run worker -- odds-coverage
npm run test:repeated-odds -w @football-ai/sync
```

Run the worker continuously to make horizon collection effective:

```powershell
npm run dev:worker
```
