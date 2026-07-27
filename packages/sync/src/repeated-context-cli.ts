import { syncRepeatedFixtureContext } from './repeated-context.js';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

const horizons = (argument('horizons') ?? '90,30,5')
  .split(',')
  .map(Number)
  .filter(
    (value) => Number.isFinite(value) && value >= 1,
  )
  .map(Math.floor);

const maximum = Number(argument('max-fixtures') ?? '4');

const summary = await syncRepeatedFixtureContext({
  horizonsMinutes: horizons,
  maximumFixturesPerRun:
    Number.isFinite(maximum) && maximum > 0
      ? Math.floor(maximum)
      : 4,
});

console.log(
  JSON.stringify(
    {
      version: 'v7.5-horizon-data-intelligence-r5',
      ...summary,
    },
    null,
    2,
  ),
);
