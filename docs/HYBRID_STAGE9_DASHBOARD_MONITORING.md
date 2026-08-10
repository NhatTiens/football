# Football AI v8 — Stage 9 Dashboard and Monitoring

The `/api/scientific/v8-monitoring` read-only endpoint and `/v8-monitoring` page expose:

- v8 paper decisions and T-180/T-90/T-30/T-10/T-5 timeline coverage;
- BEST_BET, NO_BET, candidates and rejection reason counts;
- probability, odds, edge, EV, model/policy versions and decision hashes;
- settlement, P/L, ROI, CLV and open paper exposure;
- provider, odds, lineup and injury freshness;
- calibration/backtest artifact lineage and fingerprints;
- provider failures, stale odds, semantic duplicates and missing settlements;
- calibration/model drift evaluation readiness.

The dashboard is read-only and cannot promote a model or place a bet.

