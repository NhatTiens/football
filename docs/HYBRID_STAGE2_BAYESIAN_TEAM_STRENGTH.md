# Football AI v8 — Stage 2 Bayesian Hierarchical Team Strength

Stage 2 is a challenger-only, deterministic empirical-Bayes model. It does not replace or mutate
`v7.5-current-champion`.

## Model

- Gamma–Poisson conjugate posteriors for league goal rates, team attack and team defence.
- League/global priors with configurable pseudo-match strength.
- Partial pooling: teams with little history remain closer to the league prior and retain wider
  posterior uncertainty.
- Exponential time decay for older matches.
- Separate league home/away goal priors and a posterior home-advantage term.
- Closed-form inference with a recorded fixed seed; identical input produces identical output.

The default strict result-availability contract is kickoff plus 180 minutes. A training result is
eligible only when both `kickoffAt < predictionAsOf` and `availableAt < predictionAsOf`.

## Commands

```powershell
node scripts/run-with-env.mjs node --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/bayesian-team-strength-cli.ts coverage
node scripts/run-with-env.mjs node --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/bayesian-team-strength-cli.ts audit
node scripts/run-with-env.mjs node --import ./scripts/tsx-windows-userinfo-bootstrap.mjs --import tsx packages/sync/src/bayesian-team-strength-cli.ts export
```

## Acceptance gates

- Stage 1 status is `READY_FOR_BAYESIAN`.
- Every expected-goals and posterior output is finite.
- Every non-null `trainedThrough` is strictly earlier than `predictionAsOf`.
- Output row count matches the safe Stage 1 row count.
- Dataset and row hashes are stable.
- Dixon–Coles expected goals remain present as a comparison baseline where available.
- No external API call, schema change, CURRENT_CHAMPION switch or real-money action.

Successful exports are append-only under:

```text
artifacts/hybrid/v8-stage2-bayesian-team-strength/<timestamp>-<fingerprint>/
```
