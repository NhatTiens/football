PredictionAI Automatic Pipeline V1.6

What changed from V1.5
======================
V1.5 successfully passed:
- transformer syntax
- stable patch preflight
- transformer pass 1 + pass 2 on the exact local source
- stable source application
- production-source transformation

It failed only in scripts/verify-automatic-pipeline-v1.mjs because the
static verifier recursively scanned all of apps/web, including stale Next.js
build output under apps/web/.next/dev/server/chunks.

The stale bundle still contained:
  /personal/upcoming/refresh

That is not source code and must not be treated as proof that the user-facing
frontend still calls the manual endpoint.

V1.6 fix
========
The static verifier now scans only frontend source/runtime-development areas:
- apps/web/app
- apps/web/components
- apps/web/lib
- apps/web/tests
- apps/web/next.config.ts
- apps/web/eslint.config.mjs
- apps/web/next-env.d.ts

Build/generated directories are excluded from the source contract:
- .next
- node_modules
- coverage
- dist
- build
- .turbo

The source checks remain strict:
- direct API-Football calls from frontend source still fail
- window.location.reload() in frontend source still fails
- /personal/upcoming/refresh in frontend source still fails

Architecture unchanged
======================
No production architecture from V1.5 was changed.
The V1.5 transformer logic that already passed on the user's exact local files
is retained. Only revision labels were updated.

No Prisma schema migration is introduced.
The installer still backs up all pre-existing touched files byte-for-byte,
therefore the already-verified O/U V11 changes are preserved on rollback.

Run
===
Place these files in the repository root:
- predictionai-automatic-pipeline-v1.6-stable.patch
- predictionai-automatic-pipeline-v1.6-transform.mjs
- apply-predictionai-automatic-pipeline-v1.6.ps1

Then run:

powershell -ExecutionPolicy Bypass -File .\apply-predictionai-automatic-pipeline-v1.6.ps1

Do not run V1 through V1.5 installers again.

Expected progression:
Transformer preflight PASS
Stable apply PASS
Static contract PASS
Prisma generate PASS
npm run verify:
  typecheck
  tests
  lint
  production build

If verification fails later, the installer restores the exact pre-upgrade
V11/current source state and leaves database schema unchanged.
