# Football AI v8 — Stage 6 Multi-horizon Decision Engine

Stage 6 emits an independent immutable paper decision at T-180, T-90, T-30, T-10 and T-5.

- Only odds captured at or before `decisionAsOf` are eligible.
- Stale odds outside the policy window are ignored.
- Vig is removed per complete bookmaker before consensus is calculated.
- Integer totals retain explicit push probability; EV is `P(win) × (odds - 1) - P(loss)`.
- Every candidate is retained, including candidates rejected for missing odds, edge, EV, reliability or uncertainty.
- `BEST_BET` selection is separate from the downstream risk/stake overlay.
- A `NO_BET` row is still a complete append-only decision.
- Stage 6 writes only versioned artifacts and never changes the current champion.

Commands:

```text
npm run test:multi-horizon-decision -w @football-ai/sync
npm run multi-horizon:coverage -w @football-ai/sync
npm run multi-horizon:export -w @football-ai/sync
```

