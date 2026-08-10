# Football AI v8 — Stage 5 Calibration and Uncertainty

Stage 5 calibrates Stage 4 probabilities without changing `v7.5-current-champion`.

## Temporal contract

- Unique fixtures are sorted by kickoff and split 60/20/20 into Train, Calibration and Test.
- Every horizon for one fixture stays in the same partition.
- Temperature calibrators are fitted only on the Calibration partition.
- Test kickoff must be strictly after each calibrator's `trainedThrough` cutoff.
- League calibrators require enough samples; otherwise the market/horizon calibrator is used and the fallback is recorded as OOD evidence.

## Metrics and guards

- Multiclass Brier Score, Log Loss, ECE and reliability bins are reported.
- Calibration is market- and horizon-specific, with guarded league specialization.
- A calibrator is accepted only if Calibration ECE improves without exceeding the Log Loss regression guard.
- Component disagreement, calibration error, sample guard and model fallback contribute to uncertainty.
- Identity calibration is an explicit safe fallback, never a silent failure.

## Commands

```text
npm run test:calibration-uncertainty -w @football-ai/sync
npm run calibration:coverage -w @football-ai/sync
npm run calibration:export -w @football-ai/sync
```

Artifacts are immutable JSON/JSONL with SHA-256 hashes. The runtime calls no provider API, changes no schema and writes no business database rows.
