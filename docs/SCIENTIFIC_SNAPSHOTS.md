# Scientific append-only snapshots — v7.0-alpha.2

## Scope

This release adds immutable history for:

- `ExternalPrediction`
- `FixtureTeamMetric`

It deliberately does not change model weights, betting thresholds, bankroll
rules, or recommendation ranking.

## Storage strategy

The existing current-state tables remain in place. Every new sync performs one
database transaction containing:

```text
current-state upsert
+
append-only snapshot insert
```

Snapshot inserts use a deterministic SHA-256 payload hash and
`skipDuplicates`. An unchanged payload is not stored repeatedly.

## Point-in-time read

Readers first select the newest snapshot satisfying:

```text
capturedAt <= predictionAsOf
```

Rows are grouped by their natural key:

```text
ExternalPrediction: fixtureId
FixtureTeamMetric: fixtureId + teamId
```

`capturedAt DESC, id DESC` provides deterministic selection.

If the migration has not been backfilled yet, the reader may use the old
current-state row only when its own `capturedAt <= predictionAsOf`. Audit
metadata records whether the feature came from `SNAPSHOT` or
`CURRENT_FALLBACK`.

## Migration and backfill

The code-update test script does not modify the database.

After code review:

```powershell
npm run db:deploy
npm run snapshot:backfill -w @football-ai/sync
```

The backfill is idempotent because the same payload hash and unique keys are
used by both historical import and live dual-write.

## Verification gates

- Prisma schema format and validation.
- Prisma client generation.
- Seven snapshot unit tests.
- Existing seven point-in-time tests.
- Full repository `npm run verify`.
- Changed-file allowlist.
- No database migration during code tests.
