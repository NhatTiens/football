# Football AI v7.0-beta.1A.3

## Scientific Multi-Market Prediction Replay

This stage evaluates the current v7 prediction stack on the historical
beta.1A T-90 replay set without using bookmaker odds.

## Model sources

The replay intentionally uses the current scientific source for each market:

```text
MATCH_WINNER
  source = frozen alpha.8 candidate
  95% baseline + 5% Dixon-Coles, temperature 0.8

TOTAL_GOALS 1.5 / 2.5 / 3.5
  source = Dynamic Dixon-Coles score grid

BTTS
  source = Dynamic Dixon-Coles score grid
```

The HDA row therefore reproduces the beta.1A frozen-candidate benchmark,
while totals and BTTS use the exact Dynamic Dixon-Coles snapshot referenced
by each feature row.

## Why this is scientifically useful

The source feature payload already contains the exact `dixonSnapshotId`.

beta.1A.3 resolves that lineage and rebuilds the score distribution from:

```text
homeExpectedGoals
awayExpectedGoals
rho
```

using the same exported `dixonColesTau` correction used by the fundamentals
engine.

The newly derived score grid must reproduce the already-stored:

```text
homeProbability
drawProbability
awayProbability
over25Probability
bttsProbability
```

within a strict numerical tolerance.

That equivalence gate protects against accidentally inventing a second,
incompatible Dixon-Coles implementation.

## Markets evaluated

Five tasks per historical fixture:

```text
MATCH_WINNER       HOME / DRAW / AWAY
TOTAL_GOALS_1_5    OVER / UNDER
TOTAL_GOALS_2_5    OVER / UNDER
TOTAL_GOALS_3_5    OVER / UNDER
BTTS                YES / NO
```

With 171 valid fixtures this is expected to produce 855 evaluation rows.

## Metrics

Every market reports:

```text
accuracy
Brier
log-loss
ECE
Brier skill vs uniform forecast
log-loss skill vs uniform forecast
```

Binary markets also report the actual positive rate.

The calibration calculation uses the probability of the predicted class.

### Important comparison rule

HDA is a three-class problem while totals/BTTS are binary problems.

Therefore:

```text
do NOT directly rank HDA vs binary markets using raw accuracy or Brier
```

The report only ranks the four binary tasks against one another.

## No odds and no betting

beta.1A.3 deliberately does not use odds.

Therefore it does not calculate:

```text
edge
EV
ROI
CLV
drawdown
BEST BET
```

Those belong after the prediction layer is measured.

## Safety

beta.1A.3:

```text
does not rewrite historical data
does not change timestamps
does not call live API
does not write ScientificShadowPrediction
does not activate Best-Bet
does not change production routing
does not auto-promote anything
```

## Commands

Apply source and run the complete test suite:

```powershell
.\v7-beta1a3-multi-market-replay\01-apply-and-test-local.cmd
```

Run the historical multi-market replay:

```powershell
powershell -ExecutionPolicy Bypass -File `
  .\v7-beta1a3-multi-market-replay\02-run-multi-market-replay.ps1
```

Manual commands:

```powershell
npm run worker -- scientific-multi-market-replay-run
npm run worker -- scientific-multi-market-replay-summary
npm run worker -- scientific-multi-market-replay-report
```

## Required scientific gates

A healthy replay requires:

```text
evaluationFixtures > 0
pitViolations = 0
dixonStoredProbabilityViolations = 0
frozenHdaReplayMetricViolations = 0
```

The HDA accuracy/Brier/log-loss should reproduce the beta.1A candidate
aggregate to numerical tolerance.

## Artifacts

A run writes:

```text
artifacts/provider/v7-beta1a3/<version-hash>/
├── multi-market-replay-report.json
└── multi-market-predictions.jsonl
```

No database migration is required.

## Next stage

After this stage passes and the market metrics are reviewed:

```text
v7.0-beta.1A.4
Best-Bet Policy Contract
```

API upgrade is still NOT required during beta.1A.3 or beta.1A.4.
The user should be told to upgrade API when beta.1B begins.
