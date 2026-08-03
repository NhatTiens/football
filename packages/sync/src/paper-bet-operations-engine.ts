import { prisma } from '@football-ai/database';

import { getFundamentalsFixturePrediction } from './fundamentals-engine.js';
import {
  PAPER_BET_DECISION_HORIZONS,
  PAPER_BET_OPERATIONS_VERSION,
  PAPER_BET_RELIABILITY_TARGET_ROWS,
  buildReliabilityAccumulationProgress,
  evaluatePaperBetFixtureReadiness,
  nextPaperBetDecisionHorizon,
  selectedMarketFromAnalysisPayload,
  type PaperBetMappingStatus,
  type ReliabilityAccumulationProgress,
} from './paper-bet-operations-core.js';
import {
  buildLivePaperBetCandidates,
  type LiveModelProbabilities,
  type LiveOddsRow,
  type LiveReliabilityGate,
} from './real-odds-paper-bet-core.js';
import { runLiveScientificPaperBetDecisions } from './real-odds-paper-bet-engine.js';
import { getScientificBestBetReliabilityReport } from './scientific-best-bet-reliability-engine.js';
import { captureDueCurrentSignalSnapshots } from './current-signal-snapshot-engine.js';

type AnyRecord = Record<string, unknown>;

interface ProviderFixtureRow {
  providerFixtureId: number;
  providerLeagueId: number;
  kickoffAt: Date;
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

interface CurrentSignalEvidenceRow {
  id: number;
  providerFixtureId: number;
  checkpointMinutes: number;
  snapshotAsOf: Date;
  kickoffAt: Date;
  analysisPayload: unknown;
}

interface FinalOutcomeRow {
  id: number;
  providerFixtureId: number;
  statusShort: string;
  observedAt: Date;
}

const COVERAGE_MODEL_PROBABILITIES: LiveModelProbabilities = {
  MATCH_WINNER: {
    HOME: 0.34,
    DRAW: 0.32,
    AWAY: 0.34,
  },
  TOTAL_GOALS_1_5: {
    OVER: 0.5,
    UNDER: 0.5,
  },
  TOTAL_GOALS_2_5: {
    OVER: 0.5,
    UNDER: 0.5,
  },
  TOTAL_GOALS_3_5: {
    OVER: 0.5,
    UNDER: 0.5,
  },
  BTTS: {
    YES: 0.5,
    NO: 0.5,
  },
};

const COVERAGE_RELIABILITY = Object.fromEntries(
  ['MATCH_WINNER', 'TOTAL_GOALS_1_5', 'TOTAL_GOALS_2_5', 'TOTAL_GOALS_3_5', 'BTTS'].map(
    (market): [string, LiveReliabilityGate] => [
      market,
      {
        market: market as LiveReliabilityGate['market'],
        status: 'READINESS_COVERAGE_ONLY',
        eligible: false,
      },
    ],
  ),
) as Record<LiveReliabilityGate['market'], LiveReliabilityGate>;

function record(value: unknown): AnyRecord | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;
}

function latestProviderFixtures(rows: ProviderFixtureRow[]): ProviderFixtureRow[] {
  const result = new Map<number, ProviderFixtureRow>();

  for (const row of rows) {
    if (!result.has(row.providerFixtureId)) {
      result.set(row.providerFixtureId, row);
    }
  }

  return [...result.values()].sort(
    (left, right): number =>
      left.kickoffAt.getTime() - right.kickoffAt.getTime() ||
      left.providerFixtureId - right.providerFixtureId,
  );
}

function mappingStatus(
  provider: ProviderFixtureRow,
  local: LocalFixtureRow | null,
): PaperBetMappingStatus {
  if (local == null) return 'UNMAPPED';

  const kickoffDifference = Math.abs(provider.kickoffAt.getTime() - local.kickoffAt.getTime());

  return local.apiFixtureId === provider.providerFixtureId &&
    local.league.apiLeagueId === provider.providerLeagueId &&
    local.homeTeam.apiTeamId === provider.homeProviderTeamId &&
    local.awayTeam.apiTeamId === provider.awayProviderTeamId &&
    kickoffDifference <= 10 * 60_000
    ? 'MAPPED'
    : 'MAPPING_MISMATCH';
}

function effectiveOddsTime(row: LiveOddsRow): Date {
  return row.sourceUpdatedAt ?? row.observedAt;
}

function reliabilityKey(marketType: string, horizonMinutes: number): string {
  return `${marketType}:T-${horizonMinutes}`;
}

function routeValidated(marketType: string, horizonMinutes: number): boolean {
  return marketType === 'MATCH_WINNER' && horizonMinutes === 90;
}

export async function getPaperBetOperationsReadiness(
  input: {
    now?: Date;
    hoursAhead?: number;
    maximumFixtures?: number;
    maximumOddsAgeMinutes?: number;
    providerFixtureIds?: number[];
  } = {},
): Promise<Record<string, unknown>> {
  const now = input.now ?? new Date();
  const hoursAhead = Math.max(1, Math.min(720, Math.floor(input.hoursAhead ?? 48)));
  const maximumFixtures = Math.max(1, Math.min(100, Math.floor(input.maximumFixtures ?? 30)));
  const maximumOddsAgeMinutes = Math.max(
    1,
    Math.min(1440, Math.floor(input.maximumOddsAgeMinutes ?? 360)),
  );
  const fixtureIds = [
    ...new Set(
      (input.providerFixtureIds ?? []).filter(
        (value): value is number => Number.isSafeInteger(value) && value > 0,
      ),
    ),
  ];
  const providerRows = (await prisma.apiFootballFixtureSnapshot.findMany({
    where: {
      providerFixtureId: fixtureIds.length > 0 ? { in: fixtureIds } : undefined,
      kickoffAt: {
        gt: now,
        lte: new Date(now.getTime() + hoursAhead * 3_600_000),
      },
      observedAt: {
        lte: now,
      },
    },
    select: {
      providerFixtureId: true,
      providerLeagueId: true,
      kickoffAt: true,
      homeProviderTeamId: true,
      awayProviderTeamId: true,
      homeTeamName: true,
      awayTeamName: true,
      observedAt: true,
    },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
    take: 5000,
  })) as ProviderFixtureRow[];
  const providers = latestProviderFixtures(providerRows).slice(0, maximumFixtures);
  const providerFixtureIds = providers.map((row): number => row.providerFixtureId);
  const oddsCutoff = new Date(now.getTime() - maximumOddsAgeMinutes * 60_000);

  const [localRowsRaw, oddsRowsRaw, frozenRegistry, reliabilityResult] = await Promise.all([
    providerFixtureIds.length === 0
      ? []
      : prisma.fixture.findMany({
          where: {
            apiFixtureId: {
              in: providerFixtureIds,
            },
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
        }),
    providerFixtureIds.length === 0
      ? []
      : prisma.apiFootballOddsSnapshot.findMany({
          where: {
            providerFixtureId: {
              in: providerFixtureIds,
            },
            pitUsable: true,
            observedAt: {
              gte: oddsCutoff,
              lte: now,
            },
            kickoffAt: {
              gt: now,
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
          orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
          take: 100_000,
        }),
    prisma.scientificCandidateRegistry.findFirst({
      where: {
        status: 'FROZEN_FOR_SHADOW',
        horizonMinutes: 90,
        marketBranch: 'NO_MARKET',
        frozenAt: {
          lte: now,
        },
      },
      select: {
        id: true,
        candidateVersion: true,
        frozenAt: true,
      },
      orderBy: {
        frozenAt: 'desc',
      },
    }),
    getScientificBestBetReliabilityReport()
      .then((report) => ({ report, error: null as string | null }))
      .catch((error: unknown) => ({
        report: null,
        error: error instanceof Error ? error.message : String(error),
      })),
  ]);

  const localRows = localRowsRaw as LocalFixtureRow[];
  const oddsRows = (oddsRowsRaw as LiveOddsRow[]).filter(
    (row): boolean => effectiveOddsTime(row).getTime() >= oddsCutoff.getTime(),
  );
  const localByProvider = new Map(
    localRows.map((row): [number, LocalFixtureRow] => [row.apiFixtureId, row]),
  );
  const oddsByProvider = new Map<number, LiveOddsRow[]>();

  for (const row of oddsRows) {
    const values = oddsByProvider.get(row.providerFixtureId) ?? [];
    values.push(row);
    oddsByProvider.set(row.providerFixtureId, values);
  }

  const rows: Array<Record<string, unknown>> = [];

  for (const provider of providers) {
    const local = localByProvider.get(provider.providerFixtureId) ?? null;
    const resolvedMappingStatus = mappingStatus(provider, local);
    const fixtureOdds = oddsByProvider.get(provider.providerFixtureId) ?? [];
    const candidateCoverage = buildLivePaperBetCandidates({
      providerFixtureId: provider.providerFixtureId,
      oddsRows: fixtureOdds,
      modelProbabilities: COVERAGE_MODEL_PROBABILITIES,
      reliability: COVERAGE_RELIABILITY,
    });
    const completeMarkets = candidateCoverage.marketCoverage.filter(
      (market): boolean => market.completeBookmakers > 0 && market.candidates > 0,
    );
    let dynamicModelAvailable = false;
    let modelPitSafe = false;
    let modelSampleSize = 0;
    let modelTeamCount = 0;
    let modelDataQualityScore = 0;
    let modelTrainedThrough: string | null = null;
    let modelReasons: string[] = [];
    let modelError: string | null = null;

    if (local != null && resolvedMappingStatus === 'MAPPED') {
      try {
        const model = await getFundamentalsFixturePrediction({
          fixtureId: local.id,
          leagueId: local.leagueId,
          homeTeamId: local.homeTeamId,
          awayTeamId: local.awayTeamId,
          kickoffAt: local.kickoffAt,
          predictionAsOf: now,
          horizonMinutes: 90,
          persist: false,
        });

        dynamicModelAvailable = model.available && model.dixonColes != null;
        modelPitSafe =
          model.dixonColes != null && model.dixonColes.trainedThrough.getTime() <= now.getTime();
        modelSampleSize = model.dixonColes?.sampleSize ?? 0;
        modelTeamCount = model.dixonColes?.teamCount ?? 0;
        modelDataQualityScore = model.dataQualityScore;
        modelTrainedThrough = model.dixonColes?.trainedThrough.toISOString() ?? null;
        modelReasons = model.reasons;
      } catch (error) {
        modelError = error instanceof Error ? error.message : String(error);
      }
    }

    const minutesToKickoff = (provider.kickoffAt.getTime() - now.getTime()) / 60_000;
    const nextDecisionHorizon = nextPaperBetDecisionHorizon(minutesToKickoff);
    const matchWinnerReliability = reliabilityResult.report?.reliability.MATCH_WINNER ?? null;
    const readinessByHorizon = PAPER_BET_DECISION_HORIZONS.map((horizonMinutes) =>
      evaluatePaperBetFixtureReadiness({
        providerFixtureId: provider.providerFixtureId,
        horizonMinutes,
        mappingStatus: resolvedMappingStatus,
        freshPitOddsRows: fixtureOdds.length,
        completeMarketCount: completeMarkets.length,
        dynamicModelAvailable,
        modelPitSafe,
        frozenT90RegistryAvailable: frozenRegistry != null,
        matchWinnerReliabilityEligible: matchWinnerReliability?.diagnosticEligible === true,
      }),
    );

    rows.push({
      providerFixtureId: provider.providerFixtureId,
      kickoffAt: provider.kickoffAt.toISOString(),
      homeTeamName: provider.homeTeamName,
      awayTeamName: provider.awayTeamName,
      minutesToKickoff,
      nextDecisionHorizon,
      nextDecisionAt:
        nextDecisionHorizon == null
          ? null
          : new Date(provider.kickoffAt.getTime() - nextDecisionHorizon * 60_000).toISOString(),
      mappingStatus: resolvedMappingStatus,
      localFixtureId: local?.id ?? null,
      freshPitOddsRows: fixtureOdds.length,
      completeMarkets,
      model: {
        source: dynamicModelAvailable ? 'DYNAMIC_DIXON_COLES' : 'UNAVAILABLE',
        available: dynamicModelAvailable,
        pitSafe: modelPitSafe,
        sampleSize: modelSampleSize,
        teamCount: modelTeamCount,
        dataQualityScore: modelDataQualityScore,
        trainedThrough: modelTrainedThrough,
        reasons: modelReasons,
        error: modelError,
      },
      readinessByHorizon,
    });
  }

  const horizonRows = rows.flatMap(
    (row) => row.readinessByHorizon as Array<Record<string, unknown>>,
  );

  return {
    event: 'R4.10.2.11.2A_PAPER_BET_PRODUCER_MODEL_READINESS',
    version: PAPER_BET_OPERATIONS_VERSION,
    generatedAt: now.toISOString(),
    configuration: {
      hoursAhead,
      maximumFixtures,
      maximumOddsAgeMinutes,
    },
    coverage: {
      providerFixtures: providers.length,
      mappedFixtures: rows.filter((row) => row.mappingStatus === 'MAPPED').length,
      fixturesWithFreshPitOdds: rows.filter((row) => Number(row.freshPitOddsRows) > 0).length,
      fixturesWithDynamicModel: rows.filter((row) => record(row.model)?.available === true).length,
      paperDecisionReadyRoutes: horizonRows.filter((row) => row.paperDecisionReady === true).length,
      bestBetReadyRoutes: horizonRows.filter((row) => row.bestBetRouteReady === true).length,
    },
    frozenT90Registry:
      frozenRegistry == null
        ? null
        : {
            id: frozenRegistry.id,
            candidateVersion: frozenRegistry.candidateVersion,
            frozenAt: frozenRegistry.frozenAt.toISOString(),
          },
    matchWinnerReliability: reliabilityResult.report?.reliability.MATCH_WINNER ?? null,
    reliabilityError: reliabilityResult.error,
    rows,
    safety: {
      appendOnlySource: true,
      pitSafe: true,
      paperOnly: true,
      externalApiCalled: false,
      databaseWritten: false,
      automaticPromotion: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
    },
  };
}

export async function getPaperBetReliabilityAccumulation(
  input: {
    now?: Date;
    hours?: number;
  } = {},
): Promise<Record<string, unknown>> {
  const now = input.now ?? new Date();
  const hours = Math.max(1, Math.min(87_600, Math.floor(input.hours ?? 8760)));
  const since = new Date(now.getTime() - hours * 3_600_000);
  const [snapshotRowsRaw, historical] = await Promise.all([
    prisma.scientificCurrentSignalSnapshot.findMany({
      where: {
        createdAt: {
          gte: since,
          lte: now,
        },
      },
      select: {
        id: true,
        providerFixtureId: true,
        checkpointMinutes: true,
        snapshotAsOf: true,
        kickoffAt: true,
        analysisPayload: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20_000,
    }),
    getScientificBestBetReliabilityReport(),
  ]);
  const snapshotRows = snapshotRowsRaw as CurrentSignalEvidenceRow[];
  const selectedRows = snapshotRows
    .map((row) => ({
      ...row,
      marketType: selectedMarketFromAnalysisPayload(row.analysisPayload),
    }))
    .filter(
      (
        row,
      ): row is CurrentSignalEvidenceRow & {
        marketType: string;
      } => row.marketType != null,
    );
  const providerFixtureIds = [...new Set(selectedRows.map((row): number => row.providerFixtureId))];
  const outcomeRows =
    providerFixtureIds.length === 0
      ? []
      : ((await prisma.apiFootballFixtureSnapshot.findMany({
          where: {
            providerFixtureId: {
              in: providerFixtureIds,
            },
            statusShort: {
              in: ['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO'],
            },
            observedAt: {
              lte: now,
            },
          },
          select: {
            id: true,
            providerFixtureId: true,
            statusShort: true,
            observedAt: true,
          },
          orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
          take: 20_000,
        })) as FinalOutcomeRow[]);
  const latestOutcome = new Map<number, FinalOutcomeRow>();

  for (const row of outcomeRows) {
    if (!latestOutcome.has(row.providerFixtureId)) {
      latestOutcome.set(row.providerFixtureId, row);
    }
  }

  const groups = new Map<
    string,
    {
      marketType: string;
      horizonMinutes: number;
      persistedRows: number;
      settledRows: number;
      invalidRows: number;
    }
  >();

  for (const row of selectedRows) {
    const key = reliabilityKey(row.marketType, row.checkpointMinutes);
    const group = groups.get(key) ?? {
      marketType: row.marketType,
      horizonMinutes: row.checkpointMinutes,
      persistedRows: 0,
      settledRows: 0,
      invalidRows: 0,
    };
    const invalid =
      row.snapshotAsOf.getTime() > row.kickoffAt.getTime() ||
      row.snapshotAsOf.getTime() > now.getTime();
    const outcome = latestOutcome.get(row.providerFixtureId);
    const settled =
      !invalid &&
      outcome != null &&
      outcome.observedAt.getTime() >= row.kickoffAt.getTime() &&
      outcome.observedAt.getTime() <= now.getTime();

    group.persistedRows += 1;
    group.settledRows += settled ? 1 : 0;
    group.invalidRows += invalid ? 1 : 0;
    groups.set(key, group);
  }

  const requiredKey = reliabilityKey('MATCH_WINNER', 90);

  if (!groups.has(requiredKey)) {
    groups.set(requiredKey, {
      marketType: 'MATCH_WINNER',
      horizonMinutes: 90,
      persistedRows: 0,
      settledRows: 0,
      invalidRows: 0,
    });
  }

  const progress: ReliabilityAccumulationProgress[] = [...groups.entries()]
    .map(([key, group]) => {
      const historicalMarket =
        historical.reliability[group.marketType as keyof typeof historical.reliability] ?? null;
      const validatedRoute = routeValidated(group.marketType, group.horizonMinutes);
      const blockingReasons = [
        ...(historicalMarket?.reasons ?? ['HISTORICAL_RELIABILITY_REPORT_MISSING']),
        ...(validatedRoute ? [] : ['MARKET_HORIZON_ROUTE_NOT_VALIDATED']),
      ];

      return buildReliabilityAccumulationProgress({
        key,
        marketType: group.marketType,
        horizonMinutes: group.horizonMinutes,
        persistedRows: group.persistedRows,
        settledRows: group.settledRows,
        invalidRows: group.invalidRows,
        targetRows: PAPER_BET_RELIABILITY_TARGET_ROWS,
        diagnosticEligible: validatedRoute && historicalMarket?.diagnosticEligible === true,
        blockingReasons,
      });
    })
    .sort(
      (left, right): number =>
        right.horizonMinutes - left.horizonMinutes ||
        left.marketType.localeCompare(right.marketType),
    );

  return {
    event: 'R4.10.2.11.2C_RELIABILITY_ACCUMULATION',
    version: PAPER_BET_OPERATIONS_VERSION,
    generatedAt: now.toISOString(),
    windowHours: hours,
    targetRowsPerMarketHorizon: PAPER_BET_RELIABILITY_TARGET_ROWS,
    historicalReplay: {
      replayRunId: historical.sourceReplay.replayRunId,
      evaluationFixtures: historical.sourceReplay.evaluationFixtures,
      diagnosticEligibleMarkets: historical.diagnosticEligibleMarkets,
      blockedMarkets: historical.blockedMarkets,
      markets: Object.fromEntries(
        Object.entries(historical.reliability).map(([market, value]) => [
          market,
          {
            status: value.status,
            diagnosticEligible: value.diagnosticEligible,
            rows: value.model.rows,
            relativeBrierSkillVsClimatology: value.relativeBrierSkillVsClimatology,
            logLossSkillVsClimatology: value.logLossSkillVsClimatology,
            ece: value.model.ece,
            reasons: value.reasons,
          },
        ]),
      ),
    },
    livePaperEvidence: {
      snapshotRowsRead: snapshotRows.length,
      selectedCandidateRows: selectedRows.length,
      finalOutcomeRowsRead: outcomeRows.length,
      progress,
    },
    safety: {
      appendOnlySource: true,
      pitSafe: true,
      paperOnly: true,
      historicalRowsRewritten: false,
      externalApiCalled: false,
      databaseWritten: false,
      automaticPromotion: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
    },
  };
}

export async function runPaperBetOperationsCycle(
  input: {
    now?: Date;
  } = {},
): Promise<Record<string, unknown>> {
  const now = input.now ?? new Date();
  const snapshots = await captureDueCurrentSignalSnapshots({
    now,
  });
  const decisions = await runLiveScientificPaperBetDecisions({
    now,
  });

  return {
    event: 'R4.10.2.11.2B_PAPER_BET_OPERATIONS_CYCLE',
    version: PAPER_BET_OPERATIONS_VERSION,
    executedAt: now.toISOString(),
    snapshots,
    decisions,
    safety: {
      appendOnly: true,
      pitSafe: true,
      paperOnly: true,
      externalApiCalled: false,
      databaseWriteAuthorized: true,
      databaseWritten: snapshots.databaseWritten || decisions.decisionsRecorded > 0,
      automaticPromotion: false,
      automaticBetPlacement: false,
      realMoneyExecution: false,
    },
  };
}
