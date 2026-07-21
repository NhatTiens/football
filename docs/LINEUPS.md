# Lineup analysis v1.2

The project now stores lineup snapshots from API-Football and uses only snapshots available at the recommendation/backtest time.

## Workflow

```text
fixtures/lineups API
  -> Player
  -> FixtureLineupSnapshot
  -> FixtureLineupPlayer
  -> regular starter history / rotation / missing regulars
  -> bounded lineup adjustment
  -> odds consensus Over/Under candidate
```

## Commands

```bash
npm run worker -- sync-lineups
npm run worker -- generate
```

The normal command only polls fixtures from six hours before kickoff through the next configured hours.

Historical import is explicit because it can consume many API requests:

```bash
npm run worker -- sync-lineups-history
```

## Point-in-time rule

Backtest uses only lineup snapshots with `capturedAt <= predictedAt`. A lineup imported after a historical match is not allowed into that historical prediction. This prevents post-match lineup data from leaking into the backtest.

## Analysis signals

- whether both starting XIs are confirmed;
- formation;
- number of starters;
- overlap with the previous starting XI;
- rotation count;
- regular starters missing from the current XI;
- missing-player position group: goalkeeper, defender, midfielder or attacker;
- history coverage and lineup data quality.

The positional probability shift is a transparent heuristic and is capped by `LINEUP_MAX_PROBABILITY_ADJUSTMENT`. It is not a trained player-value model. Disable it to use lineups only as a confidence/data-quality filter:

```dotenv
LINEUP_PROBABILITY_ADJUSTMENT_ENABLED=false
```

## Recommended production settings

```dotenv
LINEUP_SYNC_CRON="*/10 * * * *"
LINEUP_SYNC_HOURS_AHEAD=6
LINEUP_HISTORY_LOOKBACK=10
LINEUP_ANALYSIS_ENABLED=true
LINEUP_REQUIRE_CONFIRMED=true
LINEUP_MIN_HISTORY_MATCHES=5
LINEUP_ROTATION_WARNING_THRESHOLD=4
LINEUP_PROBABILITY_ADJUSTMENT_ENABLED=true
LINEUP_MAX_PROBABILITY_ADJUSTMENT=0.025
```

When `LINEUP_REQUIRE_CONFIRMED=true`, the engine returns `NO BET` until both official starting XIs exist.
