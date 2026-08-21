PredictionAI Automatic Pipeline V1.3

This revision fixes the V1.2 transformer preflight failure:
  automatic startup cycle: expected one regex match, found 0

Cause
-----
The V1.2 transformer attempted to rewrite the legacy one-shot:
  setTimeout(() => void executeJob('generate'), ...)
That edit is not required for automatic operation and is brittle across worker-index revisions.

V1.3 behavior
-------------
- Keeps the existing one-shot generate startup untouched.
- Registers automatic-pipeline-cycle on cron (default */2 * * * *).
- Automatic pipeline uses durable DB state/lease and resumes on the next scheduler tick after restart.
- Suppresses legacy provider/prediction cron jobs owned by the automatic pipeline.
- Preserves the existing verified O/U V11 source via byte-for-byte safety backup.
- No Prisma schema migration.

Required files
--------------
- predictionai-automatic-pipeline-v1-stable.patch
- predictionai-automatic-pipeline-v1.3-transform.mjs
- apply-predictionai-automatic-pipeline-v1.3.ps1

Run
---
powershell -ExecutionPolicy Bypass -File .\apply-predictionai-automatic-pipeline-v1.3.ps1

Expected preflight:
PREDICTIONAI_AUTOMATIC_PIPELINE_V1_3_TRANSFORM_PASS
PREDICTIONAI_AUTOMATIC_PIPELINE_V1_3_TRANSFORM_PASS
PREDICTIONAI_AUTOMATIC_PIPELINE_V1_3_LOCAL_TRANSFORM_PREFLIGHT_PASS

Then the installer runs static verification, Prisma generate, and npm run verify.
