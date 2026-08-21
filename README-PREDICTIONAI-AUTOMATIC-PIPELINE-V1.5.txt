PredictionAI Automatic Pipeline V1.5

Fix from V1.4
-------------
V1.4 still tried to locate requireAdmin() in apps/api/src/app.ts.
V1.5 removes that dependency completely.

The automation admin rate limiter and queue helper are now inserted at the
same location as the existing /api/admin/sync/fixtures -> /predictions block.
The transformer replaces that block and anchors its end to the next existing
/api/admin/recommendations/generate route.

Therefore V1.5 does not care where requireAdmin() is declared or how it is formatted.

No architecture change
----------------------
- Stable patch unchanged.
- V11 O/U changes remain preserved.
- No Prisma schema migration.
- Same DB-backed orchestration, quota, retry/backoff, realtime, monitoring and admin design.
- Installer still preflights exact local files twice before changing source.
- On failure it restores the pre-upgrade source backup byte-for-byte.

Required files
--------------
predictionai-automatic-pipeline-v1-stable.patch
predictionai-automatic-pipeline-v1.5-transform.mjs
apply-predictionai-automatic-pipeline-v1.5.ps1

Run
---
powershell -ExecutionPolicy Bypass -File .\apply-predictionai-automatic-pipeline-v1.5.ps1

Do not run V1 through V1.4 installers again.
