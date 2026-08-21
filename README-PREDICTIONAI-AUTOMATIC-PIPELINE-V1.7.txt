PredictionAI Automatic Pipeline V1.7

Checkpoint inherited from V1.6
==============================
V1.6 already passed on the user's exact repository:
- transformer syntax
- stable patch syntax/preflight
- exact-local transformer pass 1 and pass 2
- stable source apply
- source transform
- AUTOMATIC_PIPELINE_V1_STATIC_VERIFY_PASS
- Prisma generate
- typecheck for API, worker, api-football, database, engine and sync

The only failure was:
apps/web/components/UpcomingPredictionBoard.tsx
Cannot find name 'CurrentCompetitionGroup'

Root cause
==========
The transformer removed the CurrentCompetitionGroup import unconditionally.
On the user's local frontend, the older GROUPS declaration was not removed by
the narrow cleanup regex, so the transformed file still referenced the type.

V1.7 fix
========
- Legacy GROUPS / selectedGroups / lastDiscovery cleanup now uses structural,
  formatting-tolerant regex.
- CurrentCompetitionGroup and PersonalRefreshResponse imports are removed only
  when the corresponding identifier is no longer used.
- A transformer post-condition fails immediately if either type is used without
  its personal-types import.
- The same post-condition runs during the second/idempotency preflight pass.

Everything else is unchanged from V1.6.
The V1.6 stable patch is reused unchanged because it already applied and passed
the static contract on the user's machine.

Required files
==============
predictionai-automatic-pipeline-v1.6-stable.patch
predictionai-automatic-pipeline-v1.7-transform.mjs
apply-predictionai-automatic-pipeline-v1.7.ps1

Run
===
powershell -ExecutionPolicy Bypass -File .\apply-predictionai-automatic-pipeline-v1.7.ps1

Do not run V1 through V1.6 installers again.
