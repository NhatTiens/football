# Football AI v7.0-beta.1A.2

## Legacy Multi-Market & Bet Engine Scientific Port

This stage preserves the useful legacy betting logic and places it behind a
non-promotional scientific v7 adapter.

The public legacy repository already contains:

- Poisson probabilities for `MATCH_WINNER`, `TOTAL_GOALS_2_5`, and `BTTS`.
- A recommendation engine with best odds, no-vig market consensus, edge, EV,
  confidence, data quality, recommendation score, and correlation filtering.
- Settlement for the three legacy markets.
- A separate v6.2 scientific bankroll/staking module.

beta.1A.2 does **not** replace those components.

## Ported capability

Legacy market codes are normalized as:

```text
MATCH_WINNER
  HOME
  DRAW
  AWAY

TOTAL_GOALS
  OVER  2.5
  UNDER 2.5

BTTS
  YES
  NO
```

Seven probability selections are exposed through one scientific contract.

## Scientific safety decisions

During beta.1A.2:

```text
legacy recommendation ranking = diagnostic only
fixed evaluation stake        = 1 unit
best-bet policy                = NOT activated
minimum odds 1.40              = reserved for beta.1A.4
O/U 1.5 and 3.5                = NOT activated
fresh shadow writes            = 0
production routing             = unchanged
automatic promotion            = disabled
```

The fixed 1-unit evaluation rule prevents legacy variable stake sizing from
making a weak model look stronger solely because of bankroll allocation.

## Reused legacy functions

The adapter calls existing `@football-ai/engine` exports:

```text
deriveMarketProbabilities
buildRecommendationCandidates
settleSelection
profitForSettlement
```

It therefore tests the real legacy implementation instead of copying its
formula into a second implementation.

## Why O/U 1.5 and 3.5 are not added here

This stage is a port/equivalence boundary. The legacy engine only has an
explicit `TOTAL_GOALS_2_5` contract.

beta.1A.3 will expand the scientific score-distribution evaluation to:

```text
O/U 1.5
O/U 2.5
O/U 3.5
BTTS
HDA
```

without pretending those extra lines already existed in the legacy contract.

## Commands

Apply and run all tests:

```powershell
.\v7-beta1a2-multi-market-port\01-apply-and-test-local.cmd
```

Then print the port capability report:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1a2-multi-market-port\02-port-report.ps1
```

Direct command:

```powershell
npm run worker -- scientific-multi-market-port-report
```

## Database

No migration is required.

beta.1A.2 writes no production or shadow data.
