import {
  discoverEarlyPrematchOdds,
  getEarlyOddsCoverage,
} from './early-odds-discovery.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'coverage';

  if (command === 'tick') {
    console.log(
      JSON.stringify(
        await discoverEarlyPrematchOdds(new Date()),
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'coverage') {
    console.log(
      JSON.stringify(
        await getEarlyOddsCoverage(new Date()),
        null,
        2,
      ),
    );
    return;
  }

  throw new Error(
    `Unknown early odds command: ${command}. Use tick or coverage.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
