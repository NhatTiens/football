# Football AI v7.0-beta.1A — Provider Adapter + Historical Replay Pipeline

Beta.1A is the last stage that intentionally requires no live football API.

It introduces a provider-neutral contract and validates the data/orchestration
pipeline against historical database data before any paid live provider is
connected.

## Provider contract

The adapter exposes normalized capabilities for:

```text
FIXTURES
RESULTS
TEAM_METRICS
ODDS
STANDINGS
INJURIES
LINEUPS
```

The built-in beta.1A provider is:

```text
providerKey = database-historical-replay
mode = REPLAY
live = false
```

Current replay capabilities:

```text
FIXTURES      yes
RESULTS       yes
TEAM_METRICS  yes
ODDS          yes
STANDINGS     no
INJURIES      no
LINEUPS       no
```

The three unavailable capabilities are intentionally explicit so beta.1B can
validate the live provider's coverage instead of silently assuming the fields
exist.

## Historical replay boundary

Default replay window:

```text
2022-01-01 -> 2024-12-31
```

Replay evidence is always classified as:

```text
REPLAY_ONLY_NON_PROMOTIONAL
```

It can never promote a model and it is never written to:

```text
ScientificShadowPrediction
```

Therefore beta.1A cannot increase alpha.8:

```text
freshFixtures
freshPredictions
candidateBets
```

Historical replay proves pipeline behavior, not fresh model quality.

## Scheduler simulation

Each historical fixture receives this deterministic event plan:

```text
T-180  FIXTURE_DISCOVERY
T-120  FUNDAMENTALS_REFRESH
T-90   T90_SHADOW_TRIGGER
T-30   T30_OBSERVATION
T-5    T5_OBSERVATION
FT+180 RESULT_SETTLEMENT
```

All prematch events are asserted to occur strictly before kickoff.

The beta.1A T-90 route validates the already-frozen alpha.8 candidate:

```text
T-90 + NO_MARKET
95% frozen baseline
5% Dixon-Coles
temperature = 0.8
maximum raw blend shift = 0.08
```

The formula itself is imported from alpha.8 rather than duplicated.

## Point-in-time checks

For the T-90 replay tick:

```text
latest team metric capturedAt <= predictionAsOf
latest odds capturedAt <= predictionAsOf
feature.predictionAsOf == T-90
baseline.predictionAsOf == T-90
feature.kickoffAt == fixture.kickoffAt
baseline.kickoffAt == fixture.kickoffAt
```

Any violation increments:

```text
pitViolations
```

Expected final value:

```text
pitViolations = 0
```

## Replay parity/evaluation

Beta.1A reconstructs the frozen candidate from:

```text
ScientificBaselineSnapshot
+
MlFeatureSnapshot Dixon-Coles probabilities
```

and settles it against the historical result only after the configured result
availability lag.

It reports non-promotional:

```text
accuracy
Brier
log-loss
relative Brier change
log-loss change
team-metric coverage
odds coverage
```

These metrics are pipeline/parity diagnostics only. They must not be used as
new alpha.8 fresh evidence.

## Database tables

Migration `0012_provider_replay_pipeline` creates:

```text
ProviderReplayRun
ProviderReplayPrediction
ProviderHealthObservation
```

No existing production table is modified by the replay runner.

## Commands

```powershell
npm run worker -- provider-health
npm run worker -- provider-replay-run
npm run worker -- provider-replay-coverage
npm run worker -- provider-replay-report
```

Tests:

```powershell
npm run test:provider-replay -w @football-ai/sync
```

## Configuration

```text
FOOTBALL_PROVIDER_MODE=replay

BETA1A_REPLAY_DATE_FROM=2022-01-01T00:00:00Z
BETA1A_REPLAY_DATE_TO=2024-12-31T23:59:59Z
BETA1A_REPLAY_FIXTURE_LIMIT=0
BETA1A_REPLAY_ARTIFACT_DIRECTORY=artifacts/provider/v7-beta1a

RESULT_AVAILABILITY_LAG_MINUTES=180
```

`BETA1A_REPLAY_FIXTURE_LIMIT=0` means all finished fixtures in the replay
window.

## Passing criteria

The source/test stage must pass.

After migration and replay:

```text
successfulRuns >= 1
replayPredictions > 0
pitViolations = 0
freshShadowRowsWritten = 0
promotionalReplayRows = 0
```

`oddsCoverage` and `teamMetricCoverage` are diagnostic values rather than hard
pass thresholds because the current historical API/data may be incomplete.

## Live API boundary

Setting:

```text
FOOTBALL_PROVIDER_MODE=live
```

in beta.1A intentionally fails with a clear message.

Only after beta.1A replay passes should the project move to:

```text
v7.0-beta.1B — Live Provider Adapter + 2025/2026 Backfill
```

That is the recommended point to upgrade the API subscription.
