import { spawn } from 'node:child_process';

const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const child = spawn(
  npmExecutable,
  ['run', 'dev', '-w', '@football-ai/worker'],
  {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      DEV_SCIENCE_OWNS_PROVIDER_SYNC: 'true',
    },
  },
);

function forward(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));

child.on('error', (error) => {
  console.error('[dev-worker-with-science] failed to start worker', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal != null) {
    process.exitCode = 0;
    return;
  }

  process.exitCode = code ?? 0;
});
