# Prediction AI v6.1

Prediction AI v6.1 extends the existing `scientific-ensemble-dixon-coles-v6`
without replacing its probability engine.

## Added capabilities

### 1. Walk-forward backtest

Run:

```bash
npm run worker -- scientific-walk-forward
```

Default configuration:

```env
SCIENTIFIC_WF_MIN_TRAIN=200
SCIENTIFIC_WF_TEST_SIZE=50
SCIENTIFIC_WF_MAX_FOLDS=5
SCIENTIFIC_WF_HORIZON_MINUTES=30
```

Each fold trains only on earlier fixtures and tests the next chronological
window. The production model is restored when the command finishes, including
when an error occurs. Run this command while scheduled production generation is
paused because the active artifact key is temporarily switched inside each
fold.

### 2. Rejection diagnostics

Backtest `rules` JSON and recommendation generation metadata now include counts
for missing horizon odds, stale markets, bookmaker coverage, EV, edge,
confidence, data quality, probability dispersion, market limits and correlation
limits.

### 3. Metrics by market

Backtest `rules.marketMetrics` contains separate proper scoring and betting
metrics for:

- `MATCH_WINNER`
- `TOTAL_GOALS_2_5`
- `BTTS`

1X2 uses multiclass Brier score and multiclass log loss. Binary markets use
binary Brier score and binary log loss. These metrics are recorded before bet
selection so they are not biased toward only recommendations that passed the
thresholds.

### 4. Correlated-bet control

The final candidate portfolio is deterministic and constrained by:

```env
SCIENTIFIC_MAX_PER_FIXTURE=3
SCIENTIFIC_MAX_PER_MARKET=1
SCIENTIFIC_MAX_PER_CORRELATION_CLUSTER=1
```

`OVER + BTTS YES` share the `GOALS_HIGH` cluster. `UNDER + BTTS NO` share the
`GOALS_LOW` cluster. Only the strongest candidate from each cluster is retained
by default.

### 5. Multiple model artifacts

Every successful training run is preserved in `AppSetting` instead of existing
only under the single production key. Registry metadata includes model version,
training cutoff, sample size, validation metrics, seed, purpose and optional
walk-forward fold information.

Aliases:

- `champion`: latest promoted production model
- `latest`: latest saved model
- `walk-forward-latest`: latest walk-forward fold
- `walk-forward-fold-N`: a specific fold

No Prisma migration is required for v6.1.

## Commands

Code verification:

```bash
npm run typecheck -w @football-ai/sync
npm run typecheck -w @football-ai/worker
npm run test:prediction-v61 -w @football-ai/sync
```

Scientific backtest with diagnostics:

```bash
npm run worker -- scientific-backtest
```

Walk-forward:

```bash
npm run worker -- scientific-walk-forward
```

## Database output

- Individual walk-forward folds remain normal `BacktestRun` records.
- Per-market metrics and rejection diagnostics are stored in `BacktestRun.rules`.
- The latest aggregate walk-forward report is stored under
  `SCIENTIFIC_WALK_FORWARD_LATEST_V61`.
- Versioned artifacts are stored under `SCIENTIFIC_MODEL_ARTIFACT_V61_*`.
