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
import { ScientificEvaluationCollector, ScientificRejectionDiagnostics } from './scientific-v61.js';
import {
  SCIENTIFIC_STAKING_VERSION,
  ScientificBankrollTracker,
  allocateScientificStakePortfolio,
  formatScientificStakeReason,
  getScientificBankrollConfig,
  summarizeScientificBankrollConfig,
} from './scientific-bankroll.js';

export interface ScientificBacktestOptions {
  name?: string;
  leagueId?: number;
  from?: Date | string;
  to?: Date | string;
  fixtureLimit?: number;
  stakeUnits?: number;
  initialBankrollUnits?: number;
  horizonMinutes?: number;
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

export async function runScientificBacktest(options: ScientificBacktestOptions = {}) {
  const now = new Date();
  const dateFrom = parseDate(
    options.from ?? process.env.BACKTEST_FROM,
    new Date(now.getTime() - 730 * 86_400_000),
  );
  const dateTo = parseDate(options.to ?? process.env.BACKTEST_TO, now);
  const fixtureLimit = Math.min(
    5000,
    Math.max(1, options.fixtureLimit ?? Number(process.env.BACKTEST_FIXTURE_LIMIT ?? 500)),
  );
  const stakeUnits = Math.max(
    0.01,
    options.stakeUnits ?? Number(process.env.BACKTEST_STAKE_UNITS ?? 1),
  );
  const initialBankrollUnits = Math.max(
    1,
    options.initialBankrollUnits ?? Number(process.env.SCIENTIFIC_BANKROLL_UNITS ?? 100),
  );
  // PREDICTION_AI_V62_DYNAMIC_BANKROLL_BACKTEST
  const stakingConfig = getScientificBankrollConfig({
    bankrollUnits: initialBankrollUnits,
    fixedStakeUnits: stakeUnits,
  });
  // PREDICTION_AI_V6_FIXED_HORIZON: mọi trận được dự đoán tại cùng khoảng cách trước giờ bóng lăn.
  const horizonMinutes = Math.max(
    5,
    Math.floor(
      options.horizonMinutes ?? Number(process.env.SCIENTIFIC_BACKTEST_HORIZON_MINUTES ?? 90),
    ),
  );
  if (dateFrom >= dateTo) {
    throw new Error('Scientific backtest dateFrom must be earlier than dateTo.');
  }

  const modelVersion = `${SCIENTIFIC_MODEL_VERSION}-point-in-time-v61-dynamic-bankroll-v62`;
  const run = await prisma.backtestRun.create({
    data: {
      name:
        options.name?.trim() ||
        `Scientific v6.2 bankroll ${dateFrom.toISOString().slice(0, 10)} → ${dateTo.toISOString().slice(0, 10)}`,
      leagueId: options.leagueId,
      dateFrom,
      dateTo,
      fixtureLimit,
      stakeUnits,
      modelVersion,
      rules: {
        machineLearningLeakageGuard: true,
        fixedDecisionHorizonMinutes: horizonMinutes,
        description: 'ML is only used when model.trainedThrough is earlier than predictedAt.',
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
    // PREDICTION_AI_V61_MARKET_METRICS
    const evaluation = new ScientificEvaluationCollector();
    const rejectionDiagnostics = new ScientificRejectionDiagnostics();
    const bankrollTracker = new ScientificBankrollTracker(initialBankrollUnits);
    for (const fixture of fixtures) {
      const predictedAt = new Date(fixture.kickoffAt.getTime() - horizonMinutes * 60_000);
      const pointInTimeRows = fixture.oddsSnapshots.filter(
        (row: (typeof fixture.oddsSnapshots)[number]) =>
          row.capturedAt.getTime() <= predictedAt.getTime(),
      );
      const odds = latestScientificOddsRows(pointInTimeRows);
      if (odds.length === 0) {
        rejectionDiagnostics.reject('NO_ODDS_AT_HORIZON');
        continue;
      }
      const analysis = await getScientificFixtureAnalysis({
        fixtureId: fixture.id,
        leagueId: fixture.leagueId,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        homeTeamName: fixture.homeTeam.name,
        awayTeamName: fixture.awayTeam.name,
        kickoffAt: fixture.kickoffAt,
        predictionAsOf: predictedAt,
        mode: 'BACKTEST',
        useMachineLearning: true,
      });
      const actualWinner =
        fixture.homeGoals! > fixture.awayGoals!
          ? 'HOME'
          : fixture.homeGoals! < fixture.awayGoals!
            ? 'AWAY'
            : 'DRAW';
      evaluation.recordPrediction({
        marketCode: 'MATCH_WINNER',
        probabilities: analysis.matchWinner,
        actualClass: actualWinner,
      });
      evaluation.recordPrediction({
        marketCode: 'TOTAL_GOALS_2_5',
        probability: analysis.over25.OVER,
        actual: fixture.homeGoals! + fixture.awayGoals! > 2.5 ? 1 : 0,
      });
      evaluation.recordPrediction({
        marketCode: 'BTTS',
        probability: analysis.btts.YES,
        actual: fixture.homeGoals! > 0 && fixture.awayGoals! > 0 ? 1 : 0,
      });
      const candidates = buildScientificCandidates({
        odds,
        analysis,
        now: predictedAt,
        diagnostics: rejectionDiagnostics,
      });
      const stakePortfolio = allocateScientificStakePortfolio({
        candidates,
        config: stakingConfig,
        currentBankrollUnits: bankrollTracker.currentBankrollUnits,
        peakBankrollUnits: bankrollTracker.peakBankrollUnits,
        currentDailyExposureUnits: bankrollTracker.dailyExposureUnits(fixture.kickoffAt),
      });
      for (const [reason, count] of Object.entries(stakePortfolio.rejectionReasons)) {
        rejectionDiagnostics.reject(reason, count);
      }
      if (stakePortfolio.bets.length === 0) continue;
      eligibleFixtures += 1;
      for (let index = 0; index < stakePortfolio.bets.length; index += 1) {
        const { candidate, stakePlan } = stakePortfolio.bets[index]!;
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
          stakePlan.stakeUnits,
        );
        const actual =
          result === SettlementResult.WIN ? 1 : result === SettlementResult.LOSS ? 0 : null;
        if (actual !== null) {
          brierScores.push((candidate.modelProbability - actual) ** 2);
        }
        if (result === SettlementResult.WIN) wins += 1;
        else if (result === SettlementResult.LOSS) losses += 1;
        else if (result === SettlementResult.PUSH) pushes += 1;
        else voids += 1;
        totalBets += 1;
        profits.push(profitUnits);
        bankrollTracker.recordBet(fixture.kickoffAt, stakePlan.stakeUnits, profitUnits);
        oddsValues.push(candidate.decimalOdds);
        expectedValues.push(candidate.expectedValue);
        evaluation.recordBet({
          marketCode: candidate.marketCode,
          result: String(result) as 'WIN' | 'LOSS' | 'PUSH' | 'VOID',
          profitUnits,
          stakeUnits: stakePlan.stakeUnits,
          decimalOdds: candidate.decimalOdds,
          expectedValue: candidate.expectedValue,
        });
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
            stakeUnits: stakePlan.stakeUnits,
            profitUnits,
            homeGoals: fixture.homeGoals!,
            awayGoals: fixture.awayGoals!,
            reasons: [
              ...candidate.reasons,
              formatScientificStakeReason(stakePlan),
            ] as unknown as InputJsonValue,
          },
        });
      }
    }

    const bankrollSnapshot = bankrollTracker.snapshot();
    const profitUnits = bankrollSnapshot.profitUnits;
    const settledBets = wins + losses;
    const totalStake = bankrollSnapshot.totalStakeUnits;
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
        yieldRate: totalStake > 0 ? profitUnits / totalStake : null,
        averageOdds: mean(oddsValues),
        averageExpectedValue: mean(expectedValues),
        maximumDrawdown: bankrollSnapshot.maximumDrawdownUnits,
        brierScore: evaluation.overallBrierScore() ?? mean(brierScores),
        rules: {
          machineLearningLeakageGuard: true,
          fixedDecisionHorizonMinutes: horizonMinutes,
          description: 'ML is only used when model.trainedThrough is earlier than predictedAt.',
          rejectionDiagnostics: rejectionDiagnostics.snapshot(),
          marketMetrics: evaluation.snapshot(),
          correlationControl: true,
          stakingVersion: SCIENTIFIC_STAKING_VERSION,
          stakingConfig: summarizeScientificBankrollConfig(stakingConfig),
          stakingMetrics: bankrollSnapshot,
        } as unknown as InputJsonValue,
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
