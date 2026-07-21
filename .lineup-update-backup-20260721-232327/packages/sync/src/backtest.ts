import {
  BacktestStatus,
  FixtureStatus,
  prisma,
  SettlementResult,
  type InputJsonValue,
} from '@football-ai/database';
import {
  buildOddsConsensusOverUnderCandidates,
  profitForSettlement,
  settleSelection,
  type OverUnderConsensusRules,
} from '@football-ai/engine';
import { getOverUnderConsensusRules } from './config.js';
import { latestOverUnderOddsRows } from './recommendations.js';

type BacktestOddsRow = Parameters<
  typeof latestOverUnderOddsRows
>[0][number];

export interface BacktestOptions {
  name?: string;
  leagueId?: number;
  from?: Date | string;
  to?: Date | string;
  fixtureLimit?: number;
  stakeUnits?: number;
  rules?: Partial<Pick<
    OverUnderConsensusRules,
    'minimumExpectedValue' | 'minimumEdge' | 'minimumConfidence' | 'minimumDataQuality'
  >>;
}

export interface BacktestSummary {
  id: number;
  name: string;
  status: string;
  totalFixtures: number;
  eligibleFixtures: number;
  totalBets: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  hitRate: number | null;
  profitUnits: number;
  roi: number | null;
  yieldRate: number | null;
  averageOdds: number | null;
  averageExpectedValue: number | null;
  maximumDrawdown: number | null;
  brierScore: number | null;
}

function parseDate(value: Date | string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid backtest date: ${String(value)}`);
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

export async function runBacktest(options: BacktestOptions = {}): Promise<BacktestSummary> {
  const now = new Date();
  const dateFrom = parseDate(options.from, new Date(now.getTime() - 730 * 86_400_000));
  const dateTo = parseDate(options.to, now);
  const fixtureLimit = Math.min(5000, Math.max(1, options.fixtureLimit ?? 500));
  const stakeUnits = Math.max(0.01, options.stakeUnits ?? 1);
  const rules: OverUnderConsensusRules = {
    ...getOverUnderConsensusRules(),
    ...options.rules,
  };
  const modelVersion = 'odds-consensus-leave-one-out-ou-backtest-v1';

  if (dateFrom >= dateTo) throw new Error('Backtest dateFrom must be earlier than dateTo.');
  const requestedLeagueId = options.leagueId;

  const selectedLeague = requestedLeagueId
    ? await prisma.league.findFirst({
        where: {
          OR: [
            { id: requestedLeagueId },
            { apiLeagueId: requestedLeagueId },
          ],
        },
        orderBy: {
          id: 'asc',
        },
      })
    : null;

  if (requestedLeagueId && !selectedLeague) {
    throw new Error(
      `League not found for id or apiLeagueId: ${requestedLeagueId}`,
    );
  }

  const resolvedLeagueId = selectedLeague?.id;

  const run = await prisma.backtestRun.create({
    data: {
      name:
        options.name?.trim() ||
        `OU odds consensus ${dateFrom.toISOString().slice(0, 10)} â†’ ${dateTo.toISOString().slice(0, 10)}`,
      leagueId: resolvedLeagueId,
      dateFrom,
      dateTo,
      fixtureLimit,
      stakeUnits,
      modelVersion,
      rules: rules as unknown as InputJsonValue,
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
        ...(resolvedLeagueId ? { leagueId: resolvedLeagueId } : {}),
      },
      include: {
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
    const brierScores: number[] = [];
    const oddsValues: number[] = [];
    const expectedValues: number[] = [];
    const profits: number[] = [];
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    let voids = 0;
    let totalBets = 0;

    for (const fixture of fixtures) {
      const pointInTimeOdds = (
      fixture.oddsSnapshots as BacktestOddsRow[]
    ).filter(
        (row) => row.capturedAt.getTime() < fixture.kickoffAt.getTime(),
      );
      const latestOdds = latestOverUnderOddsRows(pointInTimeOdds, rules.lineValue);
      if (latestOdds.length === 0) continue;

      const predictedAt = new Date(
        Math.max(...latestOdds.map((row) => row.capturedAt.getTime())),
      );
      const candidates = buildOddsConsensusOverUnderCandidates({
        odds: latestOdds,
        rules,
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
        const profitUnits = profitForSettlement(resultCode, candidate.decimalOdds, stakeUnits);
        const actual = result === SettlementResult.WIN ? 1 : result === SettlementResult.LOSS ? 0 : null;
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
    const summary = await prisma.backtestRun.update({
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

    return summary;
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

