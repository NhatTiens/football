# Football AI v7.0-beta.1A.4

## Best-Bet Policy + Market Reliability Contract

This stage freezes the future BEST BET selection policy while keeping actual
bet execution disabled until real timestamped bookmaker odds are available.

## Frozen policy

```text
minimum odds        = 1.40
minimum edge        = 4%
minimum EV          = 3%
max bets / fixture  = 1
scientific stake    = 1 unit
```

A candidate is rejected if its market is not reliability-eligible.

## Reliability gate

Each market is compared against its own empirical climatology/base-rate:

```text
MATCH_WINNER
TOTAL_GOALS_1_5
TOTAL_GOALS_2_5
TOTAL_GOALS_3_5
BTTS
```

Diagnostic eligibility requires:

```text
rows >= 150
relative Brier skill vs climatology >= 0.5%
log-loss skill vs climatology >= 0.5%
ECE <= 5%
```

This is deliberately stricter than comparing binary markets against a 50/50
uniform forecast.

The current 171-fixture historical set is already known to the project, so
this reliability result is diagnostic only and cannot promote a model or
betting policy.

## BEST BET ranking

After all hard gates pass, candidates are ranked deterministically by:

```text
1. expected value descending
2. edge descending
3. model probability descending
4. decimal odds ascending
5. deterministic market/selection tie-break
```

The output is exactly one of:

```text
BEST_BET
NO_BET
```

`NO_BET` is a first-class valid decision.

## Important definitions

```text
implied probability = 1 / decimal odds
edge                = model probability - fair no-vig market probability
EV                  = model probability * decimal odds - 1
```

Edge uses the fair/no-vig market probability, not raw implied probability.

## No fake betting evaluation

beta.1A.4 does not invent odds and does not calculate:

```text
historical ROI
CLV
drawdown
profit
```

Real BEST BET execution remains disabled.

## API handoff

This is the last stage before provider upgrade.

After beta.1A.4 passes:

```text
STOP
upgrade API
then begin v7.0-beta.1B
```

The upgraded provider/plan should support:

```text
historical fixtures/results
historical team/match statistics
timestamped historical HDA odds
timestamped historical total-goals odds
timestamped historical BTTS odds
live fixtures/results
live HDA odds
live total-goals odds
live BTTS odds
preferably standings/injuries/lineups with availability timestamps
```

Do not purchase a live-only plan if historical real-odds backtesting is still
required.

## Safety

```text
database migration          NO
historical row rewrite      NO
synthetic odds              NO
live API call               NO
ROI / CLV calculation       NO
fresh shadow write          NO
production routing change   NO
automatic promotion         NO
commit / push               NO
```

## Commands

Apply source and run tests:

```powershell
.\v7-beta1a4-best-bet-reliability\01-apply-and-test-local.cmd
```

Run reliability assessment and freeze the policy report:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1a4-best-bet-reliability\02-run-best-bet-reliability.ps1
```

Manual:

```powershell
npm run worker -- scientific-best-bet-reliability-run
npm run worker -- scientific-best-bet-reliability-summary
npm run worker -- scientific-best-bet-reliability-report
```

## Artifact

```text
artifacts/provider/v7-beta1a4/<version-hash>/
└── best-bet-reliability-report.json
```

## Next stage

```text
v7.0-beta.1B
Historical + Live Provider Integration
```

API upgrade is required before beta.1B begins.
