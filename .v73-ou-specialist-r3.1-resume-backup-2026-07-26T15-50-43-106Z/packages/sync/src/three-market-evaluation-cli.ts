import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateThreeMarketSpecialists } from './three-market-evaluation-engine.js';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function booleanFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function integer(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function horizons(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const parsed = value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 5)
    .map((item) => Math.floor(item));
  return parsed.length > 0 ? parsed : undefined;
}

const summary = await evaluateThreeMarketSpecialists({
  from: argument('from'),
  to: argument('to'),
  leagueId: integer(argument('league-id')),
  fixtureLimit: integer(argument('limit')),
  horizons: horizons(argument('horizons')),
  minimumSelectiveRows: integer(argument('min-selective')),
  useMachineLearning: !booleanFlag('core-only'),
});

const stamp = summary.generatedAt.replace(/[:.]/g, '-');
const outputDir = resolve(process.cwd(), 'artifacts', 'three-market-evaluation', stamp);
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(`Three-market evaluation: ${summary.version}`);
console.log(`Fixtures: ${summary.fixturesLoaded}; successful analyses: ${summary.successfulAnalyses}; failed: ${summary.failedAnalyses}`);
for (const horizon of summary.horizons) {
  console.log(`\nT-${horizon.horizonMinutes} | rows=${horizon.fixtureRows} | ML coverage=${horizon.mlCoverage == null ? 'n/a' : `${(horizon.mlCoverage * 100).toFixed(1)}%`}`);
  for (const [market, result] of Object.entries(horizon.markets)) {
    const metrics = result.candidate;
    const selective = result.selective;
    console.log(
      `${market.padEnd(5)} accuracy=${metrics.accuracy == null ? 'n/a' : (metrics.accuracy * 100).toFixed(2) + '%'} ` +
        `brier=${metrics.brier?.toFixed(4) ?? 'n/a'} logloss=${metrics.logLoss?.toFixed(4) ?? 'n/a'} ` +
        `ECE=${metrics.ece?.toFixed(4) ?? 'n/a'} | HIGH/MEDIUM ${selective.releasedRows}/${selective.totalRows} ` +
        `hit=${selective.hitRate == null ? 'n/a' : (selective.hitRate * 100).toFixed(2) + '%'} ` +
        `Wilson95=${selective.wilsonLower95 == null ? 'n/a' : (selective.wilsonLower95 * 100).toFixed(2) + '%'}`,
    );
  }
}

if (summary.bestMarket) {
  console.log(
    `\nBEST: ${summary.bestMarket.market} @ T-${summary.bestMarket.horizonMinutes} ` +
      `hit=${(summary.bestMarket.hitRate * 100).toFixed(2)}% ` +
      `coverage=${(summary.bestMarket.coverage * 100).toFixed(2)}% ` +
      `Wilson95=${(summary.bestMarket.wilsonLower95 * 100).toFixed(2)}% ` +
      `n=${summary.bestMarket.releasedRows}`,
  );
} else {
  console.log('\nBEST: none (insufficient selective sample).');
}
console.log(`Readiness: ${summary.readiness}`);
for (const reason of summary.readinessReasons) console.log(`- ${reason}`);
console.log(`Artifact: ${outputDir}`);
