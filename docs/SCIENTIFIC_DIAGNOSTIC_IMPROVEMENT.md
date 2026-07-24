# Football AI v7.0-alpha.7.1 — Diagnostic & Model Improvement

Alpha.7.1 diagnoses the rejected alpha.7 challenger and searches for
conservative development-only alternatives.

It does not change the production champion, does not tune on the already-opened
alpha.7 `EVALUATION` holdout and does not call a football API.

## Why this stage exists

The completed alpha.7 run showed:

- zero leakage;
- sufficient evaluation rows and bets;
- worse Brier and log-loss than the frozen baseline;
- excessive confidence after stacking;
- larger drawdown;
- negative CLV;
- no market rows in the final opened evaluation block.

Alpha.7.1 identifies where the degradation occurred and tests safe alternatives
without weakening the promotion gates.

## Diagnostic reports

The engine writes:

```text
diagnostic_summary.json
model_metrics_by_fold.json
model_metrics_by_horizon.json
model_metrics_by_class.json
reliability_bins.json
overconfidence.json
market_coverage.json
label_drift.json
feature_drift.json
development_candidates.json
development_predictions.jsonl
metadata.json
```

Diagnostics include:

- Brier, log-loss, accuracy, ECE, confidence and entropy;
- metrics by fold, horizon and temporal role;
- HOME/DRAW/AWAY support, precision, recall and one-vs-rest Brier;
- reliability bins;
- high-confidence wrong predictions;
- market and market-residual coverage by fold, role, horizon and quarter;
- feature drift using PSI and standardized mean difference;
- label-frequency drift.

The old alpha.7 `EVALUATION` rows remain visible in diagnostics, but are marked:

```text
DIAGNOSTIC_ONLY_ALREADY_OPENED
```

## Safe development search

Selection data is restricted to:

```text
STACK_TRAIN + CALIBRATION
```

Rows with role `EVALUATION` are excluded before any weight or temperature
selection.

For each horizon:

```text
T-90
T-30
T-5
```

the engine evaluates separate branches:

```text
NO_MARKET
WITH_MARKET
```

Each branch is split chronologically:

```text
50% fit
25% calibration
25% development validation
```

Candidate families:

```text
baseline + CatBoost
baseline + Dixon-Coles
baseline + CatBoost + Dixon-Coles
baseline + market
baseline + CatBoost + Dixon-Coles + market
baseline + CatBoost + Dixon-Coles + market residual
```

Market methods are considered only in `WITH_MARKET`.

## Safety constraints

Default constraints:

```text
baseline weight >= 0.50
all weights >= 0
weights sum to 1
maximum per-class probability shift from baseline <= 0.08
Brier improvement on development validation >= 0.002
log-loss regression <= 0.005
ECE regression <= 0.02
```

A selected result can only be:

```text
DEVELOPMENT_CANDIDATE
NO_SAFE_IMPROVEMENT
INSUFFICIENT_BRANCH_DATA
INSUFFICIENT_VALIDATION_DATA
```

`DEVELOPMENT_CANDIDATE` is not a promotion result. It is only a configuration
eligible for a fresh alpha.8 nested evaluation.

## Database tables

Migration `0010_scientific_diagnostic_improvement` creates:

```text
ScientificDiagnosticRun
ScientificDevelopmentCandidate
```

The candidate table records:

- horizon and market branch;
- convex sources and weights;
- temperature;
- probability-shift cap;
- fit/calibration/validation fixture counts;
- metrics, gates and deltas;
- whether the old evaluation holdout was used.

The last field must always be `false`.

## Commands

```powershell
npm run test:scientific-diagnostic -w @football-ai/sync

npm run worker -- scientific-diagnostic-run
npm run worker -- scientific-diagnostic-coverage
npm run worker -- scientific-development-report
```

## Artifacts

Default location:

```text
artifacts/diagnostics/v7-alpha71/
```

## Configuration

```text
SCIENTIFIC_DIAGNOSTIC_ARTIFACT_DIRECTORY=artifacts/diagnostics/v7-alpha71
SCIENTIFIC_DIAGNOSTIC_MIN_BRANCH_FIXTURES=36
SCIENTIFIC_DIAGNOSTIC_MIN_VALIDATION_FIXTURES=12
SCIENTIFIC_DIAGNOSTIC_BLEND_STEP=0.05
SCIENTIFIC_DIAGNOSTIC_MIN_BASELINE_WEIGHT=0.50
SCIENTIFIC_DIAGNOSTIC_MAX_PROBABILITY_SHIFT=0.08
SCIENTIFIC_DIAGNOSTIC_MIN_BRIER_IMPROVEMENT=0.002
SCIENTIFIC_DIAGNOSTIC_MAX_LOGLOSS_REGRESSION=0.005
SCIENTIFIC_DIAGNOSTIC_MAX_ECE_REGRESSION=0.02
```

## Expected coverage

After migration only:

```text
diagnosticRuns = 0
developmentCandidates = 0
evaluationHoldoutUseViolations = 0
leakageViolations = 0
```

After diagnostic run:

```text
successfulRuns > 0
developmentCandidates > 0
evaluationHoldoutUseViolations = 0
leakageViolations = 0
```

`safeDevelopmentCandidates` may be zero. That is a valid scientific result and
means none of the conservative blends passed the development safety gates.

## Next stage

When at least one branch returns `DEVELOPMENT_CANDIDATE`, the next stage is:

```text
v7.0-alpha.8 — Fresh Nested Scientific Evaluation
```

The already-opened alpha.7 final holdout must not be reused for promotion.
