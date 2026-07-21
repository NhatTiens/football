import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');

function parseEnv(source) {
  const result = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-with-env.mjs <command> [...args]');
  process.exit(1);
}

const fileEnvironment = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
const environment = { ...fileEnvironment, ...process.env };
const child = spawn(args[0], args.slice(1), {
  cwd: root,
  env: environment,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
