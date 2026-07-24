# Scientific Evaluation Engine — v7.0-alpha.7

Alpha.7 evaluates the alpha.6 challenger without changing production.

It provides:

1. a frozen point-in-time operational baseline;
2. expanding-window CatBoost OOF predictions;
3. a second-level softmax stacker;
4. temporal temperature calibration;
5. fixed-policy 1X2 backtesting;
6. Brier, log-loss, calibration, ROI, drawdown and CLV metrics;
7. a manual-only champion/challenger promotion decision.

The football data API is not called.

## Scientific boundary

Alpha.7 has no code path that changes a model artifact to `CHAMPION`.

The strongest positive result is:

```text
ELIGIBLE_FOR_MANUAL_PROMOTION
```

A human must inspect the artifacts and explicitly approve any later promotion.
The existing production model, recommendation thresholds and scheduler remain
unchanged.

## Baseline freeze

`scientific-baseline-freeze` evaluates the current operational scientific
engine at the exact historical `predictionAsOf` timestamps already present in
`MlFeatureSnapshot`.

The baseline is append-only and identified by:

```text
SCIENTIFIC_EVAL_BASELINE_VERSION
```

Default scripts use:

```text
v6.2.3-frozen-alpha7
```

This is an operational freeze of the code currently installed when the command
runs. If byte-for-byte historical v6.2.3 predictions were not previously
stored, alpha.7 does not claim to reconstruct them retroactively.

Every baseline row contains:

- fixture and horizon;
- point-in-time timestamp;
- 1X2 probabilities;
- over-2.5 and BTTS probabilities;
- source feature payload hash;
- deterministic snapshot hash.

## OOF construction

Rows are grouped by fixture so T-90, T-30 and T-5 from the same match can never
cross a fold boundary.

The default process is:

```text
minimum 150 earlier fixtures
→ 5 expanding walk-forward folds
→ only labels available before the fold decision timestamp are trainable
```

For every fold:

```text
trainedThrough < validationFrom
```

`trainedThrough` uses `labelAvailableAt`, not kickoff time.

Each fixture has total sample weight 1 even when it has three horizon rows.

## Secondary stacking and calibration

Raw OOF fixtures are split chronologically:

```text
60% stacker training
20% calibration
20% final evaluation
```

The stacker uses only:

- CatBoost OOF probabilities;
- Dynamic Dixon–Coles probabilities;
- point-in-time market consensus;
- residual-market probabilities;
- market availability and quality;
- decision horizon.

The operational baseline is not a stacker feature. It is retained only as the
comparison target.

Calibration uses temperature scaling fitted only on the calibration block.
Promotion metrics use only the final untouched evaluation block.

## Prediction metrics

The primary promotion horizon defaults to T-90.

Reported metrics include:

- multiclass Brier score;
- multiclass log-loss;
- accuracy;
- expected calibration error;
- breakdown for T-90, T-30 and T-5;
- diagnostics for CatBoost, Dixon–Coles and uncalibrated stacking.

## Fixed betting policy

Alpha.7 does not optimize thresholds on the final evaluation set.

Default policy:

```text
market: MATCH_WINNER
minimum model probability: 0.35
minimum edge: 0.04
minimum expected value: 0.03
stake: 1 unit
maximum one selection per fixture and horizon
```

Both candidate and baseline use exactly the same available point-in-time odds
and thresholds.

Reported metrics include:

- bets;
- wins and losses;
- profit units;
- ROI;
- hit rate;
- maximum drawdown;
- average odds;
- average edge;
- average expected value;
- average closing-line value;
- positive CLV rate.

Decision odds are the best latest non-live odds available at or before
`predictionAsOf`. Closing odds are the best latest non-live odds available at
or before kickoff.

## Promotion gates

Default gates:

```text
leakage violations = 0
final evaluation rows >= 50
candidate bets >= 20
relative Brier improvement >= 0.5%
candidate log-loss does not regress
candidate ROI does not regress
drawdown regression <= 2 units
candidate average CLV > 0
```

Outcomes:

```text
ELIGIBLE_FOR_MANUAL_PROMOTION
HOLD
REJECT
```

Low bet count, missing ROI or non-positive CLV normally produces `HOLD`.
Leakage, insufficient final evaluation rows, Brier regression or log-loss
regression produces `REJECT`.

## Database tables

```text
ScientificBaselineSnapshot
ScientificEvaluationRun
ScientificOofPrediction
ScientificEvaluationBet
ScientificPromotionDecision
```

## Artifacts

Default location:

```text
artifacts/evaluation/v7-alpha7/
```

Each evaluation version contains:

```text
fold_models/
stacker.json
calibration.json
folds.json
oof_predictions.jsonl
evaluation_bets.jsonl
metrics.json
metadata.json
```

All important artifacts have SHA-256 digests stored in
`ScientificEvaluationRun`.

## Commands

```powershell
npm run test:scientific-evaluation -w @football-ai/sync

npm run worker -- scientific-baseline-freeze
npm run worker -- scientific-evaluate
npm run worker -- scientific-evaluation-coverage
npm run worker -- scientific-promotion-report
```

## Configuration

```text
SCIENTIFIC_EVAL_BASELINE_VERSION=v6.2.3-frozen-alpha7
SCIENTIFIC_EVALUATION_ARTIFACT_DIRECTORY=artifacts/evaluation/v7-alpha7

SCIENTIFIC_EVAL_FOLD_COUNT=5
SCIENTIFIC_EVAL_MIN_TRAIN_FIXTURES=150
SCIENTIFIC_EVAL_CATBOOST_ITERATIONS=240
SCIENTIFIC_EVAL_CATBOOST_DEPTH=6
SCIENTIFIC_EVAL_CATBOOST_LEARNING_RATE=0.035
SCIENTIFIC_EVAL_CATBOOST_L2=6
SCIENTIFIC_EVAL_RANDOM_SEED=20260723

SCIENTIFIC_EVAL_STACK_TRAIN_FRACTION=0.60
SCIENTIFIC_EVAL_CALIBRATION_FRACTION=0.20
SCIENTIFIC_EVAL_PROMOTION_HORIZON=90

SCIENTIFIC_POLICY_MIN_PROBABILITY=0.35
SCIENTIFIC_POLICY_MIN_EDGE=0.04
SCIENTIFIC_POLICY_MIN_EV=0.03
SCIENTIFIC_POLICY_STAKE_UNITS=1

SCIENTIFIC_PROMOTION_MIN_ROWS=50
SCIENTIFIC_PROMOTION_MIN_BETS=20
SCIENTIFIC_PROMOTION_MIN_BRIER_IMPROVEMENT=0.005
SCIENTIFIC_PROMOTION_MAX_LOGLOSS_REGRESSION=0
SCIENTIFIC_PROMOTION_MIN_ROI_IMPROVEMENT=0
SCIENTIFIC_PROMOTION_MAX_DRAWDOWN_REGRESSION=2
SCIENTIFIC_PROMOTION_REQUIRE_POSITIVE_CLV=true
```

## Expected coverage

After migration only:

```text
baselineSnapshots = 0
evaluationRuns = 0
leakageViolations = 0
```

After baseline freeze:

```text
baselineSnapshots > 0
baselineFixtures > 0
```

After evaluation:

```text
successfulRuns > 0
oofPredictions > 0
evaluationPredictions > 0
promotionDecisions > 0
leakageViolations = 0
```
