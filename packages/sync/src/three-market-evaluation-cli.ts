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
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}
function horizons(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const values = value.split(',').map(Number).filter((x) => Number.isFinite(x) && x >= 5).map(Math.floor);
  return values.length ? values : undefined;
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
const outputDir = resolve(process.cwd(), 'artifacts', 'three-market-evaluation-r3', stamp);
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(`Three-market evaluation R3`);
console.log(`Fixtures=${summary.fixturesLoaded}; successful=${summary.successfulAnalyses}; failed=${summary.failedAnalyses}`);
for (const horizon of summary.horizons) {
  console.log(`\nT-${horizon.horizonMinutes} rows=${horizon.fixtureRows} ML=${horizon.mlCoverage == null ? 'n/a' : (horizon.mlCoverage*100).toFixed(1)+'%'}`);
  for (const [market, result] of Object.entries(horizon.markets)) {
    const m = result.candidate;
    const s = result.selective;
    const baseline = result.majorityBaselineAccuracy;
    const skill = result.accuracySkillVsMajority;
    console.log(
      `${market.padEnd(5)} acc=${m.accuracy == null ? 'n/a' : (m.accuracy*100).toFixed(2)+'%'} ` +
      `majority=${baseline == null ? 'n/a' : (baseline*100).toFixed(2)+'%'} ` +
      `skill=${skill == null ? 'n/a' : (skill*100).toFixed(2)+'pp'} ` +
      `brier=${m.brier?.toFixed(4) ?? 'n/a'} logloss=${m.logLoss?.toFixed(4) ?? 'n/a'} ECE=${m.ece?.toFixed(4) ?? 'n/a'} ` +
      `| HM=${s.releasedRows}/${s.totalRows} hit=${s.hitRate == null ? 'n/a' : (s.hitRate*100).toFixed(2)+'%'} Wilson=${s.wilsonLower95 == null ? 'n/a' : (s.wilsonLower95*100).toFixed(2)+'%'}`
    );
  }
}
console.log(`\nReadiness=${summary.readiness}`);
console.log(`Artifact=${outputDir}`);
