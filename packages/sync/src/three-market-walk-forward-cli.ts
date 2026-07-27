import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';
import { SCIENTIFIC_MODEL_KEY, type ScientificModelArtifact } from './scientific-model.js';
import { trainScientificModel } from './scientific-sync.js';
import { evaluateThreeMarketSpecialists } from './three-market-evaluation-engine.js';

function arg(name: string, fallback: number): number {
  const raw = process.argv.slice(2).find((v) => v.startsWith(`--${name}=`))?.split('=')[1];
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}
const horizons = (process.argv.slice(2).find((v) => v.startsWith('--horizons='))?.split('=')[1] ?? '90,30,5')
  .split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 5).map(Math.floor);
const minimumTraining = Math.max(100, arg('min-train', 250));
const testPerFold = Math.max(25, arg('test-per-fold', 100));
const maximumFolds = Math.max(1, arg('folds', 3));
const leagueIdRaw = arg('league-id', 0);
const leagueId = leagueIdRaw > 0 ? leagueIdRaw : undefined;

const fixtures = await prisma.fixture.findMany({
  where: {
    status: FixtureStatus.FINISHED,
    homeGoals: { not: null },
    awayGoals: { not: null },
    ...(leagueId ? { leagueId } : {}),
  },
  select: { id: true, kickoffAt: true },
  orderBy: { kickoffAt: 'asc' },
});
if (fixtures.length < minimumTraining + testPerFold) {
  throw new Error(`Need >= ${minimumTraining + testPerFold} finished fixtures, found ${fixtures.length}.`);
}

const original = await prisma.appSetting.findUnique({ where: { key: SCIENTIFIC_MODEL_KEY } });
const foldResults: unknown[] = [];

try {
  for (const horizonMinutes of horizons) {
    let trainingCount = minimumTraining;
    for (let fold = 1; fold <= maximumFolds && trainingCount < fixtures.length; fold += 1) {
      const trainThrough = fixtures[trainingCount - 1]!.kickoffAt;
      let start = trainingCount;
      while (
        start < fixtures.length &&
        fixtures[start]!.kickoffAt.getTime() - horizonMinutes * 60_000 <= trainThrough.getTime()
      ) start += 1;
      if (start >= fixtures.length) break;
      const end = Math.min(fixtures.length, start + testPerFold);
      const testFrom = fixtures[start]!.kickoffAt;
      const testTo = new Date(fixtures[end - 1]!.kickoffAt.getTime() + 1);
      const trainedAt = new Date(trainThrough.getTime() + 1);

      const train = await trainScientificModel({
        limit: trainingCount,
        through: trainThrough,
        ...(leagueId ? { leagueId } : {}),
        trainedAt,
        purpose: `r3-ou-walk-forward-t${horizonMinutes}-f${fold}`,
        noPromote: true,
      });
      const setting = await prisma.appSetting.findUnique({ where: { key: SCIENTIFIC_MODEL_KEY } });
      const artifact = setting?.value as unknown as ScientificModelArtifact | undefined;
      if (!artifact || new Date(artifact.trainedAt).getTime() > testFrom.getTime() - horizonMinutes * 60_000) {
        throw new Error(`Fold ${fold} T-${horizonMinutes}: historical artifact is not prediction-time eligible.`);
      }

      const evaluation = await evaluateThreeMarketSpecialists({
        from: testFrom,
        to: testTo,
        ...(leagueId ? { leagueId } : {}),
        fixtureLimit: testPerFold,
        horizons: [horizonMinutes],
        useMachineLearning: true,
        minimumSelectiveRows: 10,
      });
      const h = evaluation.horizons[0]!;
      console.log(`T-${horizonMinutes} fold=${fold} train=${trainingCount} test=${h.fixtureRows} ML=${h.mlCoverage == null ? 'n/a' : (h.mlCoverage*100).toFixed(1)+'%'}`);
      for (const key of ['O1.5','O2.5','O3.5','BTTS','HDA'] as const) {
        const m = h.markets[key];
        console.log(`  ${key}: acc=${m.candidate.accuracy == null ? 'n/a' : (m.candidate.accuracy*100).toFixed(2)+'%'} skill=${m.accuracySkillVsMajority == null ? 'n/a' : (m.accuracySkillVsMajority*100).toFixed(2)+'pp'} HM=${m.selective.releasedRows} hit=${m.selective.hitRate == null ? 'n/a' : (m.selective.hitRate*100).toFixed(2)+'%'}`);
      }
      foldResults.push({ horizonMinutes, fold, trainingCount, trainThrough, testFrom, testTo, train, evaluation });
      trainingCount = end;
    }
  }
} finally {
  if (original) {
    await prisma.appSetting.upsert({
      where: { key: SCIENTIFIC_MODEL_KEY },
      update: { value: original.value as InputJsonValue },
      create: { key: SCIENTIFIC_MODEL_KEY, value: original.value as InputJsonValue },
    });
  } else {
    await prisma.appSetting.deleteMany({ where: { key: SCIENTIFIC_MODEL_KEY } });
  }
}

const generatedAt = new Date().toISOString();
const outputDir = resolve(process.cwd(), 'artifacts', 'three-market-walk-forward-r3', generatedAt.replace(/[:.]/g, '-'));
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'summary.json'), JSON.stringify({ version: 'v7.3-ou-specialist-r3', generatedAt, horizons, minimumTraining, testPerFold, maximumFolds, leagueId: leagueId ?? null, folds: foldResults }, null, 2));
console.log(`\nR3 WALK-FORWARD COMPLETE. Production model restored.`);
console.log(`Artifact=${outputDir}`);
