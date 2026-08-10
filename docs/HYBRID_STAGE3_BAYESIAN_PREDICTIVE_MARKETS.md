# Football AI v8 — Stage 3 Bayesian Predictive Markets

Stage 3 transforms the Stage 2 posterior goal intensities into deterministic posterior-predictive
football markets. It remains challenger-only and read-only with respect to business tables.

## Outputs per fixture and horizon

- Home and away goal distributions.
- Normalized score matrix.
- HDA probabilities: HOME, DRAW, AWAY.
- BTTS probabilities: YES, NO.
- O/U 1.5, 2.0, 2.5, 3.0 and 3.5.
- Explicit WIN/PUSH/LOSS probabilities for integer total lines 2.0 and 3.0.
- A 90% uncertainty band and standard deviation for every market probability.

Posterior uncertainty is propagated with a fixed deterministic log-goal quadrature grid. No random
sampling is required, so the same Stage 2 fingerprint always produces the same Stage 3 fingerprint.

## Hard identities

```text
P(HOME) + P(DRAW) + P(AWAY) = 1
P(BTTS_YES) + P(BTTS_NO) = 1
P(WIN) + P(PUSH) + P(LOSS) = 1
```

Half-goal lines have `PUSH = 0`; integer lines must have a non-zero push mass when their score total
is reachable.

## Commands

```powershell
node scripts/run-with-env.mjs node --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/bayesian-predictive-markets-cli.ts coverage
node scripts/run-with-env.mjs node --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/bayesian-predictive-markets-cli.ts export
```

No external API call, schema change, CURRENT_CHAMPION change or real-money action is performed.
