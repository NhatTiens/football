# v7.0-beta.1B — FE + Southeast Asia / Asia Expansion

This package expands both backend collection and frontend visibility without a
database migration.

## Backend

Default profile:

```text
API_FOOTBALL_LEAGUE_PROFILE=GLOBAL_ASIA
```

The provider requests `/leagues?current=true` and discovers current competition
IDs instead of hard-coding Asian league IDs.

Groups:

```text
GLOBAL_MAJOR
SOUTHEAST_ASIA
ASIA
AFC
```

Southeast Asia countries:

```text
Vietnam
Thailand
Indonesia
Malaysia
Singapore
Philippines
```

Wider Asia:

```text
Japan
South Korea
China
Saudi Arabia
Qatar
United Arab Emirates
Australia
India
Iran
Uzbekistan
```

AFC club competitions are also detected by competition name.

Default safety caps:

```text
API_FOOTBALL_MAX_LEAGUES_PER_RUN=36
API_FOOTBALL_MAX_FIXTURES_PER_RUN=50
API_FOOTBALL_CAPTURE_DAYS_AHEAD=3
```

The first 36 competition slots are balanced before overflow:

```text
Global major        up to 8
Southeast Asia      up to 12
AFC club cups       up to 4
Wider Asia          up to 12
```

This prevents Southeast Asian cup/second-division volume from crowding all
Japanese/Korean/Chinese/West Asian competitions out of a capture run.

You can still add explicit competition IDs with:

```text
API_FOOTBALL_LEAGUE_IDS=...
```

## Frontend

New pages:

```text
/scientific
/bet-history
```

`/scientific` displays:

```text
provider/data status
real odds snapshot counts
PIT-usable odds
paper-bet counts and ROI
actual discovered Global / SEA / Asia / AFC competitions
upcoming fixture schedule
T-180 / T-90 / T-30 / T-5 in Vietnam time
```

`/bet-history` displays:

```text
BEST_BET / NO_BET
decision time
horizon
market / selection
bookmaker / odds
model probability
edge / EV
WIN / LOSS
profit units
```

No fake bet is created by the frontend.

## Timezone

UI and provider queries default to:

```text
Asia/Ho_Chi_Minh
```

Database timestamps remain absolute timestamps for PIT/backtest integrity.

## REST endpoints added

```text
GET /api/scientific/overview
GET /api/scientific/leagues
GET /api/scientific/fixtures
GET /api/scientific/bets
```

## Worker commands added

```text
api-football-league-profile-discover
api-football-vn-schedule
```

## Apply

```powershell
.\v7-beta1b-fe-asia-expansion\01-apply-and-test-local.cmd
```

## Configure

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-fe-asia-expansion\02-configure-global-asia.ps1
```

## Discover current Asian competitions

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-fe-asia-expansion\03-discover-leagues.ps1
```

## Capture

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1b-fe-asia-expansion\04-capture-global-asia.ps1
```

## Run FE

```powershell
npm run dev
```

Open:

```text
http://localhost:3000/scientific
http://localhost:3000/bet-history
```

## Safety

```text
migration                         NO
production prediction promotion   NO
real-money wager execution        NO
API key logging                   NO
alpha.8 fresh-row fabrication     NO
commit / push                     NO
```
