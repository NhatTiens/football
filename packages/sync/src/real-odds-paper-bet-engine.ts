import { prisma } from '@football-ai/database';
import { buildOuGoalDistribution, OU_ENGINE_VERSION } from '@football-ai/engine';

import { getFundamentalsFixturePrediction } from './fundamentals-engine.js';
import { getScientificFixtureAnalysis } from './scientific-features.js';
import { SCIENTIFIC_MODEL_VERSION } from './scientific-model.js';
import { deriveScientificScoreGridMarkets } from './scientific-multi-market-replay-contract.js';
import {
  buildFrozenShadowCandidateProbability,
  normalizeShadowProbabilities,
} from './scientific-shadow-contract.js';
import {
  SCIENTIFIC_BEST_BET_POLICY_VERSION,
  type ScientificBestBetMarket,
} from './scientific-best-bet-policy-contract.js';
import { getScientificBestBetReliabilityReport } from './scientific-best-bet-reliability-engine.js';
import {
  recordScientificPaperBetDecision,
  settleOpenScientificPaperBets,
} from './paper-bet-ledger-engine.js';
import {
  LIVE_PAPER_BET_ENGINE_VERSION,
  buildLivePaperBetCandidates,
  dueLivePaperBetHorizons,
  parseLivePaperBetHorizons,
  type LiveMarketType,
  type LiveModelProbabilities,
  type LiveOddsRow,
  type LivePaperBetHorizon,
  type LiveReliabilityGate,
} from './real-odds-paper-bet-core.js';

interface ProviderFixtureRow {
  id: number;
  providerFixtureId: number;
  providerLeagueId: number;
  kickoffAt: Date;
  statusShort: string;
  homeProviderTeamId: number;
  awayProviderTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  observedAt: Date;
}

interface LocalFixtureRow {
  id: number;
  apiFixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  kickoffAt: Date;
  league: {
    apiLeagueId: number;
  };
  homeTeam: {
    apiTeamId: number;
    name: string;
  };
  awayTeam: {
    apiTeamId: number;
    name: string;
  };
}

interface FrozenRegistryRow {
  id: number;
  candidateVersion: string;
  baselineVersion: string;
  status: string;
  horizonMinutes: number;
  marketBranch: string;
  weights: unknown;
  temperature: number;
  maximumProbabilityShift: number;
  frozenAt: Date;
}

export interface LivePaperBetDecisionRunResult {
  version: string;
  now: string;
  horizons: LivePaperBetHorizon[];
  toleranceMinutes: number;
  maxOddsAgeMinutes: number;
  providerFixturesScanned: number;
  dueEvents: number;
  existingDecisions: number;
  mappedFixtures: number;
  decisionsRecorded: number;
  bestBets: number;
  noBets: number;
  skippedUnmappedFixture: number;
  skippedMappingMismatch: number;
  skippedNoOdds: number;
  skippedNoModel: number;
  skippedNoCandidates: number;
  errors: Array<{
    providerFixtureId: number;
    horizonMinutes: number;
    reason: string;
  }>;
  apiCalled: false;
  realMoneyExecution: false;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];

  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number.`);
  }

  return value;
}

function weightsRecord(value: unknown): Record<string, number> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, Number(item)])
      .filter(([, item]) => Number.isFinite(item)),
  );
}

function effectiveOddsTime(row: LiveOddsRow): Date {
  return row.sourceUpdatedAt ?? row.observedAt;
}

function latestProviderFixtures(rows: ProviderFixtureRow[]): ProviderFixtureRow[] {
  const latest = new Map<number, ProviderFixtureRow>();

  for (const row of rows) {
    if (!latest.has(row.providerFixtureId)) {
      latest.set(row.providerFixtureId, row);
    }
  }

  return [...latest.values()];
}

async function loadFrozenT90Registry(decisionAsOf: Date): Promise<FrozenRegistryRow | null> {
  const row = (await prisma.scientificCandidateRegistry.findFirst({
    where: {
      status: 'FROZEN_FOR_SHADOW',
      horizonMinutes: 90,
      marketBranch: 'NO_MARKET',
      frozenAt: {
        lte: decisionAsOf,
      },
    },
    orderBy: {
      frozenAt: 'desc',
    },
    select: {
      id: true,
      candidateVersion: true,
      baselineVersion: true,
      status: true,
      horizonMinutes: true,
      marketBranch: true,
      weights: true,
      temperature: true,
      maximumProbabilityShift: true,
      frozenAt: true,
    },
  })) as FrozenRegistryRow | null;

  return row;
}

function validatedMapping(provider: ProviderFixtureRow, local: LocalFixtureRow): boolean {
  const kickoffDifference = Math.abs(provider.kickoffAt.getTime() - local.kickoffAt.getTime());

  return (
    local.apiFixtureId === provider.providerFixtureId &&
    local.league.apiLeagueId === provider.providerLeagueId &&
    local.homeTeam.apiTeamId === provider.homeProviderTeamId &&
    local.awayTeam.apiTeamId === provider.awayProviderTeamId &&
    kickoffDifference <= 10 * 60_000
  );
}

async function loadLocalFixture(provider: ProviderFixtureRow): Promise<LocalFixtureRow | null> {
  return (await prisma.fixture.findUnique({
    where: {
      apiFixtureId: provider.providerFixtureId,
    },
    select: {
      id: true,
      apiFixtureId: true,
      leagueId: true,
      homeTeamId: true,
      awayTeamId: true,
      kickoffAt: true,
      league: {
        select: {
          apiLeagueId: true,
        },
      },
      homeTeam: {
        select: {
          apiTeamId: true,
          name: true,
        },
      },
      awayTeam: {
        select: {
          apiTeamId: true,
          name: true,
        },
      },
    },
  })) as LocalFixtureRow | null;
}

async function loadDecisionOdds(input: {
  providerFixtureId: number;
  decisionAsOf: Date;
  maxOddsAgeMinutes: number;
}): Promise<LiveOddsRow[]> {
  const cutoff = new Date(input.decisionAsOf.getTime() - input.maxOddsAgeMinutes * 60_000);
  const rows = (await prisma.apiFootballOddsSnapshot.findMany({
    where: {
      providerFixtureId: input.providerFixtureId,
      pitUsable: true,
      observedAt: {
        lte: input.decisionAsOf,
        gte: cutoff,
      },
      kickoffAt: {
        gt: input.decisionAsOf,
      },
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
    orderBy: [
      {
        observedAt: 'desc',
      },
      {
        id: 'desc',
      },
    ],
  })) as LiveOddsRow[];

  return rows.filter((row) => effectiveOddsTime(row).getTime() >= cutoff.getTime());
}

function reliabilityGates(input: {
  horizon: LivePaperBetHorizon;
  frozenRegistryAvailable: boolean;
  report: Awaited<ReturnType<typeof getScientificBestBetReliabilityReport>>;
  dataQualityScore: number;
}): Record<LiveMarketType, LiveReliabilityGate> {
  const markets: LiveMarketType[] = [
    'MATCH_WINNER',
    'TOTAL_GOALS_1_5',
    'TOTAL_GOALS_2_5',
    'TOTAL_GOALS_3_5',
    'BTTS',
  ];
  const result = {} as Record<LiveMarketType, LiveReliabilityGate>;

  for (const market of markets) {
    const historical = input.report.reliability[market as ScientificBestBetMarket];

    if (historical == null) {
      result[market] = {
        market,
        status: 'RELIABILITY_REPORT_MISSING',
        eligible: false,
      };
      continue;
    }

    const isOuMarket = market.startsWith('TOTAL_GOALS_');
    const horizonValidated =
      (market === 'MATCH_WINNER' && input.horizon === 90 && input.frozenRegistryAvailable) ||
      isOuMarket;
    const dataQualityValidated =
      !isOuMarket || input.dataQualityScore >= envNumber('PAPER_OU_MIN_DATA_QUALITY_SCORE', 0.4);
    result[market] = {
      market,
      status: !dataQualityValidated
        ? `DATA_QUALITY_BELOW_MINIMUM:${historical.status}`
        : horizonValidated
          ? historical.status
          : market === 'MATCH_WINNER' && input.horizon !== 90
            ? `HORIZON_NOT_VALIDATED:${historical.status}`
            : market === 'MATCH_WINNER' && !input.frozenRegistryAvailable
              ? `FROZEN_T90_REGISTRY_UNAVAILABLE:${historical.status}`
              : `MARKET_NOT_PROMOTION_ENABLED:${historical.status}`,
      eligible: historical.diagnosticEligible && horizonValidated && dataQualityValidated,
    };
  }

  return result;
}

async function buildModelProbabilities(input: {
  localFixture: LocalFixtureRow;
  decisionAsOf: Date;
  horizon: LivePaperBetHorizon;
  frozenRegistry: FrozenRegistryRow | null;
}): Promise<{
  probabilities: LiveModelProbabilities;
  source: {
    baselineModelVersion: string;
    liveEngineVersion: string;
    decisionModelVersion: string;
    frozenCandidateVersion: string | null;
    frozenRegistryId: number | null;
    dixonSampleSize: number;
    dixonTrainedThrough: string;
    dataQualityScore: number;
    goalDistributionId: string;
  };
}> {
  const [baseline, fundamentals] = await Promise.all([
    getScientificFixtureAnalysis({
      fixtureId: input.localFixture.id,
      leagueId: input.localFixture.leagueId,
      homeTeamId: input.localFixture.homeTeamId,
      awayTeamId: input.localFixture.awayTeamId,
      homeTeamName: input.localFixture.homeTeam.name,
      awayTeamName: input.localFixture.awayTeam.name,
      kickoffAt: input.localFixture.kickoffAt,
      predictionAsOf: input.decisionAsOf,
      mode: 'LIVE',
      useMachineLearning: true,
    }),
    getFundamentalsFixturePrediction({
      fixtureId: input.localFixture.id,
      leagueId: input.localFixture.leagueId,
      homeTeamId: input.localFixture.homeTeamId,
      awayTeamId: input.localFixture.awayTeamId,
      kickoffAt: input.localFixture.kickoffAt,
      predictionAsOf: input.decisionAsOf,
      horizonMinutes: input.horizon,
      persist: true,
    }),
  ]);

  if (!fundamentals.available || fundamentals.dixonColes == null) {
    throw new Error('NO_DIXON_COLES_MODEL_AT_DECISION_AS_OF');
  }

  if (fundamentals.dixonColes.trainedThrough.getTime() > input.decisionAsOf.getTime()) {
    throw new Error('DIXON_COLES_PIT_VIOLATION');
  }

  const scoreGrid = deriveScientificScoreGridMarkets({
    homeExpectedGoals: fundamentals.homeExpectedGoals,
    awayExpectedGoals: fundamentals.awayExpectedGoals,
    rho: fundamentals.dixonColes.rho,
    maximumGoals: 10,
  });
  const ouDistribution = buildOuGoalDistribution({
    expectedHomeGoals: fundamentals.homeExpectedGoals,
    expectedAwayGoals: fundamentals.awayExpectedGoals,
    rho: fundamentals.dixonColes.rho,
    maximumGoalsPerTeam: 10,
    calibrationUnder25: baseline.over25.UNDER,
  });
  const baselineHda = normalizeShadowProbabilities({
    HOME: baseline.matchWinner.HOME,
    DRAW: baseline.matchWinner.DRAW,
    AWAY: baseline.matchWinner.AWAY,
  });
  let hda = baselineHda;
  let frozenCandidateVersion: string | null = null;
  let frozenRegistryId: number | null = null;

  if (input.horizon === 90 && input.frozenRegistry != null) {
    const weights = weightsRecord(input.frozenRegistry.weights);

    hda = buildFrozenShadowCandidateProbability(baselineHda, scoreGrid.matchWinner, {
      baselineWeight: weights.baseline ?? 0,
      dixonColesWeight: weights.dixonColes ?? 0,
      temperature: input.frozenRegistry.temperature,
      maximumProbabilityShift: input.frozenRegistry.maximumProbabilityShift,
    });
    frozenCandidateVersion = input.frozenRegistry.candidateVersion;
    frozenRegistryId = input.frozenRegistry.id;
  }

  const decisionModelVersion = `${LIVE_PAPER_BET_ENGINE_VERSION}::HDA=${frozenCandidateVersion ?? SCIENTIFIC_MODEL_VERSION}::MM=DYNAMIC_DIXON_COLES::OU=${OU_ENGINE_VERSION}::GD=${ouDistribution.goalDistributionId}`;

  if (decisionModelVersion.length > 192) {
    throw new Error('LIVE_PAPER_BET_MODEL_VERSION_EXCEEDS_LEDGER_FIELD');
  }

  return {
    probabilities: {
      MATCH_WINNER: hda,
      // OU_V9_PAPER_MARKETS
      TOTAL_GOALS_1_5: ouDistribution.markets.TOTAL_GOALS_1_5,
      TOTAL_GOALS_2_5: ouDistribution.markets.TOTAL_GOALS_2_5,
      TOTAL_GOALS_3_5: ouDistribution.markets.TOTAL_GOALS_3_5,
      BTTS: scoreGrid.btts,
    },
    source: {
      baselineModelVersion: SCIENTIFIC_MODEL_VERSION,
      liveEngineVersion: LIVE_PAPER_BET_ENGINE_VERSION,
      decisionModelVersion,
      frozenCandidateVersion,
      frozenRegistryId,
      dixonSampleSize: fundamentals.dixonColes.sampleSize,
      dixonTrainedThrough: fundamentals.dixonColes.trainedThrough.toISOString(),
      dataQualityScore: fundamentals.dataQualityScore,
      goalDistributionId: ouDistribution.goalDistributionId,
    },
  };
}

async function alreadyDecided(input: {
  providerFixtureId: number;
  kickoffAt: Date;
  horizon: LivePaperBetHorizon;
}): Promise<boolean> {
  const existing = await prisma.scientificPaperBetDecision.findFirst({
    where: {
      providerFixtureId: input.providerFixtureId,
      kickoffAt: input.kickoffAt,
      horizonMinutes: input.horizon,
    },
    select: {
      id: true,
    },
  });

  return existing != null;
}

export async function runLiveScientificPaperBetDecisions(
  input: {
    now?: Date;
    providerFixtureIds?: number[];
  } = {},
): Promise<LivePaperBetDecisionRunResult> {
  const now = input.now ?? new Date();
  const horizons = parseLivePaperBetHorizons(
    process.env.PAPER_BET_HORIZONS_MINUTES,
    {
      allowFlexible:
        process.env.PAPER_BET_ALLOW_FLEXIBLE_HORIZONS === '1',
      minimumMinutes: 1,
      maximumMinutes: 1440,
    },
  );
  const toleranceMinutes = Math.max(0, envNumber('PAPER_BET_DECISION_TOLERANCE_MINUTES', 2));
  const maxOddsAgeMinutes = Math.max(1, envNumber('PAPER_BET_MAX_ODDS_AGE_MINUTES', 360));
  const maximumHorizon = Math.max(...horizons);
  const providerFixtureIds = [
    ...new Set(
      (input.providerFixtureIds ?? []).filter(
        (value): value is number =>
          Number.isSafeInteger(value) && value > 0,
      ),
    ),
  ];
  const providerRows = (await prisma.apiFootballFixtureSnapshot.findMany({
    where: {
      ...(providerFixtureIds.length > 0
        ? {
            providerFixtureId: {
              in: providerFixtureIds,
            },
          }
        : {}),
      kickoffAt: {
        gt: now,
        lte: new Date(now.getTime() + (maximumHorizon + toleranceMinutes + 5) * 60_000),
      },
    },
    select: {
      id: true,
      providerFixtureId: true,
      providerLeagueId: true,
      kickoffAt: true,
      statusShort: true,
      homeProviderTeamId: true,
      awayProviderTeamId: true,
      homeTeamName: true,
      awayTeamName: true,
      observedAt: true,
    },
    orderBy: [
      {
        observedAt: 'desc',
      },
      {
        id: 'desc',
      },
    ],
    take: 1500,
  })) as ProviderFixtureRow[];
  const fixtures = latestProviderFixtures(providerRows);

  const pending: Array<{
    provider: ProviderFixtureRow;
    horizon: LivePaperBetHorizon;
  }> = [];
  let dueEvents = 0;
  let existingDecisions = 0;

  for (const provider of fixtures) {
    const due = dueLivePaperBetHorizons({
      now,
      kickoffAt: provider.kickoffAt,
      horizons,
      toleranceMinutes,
    });

    for (const horizon of due) {
      dueEvents += 1;

      if (
        await alreadyDecided({
          providerFixtureId: provider.providerFixtureId,
          kickoffAt: provider.kickoffAt,
          horizon,
        })
      ) {
        existingDecisions += 1;
        continue;
      }

      pending.push({
        provider,
        horizon,
      });
    }
  }

  const result: LivePaperBetDecisionRunResult = {
    version: LIVE_PAPER_BET_ENGINE_VERSION,
    now: now.toISOString(),
    horizons,
    toleranceMinutes,
    maxOddsAgeMinutes,
    providerFixturesScanned: fixtures.length,
    dueEvents,
    existingDecisions,
    mappedFixtures: 0,
    decisionsRecorded: 0,
    bestBets: 0,
    noBets: 0,
    skippedUnmappedFixture: 0,
    skippedMappingMismatch: 0,
    skippedNoOdds: 0,
    skippedNoModel: 0,
    skippedNoCandidates: 0,
    errors: [],
    apiCalled: false,
    realMoneyExecution: false,
  };

  if (pending.length === 0) {
    return result;
  }

  const reliabilityReport = await getScientificBestBetReliabilityReport();
  let frozenRegistry: FrozenRegistryRow | null | undefined;

  for (const event of pending) {
    const { provider, horizon } = event;

    try {
      const localFixture = await loadLocalFixture(provider);

      if (!localFixture) {
        result.skippedUnmappedFixture += 1;
        result.errors.push({
          providerFixtureId: provider.providerFixtureId,
          horizonMinutes: horizon,
          reason: 'UNMAPPED_PROVIDER_FIXTURE_TO_CORE_FIXTURE',
        });
        continue;
      }

      if (!validatedMapping(provider, localFixture)) {
        result.skippedMappingMismatch += 1;
        result.errors.push({
          providerFixtureId: provider.providerFixtureId,
          horizonMinutes: horizon,
          reason: 'PROVIDER_CORE_FIXTURE_MAPPING_MISMATCH',
        });
        continue;
      }

      result.mappedFixtures += 1;

      const oddsRows = await loadDecisionOdds({
        providerFixtureId: provider.providerFixtureId,
        decisionAsOf: now,
        maxOddsAgeMinutes,
      });

      if (oddsRows.length === 0) {
        result.skippedNoOdds += 1;
        result.errors.push({
          providerFixtureId: provider.providerFixtureId,
          horizonMinutes: horizon,
          reason: 'NO_PIT_USABLE_REAL_ODDS_AT_DECISION_AS_OF',
        });
        continue;
      }

      if (horizon === 90 && frozenRegistry === undefined) {
        frozenRegistry = await loadFrozenT90Registry(now);
      }

      let model;

      try {
        model = await buildModelProbabilities({
          localFixture,
          decisionAsOf: now,
          horizon,
          frozenRegistry: horizon === 90 ? (frozenRegistry ?? null) : null,
        });
      } catch (error) {
        result.skippedNoModel += 1;
        result.errors.push({
          providerFixtureId: provider.providerFixtureId,
          horizonMinutes: horizon,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const gates = reliabilityGates({
        horizon,
        frozenRegistryAvailable: horizon !== 90 || frozenRegistry != null,
        report: reliabilityReport,
        dataQualityScore: model.source.dataQualityScore,
      });
      const candidateSet = buildLivePaperBetCandidates({
        providerFixtureId: provider.providerFixtureId,
        oddsRows,
        modelProbabilities: model.probabilities,
        reliability: gates,
      });

      if (candidateSet.candidates.length === 0) {
        result.skippedNoCandidates += 1;
        result.errors.push({
          providerFixtureId: provider.providerFixtureId,
          horizonMinutes: horizon,
          reason: 'NO_COMPLETE_REAL_ODDS_MARKET_FOR_NO_VIG_CONSENSUS',
        });
        continue;
      }

      const decision = await recordScientificPaperBetDecision({
        providerFixtureId: provider.providerFixtureId,
        localFixtureId: localFixture.id,
        horizonMinutes: horizon,
        decisionAsOf: now,
        kickoffAt: provider.kickoffAt,
        modelVersion: model.source.decisionModelVersion,
        policyVersion: SCIENTIFIC_BEST_BET_POLICY_VERSION,
        candidates: candidateSet.candidates,
      });

      result.decisionsRecorded += 1;

      if (decision.decisionType === 'BEST_BET') {
        result.bestBets += 1;
      } else {
        result.noBets += 1;
      }

      console.log(
        JSON.stringify({
          event: 'paper-bet-decision',
          providerFixtureId: provider.providerFixtureId,
          localFixtureId: localFixture.id,
          horizonMinutes: horizon,
          decisionType: decision.decisionType,
          candidateCount: decision.candidateCount,
          rejectedCandidateCount: decision.rejectedCandidateCount,
          marketCoverage: candidateSet.marketCoverage,
          modelSource: model.source,
          decisionHash: decision.decisionHash,
        }),
      );
    } catch (error) {
      result.errors.push({
        providerFixtureId: provider.providerFixtureId,
        horizonMinutes: horizon,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

export async function runLiveScientificPaperBetCycle(): Promise<{
  decisions: LivePaperBetDecisionRunResult;
  settlement: Awaited<ReturnType<typeof settleOpenScientificPaperBets>>;
  settlementMayCallApi: true;
  realMoneyExecution: false;
}> {
  const decisions = await runLiveScientificPaperBetDecisions();
  const settlement = await settleOpenScientificPaperBets();

  return {
    decisions,
    settlement,
    settlementMayCallApi: true,
    realMoneyExecution: false,
  };
}

export async function getLiveScientificPaperBetCoverage(): Promise<{
  version: string;
  decisions: number;
  bestBets: number;
  noBets: number;
  settlements: number;
  openBestBets: number;
  byHorizon: Array<{
    horizonMinutes: number;
    decisionType: string;
    count: number;
  }>;
  latestDecision: unknown;
  policyVersion: string;
  automaticRealMoneyExecution: false;
}> {
  const [decisions, bestBets, noBets, settlements, grouped, latestDecision] = await Promise.all([
    prisma.scientificPaperBetDecision.count({
      where: {
        modelVersion: {
          startsWith: LIVE_PAPER_BET_ENGINE_VERSION,
        },
      },
    }),
    prisma.scientificPaperBetDecision.count({
      where: {
        modelVersion: {
          startsWith: LIVE_PAPER_BET_ENGINE_VERSION,
        },
        decisionType: 'BEST_BET',
      },
    }),
    prisma.scientificPaperBetDecision.count({
      where: {
        modelVersion: {
          startsWith: LIVE_PAPER_BET_ENGINE_VERSION,
        },
        decisionType: 'NO_BET',
      },
    }),
    prisma.scientificPaperBetSettlement.count({
      where: {
        decision: {
          modelVersion: {
            startsWith: LIVE_PAPER_BET_ENGINE_VERSION,
          },
        },
      },
    }),
    prisma.scientificPaperBetDecision.groupBy({
      by: ['horizonMinutes', 'decisionType'],
      where: {
        modelVersion: {
          startsWith: LIVE_PAPER_BET_ENGINE_VERSION,
        },
      },
      _count: {
        _all: true,
      },
      orderBy: [
        {
          horizonMinutes: 'desc',
        },
        {
          decisionType: 'asc',
        },
      ],
    }),
    prisma.scientificPaperBetDecision.findFirst({
      where: {
        modelVersion: {
          startsWith: LIVE_PAPER_BET_ENGINE_VERSION,
        },
      },
      orderBy: {
        decisionAsOf: 'desc',
      },
    }),
  ]);

  return {
    version: LIVE_PAPER_BET_ENGINE_VERSION,
    decisions,
    bestBets,
    noBets,
    settlements,
    openBestBets: bestBets - settlements,
    byHorizon: grouped.map((row: (typeof grouped)[number]) => ({
      horizonMinutes: row.horizonMinutes,
      decisionType: row.decisionType,
      count: row._count._all,
    })),
    latestDecision,
    policyVersion: SCIENTIFIC_BEST_BET_POLICY_VERSION,
    automaticRealMoneyExecution: false,
  };
}
