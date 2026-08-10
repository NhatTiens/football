import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { prisma } from '@football-ai/database';
import {
  applyTemperature,
  probabilityMetrics,
  type CalibrationObservation,
  type ProbabilityMetrics,
  type TemperatureCalibrator,
} from './calibration-uncertainty-contract.js';
import {
  loadCalibrationRuntime,
  type CalibratedFixturePrediction,
} from './calibration-uncertainty-engine.js';
import {
  CHAMPION_CHALLENGER_BACKTEST_VERSION,
  profitForSettlement,
  settleBenchmarkCandidate,
  summarizeBettingPerformance,
  type BenchmarkModel,
  type BettingPerformance,
  type SettledBenchmarkBet,
} from './champion-challenger-backtest-contract.js';
import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';
import type { HybridComponentName, HybridMarketPrediction } from './hybrid-model-contract.js';
import {
  loadHybridModelRuntime,
  type HybridModelArtifactRow,
} from './hybrid-model-engine.js';
import {
  assessDecisionCandidate,
  buildMultiHorizonDecision,
  type DecisionCandidate,
  type MultiHorizonDecision,
} from './multi-horizon-decision-contract.js';
import {
  loadMultiHorizonDecisionRuntime,
} from './multi-horizon-decision-engine.js';

export type BacktestReadiness =
  | 'READY_FOR_PAPER_RUNTIME'
  | 'BLOCKED_UPSTREAM'
  | 'BLOCKED_BACKTEST_INTEGRITY';

interface OddsRow {
  id: number;
  fixtureId: number;
  bookmakerId: number;
  marketId: number;
  selectionCode: string;
  lineValue: number | null;
  decimalOdds: number;
  capturedAt: Date;
}

export interface ModelBacktestResult {
  model: BenchmarkModel;
  performance: BettingPerformance;
  calibration: ProbabilityMetrics;
  noBetQuality: {
    assessable: number;
    wouldWin: number;
    wouldLose: number;
    wouldVoid: number;
  };
  byMarket: Record<string, BettingPerformance>;
  byHorizon: Record<string, BettingPerformance>;
  byLeague: Record<string, BettingPerformance>;
  byMonth: Record<string, BettingPerformance>;
}

export interface ChampionChallengerRuntimeResult {
  version: string;
  status: BacktestReadiness;
  stage6DatasetFingerprint: string;
  datasetFingerprint: string;
  models: Record<BenchmarkModel, ModelBacktestResult>;
  decisionsByModel: Record<BenchmarkModel, MultiHorizonDecision[]>;
  settledBets: SettledBenchmarkBet[];
  integrity: {
    comparedDecisions: number;
    decisionCountMismatch: number;
    missingOutcomeRows: number;
    missingComponentRows: number;
    futureClosingOddsViolations: number;
    fabricatedOddsRows: 0;
  };
  championGate: {
    evaluated: true;
    promotionEligible: boolean;
    reasons: string[];
    automaticPromotion: false;
    currentChampionChanged: false;
  };
  configuration: { artifactDirectory: string; flatStakeUnits: 1 };
}

export interface ChampionChallengerArtifactResult {
  directory: string;
  manifestPath: string;
  decisionsPath: string;
  betsPath: string;
  hashesPath: string;
  runtime: ChampionChallengerRuntimeResult;
}

const MODELS: BenchmarkModel[] = ['V7_5_DIXON_CHAMPION', 'V8_BAYESIAN', 'V8_HYBRID'];

function repositoryRoot(): string {
  let current = process.cwd();
  while (true) {
    if (
      existsSync(resolve(current, 'package.json')) &&
      existsSync(resolve(current, 'packages/database/prisma/schema.prisma'))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) throw new Error('Unable to locate repository root.');
    current = parent;
  }
}

function configuration() {
  const root = repositoryRoot();
  return {
    artifactDirectory: resolve(
      root,
      process.env.HYBRID_BACKTEST_ARTIFACT_DIRECTORY ??
        'artifacts/hybrid/v8-stage7-champion-challenger',
    ),
    flatStakeUnits: 1 as const,
  };
}

function rowKey(fixtureId: number, horizon: number): string {
  return `${fixtureId}:${horizon}`;
}

function marketKey(market: HybridMarketPrediction): string {
  return market.market === 'TOTAL_GOALS' ? `TOTAL_GOALS:${market.line}` : market.market;
}

function modelComponent(model: BenchmarkModel): HybridComponentName | null {
  if (model === 'V7_5_DIXON_CHAMPION') return 'DIXON_COLES';
  if (model === 'V8_BAYESIAN') return 'BAYESIAN';
  return null;
}

function candidateProbability(
  candidate: DecisionCandidate,
  probabilities: Record<string, number>,
): { win: number; push: number } {
  if (candidate.selection === 'UNDER') {
    return { win: probabilities.BELOW ?? 0, push: probabilities.PUSH ?? 0 };
  }
  if (candidate.selection === 'OVER') {
    return { win: probabilities.ABOVE ?? 0, push: probabilities.PUSH ?? 0 };
  }
  return { win: probabilities[candidate.selection] ?? 0, push: 0 };
}

function componentProbabilities(input: {
  stage4Market: HybridMarketPrediction;
  component: HybridComponentName;
  calibrator: TemperatureCalibrator;
}): Record<string, number> | null {
  const row = input.stage4Market.componentProbabilities.find(
    (candidate) => candidate.component === input.component,
  );
  return row ? applyTemperature(row.probabilities, input.calibrator.temperature) : null;
}

function buildComponentDecisions(input: {
  model: Exclude<BenchmarkModel, 'V8_HYBRID'>;
  hybridDecisions: MultiHorizonDecision[];
  stage4Rows: Map<string, HybridModelArtifactRow>;
  stage5Rows: Map<string, CalibratedFixturePrediction>;
  calibrators: Map<string, TemperatureCalibrator>;
}): { decisions: MultiHorizonDecision[]; missingComponents: number } {
  const component = modelComponent(input.model)!;
  let missingComponents = 0;
  const decisions: MultiHorizonDecision[] = [];
  for (const source of input.hybridDecisions) {
    const key = rowKey(source.fixtureId, source.horizon);
    const stage4 = input.stage4Rows.get(key);
    const stage5 = input.stage5Rows.get(key);
    if (!stage4 || !stage5) continue;
    const candidates: DecisionCandidate[] = [];
    for (const sourceCandidate of source.candidateMarkets) {
      const stage4Market = stage4.markets.find(
        (candidate) => marketKey(candidate) === sourceCandidate.marketKey,
      );
      const stage5Market = stage5.markets.find(
        (candidate) => candidate.marketKey === sourceCandidate.marketKey,
      );
      const calibrator = stage5Market
        ? input.calibrators.get(stage5Market.calibratorHash)
        : undefined;
      if (!stage4Market || !stage5Market || !calibrator) continue;
      const probabilities = componentProbabilities({ stage4Market, component, calibrator });
      if (!probabilities) {
        missingComponents += 1;
        continue;
      }
      const probability = candidateProbability(sourceCandidate, probabilities);
      candidates.push(
        assessDecisionCandidate({
          marketKey: sourceCandidate.marketKey,
          selection: sourceCandidate.selection,
          line: sourceCandidate.line,
          modelProbability: probability.win,
          pushProbability: probability.push,
          fairMarketProbability: sourceCandidate.fairMarketProbability,
          quote:
            sourceCandidate.odds != null && sourceCandidate.oddsSnapshotId != null
              ? {
                  oddsSnapshotId: sourceCandidate.oddsSnapshotId,
                  bookmakerId: 0,
                  selection: sourceCandidate.selection,
                  decimalOdds: sourceCandidate.odds,
                  capturedAt: source.decisionAsOf,
                }
              : null,
          reliability: stage5Market.reliability,
          uncertainty: stage5Market.uncertainty,
          uncertaintyPenalty: stage5Market.uncertaintyPenalty,
        }),
      );
    }
    decisions.push(
      buildMultiHorizonDecision({
        fixtureId: source.fixtureId,
        decisionAsOf: source.decisionAsOf,
        kickoffAt: source.kickoffAt,
        horizon: source.horizon,
        candidates,
        modelVersion: input.model,
        stage5RowHash: stage5.rowHash,
      }),
    );
  }
  return { decisions, missingComponents };
}

function closingOddsFor(input: {
  selected: OddsRow;
  kickoffAt: Date;
  rows: OddsRow[];
}): OddsRow | null {
  return (
    input.rows
      .filter(
        (row) =>
          row.fixtureId === input.selected.fixtureId &&
          row.bookmakerId === input.selected.bookmakerId &&
          row.marketId === input.selected.marketId &&
          row.selectionCode === input.selected.selectionCode &&
          Math.abs((row.lineValue ?? -999) - (input.selected.lineValue ?? -999)) <= 1e-9 &&
          row.capturedAt.getTime() <= input.kickoffAt.getTime(),
      )
      .sort(
        (left, right) =>
          right.capturedAt.getTime() - left.capturedAt.getTime() || right.id - left.id,
      )[0] ?? null
  );
}

function settleModel(input: {
  model: BenchmarkModel;
  decisions: MultiHorizonDecision[];
  stage5Rows: Map<string, CalibratedFixturePrediction>;
  odds: OddsRow[];
}): { bets: SettledBenchmarkBet[]; missingOutcomes: number; futureClosingOddsViolations: number } {
  const oddsById = new Map(input.odds.map((row) => [row.id, row]));
  const bets: SettledBenchmarkBet[] = [];
  let missingOutcomes = 0;
  let futureClosingOddsViolations = 0;
  for (const decision of input.decisions) {
    const selected = decision.selectedCandidate;
    if (!selected || selected.odds == null) continue;
    const stage5 = input.stage5Rows.get(rowKey(decision.fixtureId, decision.horizon));
    const outcome = stage5?.markets.find((row) => row.marketKey === selected.marketKey)?.outcome;
    if (!outcome) {
      missingOutcomes += 1;
      continue;
    }
    const result = settleBenchmarkCandidate(selected, outcome);
    const selectedOdds = selected.oddsSnapshotId == null ? null : oddsById.get(selected.oddsSnapshotId);
    const closing = selectedOdds
      ? closingOddsFor({ selected: selectedOdds, kickoffAt: new Date(decision.kickoffAt), rows: input.odds })
      : null;
    if (closing && closing.capturedAt.getTime() > new Date(decision.kickoffAt).getTime()) {
      futureClosingOddsViolations += 1;
    }
    bets.push({
      model: input.model,
      decisionId: decision.decisionId,
      fixtureId: decision.fixtureId,
      leagueId: stage5!.leagueId,
      horizon: decision.horizon,
      kickoffAt: decision.kickoffAt,
      marketKey: selected.marketKey,
      selection: selected.selection,
      decimalOdds: selected.odds,
      closingOdds: closing?.decimalOdds ?? null,
      clv: closing ? selected.odds / closing.decimalOdds - 1 : null,
      result,
      profitUnits: profitForSettlement(result, selected.odds),
    });
  }
  return { bets, missingOutcomes, futureClosingOddsViolations };
}

function calibrationForModel(input: {
  model: BenchmarkModel;
  stage4Rows: Map<string, HybridModelArtifactRow>;
  stage5Rows: CalibratedFixturePrediction[];
  calibrators: Map<string, TemperatureCalibrator>;
}): ProbabilityMetrics {
  const observations: CalibrationObservation[] = [];
  for (const stage5 of input.stage5Rows) {
    const stage4 = input.stage4Rows.get(rowKey(stage5.fixtureId, stage5.horizonMinutes));
    if (!stage4) continue;
    for (const market of stage5.markets) {
      let probabilities = market.calibratedProbability;
      const component = modelComponent(input.model);
      if (component) {
        const stage4Market = stage4.markets.find((row) => marketKey(row) === market.marketKey);
        const calibrator = input.calibrators.get(market.calibratorHash);
        if (!stage4Market || !calibrator) continue;
        const componentValues = componentProbabilities({ stage4Market, component, calibrator });
        if (!componentValues) continue;
        probabilities = componentValues;
      }
      observations.push({
        fixtureId: stage5.fixtureId,
        leagueId: stage5.leagueId,
        horizonMinutes: stage5.horizonMinutes,
        kickoffAt: stage5.kickoffAt,
        marketKey: market.marketKey,
        probabilities,
        outcome: market.outcome,
        componentDisagreement: market.componentDisagreement,
      });
    }
  }
  return probabilityMetrics(observations);
}

function noBetQuality(input: {
  decisions: MultiHorizonDecision[];
  stage5Rows: Map<string, CalibratedFixturePrediction>;
}) {
  let assessable = 0;
  let wouldWin = 0;
  let wouldLose = 0;
  let wouldVoid = 0;
  for (const decision of input.decisions.filter((row) => row.decision === 'NO_BET')) {
    const candidate = decision.candidateMarkets
      .filter((row) => row.odds != null && row.score != null)
      .sort((left, right) => (right.score ?? -Infinity) - (left.score ?? -Infinity))[0];
    if (!candidate) continue;
    const outcome = input.stage5Rows
      .get(rowKey(decision.fixtureId, decision.horizon))
      ?.markets.find((row) => row.marketKey === candidate.marketKey)?.outcome;
    if (!outcome) continue;
    assessable += 1;
    const settlement = settleBenchmarkCandidate(candidate, outcome);
    if (settlement === 'WIN') wouldWin += 1;
    if (settlement === 'LOSS') wouldLose += 1;
    if (settlement === 'VOID') wouldVoid += 1;
  }
  return { assessable, wouldWin, wouldLose, wouldVoid };
}

function dimensionPerformance(input: {
  decisions: MultiHorizonDecision[];
  bets: SettledBenchmarkBet[];
  dimension: 'market' | 'horizon' | 'league' | 'month';
}): Record<string, BettingPerformance> {
  const keyForBet = (bet: SettledBenchmarkBet): string => {
    if (input.dimension === 'market') return bet.marketKey;
    if (input.dimension === 'horizon') return `T-${bet.horizon}`;
    if (input.dimension === 'league') return String(bet.leagueId);
    return bet.kickoffAt.slice(0, 7);
  };
  const groups = new Map<string, SettledBenchmarkBet[]>();
  for (const bet of input.bets) {
    const key = keyForBet(bet);
    const rows = groups.get(key) ?? [];
    rows.push(bet);
    groups.set(key, rows);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([key, bets]) => {
      const decisionIds = new Set(bets.map((row) => row.decisionId));
      const decisions = input.decisions.filter(
        (row) => decisionIds.has(row.decisionId) || row.selectedCandidate?.marketKey === key,
      );
      return [key, summarizeBettingPerformance({ decisions, bets })];
    }),
  );
}

function emptyModel(model: BenchmarkModel): ModelBacktestResult {
  const performance = summarizeBettingPerformance({ decisions: [], bets: [] });
  return {
    model,
    performance,
    calibration: probabilityMetrics([]),
    noBetQuality: { assessable: 0, wouldWin: 0, wouldLose: 0, wouldVoid: 0 },
    byMarket: {},
    byHorizon: {},
    byLeague: {},
    byMonth: {},
  };
}

function emptyRuntime(status: BacktestReadiness, stage6DatasetFingerprint: string) {
  return {
    version: CHAMPION_CHALLENGER_BACKTEST_VERSION,
    status,
    stage6DatasetFingerprint,
    datasetFingerprint: sha256(''),
    models: Object.fromEntries(MODELS.map((model) => [model, emptyModel(model)])) as Record<
      BenchmarkModel,
      ModelBacktestResult
    >,
    decisionsByModel: {
      V7_5_DIXON_CHAMPION: [],
      V8_BAYESIAN: [],
      V8_HYBRID: [],
    },
    settledBets: [],
    integrity: {
      comparedDecisions: 0,
      decisionCountMismatch: 0,
      missingOutcomeRows: 0,
      missingComponentRows: 0,
      futureClosingOddsViolations: 0,
      fabricatedOddsRows: 0 as const,
    },
    championGate: {
      evaluated: true as const,
      promotionEligible: false,
      reasons: ['UPSTREAM_NOT_READY'],
      automaticPromotion: false as const,
      currentChampionChanged: false as const,
    },
    configuration: configuration(),
  };
}

function gitHead(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export async function loadChampionChallengerBacktestRuntime(): Promise<ChampionChallengerRuntimeResult> {
  const config = configuration();
  // These runtimes currently rebuild their immutable upstream views. Keep the
  // calls sequential so a 4 GB paper VPS does not hold three Stage 4 datasets
  // in memory at once.
  const stage6 = await loadMultiHorizonDecisionRuntime();
  const stage5 = await loadCalibrationRuntime();
  const stage4 = await loadHybridModelRuntime();
  if (
    stage6.status !== 'READY_FOR_BACKTEST' ||
    stage5.status !== 'READY_FOR_DECISION_ENGINE' ||
    stage4.status !== 'READY_FOR_CALIBRATION'
  ) {
    return emptyRuntime('BLOCKED_UPSTREAM', stage6.datasetFingerprint);
  }
  const testRows = stage5.rows.filter((row) => row.split === 'TEST');
  const stage5Map = new Map(testRows.map((row) => [rowKey(row.fixtureId, row.horizonMinutes), row]));
  const stage4Map = new Map(stage4.rows.map((row) => [rowKey(row.fixtureId, row.horizonMinutes), row]));
  const calibratorMap = new Map(stage5.calibrators.map((row) => [row.artifactHash, row]));
  const v7 = buildComponentDecisions({
    model: 'V7_5_DIXON_CHAMPION',
    hybridDecisions: stage6.decisions,
    stage4Rows: stage4Map,
    stage5Rows: stage5Map,
    calibrators: calibratorMap,
  });
  const bayesian = buildComponentDecisions({
    model: 'V8_BAYESIAN',
    hybridDecisions: stage6.decisions,
    stage4Rows: stage4Map,
    stage5Rows: stage5Map,
    calibrators: calibratorMap,
  });
  const decisionsByModel: Record<BenchmarkModel, MultiHorizonDecision[]> = {
    V7_5_DIXON_CHAMPION: v7.decisions,
    V8_BAYESIAN: bayesian.decisions,
    V8_HYBRID: stage6.decisions,
  };
  const fixtureIds = [...new Set(stage6.decisions.map((row) => row.fixtureId))];
  const odds = (await prisma.oddsSnapshot.findMany({
    where: { fixtureId: { in: fixtureIds }, isLive: false },
    select: {
      id: true,
      fixtureId: true,
      bookmakerId: true,
      marketId: true,
      selectionCode: true,
      lineValue: true,
      decimalOdds: true,
      capturedAt: true,
    },
  })) as OddsRow[];
  const settledBets: SettledBenchmarkBet[] = [];
  let missingOutcomeRows = 0;
  let futureClosingOddsViolations = 0;
  const models = {} as Record<BenchmarkModel, ModelBacktestResult>;
  for (const model of MODELS) {
    const decisions = decisionsByModel[model];
    const settled = settleModel({ model, decisions, stage5Rows: stage5Map, odds });
    settledBets.push(...settled.bets);
    missingOutcomeRows += settled.missingOutcomes;
    futureClosingOddsViolations += settled.futureClosingOddsViolations;
    models[model] = {
      model,
      performance: summarizeBettingPerformance({ decisions, bets: settled.bets }),
      calibration: calibrationForModel({
        model,
        stage4Rows: stage4Map,
        stage5Rows: testRows,
        calibrators: calibratorMap,
      }),
      noBetQuality: noBetQuality({ decisions, stage5Rows: stage5Map }),
      byMarket: dimensionPerformance({ decisions, bets: settled.bets, dimension: 'market' }),
      byHorizon: dimensionPerformance({ decisions, bets: settled.bets, dimension: 'horizon' }),
      byLeague: dimensionPerformance({ decisions, bets: settled.bets, dimension: 'league' }),
      byMonth: dimensionPerformance({ decisions, bets: settled.bets, dimension: 'month' }),
    };
  }
  const decisionCountMismatch = MODELS.filter(
    (model) => decisionsByModel[model].length !== stage6.decisions.length,
  ).length;
  const missingComponentRows = v7.missingComponents + bayesian.missingComponents;
  const champion = models.V7_5_DIXON_CHAMPION;
  const challenger = models.V8_HYBRID;
  const gateReasons: string[] = [];
  if (challenger.performance.totalStakeUnits < 100) gateReasons.push('PAPER_SAMPLE_BELOW_100_SETTLED_BETS');
  if ((challenger.calibration.logLoss ?? Infinity) > (champion.calibration.logLoss ?? Infinity) * 1.02) {
    gateReasons.push('LOG_LOSS_REGRESSION_ABOVE_2_PERCENT');
  }
  if ((challenger.calibration.ece ?? Infinity) > (champion.calibration.ece ?? Infinity) + 0.01) {
    gateReasons.push('ECE_REGRESSION_ABOVE_0_01');
  }
  if ((challenger.performance.roi ?? -Infinity) <= (champion.performance.roi ?? -Infinity)) {
    gateReasons.push('ROI_NOT_ABOVE_CURRENT_CHAMPION');
  }
  if (
    challenger.performance.maximumDrawdownUnits >
    Math.max(3, champion.performance.maximumDrawdownUnits * 1.25)
  ) {
    gateReasons.push('DRAWDOWN_ABOVE_CHAMPION_GUARD');
  }
  gateReasons.push('SHADOW_PRODUCTION_EVIDENCE_NOT_YET_COLLECTED');
  const integrityBlocked =
    decisionCountMismatch > 0 ||
    missingOutcomeRows > 0 ||
    missingComponentRows > 0 ||
    futureClosingOddsViolations > 0;
  const datasetFingerprint = sha256(
    stableStringify({
      stage6: stage6.datasetFingerprint,
      decisions: Object.fromEntries(
        MODELS.map((model) => [model, decisionsByModel[model].map((row) => row.decisionId)]),
      ),
      bets: settledBets,
    }),
  );
  return {
    version: CHAMPION_CHALLENGER_BACKTEST_VERSION,
    status: integrityBlocked ? 'BLOCKED_BACKTEST_INTEGRITY' : 'READY_FOR_PAPER_RUNTIME',
    stage6DatasetFingerprint: stage6.datasetFingerprint,
    datasetFingerprint,
    models,
    decisionsByModel,
    settledBets,
    integrity: {
      comparedDecisions: stage6.decisions.length,
      decisionCountMismatch,
      missingOutcomeRows,
      missingComponentRows,
      futureClosingOddsViolations,
      fabricatedOddsRows: 0,
    },
    championGate: {
      evaluated: true,
      promotionEligible: gateReasons.length === 0,
      reasons: gateReasons,
      automaticPromotion: false,
      currentChampionChanged: false,
    },
    configuration: config,
  };
}

export function championChallengerSummary(
  runtime: ChampionChallengerRuntimeResult,
): Record<string, unknown> {
  return {
    version: runtime.version,
    status: runtime.status,
    stage6DatasetFingerprint: runtime.stage6DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    models: Object.fromEntries(
      MODELS.map((model) => [
        model,
        {
          performance: runtime.models[model].performance,
          calibration: runtime.models[model].calibration,
          noBetQuality: runtime.models[model].noBetQuality,
          byMarket: runtime.models[model].byMarket,
          byHorizon: runtime.models[model].byHorizon,
          byLeague: runtime.models[model].byLeague,
          byMonth: runtime.models[model].byMonth,
        },
      ]),
    ),
    integrity: runtime.integrity,
    championGate: runtime.championGate,
    configuration: runtime.configuration,
    walkForward: true,
    pointInTime: true,
    flatStake: true,
    historicalOddsFabricated: false,
    apiCalled: false,
    schemaChanged: false,
    currentChampionChanged: false,
  };
}

export async function writeChampionChallengerArtifacts(): Promise<ChampionChallengerArtifactResult> {
  const runtime = await loadChampionChallengerBacktestRuntime();
  if (runtime.status !== 'READY_FOR_PAPER_RUNTIME') {
    throw new Error(`Stage 7 artifact export blocked: ${runtime.status}.`);
  }
  const root = repositoryRoot();
  const generatedAt = new Date();
  const runKey = `${generatedAt.toISOString().replace(/[-:.]/g, '')}-${runtime.datasetFingerprint.slice(0, 12)}`;
  const directory = resolve(runtime.configuration.artifactDirectory, runKey);
  mkdirSync(directory, { recursive: true });
  const decisionsContent = MODELS.flatMap((model) =>
    runtime.decisionsByModel[model].map((decision) => ({ model, decision })),
  )
    .map((row) => JSON.stringify(row))
    .join('\n') + '\n';
  const decisionsPath = resolve(directory, 'benchmark-decisions.jsonl');
  writeFileSync(decisionsPath, decisionsContent, 'utf8');
  const betsContent = runtime.settledBets.map((row) => JSON.stringify(row)).join('\n') + '\n';
  const betsPath = resolve(directory, 'settled-bets.jsonl');
  writeFileSync(betsPath, betsContent, 'utf8');
  const manifest = {
    version: runtime.version,
    generatedAt: generatedAt.toISOString(),
    gitHead: gitHead(root),
    status: runtime.status,
    stage6DatasetFingerprint: runtime.stage6DatasetFingerprint,
    datasetFingerprint: runtime.datasetFingerprint,
    summary: championChallengerSummary(runtime),
    configuration: {
      artifactDirectory: relative(root, runtime.configuration.artifactDirectory).replaceAll('\\', '/'),
      flatStakeUnits: 1,
    },
    files: {
      decisions: 'benchmark-decisions.jsonl',
      bets: 'settled-bets.jsonl',
      hashes: 'sha256.json',
    },
    safety: {
      walkForward: true,
      pointInTime: true,
      paperOnly: true,
      historicalOddsFabricated: false,
      automaticPromotion: false,
      currentChampionChanged: false,
      apiCalled: false,
      schemaChanged: false,
    },
  };
  const manifestContent = JSON.stringify(manifest, null, 2) + '\n';
  const manifestPath = resolve(directory, 'manifest.json');
  writeFileSync(manifestPath, manifestContent, 'utf8');
  const hashes = {
    'manifest.json': sha256(manifestContent),
    'benchmark-decisions.jsonl': sha256(decisionsContent),
    'settled-bets.jsonl': sha256(betsContent),
  };
  const hashesPath = resolve(directory, 'sha256.json');
  writeFileSync(hashesPath, JSON.stringify(hashes, null, 2) + '\n', 'utf8');
  return { directory, manifestPath, decisionsPath, betsPath, hashesPath, runtime };
}
