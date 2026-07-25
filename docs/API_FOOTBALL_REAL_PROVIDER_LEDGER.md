# Football AI v7.0-beta.1B

## API-Football Real Provider + Append-Only Paper Bet Ledger

This stage is the API-upgrade handoff.

It connects the scientific pipeline to API-Football v3 and starts preserving
real source data before the provider's short odds-retention window disappears.

## What is stored

### Real provider history

Append-only tables store:

```text
API provider runs
fixture snapshots
pre-match odds snapshots
raw team-statistics snapshots
raw injuries snapshots
raw lineup snapshots
```

Target betting markets:

```text
MATCH_WINNER
TOTAL_GOALS 1.5
TOTAL_GOALS 2.5
TOTAL_GOALS 3.5
BTTS
```

Only source updates are deduplicated. Old snapshots are never overwritten.

### Paper bet history

The new paper-bet ledger stores:

```text
all candidates considered
rejection reasons
BEST_BET or NO_BET decision
model probability
fair/no-vig market probability
implied probability
edge
EV
bookmaker
decimal odds
source odds snapshot id
decision timestamp
kickoff timestamp
model version
policy version
market reliability status
final settlement
profit in fixed 1u
future CLV fields
```

A BEST_BET and its settlement are separate append-only records.

This is paper/shadow evaluation only. It does not place a real wager.

## Important evidence classes

Historical odds recovered now from the API's retained window are labeled:

```text
HISTORICAL_BACKFILL_SOURCE_TIMESTAMPED_NON_FRESH
```

They are useful historical evidence because the provider gives an `update`
timestamp, but they are never reclassified as alpha.8 fresh evidence.

New odds captured before kickoff can be marked `pitUsable=true` when:

```text
sourceUpdatedAt <= observedAt < kickoffAt
```

No timestamp is fabricated when the provider does not supply one.

## API key

The code accepts any of these local environment variables, in priority order:

```text
API_FOOTBALL_KEY
API_FOOTBALL_API_KEY
APISPORTS_KEY
API_SPORTS_KEY
```

Never put the key in source control or send it in chat.

The helper configuration script refuses to write `.env` unless Git reports
that `.env` is ignored.

## API-Football request safety

The client:

```text
uses only GET
sends x-apisports-key
throttles requests
backs off on HTTP 429
reads daily and per-minute rate-limit headers
never logs the API key
```

## Step 1 — Apply and test

```powershell
.\v7-beta1b-api-football-real-provider-ledger\01-apply-and-test-local.cmd
```

No network call is made by this step.

## Step 2 — Deploy migration 0014

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-api-football-real-provider-ledger\02-deploy-migration.ps1
```

## Step 3 — Configure key locally if needed

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-api-football-real-provider-ledger\03-configure-api-football.ps1
```

If the project already contains one of the supported key environment variables,
skip this step.

## Step 4 — Verify the upgraded subscription

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-api-football-real-provider-ledger\04-api-football-health.ps1
```

The `/status` endpoint is used for this health check.

## Step 5 — Immediately salvage the retained odds window

Run once as soon as possible:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-api-football-real-provider-ledger\05-backfill-last-7-days.ps1
```

Optional filter:

```text
API_FOOTBALL_LEAGUE_IDS=39,140,...
```

If left blank, the backfill walks the provider's odds pages for each retained
date and stores only HDA, O/U 1.5/2.5/3.5 and BTTS.

Safety cap:

```text
API_FOOTBALL_BACKFILL_MAX_PAGES_PER_DAY=150
```

The process fails loudly rather than silently returning a partial day when
that cap is reached.

## Step 6 — Start ongoing capture

Set at least one:

```text
API_FOOTBALL_LEAGUE_IDS=...
API_FOOTBALL_FIXTURE_IDS=...
```

Then run:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-api-football-real-provider-ledger\06-live-capture.ps1
```

Default safety configuration:

```text
API_FOOTBALL_CAPTURE_DAYS_AHEAD=2
API_FOOTBALL_MAX_FIXTURES_PER_RUN=20
API_FOOTBALL_CAPTURE_TEAM_STATS=true
API_FOOTBALL_CAPTURE_INJURIES=true
API_FOOTBALL_CAPTURE_LINEUPS=true
```

Lineups are only queried around the pre-match window.

## Step 7 — Inspect stored evidence

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-api-football-real-provider-ledger\07-coverage.ps1
```

It reports real provider snapshots and paper-bet ledger counts.

## Paper-bet settlement

Once live model decisions begin writing to the ledger:

```powershell
npm run worker -- paper-bet-ledger-settle
```

The settlement worker uses the provider fixture's fulltime score and writes a
new settlement row; it never edits the original decision.

## Scientific safety

```text
production routing changed       NO
automatic promotion              NO
real-money bet execution         NO
historical timestamp fabrication NO
alpha.8 fresh rows written       NO
commit / push                    NO
```

## Next stage

After real data is being captured successfully:

```text
v7.0-beta.1B.1
Real-Odds Multi-Market Backtest + Live Paper-Bet Wiring
```

That stage will wire the current live prediction output to
`recordScientificPaperBetDecision()` so every future BEST_BET/NO_BET decision
is retained automatically.
