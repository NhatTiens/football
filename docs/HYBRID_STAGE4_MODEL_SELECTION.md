# Football AI v8 — Stage 4 Hybrid Model and Selection

Stage 4 blends model probabilities without replacing the frozen v7.5 champion.

## Registered components

- `BAYESIAN`: Stage 3 posterior-predictive markets.
- `DIXON_COLES`: the frozen statistical baseline and its expected-goals distribution.
- `ML_SPECIALIST`: PIT-safe CatBoost/specialist snapshots when a compatible row exists.

Market odds are not admitted as a core model component. Odds remain decision-time evidence for later
edge and EV calculation.

## Weighting and fallback

- Base weights differ for HDA, BTTS and total goals.
- Horizon multipliers distinguish early (T-180/T-90) and late (T-10/T-5) decisions.
- Optional league multipliers are supported with `HYBRID_MODEL_LEAGUE_MULTIPLIERS_JSON`.
- Missing components are removed and remaining weights are normalized.
- Every market records component probabilities, component weights, selected model and fallback reasons.
- Integer total markets retain the explicit BELOW/PUSH/ABOVE outcome classes.

## Commands

```powershell
node scripts/run-with-env.mjs node --max-old-space-size=4096 --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/hybrid-model-cli.ts coverage
node scripts/run-with-env.mjs node --max-old-space-size=4096 --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/hybrid-model-cli.ts export
```

The output is challenger-only, PIT-linked and append-only. It performs no API call, schema change,
automatic promotion or real-money execution.
