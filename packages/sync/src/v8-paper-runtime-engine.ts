import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { FixtureStatus, prisma, type InputJsonValue } from '@football-ai/database';
import {
  applyTemperature,
  type TemperatureCalibrator,
} from './calibration-uncertainty-contract.js';
import { buildBayesianPredictiveMarkets } from './bayesian-predictive-markets-contract.js';
import {
  BAYESIAN_TEAM_STRENGTH_VERSION,
  fitBayesianHierarchicalTeamStrength,
  type BayesianTrainingMatch,
} from './bayesian-team-strength-contract.js';
import { sha256, stableStringify } from './hybrid-data-foundation-contract.js';
import {
  DEFAULT_HYBRID_WEIGHT_REGISTRY,
  HYBRID_MODEL_VERSION,
  buildHybridMarketPrediction,
  type HybridMarketPrediction,
  type HybridModelComponent,
} from './hybrid-model-contract.js';
import {
  MULTI_HORIZON_DECISION_VERSION,
  MULTI_HORIZON_POLICY,
  MULTI_HORIZON_POLICY_VERSION,
  assessDecisionCandidate,
  buildMultiHorizonDecision,
  consensusFairProbabilities,
  type DecisionCandidate,
  type DecisionOddsQuote,
  type MultiHorizonDecision,
} from './multi-horizon-decision-contract.js';
import { settlePaperBetSelection } from './paper-bet-ledger-core.js';

export const V8_PAPER_RUNTIME_VERSION = 'v8.0-stage8-parallel-paper-runtime-v1';
export const V8_PAPER_ACCOUNT_KEY = 'PAPER_V8_CHALLENGER';

interface ProviderFixtureRow {
  providerFixtureId: number;
  providerLeagueId: number;
  kickoffAt: Date;
  homeProviderTeamId: number;
  awayProviderTeamId: number;
}

interface LocalFixtureRow {
  id: number;
  apiFixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
  league: { apiLeagueId: number };
  homeTeam: { apiTeamId: number };
  awayTeam: { apiTeamId: number };
}

interface ProviderOddsRow {
  id: number;
  providerFixtureId: number;
  sourceUpdatedAt: Date | null;
  observedAt: Date;
  bookmakerId: number;
  bookmakerName: string;
  marketType: string;
  selection: string;
  lineValue: number | null;
  decimalOdds: number;
}

interface LiveCandidateSource {
  candidate: DecisionCandidate;
  bookmakerId: number | null;
  bookmakerName: string | null;
  sourceUpdatedAt: Date | null;
  observedAt: Date | null;
}

interface DixonRow {
  id: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
  over25Probability: number;
  bttsProbability: number;
  payloadHash: string;
}

interface MlRow {
  id: number;
  modelVersion: string;
  finalHomeProbability: number;
  finalDrawProbability: number;
  finalAwayProbability: number;
  over25Probability: number;
  bttsProbability: number;
}

interface CalibrationRegistry {
  path: string;
  hash: string;
  calibrators: TemperatureCalibrator[];
}

export interface V8PaperRuntimeResult {
  version: string;
  accountKey: string;
  now: string;
  dryRun: boolean;
  calibrationArtifactPath: string;
  calibrationArtifactHash: string;
  providerFixturesScanned: number;
  dueEvents: number;
  existingDecisions: number;
  mappedFixtures: number;
  decisionsPlanned: number;
  decisionsRecorded: number;
  bestBets: number;
  noBets: number;
  skippedUnmapped: number;
  skippedModel: number;
  errors: Array<{ providerFixtureId: number; horizon: number; reason: string }>;
  decisions: MultiHorizonDecision[];
  safety: {
    appendOnly: true;
    pointInTime: true;
    paperOnly: true;
    flatStakeUnits: 1;
    automaticBetPlacement: false;
    realMoneyExecution: false;
    externalApiCalled: false;
    schemaChanged: false;
    currentChampionChanged: false;
  };
}

function jsonValue(value: unknown): InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as InputJsonValue;
}

function latestCalibrationPath(): string {
  const explicit = process.env.V8_CALIBRATORS_PATH?.trim();
  if (explicit) return resolve(explicit);
  const root = resolve('artifacts/hybrid/v8-stage5-calibration-uncertainty');
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(root, entry.name, 'calibrators.json'))
    .sort()
    .reverse();
  if (!candidates[0]) throw new Error('V8_CALIBRATION_ARTIFACT_MISSING');
  return candidates[0];
}

export function loadV8CalibrationRegistry(): CalibrationRegistry {
  const path = latestCalibrationPath();
  const content = readFileSync(path, 'utf8');
  const calibrators = JSON.parse(content) as TemperatureCalibrator[];
  if (!Array.isArray(calibrators) || calibrators.length === 0) {
    throw new Error('V8_CALIBRATION_ARTIFACT_INVALID');
  }
  return { path, hash: sha256(content), calibrators };
}

function calibratorFor(
  registry: CalibrationRegistry,
  marketKey: string,
  horizon: number,
  leagueId: number,
): TemperatureCalibrator {
  const league = registry.calibrators.find(
    (row) =>
      row.marketKey === marketKey &&
      row.horizonMinutes === horizon &&
      row.leagueId === leagueId &&
      row.accepted,
  );
  if (league) return league;
  const global = registry.calibrators.find(
    (row) =>
      row.marketKey === marketKey && row.horizonMinutes === horizon && row.leagueId == null,
  );
  if (!global) throw new Error(`V8_CALIBRATOR_MISSING:${marketKey}:T-${horizon}`);
  return global;
}

export function dueV8PaperHorizons(now: Date, kickoffAt: Date, toleranceMinutes = 2): number[] {
  const actual = (kickoffAt.getTime() - now.getTime()) / 60_000;
  const tolerance = Math.max(0, toleranceMinutes);
  return MULTI_HORIZON_POLICY.horizonsMinutes.filter(
    (horizon) => Math.abs(actual - horizon) <= tolerance,
  );
}

function probabilityTriple(input: { WIN: number; PUSH: number; LOSS: number }) {
  return { BELOW: input.LOSS, PUSH: input.PUSH, ABOVE: input.WIN };
}

async function liveHybridMarkets(input: {
  fixture: LocalFixtureRow;
  horizon: number;
  decisionAsOf: Date;
}): Promise<HybridMarketPrediction[]> {
  const resultLagMinutes = Math.max(0, Number(process.env.RESULT_AVAILABILITY_LAG_MINUTES ?? 180));
  const history = await prisma.fixture.findMany({
    where: {
      leagueId: input.fixture.leagueId,
      status: FixtureStatus.FINISHED,
      kickoffAt: { lt: input.decisionAsOf },
      homeGoals: { not: null },
      awayGoals: { not: null },
    },
    select: {
      id: true,
      leagueId: true,
      homeTeamId: true,
      awayTeamId: true,
      kickoffAt: true,
      homeGoals: true,
      awayGoals: true,
    },
    orderBy: [{ kickoffAt: 'asc' }, { id: 'asc' }],
  });
  type HistoryRow = {
    id: number;
    leagueId: number;
    homeTeamId: number;
    awayTeamId: number;
    kickoffAt: Date;
    homeGoals: number | null;
    awayGoals: number | null;
  };
  const matches: BayesianTrainingMatch[] = (history as HistoryRow[])
    .filter((row: HistoryRow) => row.homeGoals != null && row.awayGoals != null)
    .map((row: HistoryRow) => ({
      fixtureId: row.id,
      leagueId: row.leagueId,
      kickoffAt: row.kickoffAt,
      availableAt: new Date(row.kickoffAt.getTime() + resultLagMinutes * 60_000),
      homeTeamId: row.homeTeamId,
      awayTeamId: row.awayTeamId,
      homeGoals: row.homeGoals!,
      awayGoals: row.awayGoals!,
    }));
  const historyFingerprint = sha256(
    stableStringify(
      matches.map((row) => ({
        fixtureId: row.fixtureId,
        availableAt: row.availableAt.toISOString(),
        homeGoals: row.homeGoals,
        awayGoals: row.awayGoals,
      })),
    ),
  );
  const team = fitBayesianHierarchicalTeamStrength({
    fixtureId: input.fixture.id,
    leagueId: input.fixture.leagueId,
    homeTeamId: input.fixture.homeTeamId,
    awayTeamId: input.fixture.awayTeamId,
    predictionAsOf: input.decisionAsOf,
    matches,
    datasetFingerprint: historyFingerprint,
  });
  const bayesian = buildBayesianPredictiveMarkets({
    fixtureId: input.fixture.id,
    horizonMinutes: input.horizon,
    predictionAsOf: input.decisionAsOf,
    expectedHomeGoals: team.expectedHomeGoals,
    expectedAwayGoals: team.expectedAwayGoals,
    homeGoalsVarianceLog: team.expectedHomeGoalsInterval.varianceLog,
    awayGoalsVarianceLog: team.expectedAwayGoalsInterval.varianceLog,
    sourceTeamStrengthVersion: BAYESIAN_TEAM_STRENGTH_VERSION,
    sourceTeamStrengthHash: historyFingerprint,
  });
  const [dixon, ml] = await Promise.all([
    prisma.dixonColesPredictionSnapshot.findFirst({
      where: {
        fixtureId: input.fixture.id,
        horizonMinutes: input.horizon,
        predictionAsOf: { lte: input.decisionAsOf },
        trainedThrough: { lt: input.decisionAsOf },
      },
      select: {
        id: true,
        homeExpectedGoals: true,
        awayExpectedGoals: true,
        homeProbability: true,
        drawProbability: true,
        awayProbability: true,
        over25Probability: true,
        bttsProbability: true,
        payloadHash: true,
      },
      orderBy: [{ predictionAsOf: 'desc' }, { id: 'desc' }],
    }) as Promise<DixonRow | null>,
    prisma.mlPredictionSnapshot.findFirst({
      where: {
        fixtureId: input.fixture.id,
        horizonMinutes: input.horizon,
        predictionAsOf: { lte: input.decisionAsOf },
        trainedThrough: { lt: input.decisionAsOf },
      },
      select: {
        id: true,
        modelVersion: true,
        finalHomeProbability: true,
        finalDrawProbability: true,
        finalAwayProbability: true,
        over25Probability: true,
        bttsProbability: true,
      },
      orderBy: [{ predictionAsOf: 'desc' }, { id: 'desc' }],
    }) as Promise<MlRow | null>,
  ]);
  const dixonMarkets = dixon
    ? buildBayesianPredictiveMarkets({
        fixtureId: input.fixture.id,
        horizonMinutes: input.horizon,
        predictionAsOf: input.decisionAsOf,
        expectedHomeGoals: dixon.homeExpectedGoals,
        expectedAwayGoals: dixon.awayExpectedGoals,
        homeGoalsVarianceLog: 0,
        awayGoalsVarianceLog: 0,
        sourceTeamStrengthVersion: 'DIXON_COLES_BASELINE_V7_5',
        sourceTeamStrengthHash: dixon.payloadHash,
      })
    : null;
  const common = {
    leagueId: input.fixture.leagueId,
    horizonMinutes: input.horizon,
    registry: DEFAULT_HYBRID_WEIGHT_REGISTRY,
  };
  const hda: HybridModelComponent[] = [
    {
      component: 'BAYESIAN',
      modelVersion: bayesian.modelVersion,
      probabilities: { HOME: bayesian.hda.HOME, DRAW: bayesian.hda.DRAW, AWAY: bayesian.hda.AWAY },
    },
  ];
  const btts: HybridModelComponent[] = [
    {
      component: 'BAYESIAN',
      modelVersion: bayesian.modelVersion,
      probabilities: { YES: bayesian.btts.YES, NO: bayesian.btts.NO },
    },
  ];
  if (dixon) {
    hda.push({
      component: 'DIXON_COLES',
      modelVersion: 'DIXON_COLES_BASELINE_V7_5',
      probabilities: { HOME: dixon.homeProbability, DRAW: dixon.drawProbability, AWAY: dixon.awayProbability },
    });
    btts.push({
      component: 'DIXON_COLES',
      modelVersion: 'DIXON_COLES_BASELINE_V7_5',
      probabilities: { YES: dixon.bttsProbability, NO: 1 - dixon.bttsProbability },
    });
  }
  if (ml) {
    hda.push({
      component: 'ML_SPECIALIST',
      modelVersion: ml.modelVersion,
      probabilities: {
        HOME: ml.finalHomeProbability,
        DRAW: ml.finalDrawProbability,
        AWAY: ml.finalAwayProbability,
      },
    });
    btts.push({
      component: 'ML_SPECIALIST',
      modelVersion: ml.modelVersion,
      probabilities: { YES: ml.bttsProbability, NO: 1 - ml.bttsProbability },
    });
  }
  const markets = [
    buildHybridMarketPrediction({ market: 'HDA', components: hda, ...common }),
    buildHybridMarketPrediction({ market: 'BTTS', components: btts, ...common }),
  ];
  for (const total of bayesian.totalGoals) {
    const components: HybridModelComponent[] = [
      {
        component: 'BAYESIAN',
        modelVersion: bayesian.modelVersion,
        probabilities: probabilityTriple(total.OVER),
      },
    ];
    const dixonTotal = dixonMarkets?.totalGoals.find((row) => row.line === total.line);
    if (dixonTotal) {
      components.push({
        component: 'DIXON_COLES',
        modelVersion: 'DIXON_COLES_BASELINE_V7_5',
        probabilities:
          total.line === 2.5 && dixon
            ? { BELOW: 1 - dixon.over25Probability, PUSH: 0, ABOVE: dixon.over25Probability }
            : probabilityTriple(dixonTotal.OVER),
      });
    }
    if (ml && total.line === 2.5) {
      components.push({
        component: 'ML_SPECIALIST',
        modelVersion: ml.modelVersion,
        probabilities: { BELOW: 1 - ml.over25Probability, PUSH: 0, ABOVE: ml.over25Probability },
      });
    }
    markets.push(
      buildHybridMarketPrediction({
        market: 'TOTAL_GOALS',
        line: total.line,
        components,
        ...common,
      }),
    );
  }
  return markets;
}

function marketKey(market: HybridMarketPrediction): string {
  return market.market === 'TOTAL_GOALS' ? `TOTAL_GOALS:${market.line}` : market.market;
}

function marketOddsDefinition(key: string): { marketType: string; line: number | null; selections: string[] } {
  if (key === 'HDA') return { marketType: 'MATCH_WINNER', line: null, selections: ['HOME', 'DRAW', 'AWAY'] };
  if (key === 'BTTS') return { marketType: 'BTTS', line: null, selections: ['YES', 'NO'] };
  const line = Number(key.slice('TOTAL_GOALS:'.length));
  return { marketType: 'TOTAL_GOALS', line, selections: ['UNDER', 'OVER'] };
}

export function v8PaperMarketType(key: string): string {
  if (key === 'HDA') return 'MATCH_WINNER';
  if (key === 'BTTS') return 'BTTS';
  return `TOTAL_GOALS_${key.slice('TOTAL_GOALS:'.length).replace('.', '_')}`;
}

function buildLiveCandidates(input: {
  fixtureId: number;
  decisionAsOf: Date;
  leagueId: number;
  horizon: number;
  markets: HybridMarketPrediction[];
  odds: ProviderOddsRow[];
  calibrations: CalibrationRegistry;
}): LiveCandidateSource[] {
  const maxAge = MULTI_HORIZON_POLICY.maximumOddsAgeMinutes * 60_000;
  const results: LiveCandidateSource[] = [];
  for (const market of input.markets.filter((row) => row.market !== 'TOTAL_GOALS' || [1.5, 2.5, 3.5].includes(row.line!))) {
    const key = marketKey(market);
    const definition = marketOddsDefinition(key);
    const calibrator = calibratorFor(input.calibrations, key, input.horizon, input.leagueId);
    const calibrated = applyTemperature(market.rawProbability, calibrator.temperature);
    const latest = new Map<string, ProviderOddsRow>();
    for (const row of input.odds) {
      if (row.marketType !== definition.marketType) continue;
      if (definition.line != null && Math.abs((row.lineValue ?? -999) - definition.line) > 1e-9) continue;
      if (!definition.selections.includes(row.selection)) continue;
      const effective = row.sourceUpdatedAt ?? row.observedAt;
      if (effective.getTime() > input.decisionAsOf.getTime()) continue;
      if (input.decisionAsOf.getTime() - effective.getTime() > maxAge) continue;
      const rowKey = `${row.bookmakerId}:${row.selection}`;
      const existing = latest.get(rowKey);
      if (!existing || row.observedAt.getTime() > existing.observedAt.getTime()) latest.set(rowKey, row);
    }
    const byBook = new Map<number, ProviderOddsRow[]>();
    for (const row of latest.values()) {
      const rows = byBook.get(row.bookmakerId) ?? [];
      rows.push(row);
      byBook.set(row.bookmakerId, rows);
    }
    const complete = [...byBook.values()].filter((rows) =>
      definition.selections.every((selection) => rows.some((row) => row.selection === selection)),
    );
    const quoteSets: DecisionOddsQuote[][] = complete.map((rows) =>
      definition.selections.map((selection) => {
        const row = rows.find((item) => item.selection === selection)!;
        return {
          oddsSnapshotId: row.id,
          bookmakerId: row.bookmakerId,
          selection,
          decimalOdds: row.decimalOdds,
          capturedAt: (row.sourceUpdatedAt ?? row.observedAt).toISOString(),
        };
      }),
    );
    const fair = quoteSets.length ? consensusFairProbabilities(quoteSets) : {};
    for (const selection of definition.selections) {
      const quote = quoteSets
        .flat()
        .filter((row) => row.selection === selection)
        .sort((left, right) => right.decimalOdds - left.decimalOdds)[0] ?? null;
      const source = quote ? input.odds.find((row) => row.id === quote.oddsSnapshotId) ?? null : null;
      const modelSelection = selection === 'UNDER' ? 'BELOW' : selection === 'OVER' ? 'ABOVE' : selection;
      const candidate = assessDecisionCandidate({
        marketKey: key,
        selection,
        line: definition.line,
        modelProbability: calibrated[modelSelection] ?? 0,
        pushProbability: calibrated.PUSH ?? 0,
        fairMarketProbability: fair[selection] ?? null,
        quote,
        reliability: Math.max(0, 1 - (calibrator.calibratedCalibrationMetrics.ece ?? 0.25)),
        uncertainty: Math.min(1, market.componentDisagreement + (calibrator.calibratedCalibrationMetrics.ece ?? 0.25)),
        uncertaintyPenalty: Math.min(0.75, market.componentDisagreement * 2.5 + (calibrator.calibratedCalibrationMetrics.ece ?? 0.25) * 0.5),
      });
      results.push({
        candidate,
        bookmakerId: source?.bookmakerId ?? null,
        bookmakerName: source?.bookmakerName ?? null,
        sourceUpdatedAt: source?.sourceUpdatedAt ?? null,
        observedAt: source?.observedAt ?? null,
      });
    }
  }
  return results;
}

async function persistDecision(input: {
  providerFixtureId: number;
  localFixtureId: number;
  decision: MultiHorizonDecision;
  candidates: LiveCandidateSource[];
}): Promise<boolean> {
  const existing = await prisma.scientificPaperBetDecision.findUnique({
    where: { decisionHash: input.decision.decisionId },
    select: { id: true },
  });
  if (existing) return false;
  const selected = input.decision.selectedCandidate;
  const selectedSource = selected
    ? input.candidates.find(
        (row) =>
          row.candidate.marketKey === selected.marketKey &&
          row.candidate.selection === selected.selection &&
          row.candidate.oddsSnapshotId === selected.oddsSnapshotId,
      ) ?? null
    : null;
  await prisma.$transaction(async (tx: typeof prisma) => {
    const row = await tx.scientificPaperBetDecision.create({
      data: {
        providerFixtureId: input.providerFixtureId,
        localFixtureId: input.localFixtureId,
        horizonMinutes: input.decision.horizon,
        decisionAsOf: new Date(input.decision.decisionAsOf),
        kickoffAt: new Date(input.decision.kickoffAt),
        decisionType: input.decision.decision,
        selectedMarket: selected ? v8PaperMarketType(selected.marketKey) : null,
        selectedSelection: selected?.selection ?? null,
        lineValue: selected?.line ?? null,
        decimalOdds: selected?.odds ?? null,
        bookmakerId: selectedSource?.bookmakerId ?? null,
        bookmakerName: selectedSource?.bookmakerName ?? null,
        modelProbability: selected?.modelProbability ?? null,
        fairMarketProbability: selected?.fairMarketProbability ?? null,
        impliedProbability: selected?.odds ? 1 / selected.odds : null,
        edge: selected?.edge ?? null,
        expectedValue: selected?.expectedValue ?? null,
        modelVersion: V8_PAPER_RUNTIME_VERSION,
        policyVersion: MULTI_HORIZON_POLICY_VERSION,
        reliabilityStatus: selected ? `RELIABILITY=${selected.reliability.toFixed(6)}` : null,
        sourceOddsSnapshotId: selected?.oddsSnapshotId ?? null,
        sourceOddsUpdatedAt: selectedSource?.sourceUpdatedAt ?? null,
        sourceOddsObservedAt: selectedSource?.observedAt ?? null,
        candidateCount: input.candidates.length,
        rejectedCandidateCount: input.candidates.filter((candidate) => !candidate.candidate.eligible).length,
        decisionPayload: jsonValue({
          accountKey: V8_PAPER_ACCOUNT_KEY,
          decision: input.decision,
          candidates: input.candidates,
          paperOnly: true,
          automaticBetPlacement: false,
          realMoneyExecution: false,
        }),
        decisionHash: input.decision.decisionId,
      },
    });
    const priced = input.candidates.filter(
      (entry) =>
        entry.candidate.odds != null &&
        entry.candidate.fairMarketProbability != null &&
        entry.bookmakerId != null &&
        entry.bookmakerName != null,
    );
    if (priced.length) {
      await tx.scientificPaperBetCandidate.createMany({
        data: priced.map((entry, index) => ({
          decisionId: row.id,
          providerFixtureId: input.providerFixtureId,
          marketType: v8PaperMarketType(entry.candidate.marketKey),
          selection: entry.candidate.selection,
          lineValue: entry.candidate.line,
          decimalOdds: entry.candidate.odds!,
          bookmakerId: entry.bookmakerId!,
          bookmakerName: entry.bookmakerName!,
          modelProbability: entry.candidate.modelProbability,
          fairMarketProbability: entry.candidate.fairMarketProbability!,
          impliedProbability: 1 / entry.candidate.odds!,
          edge: entry.candidate.edge!,
          expectedValue: entry.candidate.expectedValue!,
          reliabilityStatus: `RELIABILITY=${entry.candidate.reliability.toFixed(6)}`,
          eligible: entry.candidate.eligible,
          rejectionReasons: jsonValue(entry.candidate.reasonCodes),
          sourceOddsSnapshotId: entry.candidate.oddsSnapshotId,
          candidatePayload: jsonValue(entry),
          candidateHash: sha256(
            stableStringify({ decisionId: input.decision.decisionId, index, entry }),
          ),
        })),
        skipDuplicates: true,
      });
    }
  });
  return true;
}

async function localFixture(provider: ProviderFixtureRow): Promise<LocalFixtureRow | null> {
  const row = (await prisma.fixture.findUnique({
    where: { apiFixtureId: provider.providerFixtureId },
    select: {
      id: true,
      apiFixtureId: true,
      leagueId: true,
      homeTeamId: true,
      awayTeamId: true,
      kickoffAt: true,
      league: { select: { apiLeagueId: true } },
      homeTeam: { select: { apiTeamId: true } },
      awayTeam: { select: { apiTeamId: true } },
    },
  })) as LocalFixtureRow | null;
  if (!row) return null;
  const valid =
    row.apiFixtureId === provider.providerFixtureId &&
    row.league.apiLeagueId === provider.providerLeagueId &&
    row.homeTeam.apiTeamId === provider.homeProviderTeamId &&
    row.awayTeam.apiTeamId === provider.awayProviderTeamId &&
    Math.abs(row.kickoffAt.getTime() - provider.kickoffAt.getTime()) <= 10 * 60_000;
  return valid ? row : null;
}

export async function runV8PaperRuntime(input: { now?: Date; dryRun?: boolean } = {}): Promise<V8PaperRuntimeResult> {
  const now = input.now ?? new Date();
  const dryRun = input.dryRun ?? process.env.V8_PAPER_WRITE_ENABLED !== 'true';
  const calibration = loadV8CalibrationRegistry();
  const maximum = Math.max(...MULTI_HORIZON_POLICY.horizonsMinutes) + 5;
  const providerRows = (await prisma.apiFootballFixtureSnapshot.findMany({
    where: { kickoffAt: { gt: now, lte: new Date(now.getTime() + maximum * 60_000) } },
    select: {
      providerFixtureId: true,
      providerLeagueId: true,
      kickoffAt: true,
      homeProviderTeamId: true,
      awayProviderTeamId: true,
      observedAt: true,
    },
    orderBy: [{ observedAt: 'desc' }],
    take: 2000,
  })) as Array<ProviderFixtureRow & { observedAt: Date }>;
  const latest = new Map<number, ProviderFixtureRow>();
  for (const row of providerRows) if (!latest.has(row.providerFixtureId)) latest.set(row.providerFixtureId, row);
  const result: V8PaperRuntimeResult = {
    version: V8_PAPER_RUNTIME_VERSION,
    accountKey: V8_PAPER_ACCOUNT_KEY,
    now: now.toISOString(),
    dryRun,
    calibrationArtifactPath: calibration.path,
    calibrationArtifactHash: calibration.hash,
    providerFixturesScanned: latest.size,
    dueEvents: 0,
    existingDecisions: 0,
    mappedFixtures: 0,
    decisionsPlanned: 0,
    decisionsRecorded: 0,
    bestBets: 0,
    noBets: 0,
    skippedUnmapped: 0,
    skippedModel: 0,
    errors: [],
    decisions: [],
    safety: {
      appendOnly: true,
      pointInTime: true,
      paperOnly: true,
      flatStakeUnits: 1,
      automaticBetPlacement: false,
      realMoneyExecution: false,
      externalApiCalled: false,
      schemaChanged: false,
      currentChampionChanged: false,
    },
  };
  for (const provider of latest.values()) {
    const tolerance = Math.max(0, Number(process.env.V8_PAPER_TOLERANCE_MINUTES ?? 2));
    for (const horizon of dueV8PaperHorizons(now, provider.kickoffAt, tolerance)) {
      result.dueEvents += 1;
      const existing = await prisma.scientificPaperBetDecision.findFirst({
        where: {
          providerFixtureId: provider.providerFixtureId,
          kickoffAt: provider.kickoffAt,
          horizonMinutes: horizon,
          modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION },
        },
        select: { id: true },
      });
      if (existing) {
        result.existingDecisions += 1;
        continue;
      }
      const fixture = await localFixture(provider);
      if (!fixture) {
        result.skippedUnmapped += 1;
        continue;
      }
      result.mappedFixtures += 1;
      try {
        const [markets, odds] = await Promise.all([
          liveHybridMarkets({ fixture, horizon, decisionAsOf: now }),
          prisma.apiFootballOddsSnapshot.findMany({
            where: {
              providerFixtureId: provider.providerFixtureId,
              pitUsable: true,
              observedAt: { lte: now },
              kickoffAt: { gt: now },
            },
            select: {
              id: true,
              providerFixtureId: true,
              sourceUpdatedAt: true,
              observedAt: true,
              bookmakerId: true,
              bookmakerName: true,
              marketType: true,
              selection: true,
              lineValue: true,
              decimalOdds: true,
            },
            orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
          }) as Promise<ProviderOddsRow[]>,
        ]);
        const candidates = buildLiveCandidates({
          fixtureId: fixture.id,
          decisionAsOf: now,
          leagueId: fixture.leagueId,
          horizon,
          markets,
          odds,
          calibrations: calibration,
        });
        const decision = buildMultiHorizonDecision({
          fixtureId: fixture.id,
          decisionAsOf: now.toISOString(),
          kickoffAt: fixture.kickoffAt.toISOString(),
          horizon,
          candidates: candidates.map((row) => row.candidate),
          modelVersion: `${V8_PAPER_RUNTIME_VERSION}::${HYBRID_MODEL_VERSION}`,
          stage5RowHash: calibration.hash,
        });
        result.decisions.push(decision);
        result.decisionsPlanned += 1;
        if (decision.decision === 'BEST_BET') result.bestBets += 1;
        else result.noBets += 1;
        if (!dryRun) {
          const recorded = await persistDecision({
            providerFixtureId: provider.providerFixtureId,
            localFixtureId: fixture.id,
            decision,
            candidates,
          });
          if (recorded) result.decisionsRecorded += 1;
        }
      } catch (error) {
        result.skippedModel += 1;
        result.errors.push({
          providerFixtureId: provider.providerFixtureId,
          horizon,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return result;
}

export async function settleV8PaperFromArchive(now = new Date()) {
  const decisions = await prisma.scientificPaperBetDecision.findMany({
    where: {
      modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION },
      decisionType: 'BEST_BET',
      settlement: null,
      kickoffAt: { lt: now },
    },
    take: 500,
  });
  let settled = 0;
  let waiting = 0;
  for (const decision of decisions) {
    const fixture = await prisma.apiFootballFixtureSnapshot.findFirst({
      where: {
        providerFixtureId: decision.providerFixtureId,
        statusShort: { in: ['FT', 'AET', 'PEN'] },
        fulltimeHomeGoals: { not: null },
        fulltimeAwayGoals: { not: null },
      },
      orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
    });
    if (
      !fixture ||
      fixture.fulltimeHomeGoals == null ||
      fixture.fulltimeAwayGoals == null ||
      !decision.selectedMarket ||
      !decision.selectedSelection ||
      !decision.decimalOdds
    ) {
      waiting += 1;
      continue;
    }
    const outcome = settlePaperBetSelection({
      marketType: decision.selectedMarket,
      selection: decision.selectedSelection,
      lineValue: decision.lineValue,
      homeGoals: fixture.fulltimeHomeGoals,
      awayGoals: fixture.fulltimeAwayGoals,
      decimalOdds: decision.decimalOdds,
      stakeUnits: 1,
    });
    const closing = decision.bookmakerId == null
      ? null
      : await prisma.apiFootballOddsSnapshot.findFirst({
          where: {
            providerFixtureId: decision.providerFixtureId,
            bookmakerId: decision.bookmakerId,
            selection: decision.selectedSelection,
            lineValue: decision.lineValue,
            observedAt: { lte: decision.kickoffAt },
          },
          orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        });
    const clv = closing ? decision.decimalOdds / closing.decimalOdds - 1 : null;
    const payload = {
      version: V8_PAPER_RUNTIME_VERSION,
      decisionHash: decision.decisionHash,
      fixtureSnapshotId: fixture.id,
      result: outcome,
      closingOddsSnapshotId: closing?.id ?? null,
      clv,
      paperOnly: true,
    };
    const created = await prisma.scientificPaperBetSettlement.createMany({
      data: [{
        decisionId: decision.id,
        providerFixtureId: decision.providerFixtureId,
        settledAt: now,
        sourceFixtureObservedAt: fixture.observedAt,
        statusShort: fixture.statusShort,
        fulltimeHomeGoals: fixture.fulltimeHomeGoals,
        fulltimeAwayGoals: fixture.fulltimeAwayGoals,
        result: outcome.result,
        stakeUnits: outcome.stakeUnits,
        profitUnits: outcome.profitUnits,
        closingDecimalOdds: closing?.decimalOdds ?? null,
        closingFairProbability: null,
        clv,
        settlementPayload: jsonValue(payload),
        settlementHash: sha256(stableStringify(payload)),
      }],
      skipDuplicates: true,
    });
    settled += created.count;
  }
  return {
    version: V8_PAPER_RUNTIME_VERSION,
    considered: decisions.length,
    settled,
    waiting,
    externalApiCalled: false,
    paperOnly: true,
  };
}

export async function getV8PaperRuntimeCoverage() {
  const [decisions, bestBets, noBets, settlements, aggregates] = await Promise.all([
    prisma.scientificPaperBetDecision.count({ where: { modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION } } }),
    prisma.scientificPaperBetDecision.count({ where: { modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION }, decisionType: 'BEST_BET' } }),
    prisma.scientificPaperBetDecision.count({ where: { modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION }, decisionType: 'NO_BET' } }),
    prisma.scientificPaperBetSettlement.count({ where: { decision: { modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION } } } }),
    prisma.scientificPaperBetSettlement.aggregate({
      where: { decision: { modelVersion: { startsWith: V8_PAPER_RUNTIME_VERSION } } },
      _sum: { stakeUnits: true, profitUnits: true },
      _avg: { clv: true },
    }),
  ]);
  const stake = aggregates._sum.stakeUnits ?? 0;
  return {
    version: V8_PAPER_RUNTIME_VERSION,
    accountKey: V8_PAPER_ACCOUNT_KEY,
    decisions,
    bestBets,
    noBets,
    settlements,
    totalStakeUnits: stake,
    profitUnits: aggregates._sum.profitUnits ?? 0,
    roi: stake ? (aggregates._sum.profitUnits ?? 0) / stake : null,
    meanClv: aggregates._avg.clv ?? null,
    openBestBets: bestBets - settlements,
    appendOnly: true,
    paperOnly: true,
    flatStakeUnits: 1,
    automaticBetPlacement: false,
    realMoneyExecution: false,
    currentChampionChanged: false,
  };
}

export async function runV8PaperRuntimeCycle() {
  const decisions = await runV8PaperRuntime();
  const settlement = await settleV8PaperFromArchive();
  return {
    version: V8_PAPER_RUNTIME_VERSION,
    decisions,
    settlement,
    paperOnly: true,
    externalApiCalled: false,
    realMoneyExecution: false,
  };
}
