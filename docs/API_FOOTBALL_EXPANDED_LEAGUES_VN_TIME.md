# v7.0-beta.1B hotfix — Expanded Leagues + Vietnam Time

This hotfix does **not** change the database schema and needs **no migration**.

## What changes

### More competitions by default

`API_FOOTBALL_LEAGUE_PROFILE=MAJOR_8` becomes the default.

Default competition IDs:

```text
2    UEFA Champions League
3    UEFA Europa League
39   Premier League
61   Ligue 1
78   Bundesliga
135  Serie A
140  La Liga
253  Major League Soccer
```

You can add more without editing code:

```text
API_FOOTBALL_LEAGUE_IDS=40,88,94,...
```

The custom list is merged with `MAJOR_8`.

For a fully custom set:

```text
API_FOOTBALL_LEAGUE_PROFILE=NONE
API_FOOTBALL_LEAGUE_IDS=...
```

### Vietnam time

Default API/query/display timezone:

```text
Asia/Ho_Chi_Minh
```

The provider returns/prints:

```text
Kickoff Vietnam
T-180 Vietnam
T-90 Vietnam
T-30 Vietnam
T-5 Vietnam
```

Scientific/database timestamps remain absolute `Date` values and therefore
retain UTC semantics for PIT/backtesting.

## Apply

```powershell
.\v7-beta1b-hotfix-expanded-leagues-vn-time\01-apply-hotfix-local.cmd
```

No migration is deployed.

## Persist recommended settings in .env

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-hotfix-expanded-leagues-vn-time\02-configure-expanded-leagues-vn.ps1
```

This writes:

```text
API_FOOTBALL_TIMEZONE=Asia/Ho_Chi_Minh
API_FOOTBALL_LEAGUE_PROFILE=MAJOR_8
API_FOOTBALL_MAX_FIXTURES_PER_RUN=30
```

Existing explicit `API_FOOTBALL_LEAGUE_IDS` is preserved.

## Show Vietnam schedule from stored fixtures

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-hotfix-expanded-leagues-vn-time\03-vietnam-schedule.ps1
```

## Capture expanded leagues

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-hotfix-expanded-leagues-vn-time\04-live-capture-expanded.ps1
```

Start with 30 fixtures/run. Increase only after reviewing daily request use.

## Backfill behavior

The 7-day historical odds salvage remains broad by default:

```text
API_FOOTBALL_BACKFILL_LEAGUE_IDS=
```

Blank means **do not filter by league**. This preserves as much retained
historical odds evidence as possible.

`MAJOR_8` applies to ongoing/upcoming live capture, not to the already-retained
7-day odds salvage.
