# Football AI v8 — Stage 10 Live Data Readiness

Stage 10 reuses the existing append-only API-Football snapshot pipeline for fixtures, odds, statistics, injuries and lineups. Raw payload, source timestamp, observed timestamp, provider quota, retry checkpoints and closing-odds coverage are audited without calling the provider.

The system never upgrades a paid API plan or changes credentials automatically. An upgrade is recommended only when daily remaining quota is below 10% and provider failures are also present. Weather remains unconfigured unless the selected provider plan explicitly supports it. Suspension context is currently partial through the injury payload.

```text
npm run test:v8-live-data -w @football-ai/sync
npm run v8-live-data:readiness -w @football-ai/sync
```

New live snapshots do not mutate the frozen Stage 1 artifact.

