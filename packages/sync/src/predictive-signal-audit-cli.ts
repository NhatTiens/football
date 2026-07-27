import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FixtureStatus, prisma } from '@football-ai/database';
import { getScientificFixtureAnalysis } from './scientific-features.js';
import {
  aucStrength,
  mean,
  pearsonCorrelation,
  rankAuc,
  standardDeviation,
  summarizeHorizonSensitivity,
  type HorizonVector,
} from './predictive-signal-audit.js';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}
function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}
function horizons(value: string | undefined): number[] {
  return (value ?? '90,30,5').split(',').map(Number).filter((x) => Number.isFinite(x) && x >= 5).map(Math.floor);
}
function formatPercent(value: number | null): string {
  return value == null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}
function formatNumber(value: number | null, digits = 4): string {
  return value == null ? 'n/a' : value.toFixed(digits);
}

const fixtureLimit = Math.min(2000, Math.max(50, integer(argument('limit'), 300)));
const requestedHorizons = horizons(argument('horizons'));
const leagueIdValue = integer(argument('league-id'), 0);
const leagueId = leagueIdValue > 0 ? leagueIdValue : undefined;

const fixtures = await prisma.fixture.findMany({
  where: {
    status: FixtureStatus.FINISHED,
    homeGoals: { not: null },
    awayGoals: { not: null },
    ...(leagueId ? { leagueId } : {}),
  },
  select: {
    id: true,
    leagueId: true,
    kickoffAt: true,
    homeGoals: true,
    awayGoals: true,
    homeTeamId: true,
    awayTeamId: true,
    homeTeam: { select: { name: true } },
    awayTeam: { select: { name: true } },
  },
  orderBy: { kickoffAt: 'desc' },
  take: fixtureLimit,
});

type Row = {
  fixtureId: number;
  horizonMinutes: number;
  features: number[];
  featureNames: readonly string[];
  totalGoals: number;
  goalDifference: number;
  over15: boolean;
  over25: boolean;
  over35: boolean;
  btts: boolean;
  homeWin: boolean;
  draw: boolean;
  awayWin: boolean;
  dataQuality: number;
  model: boolean;
  marketMovement: boolean;
  lineup: boolean;
  injury: boolean;
  horizonVector: HorizonVector;
};

const rows: Row[] = [];
const errors: Array<{ fixtureId: number; horizonMinutes: number; message: string }> = [];

for (const fixture of fixtures) {
  if (fixture.homeGoals == null || fixture.awayGoals == null) continue;
  for (const horizonMinutes of requestedHorizons) {
    const predictionAsOf = new Date(fixture.kickoffAt.getTime() - horizonMinutes * 60_000);
    try {
      const analysis = await getScientificFixtureAnalysis({
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        homeTeamName: fixture.homeTeam.name,
        awayTeamName: fixture.awayTeam.name,
        kickoffAt: fixture.kickoffAt,
        predictionAsOf,
        mode: 'BACKTEST',
        useMachineLearning: true,
      });
      const totalGoals = fixture.homeGoals + fixture.awayGoals;
      const probabilities = {
        hdaHome: analysis.threeMarket.hda.probabilities.HOME,
        hdaDraw: analysis.threeMarket.hda.probabilities.DRAW,
        hdaAway: analysis.threeMarket.hda.probabilities.AWAY,
        over15: analysis.threeMarket.totals[1.5].probabilities.OVER,
        over25: analysis.threeMarket.totals[2.5].probabilities.OVER,
        over35: analysis.threeMarket.totals[3.5].probabilities.OVER,
        btts: analysis.threeMarket.btts.probabilities.YES,
      };
      const horizonVector: HorizonVector = {
        fixtureId: fixture.id,
        horizonMinutes,
        features: [...analysis.featureVector],
        probabilities,
        coverage: {
          model: analysis.modelPrediction != null,
          marketMovement: analysis.marketMovement.available,
          lineup: analysis.lineupAnalysis.available,
          injury: analysis.injuries.coverageAvailable,
        },
      };
      rows.push({
        fixtureId: fixture.id,
        horizonMinutes,
        features: [...analysis.featureVector],
        featureNames: analysis.featureNames,
        totalGoals,
        goalDifference: fixture.homeGoals - fixture.awayGoals,
        over15: totalGoals > 1.5,
        over25: totalGoals > 2.5,
        over35: totalGoals > 3.5,
        btts: fixture.homeGoals > 0 && fixture.awayGoals > 0,
        homeWin: fixture.homeGoals > fixture.awayGoals,
        draw: fixture.homeGoals === fixture.awayGoals,
        awayWin: fixture.homeGoals < fixture.awayGoals,
        dataQuality: analysis.dataQualityScore,
        model: analysis.modelPrediction != null,
        marketMovement: analysis.marketMovement.available,
        lineup: analysis.lineupAnalysis.available,
        injury: analysis.injuries.coverageAvailable,
        horizonVector,
      });
    } catch (error) {
      if (errors.length < 50) {
        errors.push({
          fixtureId: fixture.id,
          horizonMinutes,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

const primaryHorizon = requestedHorizons.includes(30) ? 30 : requestedHorizons[0]!;
const primaryRows = rows.filter((row) => row.horizonMinutes === primaryHorizon);
const featureNames = primaryRows[0]?.featureNames ?? [];
const featureSignals = featureNames.map((name, index) => {
  const values = primaryRows.map((row) => row.features[index] ?? 0);
  const uniqueRounded = new Set(values.map((value) => value.toFixed(6))).size;
  const auc = (labels: boolean[]) => rankAuc(values, labels);
  return {
    index,
    name,
    mean: mean(values),
    standardDeviation: standardDeviation(values),
    uniqueRounded,
    constant: (standardDeviation(values) ?? 0) < 1e-8,
    totalGoalsCorrelation: pearsonCorrelation(values, primaryRows.map((row) => row.totalGoals)),
    goalDifferenceCorrelation: pearsonCorrelation(values, primaryRows.map((row) => row.goalDifference)),
    over15Auc: auc(primaryRows.map((row) => row.over15)),
    over25Auc: auc(primaryRows.map((row) => row.over25)),
    over35Auc: auc(primaryRows.map((row) => row.over35)),
    bttsAuc: auc(primaryRows.map((row) => row.btts)),
    homeWinAuc: auc(primaryRows.map((row) => row.homeWin)),
    drawAuc: auc(primaryRows.map((row) => row.draw)),
    awayWinAuc: auc(primaryRows.map((row) => row.awayWin)),
  };
}).map((feature) => ({
  ...feature,
  strongestBinaryAucStrength: Math.max(
    ...[feature.over15Auc, feature.over25Auc, feature.over35Auc, feature.bttsAuc]
      .map(aucStrength)
      .filter((value): value is number => value != null),
    0.5,
  ),
}));

const horizonVectors = rows.map((row) => row.horizonVector);
const horizonSensitivity = summarizeHorizonSensitivity(horizonVectors, requestedHorizons);

const coverageByHorizon = requestedHorizons.map((horizonMinutes) => {
  const selected = rows.filter((row) => row.horizonMinutes === horizonMinutes);
  const ratio = (selector: (row: Row) => boolean) =>
    selected.length > 0 ? selected.filter(selector).length / selected.length : null;
  return {
    horizonMinutes,
    rows: selected.length,
    modelCoverage: ratio((row) => row.model),
    marketMovementCoverage: ratio((row) => row.marketMovement),
    lineupCoverage: ratio((row) => row.lineup),
    injuryCoverage: ratio((row) => row.injury),
    averageDataQuality: mean(selected.map((row) => row.dataQuality)),
  };
});

const prevalence = {
  over15: mean(primaryRows.map((row) => row.over15 ? 1 : 0)),
  over25: mean(primaryRows.map((row) => row.over25 ? 1 : 0)),
  over35: mean(primaryRows.map((row) => row.over35 ? 1 : 0)),
  btts: mean(primaryRows.map((row) => row.btts ? 1 : 0)),
  homeWin: mean(primaryRows.map((row) => row.homeWin ? 1 : 0)),
  draw: mean(primaryRows.map((row) => row.draw ? 1 : 0)),
  awayWin: mean(primaryRows.map((row) => row.awayWin ? 1 : 0)),
};

const issues: string[] = [];
const constants = featureSignals.filter((feature) => feature.constant);
if (constants.length > 0) {
  issues.push(`Constant features at T-${primaryHorizon}: ${constants.map((feature) => feature.name).join(', ')}.`);
}
for (const pair of horizonSensitivity) {
  if ((pair.featureChangeCoverage ?? 0) < 0.1) {
    issues.push(
      `Only ${formatPercent(pair.featureChangeCoverage)} of fixtures change feature vectors from T-${pair.leftHorizon} to T-${pair.rightHorizon}; horizon specialization is data-limited.`,
    );
  }
}
const coverage30 = coverageByHorizon.find((entry) => entry.horizonMinutes === primaryHorizon);
if ((coverage30?.lineupCoverage ?? 0) < 0.2) {
  issues.push(`Confirmed/projected lineup coverage at T-${primaryHorizon} is only ${formatPercent(coverage30?.lineupCoverage ?? null)}.`);
}
if ((coverage30?.marketMovementCoverage ?? 0) < 0.2) {
  issues.push(`Market-movement coverage at T-${primaryHorizon} is only ${formatPercent(coverage30?.marketMovementCoverage ?? null)}.`);
}
if ((coverage30?.injuryCoverage ?? 0) < 0.2) {
  issues.push(`Injury coverage at T-${primaryHorizon} is only ${formatPercent(coverage30?.injuryCoverage ?? null)}.`);
}

const strongest = [...featureSignals]
  .filter((feature) => !feature.constant)
  .sort((a, b) => b.strongestBinaryAucStrength - a.strongestBinaryAucStrength)
  .slice(0, 10);

const summary = {
  version: 'v7.4-predictive-signal-audit-r4',
  generatedAt: new Date().toISOString(),
  options: {
    fixtureLimit,
    horizons: requestedHorizons,
    primaryHorizon,
    leagueId: leagueId ?? null,
  },
  fixturesLoaded: fixtures.length,
  analyses: rows.length,
  errors,
  prevalence,
  coverageByHorizon,
  horizonSensitivity,
  featureSignals,
  strongestFeatures: strongest,
  issues,
  readiness:
    issues.some((issue) => issue.includes('horizon specialization')) ? 'DATA_LIMITED' : 'READY_FOR_MODEL_CHALLENGER',
};

const outputDir = resolve(process.cwd(), 'artifacts', 'predictive-signal-audit-r4', summary.generatedAt.replace(/[:.]/g, '-'));
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(`Predictive Signal Audit R4`);
console.log(`Fixtures=${summary.fixturesLoaded}; analyses=${summary.analyses}; errors=${errors.length}`);
console.log(`Primary horizon=T-${primaryHorizon}`);
console.log(`Prevalence: O1.5=${formatPercent(prevalence.over15)} O2.5=${formatPercent(prevalence.over25)} O3.5=${formatPercent(prevalence.over35)} BTTS=${formatPercent(prevalence.btts)}`);
console.log(`\nCoverage`);
for (const entry of coverageByHorizon) {
  console.log(
    `T-${entry.horizonMinutes}: ML=${formatPercent(entry.modelCoverage)} market=${formatPercent(entry.marketMovementCoverage)} lineup=${formatPercent(entry.lineupCoverage)} injury=${formatPercent(entry.injuryCoverage)} dataQ=${formatPercent(entry.averageDataQuality)}`,
  );
}
console.log(`\nHorizon sensitivity`);
for (const pair of horizonSensitivity) {
  console.log(
    `T-${pair.leftHorizon}→T-${pair.rightHorizon}: featureChanged=${formatPercent(pair.featureChangeCoverage)} featureL1=${formatNumber(pair.averageFeatureL1Delta, 6)} probabilityChanged=${formatPercent(pair.probabilityChangeCoverage)} probL1=${formatNumber(pair.averageProbabilityL1Delta, 6)}`,
  );
}
console.log(`\nTop feature signals @ T-${primaryHorizon}`);
for (const feature of strongest) {
  console.log(
    `${String(feature.index).padStart(2)} ${feature.name.padEnd(26)} std=${formatNumber(feature.standardDeviation)} aucStrength=${formatNumber(feature.strongestBinaryAucStrength)} totalCorr=${formatNumber(feature.totalGoalsCorrelation)} goalDiffCorr=${formatNumber(feature.goalDifferenceCorrelation)}`,
  );
}
if (constants.length > 0) {
  console.log(`\nConstant features: ${constants.map((feature) => feature.name).join(', ')}`);
}
console.log(`\nReadiness=${summary.readiness}`);
for (const issue of issues) console.log(`- ${issue}`);
console.log(`Artifact=${outputDir}`);
