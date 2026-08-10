# Football AI v8 — Stage 8 Parallel Paper Runtime

The v8 challenger now has a separate `PAPER_V8_CHALLENGER` identity and runs beside the unchanged v7.5 paper champion.

- Decisions are independently due at T-180, T-90, T-30, T-10 and T-5.
- Bayesian history uses only results whose configured availability time is before `decisionAsOf`.
- Model snapshots and odds must be PIT-safe.
- The frozen Stage 5 calibration artifact is loaded and hashed at runtime.
- All candidates and rejection reasons remain in the append-only decision payload.
- Flat one-unit paper stake is used initially.
- Settlement reads archived terminal fixture snapshots and closing odds; it does not call the provider.
- The existing ledger schema is reused; no migration is required.
- No real-money placement path exists.

`readiness` and `preview` never write business data. `once` writes only when `V8_PAPER_WRITE_ENABLED=true`.

```text
npm run v8-paper:readiness -w @football-ai/sync
npm run v8-paper:preview -w @football-ai/sync
npm run v8-paper:once -w @football-ai/sync
npm run v8-paper:settle -w @football-ai/sync
npm run v8-paper:coverage -w @football-ai/sync
```

