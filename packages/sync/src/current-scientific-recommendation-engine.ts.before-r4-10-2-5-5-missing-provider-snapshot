import { prisma } from '@football-ai/database';

import { getFundamentalsFixturePrediction } from './fundamentals-engine.js';
import { getScientificFixtureAnalysis } from './scientific-features.js';
import { SCIENTIFIC_MODEL_VERSION } from './scientific-model.js';
import { deriveScientificScoreGridMarkets } from './scientific-multi-market-replay-contract.js';
import {
  buildFrozenShadowCandidateProbability,
  normalizeShadowProbabilities,
} from './scientific-shadow-contract.js';
import {
  SCIENTIFIC_BEST_BET_POLICY,
  assessBestBetCandidate,
} from './scientific-best-bet-policy-contract.js';
import { getScientificBestBetReliabilityReport } from './scientific-best-bet-reliability-engine.js';
import {
  LIVE_PAPER_BET_ENGINE_VERSION,
  buildLivePaperBetCandidates,
  type LiveMarketType,
  type LiveModelProbabilities,
  type LiveOddsRow,
  type LiveReliabilityGate,
} from './real-odds-paper-bet-core.js';
import { normalizePaperBetCandidate } from './paper-bet-ledger-core.js';
import {
  emptyOddsFreshnessSummary,
  resolveFreshReobservedOdds,
  type OddsFreshnessEvidence,
  type OddsFreshnessSummary,
  type ReobservationOddsRow,
} from './fresh-odds-reobservation-bridge.js';

export const CURRENT_SCIENTIFIC_RECOMMENDATION_VERSION =
  'v7.0-r4.10.2.4-current-scientific-recommendation-v3';

export type CurrentRecommendationModelSource =
  | 'DYNAMIC_DIXON_COLES'
  | 'SCIENTIFIC_BASELINE_FALLBACK';

export type CurrentRecommendationConfidenceTier =
  | 'HIGH'
  | 'MEDIUM'
  | 'LIMITED';

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

interface FrozenRegistryRow {
  id: number;
  candidateVersion: string;
  weights: unknown;
  temperature: number;
  maximumProbabilityShift: number;
  frozenAt: Date;
}

export interface CurrentScientificCandidate {
  marketType: LiveMarketType;
  selection: 'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO';
  lineValue: number | null;
  decimalOdds: number;
  bookmakerName: string;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  reliabilityStatus: string;
  modelSource: CurrentRecommendationModelSource;
  modelFallbackReason: string | null;
  modelConfidenceTier: CurrentRecommendationConfidenceTier;
  modelHistorySampleSize: number;
  modelDataQualityScore: number;
  currentSignalEligible: boolean;
  currentSignalRejectionReasons: string[];
  officialEligible: boolean;
  officialRejectionReasons: string[];
  sourceOddsSnapshotId: number | null;
  sourceOddsEffectiveAt: string | null;
  sourceOddsUpdatedAt: string | null;
  sourceOddsFirstObservedAt: string | null;
  sourceOddsReobservedAt: string | null;
  sourceOddsFreshnessAt: string | null;
  oddsFreshnessBasis:
    | 'SOURCE_EFFECTIVE_AT'
    | 'REOBSERVED_AT'
    | null;
  reobservationRawSnapshotId: number | null;
  reobservationKind: string | null;
}

export interface CurrentScientificRecommendation {
  source: 'CURRENT_SCIENTIFIC_PIT';
  version: string;
  calculatedAt: string;
  providerFixtureId: number;
  localFixtureId: number;
  kickoffAt: string;
  horizonMinutes: number;
  marketType: LiveMarketType;
  selection: CurrentScientificCandidate['selection'];
  lineValue: number | null;
  decimalOdds: number;
  bookmakerName: string;
  modelProbability: number;
  fairMarketProbability: number;
  edge: number;
  expectedValue: number;
  reliabilityStatus: string;
  modelSource: CurrentRecommendationModelSource;
  modelFallbackReason: string | null;
  modelConfidenceTier: CurrentRecommendationConfidenceTier;
  modelHistorySampleSize: number;
  currentSignalEligible: true;
  officialEligible: boolean;
  dataQualityScore: number;
  modelVersion: string;
  sourceOddsSnapshotId: number | null;
  sourceOddsEffectiveAt: string | null;
  sourceOddsUpdatedAt: string | null;
  sourceOddsFirstObservedAt: string | null;
  sourceOddsReobservedAt: string | null;
  sourceOddsFreshnessAt: string | null;
  oddsFreshnessBasis:
    | 'SOURCE_EFFECTIVE_AT'
    | 'REOBSERVED_AT'
    | null;
  reobservationRawSnapshotId: number | null;
  reobservationKind: string | null;
  note: 'CURRENT_SIGNAL_NOT_OFFICIAL_BEST_BET';
}

export interface CurrentScientificRecommendationAnalysis {
  version: string;
  providerFixtureId: number;
  localFixtureId: number | null;
  kickoffAt: string;
  horizonMinutes: number;
  calculatedAt: string;
  status:
    | 'AVAILABLE'
    | 'NO_FRESH_PIT_ODDS'
    | 'UNMAPPED_FIXTURE'
    | 'MAPPING_MISMATCH'
    | 'NO_MODEL'
    | 'NO_COMPLETE_MARKET'
    | 'NO_VALUE_SIGNAL';
  recommendation: CurrentScientificRecommendation | null;
  candidates: CurrentScientificCandidate[];
  oddsFreshness: OddsFreshnessSummary;
  marketCoverage: Array<{
    market: LiveMarketType;
    completeBookmakers: number;
    candidates: number;
  }>;
  error: string | null;
  modelFallbackIsCurrentSignalOnly: true;
  externalApiCalled: false;
  databaseWritten: false;
  realMoneyExecution: false;
}

function envNumber(
  name: string,
  fallback: number,
): number {
  const raw = process.env[name];

  if (raw == null || raw.trim() === '') {
    return fallback;
  }

  const value = Number(raw);

  return Number.isFinite(value)
    ? value
    : fallback;
}

function weightsRecord(
  value: unknown,
): Record<string, number> {
  if (
    value == null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(
      value as Record<string, unknown>,
    )
      .map(
        ([key, item]): [string, number] => [
          key,
          Number(item),
        ],
      )
      .filter(
        ([, item]): boolean =>
          Number.isFinite(item),
      ),
  );
}

function latestProviderFixtures(
  rows: ProviderFixtureRow[],
): ProviderFixtureRow[] {
  const latest =
    new Map<number, ProviderFixtureRow>();

  for (const row of rows) {
    if (
      !latest.has(
        row.providerFixtureId,
      )
    ) {
      latest.set(
        row.providerFixtureId,
        row,
      );
    }
  }

  return [...latest.values()];
}

function validMapping(
  provider: ProviderFixtureRow,
  local: LocalFixtureRow,
): boolean {
  const kickoffDifference =
    Math.abs(
      provider.kickoffAt.getTime() -
      local.kickoffAt.getTime(),
    );

  return (
    local.apiFixtureId ===
      provider.providerFixtureId &&
    local.league.apiLeagueId ===
      provider.providerLeagueId &&
    local.homeTeam.apiTeamId ===
      provider.homeProviderTeamId &&
    local.awayTeam.apiTeamId ===
      provider.awayProviderTeamId &&
    kickoffDifference <=
      10 * 60_000
  );
}

function currentHorizonMinutes(
  kickoffAt: Date,
  now: Date,
): number {
  const minutes =
    (
      kickoffAt.getTime() -
      now.getTime()
    ) /
    60_000;

  return Math.max(
    1,
    Math.round(minutes),
  );
}

async function loadFrozenT90Registry(
  now: Date,
): Promise<FrozenRegistryRow | null> {
  return (
    await prisma.scientificCandidateRegistry.findFirst({
      where: {
        status:
          'FROZEN_FOR_SHADOW',
        horizonMinutes: 90,
        marketBranch:
          'NO_MARKET',
        frozenAt: {
          lte: now,
        },
      },
      select: {
        id: true,
        candidateVersion: true,
        weights: true,
        temperature: true,
        maximumProbabilityShift: true,
        frozenAt: true,
      },
      orderBy: {
        frozenAt: 'desc',
      },
    })
  ) as FrozenRegistryRow | null;
}

function reliabilityGates(input: {
  horizonMinutes: number;
  frozenRegistryAvailable: boolean;
  report: Awaited<
    ReturnType<
      typeof getScientificBestBetReliabilityReport
    >
  >;
}): Record<
  LiveMarketType,
  LiveReliabilityGate
> {
  const markets: LiveMarketType[] = [
    'MATCH_WINNER',
    'TOTAL_GOALS_1_5',
    'TOTAL_GOALS_2_5',
    'TOTAL_GOALS_3_5',
    'BTTS',
  ];

  const result =
    {} as Record<
      LiveMarketType,
      LiveReliabilityGate
    >;

  for (const market of markets) {
    const historical =
      input.report.reliability[
        market
      ];

    if (historical == null) {
      result[market] = {
        market,
        status:
          'RELIABILITY_REPORT_MISSING',
        eligible: false,
      };
      continue;
    }

    const horizonValidated =
      market === 'MATCH_WINNER' &&
      input.horizonMinutes === 90 &&
      input.frozenRegistryAvailable;

    result[market] = {
      market,
      status:
        horizonValidated
          ? historical.status
          : market ===
                'MATCH_WINNER' &&
              input.horizonMinutes !== 90
            ? `HORIZON_NOT_VALIDATED:${historical.status}`
            : market ===
                  'MATCH_WINNER' &&
                !input
                  .frozenRegistryAvailable
              ? `FROZEN_T90_REGISTRY_UNAVAILABLE:${historical.status}`
              : historical.status,
      eligible:
        historical.diagnosticEligible &&
        horizonValidated,
    };
  }

  return result;
}

function confidenceTier(input: {
  dataQualityScore: number;
  historySampleSize: number;
}): CurrentRecommendationConfidenceTier {
  if (
    input.dataQualityScore >= 0.65 &&
    input.historySampleSize >= 8
  ) {
    return 'HIGH';
  }

  if (
    input.dataQualityScore >= 0.4 &&
    input.historySampleSize >= 3
  ) {
    return 'MEDIUM';
  }

  return 'LIMITED';
}

async function buildCurrentModel(input: {
  localFixture: LocalFixtureRow;
  now: Date;
  horizonMinutes: number;
  frozenRegistry: FrozenRegistryRow | null;
}): Promise<{
  probabilities: LiveModelProbabilities;
  modelVersion: string;
  modelSource: CurrentRecommendationModelSource;
  modelFallbackReason: string | null;
  modelConfidenceTier: CurrentRecommendationConfidenceTier;
  historySampleSize: number;
  dataQualityScore: number;
  officialPromotionAllowed: boolean;
}> {
  const [
    baseline,
    fundamentals,
  ] = await Promise.all([
    getScientificFixtureAnalysis({
      fixtureId:
        input.localFixture.id,
      leagueId:
        input.localFixture.leagueId,
      homeTeamId:
        input.localFixture.homeTeamId,
      awayTeamId:
        input.localFixture.awayTeamId,
      homeTeamName:
        input.localFixture.homeTeam.name,
      awayTeamName:
        input.localFixture.awayTeam.name,
      kickoffAt:
        input.localFixture.kickoffAt,
      predictionAsOf:
        input.now,
      mode: 'LIVE',
      useMachineLearning: true,
    }),
    getFundamentalsFixturePrediction({
      fixtureId:
        input.localFixture.id,
      leagueId:
        input.localFixture.leagueId,
      homeTeamId:
        input.localFixture.homeTeamId,
      awayTeamId:
        input.localFixture.awayTeamId,
      kickoffAt:
        input.localFixture.kickoffAt,
      predictionAsOf:
        input.now,
      horizonMinutes:
        input.horizonMinutes,
      persist: false,
    }),
  ]);

  const baselineHda =
    normalizeShadowProbabilities({
      HOME:
        baseline.matchWinner.HOME,
      DRAW:
        baseline.matchWinner.DRAW,
      AWAY:
        baseline.matchWinner.AWAY,
    });

  const baselineOver25 = {
    OVER:
      baseline.over25.OVER,
    UNDER:
      baseline.over25.UNDER,
  };

  const baselineBtts = {
    YES:
      baseline.btts.YES,
    NO:
      baseline.btts.NO,
  };

  const modelConfidenceTier =
    confidenceTier({
      dataQualityScore:
        baseline.dataQualityScore,
      historySampleSize:
        baseline.historySampleSize,
    });

  if (
    fundamentals.available &&
    fundamentals.dixonColes != null
  ) {
    if (
      fundamentals.dixonColes
        .trainedThrough
        .getTime() >
      input.now.getTime()
    ) {
      throw new Error(
        'CURRENT_RECOMMENDATION_PIT_VIOLATION',
      );
    }

    const scoreGrid =
      deriveScientificScoreGridMarkets({
        homeExpectedGoals:
          fundamentals.homeExpectedGoals,
        awayExpectedGoals:
          fundamentals.awayExpectedGoals,
        rho:
          fundamentals.dixonColes.rho,
        maximumGoals: 10,
      });

    let hda =
      baselineHda;

    let hdaVersion =
      SCIENTIFIC_MODEL_VERSION;

    if (
      input.horizonMinutes === 90 &&
      input.frozenRegistry != null
    ) {
      const weights =
        weightsRecord(
          input.frozenRegistry.weights,
        );

      hda =
        buildFrozenShadowCandidateProbability(
          baselineHda,
          scoreGrid.matchWinner,
          {
            baselineWeight:
              weights.baseline ?? 0,
            dixonColesWeight:
              weights.dixonColes ?? 0,
            temperature:
              input.frozenRegistry
                .temperature,
            maximumProbabilityShift:
              input.frozenRegistry
                .maximumProbabilityShift,
          },
        );

      hdaVersion =
        input.frozenRegistry
          .candidateVersion;
    }

    return {
      probabilities: {
        MATCH_WINNER:
          hda,
        TOTAL_GOALS_1_5:
          scoreGrid.totalGoals[1.5],
        TOTAL_GOALS_2_5:
          scoreGrid.totalGoals[2.5],
        TOTAL_GOALS_3_5:
          scoreGrid.totalGoals[3.5],
        BTTS:
          scoreGrid.btts,
      },
      modelVersion: [
        CURRENT_SCIENTIFIC_RECOMMENDATION_VERSION,
        'SOURCE=DYNAMIC_DIXON_COLES',
        `HDA=${hdaVersion}`,
        'MM=DYNAMIC_DIXON_COLES',
      ].join('::'),
      modelSource:
        'DYNAMIC_DIXON_COLES',
      modelFallbackReason:
        null,
      modelConfidenceTier,
      historySampleSize:
        baseline.historySampleSize,
      dataQualityScore:
        fundamentals.dataQualityScore,
      officialPromotionAllowed:
        true,
    };
  }

  // Explicit PIT-safe fallback:
  // - HDA uses the existing scientific baseline blend.
  // - O/U 2.5 and BTTS use the existing calibrated baseline outputs.
  // - O/U 1.5 and 3.5 use an independent Poisson score grid built
  //   from the baseline expected goals calculated at predictionAsOf.
  const baselineScoreGrid =
    deriveScientificScoreGridMarkets({
      homeExpectedGoals:
        baseline.homeExpectedGoals,
      awayExpectedGoals:
        baseline.awayExpectedGoals,
      rho: 0,
      maximumGoals: 10,
    });

  return {
    probabilities: {
      MATCH_WINNER:
        baselineHda,
      TOTAL_GOALS_1_5:
        baselineScoreGrid
          .totalGoals[1.5],
      TOTAL_GOALS_2_5:
        baselineOver25,
      TOTAL_GOALS_3_5:
        baselineScoreGrid
          .totalGoals[3.5],
      BTTS:
        baselineBtts,
    },
    modelVersion: [
      CURRENT_SCIENTIFIC_RECOMMENDATION_VERSION,
      'SOURCE=SCIENTIFIC_BASELINE_FALLBACK',
      `BASE=${SCIENTIFIC_MODEL_VERSION}`,
      'HDA=SCIENTIFIC_BASELINE_BLEND',
      'OU25=CALIBRATED_BASELINE',
      'BTTS=SCIENTIFIC_BASELINE',
      'OU15_OU35=INDEPENDENT_POISSON_PIT_XG',
    ].join('::'),
    modelSource:
      'SCIENTIFIC_BASELINE_FALLBACK',
    modelFallbackReason:
      'NO_DIXON_COLES_MODEL_AT_CURRENT_AS_OF',
    modelConfidenceTier,
    historySampleSize:
      baseline.historySampleSize,
    dataQualityScore:
      baseline.dataQualityScore,
    officialPromotionAllowed:
      false,
  };
}
function currentSignalAssessment(
  input: {
    decimalOdds: number;
    edge: number;
    expectedValue: number;
  },
): {
  eligible: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  if (
    input.decimalOdds <
    SCIENTIFIC_BEST_BET_POLICY
      .minimumOdds
  ) {
    reasons.push(
      'CURRENT_ODDS_BELOW_MINIMUM',
    );
  }

  if (
    input.edge <
    SCIENTIFIC_BEST_BET_POLICY
      .minimumEdge
  ) {
    reasons.push(
      'CURRENT_EDGE_BELOW_MINIMUM',
    );
  }

  if (
    input.expectedValue <
    SCIENTIFIC_BEST_BET_POLICY
      .minimumExpectedValue
  ) {
    reasons.push(
      'CURRENT_EV_BELOW_MINIMUM',
    );
  }

  return {
    eligible:
      reasons.length === 0,
    reasons,
  };
}

function compareCurrentCandidates(
  left: CurrentScientificCandidate,
  right: CurrentScientificCandidate,
): number {
  return (
    Number(
      right.currentSignalEligible,
    ) -
      Number(
        left.currentSignalEligible,
      ) ||
    right.expectedValue -
      left.expectedValue ||
    right.edge -
      left.edge ||
    right.modelProbability -
      left.modelProbability ||
    left.decimalOdds -
      right.decimalOdds ||
    left.marketType.localeCompare(
      right.marketType,
    ) ||
    left.selection.localeCompare(
      right.selection,
    )
  );
}

function emptyAnalysis(input: {
  providerFixtureId: number;
  localFixtureId?: number | null;
  kickoffAt: Date;
  horizonMinutes: number;
  now: Date;
  status:
    CurrentScientificRecommendationAnalysis[
      'status'
    ];
  error?: string | null;
  oddsFreshness?: OddsFreshnessSummary;
}): CurrentScientificRecommendationAnalysis {
  return {
    version:
      CURRENT_SCIENTIFIC_RECOMMENDATION_VERSION,
    providerFixtureId:
      input.providerFixtureId,
    localFixtureId:
      input.localFixtureId ?? null,
    kickoffAt:
      input.kickoffAt.toISOString(),
    horizonMinutes:
      input.horizonMinutes,
    calculatedAt:
      input.now.toISOString(),
    status:
      input.status,
    recommendation: null,
    candidates: [],
    oddsFreshness:
      input.oddsFreshness ??
      emptyOddsFreshnessSummary(
        input.providerFixtureId,
        envNumber(
          'CURRENT_RECOMMENDATION_MAX_ODDS_AGE_MINUTES',
          360,
        ),
      ),
    marketCoverage: [],
    error:
      input.error ?? null,
    modelFallbackIsCurrentSignalOnly:
      true,
    externalApiCalled: false,
    databaseWritten: false,
    realMoneyExecution: false,
  };
}

export async function getCurrentScientificRecommendationMap(
  input: {
    providerFixtureIds: number[];
    now?: Date;
    maxFixtures?: number;
    maxOddsAgeMinutes?: number;
  },
): Promise<
  Map<
    number,
    CurrentScientificRecommendationAnalysis
  >
> {
  const now =
    input.now ?? new Date();

  const maxFixtures =
    Math.max(
      1,
      Math.min(
        120,
        Math.floor(
          input.maxFixtures ??
            envNumber(
              'CURRENT_RECOMMENDATION_MAX_FIXTURES',
              60,
            ),
        ),
      ),
    );

  const maxOddsAgeMinutes =
    Math.max(
      1,
      input.maxOddsAgeMinutes ??
        envNumber(
          'CURRENT_RECOMMENDATION_MAX_ODDS_AGE_MINUTES',
          360,
        ),
    );

  const providerFixtureIds = [
    ...new Set(
      input.providerFixtureIds.filter(
        (value: number): boolean =>
          Number.isSafeInteger(value) &&
          value > 0,
      ),
    ),
  ];

  const result =
    new Map<
      number,
      CurrentScientificRecommendationAnalysis
    >();

  if (
    providerFixtureIds.length === 0
  ) {
    return result;
  }

  const providerRows =
    (await prisma.apiFootballFixtureSnapshot.findMany({
      where: {
        providerFixtureId: {
          in: providerFixtureIds,
        },
        kickoffAt: {
          gt: now,
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
      orderBy: [
        {
          observedAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
      take: 5000,
    })) as ProviderFixtureRow[];

  const providers =
    latestProviderFixtures(
      providerRows,
    )
      .sort(
        (
          left: ProviderFixtureRow,
          right: ProviderFixtureRow,
        ): number =>
          left.kickoffAt.getTime() -
          right.kickoffAt.getTime(),
      )
      .slice(
        0,
        maxFixtures,
      );

  const ids =
    providers.map(
      (
        row: ProviderFixtureRow,
      ): number =>
        row.providerFixtureId,
    );

  if (ids.length === 0) {
    return result;
  }

  const oddsLookbackDays =
    Math.max(
      1,
      Math.min(
        30,
        Math.floor(
          envNumber(
            'CURRENT_RECOMMENDATION_ODDS_LOOKBACK_DAYS',
            14,
          ),
        ),
      ),
    );

  const oddsLookbackCutoff =
    new Date(
      now.getTime() -
        oddsLookbackDays *
          86_400_000,
    );

  const [
    localRowsRaw,
    oddsRowsRaw,
    reliabilityReport,
  ] = await Promise.all([
    prisma.fixture.findMany({
      where: {
        apiFixtureId: {
          in: ids,
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
    prisma.apiFootballOddsSnapshot.findMany({
      where: {
        providerFixtureId: {
          in: ids,
        },
        pitUsable: true,
        observedAt: {
          lte: now,
          gte: oddsLookbackCutoff,
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
        betId: true,
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
      take: 100000,
    }),
    getScientificBestBetReliabilityReport(),
  ]);

  const localRows =
    localRowsRaw as LocalFixtureRow[];

  const localByProvider =
    new Map<
      number,
      LocalFixtureRow
    >(
      localRows.map(
        (
          row: LocalFixtureRow,
        ): [
          number,
          LocalFixtureRow,
        ] => [
          row.apiFixtureId,
          row,
        ],
      ),
    );

  const oddsFreshnessResolution =
    await resolveFreshReobservedOdds({
      providerFixtureIds:
        ids,
      oddsRows:
        oddsRowsRaw as
          ReobservationOddsRow[],
      now,
      maximumAgeMinutes:
        maxOddsAgeMinutes,
    });

  const oddsByProvider =
    new Map<
      number,
      LiveOddsRow[]
    >();

  for (
    const row of
    oddsFreshnessResolution
      .activeOddsRows
  ) {
    const rows =
      oddsByProvider.get(
        row.providerFixtureId,
      ) ?? [];

    rows.push(row);

    oddsByProvider.set(
      row.providerFixtureId,
      rows,
    );
  }

  let frozenRegistry:
    FrozenRegistryRow |
    null |
    undefined;

  for (
    const provider of providers
  ) {
    const horizonMinutes =
      currentHorizonMinutes(
        provider.kickoffAt,
        now,
      );

    const oddsFreshness =
      oddsFreshnessResolution
        .summaryByFixture
        .get(
          provider.providerFixtureId,
        ) ??
      emptyOddsFreshnessSummary(
        provider.providerFixtureId,
        maxOddsAgeMinutes,
      );

    const local =
      localByProvider.get(
        provider.providerFixtureId,
      );

    if (local == null) {
      result.set(
        provider.providerFixtureId,
        emptyAnalysis({
          providerFixtureId:
            provider.providerFixtureId,
          kickoffAt:
            provider.kickoffAt,
          horizonMinutes,
          now,
          oddsFreshness,
          status:
            'UNMAPPED_FIXTURE',
        }),
      );
      continue;
    }

    if (
      !validMapping(
        provider,
        local,
      )
    ) {
      result.set(
        provider.providerFixtureId,
        emptyAnalysis({
          providerFixtureId:
            provider.providerFixtureId,
          localFixtureId:
            local.id,
          kickoffAt:
            provider.kickoffAt,
          horizonMinutes,
          now,
          oddsFreshness,
          status:
            'MAPPING_MISMATCH',
        }),
      );
      continue;
    }

    const fixtureOdds =
      oddsByProvider.get(
        provider.providerFixtureId,
      ) ?? [];

    if (
      fixtureOdds.length === 0
    ) {
      result.set(
        provider.providerFixtureId,
        emptyAnalysis({
          providerFixtureId:
            provider.providerFixtureId,
          localFixtureId:
            local.id,
          kickoffAt:
            provider.kickoffAt,
          horizonMinutes,
          now,
          oddsFreshness,
          status:
            'NO_FRESH_PIT_ODDS',
        }),
      );
      continue;
    }

    if (
      horizonMinutes === 90 &&
      frozenRegistry === undefined
    ) {
      frozenRegistry =
        await loadFrozenT90Registry(
          now,
        );
    }

    try {
      const model =
        await buildCurrentModel({
          localFixture:
            local,
          now,
          horizonMinutes,
          frozenRegistry:
            horizonMinutes === 90
              ? (
                  frozenRegistry ??
                  null
                )
              : null,
        });

      const gates =
        reliabilityGates({
          horizonMinutes,
          frozenRegistryAvailable:
            horizonMinutes !== 90 ||
            frozenRegistry != null,
          report:
            reliabilityReport,
        });

      const candidateSet =
        buildLivePaperBetCandidates({
          providerFixtureId:
            provider.providerFixtureId,
          oddsRows:
            fixtureOdds,
          modelProbabilities:
            model.probabilities,
          reliability:
            gates,
        });

      if (
        candidateSet
          .candidates.length === 0
      ) {
        result.set(
          provider.providerFixtureId,
          {
            ...emptyAnalysis({
              providerFixtureId:
                provider.providerFixtureId,
              localFixtureId:
                local.id,
              kickoffAt:
                provider.kickoffAt,
              horizonMinutes,
              now,
              oddsFreshness,
              status:
                'NO_COMPLETE_MARKET',
            }),
            marketCoverage:
              candidateSet
                .marketCoverage,
          },
        );
        continue;
      }

      const candidates =
        candidateSet.candidates
          .map(
            (
              candidate,
            ): CurrentScientificCandidate => {
              const normalized =
                normalizePaperBetCandidate(
                  candidate,
                );

              const scientific =
                normalized
                  .scientificCandidate;

              const official =
                assessBestBetCandidate(
                  scientific,
                );

              const officialEligible =
                official.eligible &&
                model
                  .officialPromotionAllowed;

              const officialRejectionReasons =
                model
                  .officialPromotionAllowed
                  ? official
                      .rejectionReasons
                  : [
                      ...official
                        .rejectionReasons,
                      'CURRENT_BASELINE_FALLBACK_NOT_OFFICIAL',
                    ];

              const currentSignal =
                currentSignalAssessment({
                  decimalOdds:
                    scientific
                      .decimalOdds,
                  edge:
                    scientific.edge,
                  expectedValue:
                    scientific
                      .expectedValue,
                });

              const freshnessEvidence:
                OddsFreshnessEvidence |
                null =
                candidate
                  .sourceOddsSnapshotId ==
                null
                  ? null
                  : oddsFreshnessResolution
                      .evidenceBySnapshotId
                      .get(
                        candidate
                          .sourceOddsSnapshotId,
                      ) ??
                    null;

              return {
                marketType:
                  candidate.marketType,
                selection:
                  candidate.selection,
                lineValue:
                  candidate.lineValue,
                decimalOdds:
                  candidate.decimalOdds,
                bookmakerName:
                  candidate.bookmakerName,
                modelProbability:
                  candidate
                    .modelProbability,
                fairMarketProbability:
                  candidate
                    .fairMarketProbability,
                edge:
                  scientific.edge,
                expectedValue:
                  scientific
                    .expectedValue,
                reliabilityStatus:
                  candidate
                    .reliabilityStatus,
                modelSource:
                  model.modelSource,
                modelFallbackReason:
                  model.modelFallbackReason,
                modelConfidenceTier:
                  model.modelConfidenceTier,
                modelHistorySampleSize:
                  model.historySampleSize,
                modelDataQualityScore:
                  model.dataQualityScore,
                currentSignalEligible:
                  currentSignal
                    .eligible,
                currentSignalRejectionReasons:
                  currentSignal
                    .reasons,
                officialEligible,
                officialRejectionReasons,
                sourceOddsSnapshotId:
                  candidate
                    .sourceOddsSnapshotId,
                sourceOddsEffectiveAt:
                  (
                    candidate
                      .sourceOddsUpdatedAt ??
                    candidate
                      .sourceOddsObservedAt
                  )?.toISOString() ??
                  null,
                sourceOddsUpdatedAt:
                  candidate
                    .sourceOddsUpdatedAt
                    ?.toISOString() ??
                  null,
                sourceOddsFirstObservedAt:
                  candidate
                    .sourceOddsObservedAt
                    ?.toISOString() ??
                  null,
                sourceOddsReobservedAt:
                  freshnessEvidence
                    ?.reobservedAt
                    ?.toISOString() ??
                  null,
                sourceOddsFreshnessAt:
                  freshnessEvidence
                    ?.freshnessAt
                    .toISOString() ??
                  null,
                oddsFreshnessBasis:
                  freshnessEvidence
                    ?.basis ??
                  null,
                reobservationRawSnapshotId:
                  freshnessEvidence
                    ?.reobservationRawSnapshotId ??
                  null,
                reobservationKind:
                  freshnessEvidence
                    ?.reobservationKind ??
                  null,
              };
            },
          )
          .sort(
            compareCurrentCandidates,
          );

      const selected =
        candidates.find(
          (
            candidate: CurrentScientificCandidate,
          ): boolean =>
            candidate
              .currentSignalEligible,
        ) ??
        null;

      const recommendation =
        selected == null
          ? null
          : {
              source:
                'CURRENT_SCIENTIFIC_PIT' as const,
              version:
                CURRENT_SCIENTIFIC_RECOMMENDATION_VERSION,
              calculatedAt:
                now.toISOString(),
              providerFixtureId:
                provider
                  .providerFixtureId,
              localFixtureId:
                local.id,
              kickoffAt:
                provider
                  .kickoffAt
                  .toISOString(),
              horizonMinutes,
              marketType:
                selected.marketType,
              selection:
                selected.selection,
              lineValue:
                selected.lineValue,
              decimalOdds:
                selected.decimalOdds,
              bookmakerName:
                selected.bookmakerName,
              modelProbability:
                selected
                  .modelProbability,
              fairMarketProbability:
                selected
                  .fairMarketProbability,
              edge:
                selected.edge,
              expectedValue:
                selected
                  .expectedValue,
              reliabilityStatus:
                selected
                  .reliabilityStatus,
              modelSource:
                selected
                  .modelSource,
              modelFallbackReason:
                selected
                  .modelFallbackReason,
              modelConfidenceTier:
                selected
                  .modelConfidenceTier,
              modelHistorySampleSize:
                selected
                  .modelHistorySampleSize,
              currentSignalEligible:
                true as const,
              officialEligible:
                selected
                  .officialEligible,
              dataQualityScore:
                model
                  .dataQualityScore,
              modelVersion:
                model.modelVersion,
              sourceOddsSnapshotId:
                selected
                  .sourceOddsSnapshotId,
              sourceOddsEffectiveAt:
                selected
                  .sourceOddsEffectiveAt,
              sourceOddsUpdatedAt:
                selected
                  .sourceOddsUpdatedAt,
              sourceOddsFirstObservedAt:
                selected
                  .sourceOddsFirstObservedAt,
              sourceOddsReobservedAt:
                selected
                  .sourceOddsReobservedAt,
              sourceOddsFreshnessAt:
                selected
                  .sourceOddsFreshnessAt,
              oddsFreshnessBasis:
                selected
                  .oddsFreshnessBasis,
              reobservationRawSnapshotId:
                selected
                  .reobservationRawSnapshotId,
              reobservationKind:
                selected
                  .reobservationKind,
              note:
                'CURRENT_SIGNAL_NOT_OFFICIAL_BEST_BET' as const,
            };

      result.set(
        provider.providerFixtureId,
        {
          version:
            CURRENT_SCIENTIFIC_RECOMMENDATION_VERSION,
          providerFixtureId:
            provider.providerFixtureId,
          localFixtureId:
            local.id,
          kickoffAt:
            provider.kickoffAt
              .toISOString(),
          horizonMinutes,
          calculatedAt:
            now.toISOString(),
          status:
            recommendation == null
              ? 'NO_VALUE_SIGNAL'
              : 'AVAILABLE',
          recommendation,
          candidates,
          oddsFreshness,
          marketCoverage:
            candidateSet
              .marketCoverage,
          error: null,
          modelFallbackIsCurrentSignalOnly:
            true,
          externalApiCalled:
            false,
          databaseWritten:
            false,
          realMoneyExecution:
            false,
        },
      );
    } catch (error) {
      result.set(
        provider.providerFixtureId,
        emptyAnalysis({
          providerFixtureId:
            provider.providerFixtureId,
          localFixtureId:
            local.id,
          kickoffAt:
            provider.kickoffAt,
          horizonMinutes,
          now,
          oddsFreshness,
          status:
            'NO_MODEL',
          error:
            error instanceof Error
              ? error.message
              : String(error),
        }),
      );
    }
  }

  return result;
}

export async function getCurrentScientificRecommendation(
  input: {
    providerFixtureId: number;
    now?: Date;
    maxOddsAgeMinutes?: number;
  },
): Promise<
  CurrentScientificRecommendationAnalysis |
  null
> {
  const map =
    await getCurrentScientificRecommendationMap({
      providerFixtureIds: [
        input.providerFixtureId,
      ],
      now: input.now,
      maxFixtures: 1,
      maxOddsAgeMinutes:
        input.maxOddsAgeMinutes,
    });

  return (
    map.get(
      input.providerFixtureId,
    ) ??
    null
  );
}
