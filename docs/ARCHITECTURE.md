# Architecture

```text
API-Football
    │
    ▼
Node.js worker ── fixtures / predictions / odds snapshots
    │
    ▼
MySQL + Prisma
    │
    ├── Poisson goal model
    ├── no-vig market consensus
    ├── edge / EV / confidence
    └── correlated-market filter
    │
    ▼
Express REST API
    │
    ▼
Next.js App Router UI
```

## Service boundaries

- `apps/web`: server-rendered Next.js interface. It never exposes the API-Football key.
- `apps/api`: public read API and protected administrative commands.
- `apps/worker`: cron scheduler and one-off CLI.
- `packages/database`: Prisma schema and demo seed.
- `packages/api-football`: retrying API client with rate-limit metadata.
- `packages/engine`: deterministic mathematical functions and tests.
- `packages/sync`: all integration and recommendation workflows shared by API and worker.

## Recommendation model

1. Keep the latest odds per bookmaker/market/selection while retaining all historical snapshots.
2. Normalize each complete bookmaker market to remove overround.
3. Use median fair probability across bookmakers as market consensus.
4. Estimate team expected goals from point-in-time completed league fixtures.
5. Derive 1X2, Over/Under 2.5 and BTTS probabilities from a Poisson score matrix.
6. Blend API-Football 1X2 prediction at 25% when available.
7. Calculate edge and expected value against the best available price.
8. Apply freshness, data-quality, confidence and correlation filters.
9. Store every generated recommendation with the exact odds snapshot and model version.

This is an MVP baseline, not a validated commercial betting model.
