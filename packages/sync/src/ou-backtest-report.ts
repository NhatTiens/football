import { prisma } from '@football-ai/database';
import {
  backtestByCompositeSlice,
  backtestByLeague,
  backtestByMarket,
  backtestByModelVersion,
  backtestByOddsRange,
  backtestBySeason,
  backtestByTimePeriod,
  buildCalibrationReport,
  calculateBacktestMetrics,
  OU_ENGINE_VERSION,
  type CalibrationObservation,
  type OuBacktestRow,
} from '@football-ai/engine';

const OU_MARKETS = ['TOTAL_GOALS_1_5', 'TOTAL_GOALS_2_5', 'TOTAL_GOALS_3_5'] as const;
type OuMarket = (typeof OU_MARKETS)[number];

interface PaperDecisionRow {
  id: number;
  localFixtureId: number | null;
  providerFixtureId: number;
  decisionAsOf: Date;
  selectedMarket: string | null;
  selectedSelection: string | null;
  decimalOdds: number | null;
  modelProbability: number | null;
  expectedValue: number | null;
  modelVersion: string;
  settlement: {
    result: string;
    profitUnits: number;
    stakeUnits: number;
    closingDecimalOdds: number | null;
    clv: number | null;
  } | null;
}
interface FixtureMetaRow {
  id: number;
  league: { name: string; season: number };
}

function isOuMarket(value: string | null): value is OuMarket {
  return value != null && (OU_MARKETS as readonly string[]).includes(value);
}
function marketLabel(market: OuMarket, selection: string | null): string {
  const line = market === 'TOTAL_GOALS_1_5' ? '1.5' : market === 'TOTAL_GOALS_2_5' ? '2.5' : '3.5';
  return `${selection === 'OVER' ? 'O' : 'U'}${line}`;
}

export async function buildOuBacktestReport(): Promise<Record<string, unknown>> {
  const decisions = (await prisma.scientificPaperBetDecision.findMany({
    where: {
      decisionType: 'BEST_BET',
      selectedMarket: { in: [...OU_MARKETS] },
      settlement: { isNot: null },
    },
    select: {
      id: true,
      localFixtureId: true,
      providerFixtureId: true,
      decisionAsOf: true,
      selectedMarket: true,
      selectedSelection: true,
      decimalOdds: true,
      modelProbability: true,
      expectedValue: true,
      modelVersion: true,
      settlement: {
        select: {
          result: true,
          profitUnits: true,
          stakeUnits: true,
          closingDecimalOdds: true,
          clv: true,
        },
      },
    },
    orderBy: { decisionAsOf: 'asc' },
  })) as PaperDecisionRow[];

  const localFixtureIds = [...new Set(decisions.flatMap((row) => row.localFixtureId == null ? [] : [row.localFixtureId]))];
  const fixtureRows = localFixtureIds.length === 0
    ? []
    : (await prisma.fixture.findMany({
        where: { id: { in: localFixtureIds } },
        select: { id: true, league: { select: { name: true, season: true } } },
      })) as FixtureMetaRow[];
  const fixtureById = new Map(fixtureRows.map((row): [number, FixtureMetaRow] => [row.id, row]));

  const rows: OuBacktestRow[] = [];
  const calibrationByMarket = new Map<string, CalibrationObservation[]>();
  for (const decision of decisions) {
    if (!isOuMarket(decision.selectedMarket) || decision.decimalOdds == null || decision.modelProbability == null || decision.settlement == null) continue;
    if (decision.settlement.result !== 'WIN' && decision.settlement.result !== 'LOSS') continue;
    const fixture = decision.localFixtureId == null ? null : fixtureById.get(decision.localFixtureId) ?? null;
    const market = marketLabel(decision.selectedMarket, decision.selectedSelection);
    const actualWin = decision.settlement.result === 'WIN';
    rows.push({
      market,
      odds: decision.decimalOdds,
      predictedProbability: decision.modelProbability,
      actualWin,
      league: fixture?.league.name ?? 'UNKNOWN',
      season: fixture == null ? 'UNKNOWN' : String(fixture.league.season),
      occurredAt: decision.decisionAsOf,
      stake: decision.settlement.stakeUnits,
      realizedProfit: decision.settlement.profitUnits,
      ...(decision.expectedValue == null ? {} : { expectedValue: decision.expectedValue }),
      predictionOdds: decision.decimalOdds,
      closingOdds: decision.settlement.closingDecimalOdds,
      modelVersion: decision.modelVersion,
    });
    const observations = calibrationByMarket.get(market) ?? [];
    observations.push({ probability: decision.modelProbability, actual: actualWin });
    calibrationByMarket.set(market, observations);
  }

  return {
    generatedAt: new Date().toISOString(),
    engineVersion: OU_ENGINE_VERSION,
    evidenceClass: 'SETTLED_PAPER_BETS_ONLY',
    sampleSize: rows.length,
    overall: calculateBacktestMetrics(rows),
    byMarket: backtestByMarket(rows),
    byOddsRange: backtestByOddsRange(rows),
    byLeague: backtestByLeague(rows),
    bySeason: backtestBySeason(rows),
    byModelVersion: backtestByModelVersion(rows),
    byTimePeriod: backtestByTimePeriod(rows),
    byQuarter: backtestByTimePeriod(rows, 'QUARTER'),
    byComposite: backtestByCompositeSlice(rows),
    modelVersions: Object.fromEntries(
      [...new Set(rows.map((row) => row.modelVersion ?? 'UNKNOWN'))]
        .sort()
        .map((version) => [version, rows.filter((row) => (row.modelVersion ?? 'UNKNOWN') === version).length]),
    ),
    calibrationByMarket: Object.fromEntries(
      [...calibrationByMarket.entries()].map(([market, observations]) => [market, buildCalibrationReport(observations)]),
    ),
  };
}

async function main(): Promise<void> {
  const report = await buildOuBacktestReport();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/ou-backtest-report.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
