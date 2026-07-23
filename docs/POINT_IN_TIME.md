# Point-in-time contract — v7.0-alpha.1

## Invariant

Every value used by training, replay, backtest, or inference must satisfy:

```text
availableAt <= predictionAsOf
```

`predictionAsOf` is the simulated decision time. It is not the fixture kickoff
time and it is not the time at which the backtest is executed.

## What this patch enforces

- A shared `PredictionContext`.
- A fail-fast `PointInTimeAudit`.
- Historical results are only eligible after a conservative result-availability
  lag (`POINT_IN_TIME_RESULT_LAG_MINUTES`, default `180`).
- `FixtureTeamMetric.capturedAt <= predictionAsOf`.
- `FixtureInjury.capturedAt <= predictionAsOf`.
- `FixtureLineupSnapshot.capturedAt <= predictionAsOf`.
- `ExternalPrediction.capturedAt <= predictionAsOf`.
- Scientific coverage timestamps only count when they existed by
  `predictionAsOf`.
- A model artifact is eligible only when both `trainedAt <= predictionAsOf`
  and `trainedThrough < predictionAsOf`.
- Existing `asOf` callers remain temporarily compatible, while new callers use
  the explicit `predictionAsOf` name.

## Important limitation

The current database schema stores immutable history for odds and lineup
snapshots, but these tables are still current-state/mutable records:

- `ExternalPrediction` has one row per fixture.
- `FixtureTeamMetric` has one row per fixture/team.
- `FixtureInjury` has one row per fixture/team/player and obsolete injuries may
  disappear.
- `FixtureScientificCoverage` has one row per fixture.

This patch is deliberately conservative: an overwritten row captured after
`predictionAsOf` is excluded. That prevents future leakage, but it cannot
reconstruct an older value that was overwritten. The next schema migration
must add append-only snapshot tables for these sources.

Only the latest model artifact is stored in `AppSetting`. Therefore historical
replay can safely reject a model trained after `predictionAsOf`, but it cannot
recover an older artifact that was available at that time. A later migration
should store model artifacts append-only with immutable `trainedAt` metadata.

## Verification gates

```powershell
npm run format -- packages/sync/src/point-in-time.ts packages/sync/tests/point-in-time.test.ts packages/sync/src/scientific-features.ts
npm run typecheck
npm test
npm run lint
npm run build
```

A backtest is invalid if any `PointInTimeLeakageError` is raised.
