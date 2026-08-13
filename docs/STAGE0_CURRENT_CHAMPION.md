# Stage 0 — CURRENT_CHAMPION freeze

Stage 0 keeps the existing prediction system unchanged and creates a clean, reproducible baseline before the Hybrid Ensemble work starts.

## Security prerequisite

The public repository previously tracked environment backup files. Before creating the champion tag, rotate every credential that appeared there, including:

- API-Football key;
- admin API token;
- database password/connection credential.

Removing a file from the latest commit does not revoke a leaked credential and does not erase older Git history. Never reuse the exposed values.

## Required gates

1. No tracked backup, patch payload, build cache or non-example environment file.
2. O/U policy tests preserve the calculated Over/Under selection and its original 1.5/2.5/3.5 line.
3. Legacy history replay uses the exact PIT quote for the calculated selection and never invents odds.
4. Typecheck, all tests, lint and production build pass.
5. GitHub Actions passes on the cleanup commit.
6. Working tree and origin/main are synchronized before tagging.

## Champion identity

Recommended annotated tag: `v7.5-current-champion`.

The tag freezes infrastructure, PIT safeguards, odds handling, paper history, settlement and the current prediction model. It does not promote the future Bayesian/CatBoost hybrid model.
