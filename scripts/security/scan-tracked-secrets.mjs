import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const result = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', shell: false });
if (result.status !== 0) process.exit(result.status ?? 1);
const files = (result.stdout ?? '').split('\0').filter(Boolean);
const findings = [];
const placeholder = /(test|example|placeholder|changeme|your[-_]|dummy|sample|redacted)/i;

for (const file of files) {
  const normalized = file.replace(/\\/g, '/');
  const base = path.basename(normalized);
  if (/^\.env(?:$|\.)/i.test(base) && !/example/i.test(base)) {
    findings.push({ file, rule: 'TRACKED_ENV_FILE' });
    continue;
  }
  const absolute = path.join(root, file);
  let stat;
  try { stat = fs.statSync(absolute); } catch { continue; }
  if (!stat.isFile() || stat.size > 1_000_000) continue;
  let content;
  try { content = fs.readFileSync(absolute, 'utf8'); } catch { continue; }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) {
    findings.push({ file, rule: 'PRIVATE_KEY_MATERIAL' });
  }
  const patterns = [
    ['API_FOOTBALL_KEY', /API_FOOTBALL_KEY\s*[:=]\s*["']?([A-Za-z0-9_-]{16,})/g],
    ['ADMIN_API_TOKEN', /ADMIN_API_TOKEN\s*[:=]\s*["']?([A-Za-z0-9_.-]{16,})/g],
    ['GITHUB_TOKEN', /(?:ghp|github_pat)_[A-Za-z0-9_]{20,}/g],
  ];
  for (const [rule, regex] of patterns) {
    for (const match of content.matchAll(regex)) {
      const value = match[1] ?? match[0];
      if (!placeholder.test(value)) findings.push({ file, rule });
    }
  }
}

const unique = [...new Map(findings.map((item) => [item.file + ':' + item.rule, item])).values()];
if (unique.length > 0) {
  console.error('Tracked secret scan: FAIL');
  for (const item of unique) console.error('- ' + item.file + ' [' + item.rule + ']');
  console.error('Secret values are intentionally not printed.');
  process.exit(1);
}
console.log('Tracked secret scan: PASS');
