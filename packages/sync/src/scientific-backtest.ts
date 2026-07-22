import {
  BacktestStatus,
  FixtureStatus,
  prisma,
  SettlementResult,
  type InputJsonValue,
} from '@football-ai/database';
import { profitForSettlement, settleSelection } from '@football-ai/engine';
import { getScientificFixtureAnalysis } from './scientific-features.js';
import {
  buildScientificCandidates,
  latestScientificOddsRows,
} from './scientific-recommendations.js';
import { SCIENTIFIC_MODEL_VERSION } from './scientific-model.js';

export interface ScientificBacktestOptions {
  name?: string;
  leagueId?: number;
  from?: Date | string;
  to?: Date | string;
  fixtureLimit?: number;
  stakeUnits?: number;
}

function parseDate(value: Date | string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid scientific backtest date: ${String(value)}`);
  }
  return parsed;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximumDrawdown(profits: number[]): number {
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  for (const profit of profits) {
    equity += profit;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
  }
  return drawdown;
}

export async function runScientificBacktest(
  options: ScientificBacktestOptions = {},
) {
  const now = new Date();
  const dateFrom = parseDate(
    options.from ?? process.env.BACKTEST_FROM,
    new Date(now.getTime() - 730 * 86_400_000),
  );
  const dateTo = parseDate(options.to ?? process.env.BACKTEST_TO, now);
  const fixtureLimit = Math.min(
    5000,
    Math.max(
      1,
      options.fixtureLimit ??
        Number(process.env.BACKTEST_FIXTURE_LIMIT ?? 500),
    ),
  );
  const stakeUnits = Math.max(
    0.01,
    options.stakeUnits ?? Number(process.env.BACKTEST_STAKE_UNITS ?? 1),
  );
  if (dateFrom >= dateTo) {
    throw new Error('Scientific backtest dateFrom must be earlier than dateTo.');
  }

  const modelVersion = `${SCIENTIFIC_MODEL_VERSION}-point-in-time`;
  const run = await prisma.backtestRun.create({
    data: {
      name:
        options.name?.trim() ||
        `Scientific v5 ${dateFrom.toISOString().slice(0, 10)} → ${dateTo.toISOString().slice(0, 10)}`,
      leagueId: options.leagueId,
      dateFrom,
      dateTo,
      fixtureLimit,
      stakeUnits,
      modelVersion,
      rules: {
        machineLearningLeakageGuard: true,
        description:
          'ML is only used when model.trainedThrough is earlier than predictedAt.',
      } as InputJsonValue,
      status: BacktestStatus.RUNNING,
    },
  });

  try {
    const fixtures = await prisma.fixture.findMany({
      where: {
        status: FixtureStatus.FINISHED,
        kickoffAt: { gte: dateFrom, lte: dateTo },
        homeGoals: { not: null },
        awayGoals: { not: null },
        ...(options.leagueId ? { leagueId: options.leagueId } : {}),
      },
      include: {
        homeTeam: true,
        awayTeam: true,
        oddsSnapshots: {
          where: { isLive: false },
          include: { bookmaker: true, market: true },
          orderBy: { capturedAt: 'desc' },
        },
      },
      orderBy: { kickoffAt: 'asc' },
      take: fixtureLimit,
    });

    let eligibleFixtures = 0;
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let voids = 0;
    let totalBets = 0;
    const brierScores: number[] = [];
    const oddsValues: number[] = [];
    const expectedValues: number[] = [];
    const profits: number[] = [];

    for (const fixture of fixtures) {
      const pointInTimeRows = fixture.oddsSnapshots.filter(
        (row: (typeof fixture.oddsSnapshots)[number]) =>
          row.capturedAt.getTime() < fixture.kickoffAt.getTime(),
      );
      const odds = latestScientificOddsRows(pointInTimeRows);
      if (odds.length === 0) continue;
      const predictedAt = new Date(
        Math.max(...odds.map((row) => row.capturedAt.getTime())),
      );
      const analysis = await getScientificFixtureAnalysis({
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        homeTeamName: fixture.homeTeam.name,
        awayTeamName: fixture.awayTeam.name,
        kickoffAt: fixture.kickoffAt,
        asOf: predictedAt,
        useMachineLearning: true,
      });
      const candidates = buildScientificCandidates({
        odds,
        analysis,
        now: predictedAt,
      });
      if (candidates.length === 0) continue;
      eligibleFixtures += 1;

      for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index]!;
        const resultCode = settleSelection({
          marketCode: candidate.marketCode,
          selectionCode: candidate.selectionCode,
          lineValue: candidate.lineValue,
          homeGoals: fixture.homeGoals!,
          awayGoals: fixture.awayGoals!,
        });
        const result = resultCode as SettlementResult;
        const profitUnits = profitForSettlement(
          resultCode,
          candidate.decimalOdds,
          stakeUnits,
        );
        const actual =
          result === SettlementResult.WIN
            ? 1
            : result === SettlementResult.LOSS
              ? 0
              : null;
        if (actual !== null) {
          brierScores.push((candidate.modelProbability - actual) ** 2);
        }
        if (result === SettlementResult.WIN) wins += 1;
        else if (result === SettlementResult.LOSS) losses += 1;
        else if (result === SettlementResult.PUSH) pushes += 1;
        else voids += 1;
        totalBets += 1;
        profits.push(profitUnits);
        oddsValues.push(candidate.decimalOdds);
        expectedValues.push(candidate.expectedValue);

        await prisma.backtestBet.create({
          data: {
            runId: run.id,
            fixtureId: fixture.id,
            bookmakerId: candidate.bookmakerId,
            oddsSnapshotId: candidate.oddsSnapshotId,
            predictedAt,
            kickoffAt: fixture.kickoffAt,
            marketCode: candidate.marketCode,
            marketName: candidate.marketName,
            marketGroup: candidate.marketGroup,
            selectionCode: candidate.selectionCode,
            selectionName: candidate.selectionName,
            lineValue: candidate.lineValue,
            decimalOdds: candidate.decimalOdds,
            modelProbability: candidate.modelProbability,
            fairMarketProbability: candidate.fairMarketProbability,
            edge: candidate.edge,
            expectedValue: candidate.expectedValue,
            confidenceScore: candidate.confidenceScore,
            dataQualityScore: candidate.dataQualityScore,
            recommendationScore: candidate.recommendationScore,
            rankNumber: index + 1,
            settlementResult: result,
            stakeUnits,
            profitUnits,
            homeGoals: fixture.homeGoals!,
            awayGoals: fixture.awayGoals!,
            reasons: candidate.reasons as unknown as InputJsonValue,
          },
        });
      }
    }

    const profitUnits = profits.reduce((sum, value) => sum + value, 0);
    const settledBets = wins + losses;
    const totalStake = totalBets * stakeUnits;
    return prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        status: BacktestStatus.SUCCESS,
        finishedAt: new Date(),
        totalFixtures: fixtures.length,
        eligibleFixtures,
        totalBets,
        wins,
        losses,
        pushes,
        voids,
        hitRate: settledBets > 0 ? wins / settledBets : null,
        profitUnits,
        roi: totalStake > 0 ? profitUnits / totalStake : null,
        yieldRate: totalBets > 0 ? profitUnits / totalBets : null,
        averageOdds: mean(oddsValues),
        averageExpectedValue: mean(expectedValues),
        maximumDrawdown: maximumDrawdown(profits),
        brierScore: mean(brierScores),
      },
    });
  } catch (error) {
    await prisma.backtestRun.update({
      where: { id: run.id },
      data: {
        status: BacktestStatus.FAILED,
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
