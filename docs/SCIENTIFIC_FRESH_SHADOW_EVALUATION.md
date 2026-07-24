# Football AI v7.0-alpha.8 — Frozen Candidate Registry & Fresh Shadow Evaluation

Alpha.8 freezes the successful alpha.7.1 development candidate and creates a
fresh, append-only shadow evaluation lane.

The candidate being frozen by default is:

```text
experimentId = 289d3fdb1fab2547
route = T-90 + NO_MARKET
method = SAFE_CONVEX_BLEND
sources = baseline + Dixon-Coles
weights = 0.95 + 0.05
temperature = 0.8
maximumProbabilityShift = 0.08
```

## Scientific boundary

The old alpha.7 final evaluation block is permanently quarantined:

```text
old alpha.7 EVALUATION = diagnostic only
```

It is never copied into `ScientificShadowPrediction` and is never used by the
alpha.8 review decision.

A shadow prediction is eligible only when its source feature and baseline
snapshots satisfy all of the following:

```text
feature.createdAt >= candidate.frozenAt
feature.predictionAsOf >= candidate.frozenAt
feature.predictionAsOf < kickoffAt
feature.createdAt <= kickoffAt
baseline.createdAt <= kickoffAt
baseline.predictionAsOf == feature.predictionAsOf
labelAvailableAt > feature.createdAt
marketAvailable == false
horizonMinutes == 90
```

The capture path does not select label fields.

## Candidate formula

Alpha.8 reproduces the exact alpha.7.1 selected formula:

```text
raw = normalize(0.95 * baseline + 0.05 * Dixon-Coles)
capped = cap(raw - baseline, max absolute class shift = 0.08)
candidate = temperature_scale(capped, temperature = 0.8)
```

The order is intentionally:

```text
blend -> cap -> temperature
```

because this is the order used when experiment `289d3fdb1fab2547` was selected.

## Database tables

Migration `0011_fresh_shadow_evaluation` creates:

```text
ScientificCandidateRegistry
ScientificShadowPrediction
ScientificShadowEvaluationRun
ScientificShadowBet
ScientificShadowDecision
```

## Commands

Freeze the exact development candidate:

```powershell
npm run worker -- scientific-shadow-freeze
```

Refresh baseline snapshots and capture fresh shadow rows:

```powershell
npm run worker -- scientific-baseline-freeze
npm run worker -- scientific-shadow-capture
```

Evaluate all settled fresh shadow rows:

```powershell
npm run worker -- scientific-shadow-evaluate
```

Coverage and report:

```powershell
npm run worker -- scientific-shadow-coverage
npm run worker -- scientific-shadow-report
```

## Review policy

Default review requirements:

```text
fresh fixtures >= 150
candidate bets >= 30
relative Brier improvement >= 0.5%
log-loss regression <= 0
ECE regression <= 0.02
ROI improvement >= 0
drawdown regression <= 2 units
candidate average CLV > 0
leakage violations = 0
freshness violations = 0
```

Decision states:

```text
COLLECTING
ELIGIBLE_FOR_MANUAL_REVIEW
HOLD
REJECT
```

There is no automatic champion promotion.

## Routing

Only the frozen challenger route is evaluated:

```text
T-90 + NO_MARKET -> frozen alpha.8 challenger
```

All other routes remain baseline-only:

```text
T-90 + WITH_MARKET -> v6.2.3 baseline
T-30 -> v6.2.3 baseline
T-5 -> v6.2.3 baseline
production output -> v6.2.3 baseline
```

## Expected behavior immediately after freeze

Because all existing alpha.7/alpha.7.1 snapshots predate the freeze, the normal
initial state is:

```text
registries = 1
frozenRegistries = 1
shadowPredictions = 0
freshPredictions = 0
evaluationRuns = 0
reviewEligibleRuns = 0
```

This is expected. Alpha.8 must not manufacture fresh evidence from historical
rows.

## Operational note

Alpha.8 does not enable the scheduler and does not call a football API.
Therefore fresh shadow rows appear only after the repository begins producing
new pre-match feature and baseline snapshots after the candidate freeze.

Real-time ingestion and scheduler automation remain beta.1 work.
