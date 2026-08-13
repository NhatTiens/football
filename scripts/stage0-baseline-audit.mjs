import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return (result.stdout ?? '').trim();
}
const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
const presentFiles = files.filter((file) => fs.existsSync(file));
const transient = presentFiles.filter((file) => {
  const value = file.replace(/\\/g, '/');
  return value === 'payload' || value.startsWith('payload/') || /^football-v7-/i.test(value) || /\.tsbuildinfo$/i.test(value) || /(?:^|\/)\.[^/]*(?:backup|broken)/i.test(value) || /-backup-/i.test(value) || /(?:^|\/)[^/]+\.before-/i.test(value) || /\.bak(?:$|-)/i.test(value) || value === '{console.error(e)';
});
const required = [
  'packages/sync/src/paper-ou-model-selection-core.ts',
  'packages/sync/src/paper-ou-opposite-line-core.ts',
  'packages/sync/src/ou-legacy-history-replay-core.ts',
  'packages/sync/tests/ou-direct-model-selection.test.ts',
  'packages/sync/tests/paper-ou-model-selection-core.test.ts',
  'packages/sync/tests/ou-legacy-history-replay.test.ts',
  'scripts/security/scan-tracked-secrets.mjs',
  'docs/STAGE0_CURRENT_CHAMPION.md',
];
const missing = required.filter((file) => !fs.existsSync(file));
const ruleTest = fs.readFileSync('packages/sync/tests/paper-ou-model-selection-core.test.ts', 'utf8');
const ruleContractOk =
  ruleTest.includes("['OVER', 2.5]") &&
  ruleTest.includes("recommendedSelection: predictionSelection") &&
  ruleTest.includes('lineShiftGoals: 0');
console.log(JSON.stringify({
  stage: 0,
  branch: git(['branch', '--show-current']),
  head: git(['rev-parse', 'HEAD']),
  trackedFiles: presentFiles.length,
  transientTrackedFiles: transient.length,
  missingRequiredFiles: missing,
  ouDirectModelRuleContract: ruleContractOk,
}, null, 2));
if (transient.length || missing.length || !ruleContractOk) process.exit(1);
