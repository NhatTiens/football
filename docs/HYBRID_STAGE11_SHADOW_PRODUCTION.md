# Football AI v8 — Stage 11 Shadow Production & Release Gate

Stage 11 is a read-only promotion gate. It never changes the champion, creates a
release tag, calls an external API, writes to the database, or places a real bet.

## Required evidence

- `v7.5-current-champion` and `v8.0-stage1-pit-foundation` tags remain present.
- Latest Stage 7 artifact exists and its manifest SHA-256 verifies.
- Stage 7 marks the challenger promotion-eligible.
- At least 200 v8 paper decisions and 100 settled BEST_BET rows.
- At least 30 active decision days across an observation span of 30 days.
- No duplicate fixture/horizon decision, future-odds leakage, or matured missing settlement.
- Paper ROI and mean CLV are non-negative, ECE is within guard, and drawdown is at most 30 units.
- Stage 10 live input is fresh and complete.
- v7/v8 O/U execution-policy parity is explicitly certified.

The v7 paper runtime and Stage 6/8 now evaluate the model-selected O/U line
directly. The gate still keeps `V7_V8_PAPER_OU_POLICY_PARITY_NOT_CERTIFIED`
active until the comparison is rerun with fresh evidence under the direct-line
runtime version. This prevents a stale champion comparison.

## Command

```powershell
npm run v8-release:gate -w @football-ai/sync
```

Exit code `2` means evidence is incomplete or a guard failed. Even when all
guards pass, the result is only `READY_FOR_MANUAL_PROMOTION_REVIEW`; promotion
and tagging remain manual operations.
