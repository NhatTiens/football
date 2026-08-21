PredictionAI Automatic Pipeline V1.4

This revision continues from V1.3 and fixes only the API-app preflight anchor.

Root cause fixed
----------------
V1.3 matched the complete requireAdmin() helper as one exact string.
On the user's current local apps/api/src/app.ts that formatting did not match,
although the function and /api/health route were present.

V1.4 uses a structure-based regex:
- starts at function requireAdmin(...)
- ends at its closing brace
- requires /api/health immediately after it

It also makes the getPersonalUpcomingAnalysis import insertion formatting-tolerant.

No architecture changes
-----------------------
The automatic fixture/prediction/result/realtime design, stable patch,
quota manager, DB state/lease design, realtime behavior and V11 preservation
are unchanged.

Required files in project root
------------------------------
predictionai-automatic-pipeline-v1-stable.patch
predictionai-automatic-pipeline-v1.4-transform.mjs
apply-predictionai-automatic-pipeline-v1.4.ps1

Run
---
powershell -ExecutionPolicy Bypass -File .\apply-predictionai-automatic-pipeline-v1.4.ps1

Do not run V1/V1.1/V1.2/V1.3 installers again.
