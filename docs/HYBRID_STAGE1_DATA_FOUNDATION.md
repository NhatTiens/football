# Hybrid Ensemble v8 — Stage 1 PIT Data Foundation

Stage 1 does not replace the current recommendation engine. It certifies and exports the existing point-in-time feature snapshots for the future Bayesian + Dixon–Coles + CatBoost hybrid ensemble.

## Required horizons

- T-180
- T-90
- T-30
- T-10
- T-5

## Hard gates

- `predictionAsOf < kickoffAt`
- `trainedThrough < predictionAsOf`
- source fundamental snapshots are not later than `predictionAsOf`
- market evidence is not later than `predictionAsOf`
- labels become available after kickoff
- one feature row per fixture/horizon/feature contract
- exact lineage IDs and hashes
- finite feature vectors with a stable feature contract

## Commands

```powershell
node scripts/run-with-env.mjs node --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/hybrid-data-foundation-cli.ts coverage
node scripts/run-with-env.mjs node --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/hybrid-data-foundation-cli.ts audit
node scripts/run-with-env.mjs node --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/hybrid-data-foundation-cli.ts export
```

`export` is blocked until the audit status is `READY_FOR_BAYESIAN`.

## Artifacts

Each run writes a new append-only directory under:

```text
artifacts/hybrid/v8-data-foundation/<timestamp>-<fingerprint>/
```

Files:

- `manifest.json`
- `findings.jsonl`
- `sha256.json`
- `dataset.jsonl` (only for a successful export)

No schema change and no external API request are performed by the Stage 1 audit/export commands.
