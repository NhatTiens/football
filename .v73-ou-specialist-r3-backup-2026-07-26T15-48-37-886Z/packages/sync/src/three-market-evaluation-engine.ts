import { FixtureStatus, prisma } from '@football-ai/database';
import { getScientificFixtureAnalysis } from './scientific-features.js';
import {
  actualBtts,
  actualMatchWinner,
  actualOverLine,
  evaluateBinaryPredictions,
  evaluateMatchWinnerPredictions,
  type ScientificPredictionMetrics,
} from './scientific-multi-market-replay-contract.js';
import {
  THREE_MARKET_TOTAL_LINES,
  type PredictionConfidenceGrade,
  type ThreeMarketTotalLine,
} from './three-market-core.js';

export const THREE_MARKET_EVALUATION_VERSION = 'v7.2-market-specialist-evaluation-r2';
export const THREE_MARKET_EVALUATION_HORIZONS = [90, 30, 5] as const;

export type ThreeMarketEvaluationMarket = 'HDA' | 'O1.5' | 'O2.5' | 'O3.5' | 'BTTS';

export interface SelectiveEvaluationRow {
  grade: PredictionConfidenceGrade;
  correct: boolean;
}

export interface SelectiveEvaluationMetrics {
  totalRows: number;
  releasedRows: number;
  coverage: number | null;
  correct: number;
  hitRate: number | null;
  wilsonLower95: number | null;
  highRows: number;
  highCorrect: number;
  highHitRate: number | null;
}

export interface MarketComparisonMetrics {
  candidate: ScientificPredictionMetrics;
  champion: ScientificPredictionMetrics | null;
  deltaVsChampion: {
    accuracy: number | null;
    brier: number | null;
    logLoss: number | null;
    ece: number | null;
  } | null;
  selective: SelectiveEvaluationMetrics;
}

export interface ThreeMarketHorizonEvaluation {
  horizonMinutes: number;
  fixtureRows: number;
  mlEligibleRows: number;
  mlCoverage: number | null;
  pointInTimeViolations: number;
  averageDataQuality: number | null;
  averageConfidence: number | null;
  markets: Record<ThreeMarketEvaluationMarket, MarketComparisonMetrics>;
}

export interface ThreeMarketEvaluationSummary {
  version: typeof THREE_MARKET_EVALUATION_VERSION;
  generatedAt: string;
  options: {
    from: string;
    to: string;
    leagueId: number | null;
    fixtureLimit: number;
    horizons: number[];
    useMachineLearning: boolean;
    minimumSelectiveRows: number;
  };
  fixturesLoaded: number;
  successfulAnalyses: number;
  failedAnalyses: number;
  failureRate: number | null;
  errors: Array<{ fixtureId: number; horizonMinutes: number; message: string }>;
  horizons: ThreeMarketHorizonEvaluation[];
  bestMarket: {
    market: ThreeMarketEvaluationMarket;
    horizonMinutes: number;
    releasedRows: number;
    coverage: number;
    hitRate: number;
    wilsonLower95: number;
  } | null;
  readiness: 'PASS' | 'BLOCKED';
  readinessReasons: string[];
}

export interface ThreeMarketEvaluationOptions {
  from?: Date | string;
  to?: Date | string;
  leagueId?: number;
  fixtureLimit?: number;
  horizons?: number[];
  useMachineLearning?: boolean;
  minimumSelectiveRows?: number;
}

interface EvaluationFixture {
  id: number;
  leagueId: number;
  kickoffAt: Date;
  homeGoals: number | null;
  awayGoals: number | null;
  homeTeamId: number;
  awayTeamId: number;
  homeTeam: { name: string };
  awayTeam: { name: string };
}

interface CandidateRowState {
  hda: Array<{
    probabilities: Record<'HOME' | 'DRAW' | 'AWAY', number>;
    actualClass: 'HOME' | 'DRAW' | 'AWAY';
  }>;
  totals: Record<ThreeMarketTotalLine, Array<{ positiveProbability: number; actualPositive: boolean }>>;
  btts: Array<{ positiveProbability: number; actualPositive: boolean }>;
  championHda: Array<{
    probabilities: Record<'HOME' | 'DRAW' | 'AWAY', number>;
    actualClass: 'HOME' | 'DRAW' | 'AWAY';
  }>;
  championOver25: Array<{ positiveProbability: number; actualPositive: boolean }>;
  championBtts: Array<{ positiveProbability: number; actualPositive: boolean }>;
  selective: Record<ThreeMarketEvaluationMarket, SelectiveEvaluationRow[]>;
}

function parseDate(value: Date | string | undefined, fallback: Date): Date {
  if (value == null) return new Date(fallback);
  const parsed = value instanceof Date ? new Date(value) : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError(`Invalid evaluation date: ${String(value)}`);
  return parsed;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function safeDelta(candidate: number | null, champion: number | null): number | null {
  if (candidate == null || champion == null) return null;
  return candidate - champion;
}

export function wilsonLowerBound95(successes: number, total: number): number | null {
  if (!Number.isFinite(successes) || !Number.isFinite(total) || total <= 0) return null;
  const n = Math.floor(total);
  const k = Math.max(0, Math.min(n, Math.floor(successes)));
  const z = 1.959963984540054;
  const p = k / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centre - margin) / denominator);
}

export function summarizeSelectiveRows(rows: readonly SelectiveEvaluationRow[]): SelectiveEvaluationMetrics {
  const released = rows.filter((row) => row.grade === 'HIGH' || row.grade === 'MEDIUM');
  const high = rows.filter((row) => row.grade === 'HIGH');
  const correct = released.filter((row) => row.correct).length;
  const highCorrect = high.filter((row) => row.correct).length;
  return {
    totalRows: rows.length,
    releasedRows: released.length,
    coverage: rows.length > 0 ? released.length / rows.length : null,
    correct,
    hitRate: released.length > 0 ? correct / released.length : null,
    wilsonLower95: wilsonLowerBound95(correct, released.length),
    highRows: high.length,
    highCorrect,
    highHitRate: high.length > 0 ? highCorrect / high.length : null,
  };
}

function emptyState(): CandidateRowState {
  return {
    hda: [],
    totals: { 1.5: [], 2.5: [], 3.5: [] },
    btts: [],
    championHda: [],
    championOver25: [],
    championBtts: [],
    selective: { HDA: [], 'O1.5': [], 'O2.5': [], 'O3.5': [], BTTS: [] },
  };
}

function marketKeyForLine(line: ThreeMarketTotalLine): ThreeMarketEvaluationMarket {
  return `O${line}` as ThreeMarketEvaluationMarket;
}

function comparison(
  candidate: ScientificPredictionMetrics,
  champion: ScientificPredictionMetrics | null,
  selectiveRows: SelectiveEvaluationRow[],
): MarketComparisonMetrics {
  return {
    candidate,
    champion,
    deltaVsChampion:
      champion == null
        ? null
        : {
            accuracy: safeDelta(candidate.accuracy, champion.accuracy),
            brier: safeDelta(candidate.brier, champion.brier),
            logLoss: safeDelta(candidate.logLoss, champion.logLoss),
            ece: safeDelta(candidate.ece, champion.ece),
          },
    selective: summarizeSelectiveRows(selectiveRows),
  };
}

export function selectBestEvaluatedMarket(
  horizons: readonly ThreeMarketHorizonEvaluation[],
  minimumSelectiveRows: number,
): ThreeMarketEvaluationSummary['bestMarket'] {
  const candidates: NonNullable<ThreeMarketEvaluationSummary['bestMarket']>[] = [];
  for (const horizon of horizons) {
    for (const market of Object.keys(horizon.markets) as ThreeMarketEvaluationMarket[]) {
      const selective = horizon.markets[market].selective;
      if (
        selective.releasedRows < minimumSelectiveRows ||
        selective.coverage == null ||
        selective.hitRate == null ||
        selective.wilsonLower95 == null
      ) continue;
      candidates.push({
        market,
        horizonMinutes: horizon.horizonMinutes,
        releasedRows: selective.releasedRows,
        coverage: selective.coverage,
        hitRate: selective.hitRate,
        wilsonLower95: selective.wilsonLower95,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      right.wilsonLower95 - left.wilsonLower95 ||
      right.hitRate - left.hitRate ||
      right.releasedRows - left.releasedRows ||
      right.coverage - left.coverage,
  );
  return candidates[0] ?? null;
}

export async function evaluateThreeMarketSpecialists(
  options: ThreeMarketEvaluationOptions = {},
): Promise<ThreeMarketEvaluationSummary> {
  const now = new Date();
  const dateFrom = parseDate(options.from ?? process.env.THREE_MARKET_EVAL_FROM, new Date(now.getTime() - 730 * 86_400_000));
  const dateTo = parseDate(options.to ?? process.env.THREE_MARKET_EVAL_TO, now);
  if (dateFrom >= dateTo) throw new RangeError('Evaluation from must be earlier than to.');

  const fixtureLimit = Math.min(5000, Math.max(20, Math.floor(options.fixtureLimit ?? Number(process.env.THREE_MARKET_EVAL_LIMIT ?? 500))));
  const horizons = [...(options.horizons ?? THREE_MARKET_EVALUATION_HORIZONS)]
    .map((value) => Math.max(5, Math.floor(value)))
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => right - left);
  const useMachineLearning = options.useMachineLearning ?? true;
  const minimumSelectiveRows = Math.max(10, Math.floor(options.minimumSelectiveRows ?? 25));

  const fixtures = (await prisma.fixture.findMany({
    where: {
      status: FixtureStatus.FINISHED,
      kickoffAt: { gte: dateFrom, lte: dateTo },
      homeGoals: { not: null },
      awayGoals: { not: null },
      ...(options.leagueId ? { leagueId: options.leagueId } : {}),
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
  })) as EvaluationFixture[];

  const errors: ThreeMarketEvaluationSummary['errors'] = [];
  const horizonSummaries: ThreeMarketHorizonEvaluation[] = [];
  let successfulAnalyses = 0;
  let failedAnalyses = 0;

  for (const horizonMinutes of horizons) {
    const state = emptyState();
    let mlEligibleRows = 0;
    let pointInTimeViolations = 0;
    const dataQualities: number[] = [];
    const confidences: number[] = [];
    let fixtureRows = 0;

    for (const fixture of fixtures) {
      if (fixture.homeGoals == null || fixture.awayGoals == null) continue;
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
          useMachineLearning,
        });
        fixtureRows += 1;
        successfulAnalyses += 1;
        if (analysis.modelPrediction != null) mlEligibleRows += 1;
        dataQualities.push(analysis.dataQualityScore);
        confidences.push(analysis.confidenceScore);
        const auditMax = analysis.pointInTimeAudit.maxAvailableAt;
        if (auditMax != null && auditMax.getTime() > predictionAsOf.getTime()) pointInTimeViolations += 1;

        const actualHda = actualMatchWinner(fixture.homeGoals, fixture.awayGoals);
        state.hda.push({ probabilities: analysis.threeMarket.hda.probabilities, actualClass: actualHda });
        state.championHda.push({ probabilities: analysis.matchWinner, actualClass: actualHda });
        state.selective.HDA.push({
          grade: analysis.threeMarket.hda.grade,
          correct: analysis.threeMarket.hda.selected === actualHda,
        });

        for (const line of THREE_MARKET_TOTAL_LINES) {
          const actualOver = actualOverLine(fixture.homeGoals, fixture.awayGoals, line);
          state.totals[line].push({
            positiveProbability: analysis.threeMarket.totals[line].probabilities.OVER,
            actualPositive: actualOver,
          });
          const projection = analysis.threeMarket.totals[line];
          state.selective[marketKeyForLine(line)].push({
            grade: projection.grade,
            correct: projection.selected === (actualOver ? 'OVER' : 'UNDER'),
          });
          if (line === 2.5) {
            state.championOver25.push({
              positiveProbability: analysis.over25.OVER,
              actualPositive: actualOver,
            });
          }
        }

        const actualBothScore = actualBtts(fixture.homeGoals, fixture.awayGoals);
        state.btts.push({
          positiveProbability: analysis.threeMarket.btts.probabilities.YES,
          actualPositive: actualBothScore,
        });
        state.championBtts.push({ positiveProbability: analysis.btts.YES, actualPositive: actualBothScore });
        state.selective.BTTS.push({
          grade: analysis.threeMarket.btts.grade,
          correct: analysis.threeMarket.btts.selected === (actualBothScore ? 'YES' : 'NO'),
        });
      } catch (error) {
        failedAnalyses += 1;
        if (errors.length < 30) {
          errors.push({
            fixtureId: fixture.id,
            horizonMinutes,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    horizonSummaries.push({
      horizonMinutes,
      fixtureRows,
      mlEligibleRows,
      mlCoverage: fixtureRows > 0 ? mlEligibleRows / fixtureRows : null,
      pointInTimeViolations,
      averageDataQuality: mean(dataQualities),
      averageConfidence: mean(confidences),
      markets: {
        HDA: comparison(
          evaluateMatchWinnerPredictions(state.hda),
          evaluateMatchWinnerPredictions(state.championHda),
          state.selective.HDA,
        ),
        'O1.5': comparison(
          evaluateBinaryPredictions(state.totals[1.5]),
          null,
          state.selective['O1.5'],
        ),
        'O2.5': comparison(
          evaluateBinaryPredictions(state.totals[2.5]),
          evaluateBinaryPredictions(state.championOver25),
          state.selective['O2.5'],
        ),
        'O3.5': comparison(
          evaluateBinaryPredictions(state.totals[3.5]),
          null,
          state.selective['O3.5'],
        ),
        BTTS: comparison(
          evaluateBinaryPredictions(state.btts),
          evaluateBinaryPredictions(state.championBtts),
          state.selective.BTTS,
        ),
      },
    });
  }

  const bestMarket = selectBestEvaluatedMarket(horizonSummaries, minimumSelectiveRows);
  const totalAttempts = successfulAnalyses + failedAnalyses;
  const failureRate = totalAttempts > 0 ? failedAnalyses / totalAttempts : null;
  const readinessReasons: string[] = [];
  if (horizonSummaries.some((horizon) => horizon.pointInTimeViolations > 0)) {
    readinessReasons.push('Point-in-time violation detected.');
  }
  if (failureRate != null && failureRate > 0.05) {
    readinessReasons.push(`Evaluation failure rate ${(failureRate * 100).toFixed(2)}% exceeds 5%.`);
  }
  if (bestMarket == null) {
    readinessReasons.push(`No market/horizon reached minimum ${minimumSelectiveRows} HIGH/MEDIUM rows.`);
  }

  return {
    version: THREE_MARKET_EVALUATION_VERSION,
    generatedAt: new Date().toISOString(),
    options: {
      from: dateFrom.toISOString(),
      to: dateTo.toISOString(),
      leagueId: options.leagueId ?? null,
      fixtureLimit,
      horizons,
      useMachineLearning,
      minimumSelectiveRows,
    },
    fixturesLoaded: fixtures.length,
    successfulAnalyses,
    failedAnalyses,
    failureRate,
    errors,
    horizons: horizonSummaries,
    bestMarket,
    readiness: readinessReasons.length === 0 ? 'PASS' : 'BLOCKED',
    readinessReasons,
  };
}
