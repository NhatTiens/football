# ML & Market Engine — v7.0-alpha.6

Alpha.6 adds an offline challenger modelling layer on top of alpha.5.

It combines:

1. a fixed numerical feature contract;
2. CatBoost fundamentals models;
3. point-in-time market consensus;
4. a market-residual model;
5. model artifact and validation-prediction snapshots.

The external football API is not called.

## Scientific boundary

Alpha.6 does not automatically replace the current champion prediction.

Every trained artifact is stored with:

```text
status = CHALLENGER
```

Only temporally held-out validation fixtures receive prediction snapshots. A
prediction is persisted only when:

```text
model.trainedThrough < predictionAsOf
```

Champion selection, out-of-fold stacking, calibration and betting-policy
promotion remain alpha.7 responsibilities.

## Feature contract

The feature vector includes:

- alpha.5 rolling form for 5, 10 and 20 matches;
- home/away venue splits;
- goals, xG, shots, shots on target, possession and corners;
- win/draw/loss, clean sheet, BTTS and over-2.5 rates;
- rest days, metric coverage and data quality;
- Dynamic Dixon–Coles expected goals and probabilities;
- no-vig multi-bookmaker MATCH_WINNER consensus;
- market dispersion, agreement and quality;
- odds movement fields when repeated snapshots exist;
- Dixon–Coles versus market residuals;
- horizon as a stable numerical feature.

The feature-name order and contract SHA-256 are fixed. Training fails if rows
contain a different contract or non-finite values.

## CatBoost models

The Python engine trains:

```text
MATCH_WINNER  CatBoostClassifier / MultiClass
OVER_2_5      CatBoostClassifier / Logloss
BTTS          CatBoostClassifier / Logloss
MARKET_RESIDUAL CatBoostRegressor / MultiRMSE
```

The residual target is:

```text
actual one-hot outcome - fair market consensus
```

The residual model is trained only when enough fixtures have point-in-time
market consensus.

## Temporal split

Fixtures are sorted by kickoff time and split by unique fixture ID, not by
individual horizon row. Therefore T-90, T-30 and T-5 rows from one fixture can
never be split between train and validation.

Default:

```text
80% earlier fixtures: training
20% later fixtures: validation
```

Each fixture receives total sample weight 1 regardless of the number of horizon
rows, preventing fixtures with three horizons from receiving three times the
importance.

## Artifacts

Default output:

```text
artifacts/ml/v7-alpha6/<model-version>/
  match_winner.cbm
  match_winner.json
  over_25.cbm
  over_25.json
  btts.cbm
  btts.json
  market_residual.cbm
  market_residual.json
  metadata.json
  validation_predictions.jsonl
```

Binary and JSON model files are hashed with SHA-256. The database stores the
relative directory, hashes, parameters, feature importance and validation
metrics.

## Database tables

```text
MlFeatureSnapshot
MlModelArtifact
MlPredictionSnapshot
```

These tables are append-only scientific storage. No live model is promoted by
migration or backfill.

## Configuration

```text
ML_FEATURE_HORIZONS_MINUTES=90,30,5
ML_FEATURE_DATE_FROM=
ML_FEATURE_DATE_TO=
ML_FEATURE_LIMIT=0
ML_FEATURE_FORCE=false

ML_ARTIFACT_DIRECTORY=artifacts/ml/v7-alpha6
ML_PYTHON_EXECUTABLE=.venv-alpha6/Scripts/python.exe
ML_VALIDATION_FRACTION=0.20

CATBOOST_ITERATIONS=450
CATBOOST_DEPTH=6
CATBOOST_LEARNING_RATE=0.035
CATBOOST_L2_LEAF_REG=5
CATBOOST_RANDOM_SEED=20260723
CATBOOST_EARLY_STOPPING_ROUNDS=70

ML_CATBOOST_BLEND_WEIGHT=0.60
ML_RESIDUAL_STRENGTH=1.00
```

## Commands

```powershell
npm run test:ml-market -w @football-ai/sync

npm run worker -- ml-feature-backfill
npm run worker -- ml-train
npm run worker -- ml-score-validation
npm run worker -- ml-coverage
```

## Expected flow

```text
alpha.5 snapshots
→ alpha.6 feature snapshots
→ grouped temporal split
→ CatBoost challenger training
→ held-out validation predictions
→ alpha.7 OOF stacking/calibration/backtest
```

## Interpretation

A lower validation Brier score or log-loss does not promote the model by
itself. Alpha.7 must compare the challenger against the frozen baseline using
the same walk-forward fixtures, horizons and betting thresholds.
