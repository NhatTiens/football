import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return (result.stdout ?? '').trim();
}
const files = git(['ls-files', '-z']).split('\0').filter(Boolean);
const transient = files.filter((file) => {
  const value = file.replace(/\\/g, '/');
  return value === 'payload' || value.startsWith('payload/') || /^football-v7-/i.test(value) || /\.tsbuildinfo$/i.test(value) || /(?:^|\/)\.[^/]*(?:backup|broken)/i.test(value) || /-backup-/i.test(value) || /^package\.json\.before-/i.test(value);
});
const required = [
  'packages/sync/src/paper-ou-opposite-line-core.ts',
  'packages/sync/src/ou-legacy-history-replay-core.ts',
  'packages/sync/tests/ou-half-goal-rule.test.ts',
  'packages/sync/tests/paper-ou-opposite-line-core.test.ts',
  'packages/sync/tests/ou-legacy-history-replay.test.ts',
  'scripts/security/scan-tracked-secrets.mjs',
  'docs/STAGE0_CURRENT_CHAMPION.md',
];
const missing = required.filter((file) => !fs.existsSync(file));
const ruleTest = fs.readFileSync('packages/sync/tests/paper-ou-opposite-line-core.test.ts', 'utf8');
const ruleContractOk = ruleTest.includes("['OVER', 2.5, 'UNDER', 3, false, 0.5]") && ruleTest.includes("['UNDER', 2.5, 'OVER', 2, false, 0.5]");
console.log(JSON.stringify({
  stage: 0,
  branch: git(['branch', '--show-current']),
  head: git(['rev-parse', 'HEAD']),
  trackedFiles: files.length,
  transientTrackedFiles: transient.length,
  missingRequiredFiles: missing,
  ouHalfGoalRuleContract: ruleContractOk,
}, null, 2));
if (transient.length || missing.length || !ruleContractOk) process.exit(1);
