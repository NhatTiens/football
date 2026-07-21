# REST API

Base URL: `http://localhost:4000/api`

## Public

- `GET /health`
- `GET /stats`
- `GET /leagues`
- `GET /fixtures?status=UPCOMING&limit=50`
- `GET /fixtures/:id`
- `GET /recommendations?status=ACTIVE&limit=50`
- `GET /backtests?limit=20`
- `GET /backtests/latest`
- `GET /backtests/:id`
- `GET /openapi.json`
- `GET /docs`

## Administrative

Send header:

```text
x-admin-token: <ADMIN_API_TOKEN>
```

- `POST /admin/sync/fixtures` body `{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }`
- `POST /admin/sync/odds`
- `POST /admin/sync/predictions`
- `POST /admin/recommendations/generate`
- `POST /admin/recommendations/settle`
- `POST /admin/backtests/run`

Example backtest body:

```json
{
  "name": "Premier League validation",
  "from": "2024-08-01T00:00:00.000Z",
  "to": "2025-05-31T23:59:59.999Z",
  "fixtureLimit": 500,
  "stakeUnits": 1,
  "rules": {
    "minimumExpectedValue": 0.03,
    "minimumEdge": 0.02,
    "minimumConfidence": 0.5
  }
}
```
