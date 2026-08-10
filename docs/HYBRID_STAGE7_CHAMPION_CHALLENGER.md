# Football AI v8 — Stage 7 Walk-forward Champion–Challenger

Stage 7 compares `v7.5-current-champion`, v8 Bayesian and v8 Hybrid on the same chronological Test fixtures, real PIT odds and frozen Stage 6 policy.

It reports calibration, coverage, ROI, hit rate, real closing-line value where available, drawdown, turnover, bet frequency and NO_BET counterfactual quality. Results are broken down by market, horizon, league and calendar month.

Safety rules:

- No random split and no post-test threshold tuning.
- No fabricated historical odds.
- Integer-line pushes are VOID with zero P/L and excluded from hit-rate denominator.
- Flat one-unit stakes are used for comparison.
- A passed backtest only permits paper runtime; it never promotes v8 automatically.
- Shadow evidence remains mandatory before any champion change.

Commands:

```text
npm run test:champion-challenger -w @football-ai/sync
npm run champion-challenger:report -w @football-ai/sync
npm run champion-challenger:export -w @football-ai/sync
```

