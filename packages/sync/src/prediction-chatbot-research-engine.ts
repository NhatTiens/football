import { prisma } from '@football-ai/database';

import { getPaperHdaContextAdjustment } from './paper-hda-context-adjustment-engine.js';
import { getScientificFixtureAnalysis } from './scientific-features.js';
import {
  aggregateShadowSettlements,
  type ShadowReliabilityGroup,
  type ShadowSettlementRow,
} from './shadow-settlement-core.js';
import { buildShadowSettlementRuntimeReport } from './shadow-settlement-report-cli.js';

export const PREDICTION_CHATBOT_RESEARCH_VERSION =
  'v7.0-chatbot.4-7-pit-research-outcome-reliability-v1';

export interface PredictionChatResearchFixture {
  localFixtureId: number;
  providerFixtureId: number;
  leagueId: number;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: string;
}

export interface PredictionChatDeepExplanation {
  version: string;
  generatedAsOf: string;
  expectedGoals: {
    home: number;
    away: number;
    total: number;
  };
  form: {
    homePointsPerGame: number;
    awayPointsPerGame: number;
  };
  elo: {
    home: number;
    away: number;
    differenceHomeMinusAway: number;
  };
  lineup: {
    available: boolean;
    home: {
      confirmed: boolean;
      starterCount: number;
      formation: string | null;
      rotationCount: number | null;
      missingRegulars: Array<{
        playerName: string;
        positionGroup: string;
        startRate: number;
      }>;
    };
    away: {
      confirmed: boolean;
      starterCount: number;
      formation: string | null;
      rotationCount: number | null;
      missingRegulars: Array<{
        playerName: string;
        positionGroup: string;
        startRate: number;
      }>;
    };
  };
  injuries: {
    home: number;
    away: number;
    homeRegulars: number;
    awayRegulars: number;
    coverageAvailable: boolean;
  };
  headToHead: {
    eligibleMatches: number;
    effectiveWeight: number;
    probabilityShift: number;
    applied: boolean;
  };
  modelEvidence: {
    historySampleSize: number;
    dataQualityScore: number;
    confidenceScore: number;
    machineLearningAvailable: boolean;
  };
  reasons: string[];
  missingData: string[];
  safety: {
    pointInTimeSafe: true;
    futureRowsRejected: number;
    probabilitiesInvented: false;
    databaseWritten: false;
    externalApiCalled: false;
  };
}

export interface PredictionChatHistoryEntry {
  id: string;
  source: 'PAPER_LEDGER' | 'PAPER_SHADOW';
  providerFixtureId: number;
  homeTeamName: string | null;
  awayTeamName: string | null;
  kickoffAt: string;
  decisionAsOf: string;
  decisionType: string;
  marketType: string | null;
  selection: string | null;
  lineValue: number | null;
  decimalOdds: number | null;
  modelProbability: number | null;
  result: 'WIN' | 'LOSS' | 'VOID' | 'PUSH' | 'PENDING';
  fulltimeHomeGoals: number | null;
  fulltimeAwayGoals: number | null;
  profitUnits: number | null;
  clv: number | null;
}

export interface PredictionChatReliabilitySummary {
  rows: number;
  settled: number;
  pending: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number | null;
  roi: number | null;
  profitUnits: number;
  clvEligible: number;
  averageClv: number | null;
  positiveClvRate: number | null;
  status: string;
}

export interface PredictionChatResearchReport {
  version: string;
  generatedAt: string;
  fixtureFilter: number | null;
  marketFilter: 'TOTAL_GOALS' | 'BTTS' | null;
  history: {
    rows: PredictionChatHistoryEntry[];
    totalRows: number;
    settledRows: number;
    pendingRows: number;
  };
  reliability: {
    overall: PredictionChatReliabilitySummary;
    byMarket: PredictionChatReliabilitySummaryWithKey[];
    byHorizon: PredictionChatReliabilitySummaryWithKey[];
    diagnosticTargetRows: 30;
    promotionTargetRows: 150;
    diagnosticProgressRate: number;
    promotionProgressRate: number;
    sampleWarning: string | null;
    automaticPromotion: false;
  };
  safety: {
    appendOnlySource: true;
    derivedReadModel: true;
    pitSafe: true;
    paperOnly: true;
    databaseWritten: false;
    externalApiCalled: false;
    automaticPromotion: false;
    realMoneyExecution: false;
  };
}

export interface PredictionChatReliabilitySummaryWithKey extends PredictionChatReliabilitySummary {
  key: string;
  marketType: string | null;
  checkpointMinutes: number | null;
}

function missingRegulars(
  rows: ReadonlyArray<{
    playerName: string;
    positionGroup: string;
    startRate: number;
  }>,
): Array<{ playerName: string; positionGroup: string; startRate: number }> {
  return rows.slice(0, 11).map((row) => ({
    playerName: row.playerName,
    positionGroup: row.positionGroup,
    startRate: row.startRate,
  }));
}

export async function buildPredictionChatDeepExplanation(input: {
  fixture: PredictionChatResearchFixture;
  predictionAsOf: Date;
}): Promise<PredictionChatDeepExplanation> {
  const fixture = input.fixture;
  const scientific = await getScientificFixtureAnalysis({
    fixtureId: fixture.localFixtureId,
    leagueId: fixture.leagueId,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    homeTeamName: fixture.homeTeamName,
    awayTeamName: fixture.awayTeamName,
    kickoffAt: new Date(fixture.kickoffAt),
    predictionAsOf: input.predictionAsOf,
  });
  const hdaContext = await getPaperHdaContextAdjustment({
    fixtureId: fixture.localFixtureId,
    leagueId: fixture.leagueId,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    predictionAsOf: input.predictionAsOf,
    baseline: scientific.matchWinner,
    homeLineup: scientific.lineupAnalysis.home,
    awayLineup: scientific.lineupAnalysis.away,
  });
  const missingData: string[] = [];
  if (scientific.historySampleSize === 0) missingData.push('Chưa có lịch sử trận đủ dùng.');
  if (scientific.dataQualityScore < 0.4) missingData.push('Data quality hiện còn thấp.');
  if (!scientific.lineupAnalysis.available) missingData.push('Chưa có đội hình đủ dùng.');
  if (!scientific.injuries.coverageAvailable)
    missingData.push('Chưa xác nhận coverage chấn thương.');
  if (hdaContext.evidence.eligibleHeadToHeadMatches < 3) {
    missingData.push('Mẫu đối đầu trực tiếp dưới 3 trận nên không dùng để dịch xác suất.');
  }

  return {
    version: PREDICTION_CHATBOT_RESEARCH_VERSION,
    generatedAsOf: input.predictionAsOf.toISOString(),
    expectedGoals: {
      home: scientific.homeExpectedGoals,
      away: scientific.awayExpectedGoals,
      total: scientific.homeExpectedGoals + scientific.awayExpectedGoals,
    },
    form: scientific.form,
    elo: {
      ...scientific.elo,
      differenceHomeMinusAway: scientific.elo.home - scientific.elo.away,
    },
    lineup: {
      available: scientific.lineupAnalysis.available,
      home: {
        confirmed: scientific.lineupAnalysis.home.confirmed,
        starterCount: scientific.lineupAnalysis.home.starterCount,
        formation: scientific.lineupAnalysis.home.formation ?? null,
        rotationCount: scientific.lineupAnalysis.home.rotationCount,
        missingRegulars: missingRegulars(scientific.lineupAnalysis.home.missingRegulars),
      },
      away: {
        confirmed: scientific.lineupAnalysis.away.confirmed,
        starterCount: scientific.lineupAnalysis.away.starterCount,
        formation: scientific.lineupAnalysis.away.formation ?? null,
        rotationCount: scientific.lineupAnalysis.away.rotationCount,
        missingRegulars: missingRegulars(scientific.lineupAnalysis.away.missingRegulars),
      },
    },
    injuries: scientific.injuries,
    headToHead: {
      eligibleMatches: hdaContext.evidence.eligibleHeadToHeadMatches,
      effectiveWeight: hdaContext.evidence.headToHeadEffectiveWeight,
      probabilityShift: hdaContext.headToHeadShift,
      applied: Math.abs(hdaContext.headToHeadShift) > 1e-9,
    },
    modelEvidence: {
      historySampleSize: scientific.historySampleSize,
      dataQualityScore: scientific.dataQualityScore,
      confidenceScore: scientific.confidenceScore,
      machineLearningAvailable: scientific.modelPrediction != null,
    },
    reasons: scientific.reasons.slice(0, 16),
    missingData,
    safety: {
      pointInTimeSafe: true,
      futureRowsRejected: hdaContext.pointInTime.futureRowsRejected,
      probabilitiesInvented: false,
      databaseWritten: false,
      externalApiCalled: false,
    },
  };
}

function matchesMarket(marketType: string, filter: 'TOTAL_GOALS' | 'BTTS' | null): boolean {
  if (filter == null) return true;
  if (filter === 'BTTS') return marketType.toUpperCase() === 'BTTS';
  return marketType.toUpperCase().startsWith('TOTAL_GOALS');
}

function reliabilitySummary(input: {
  rows: number;
  settled: number;
  pending: number;
  wins: number;
  losses: number;
  voids: number;
  hitRate: number | null;
  roi: number | null;
  hypotheticalProfitUnits: number;
  clvEligible: number;
  averageClv: number | null;
  positiveClvRate: number | null;
  reliabilityStatus: string;
}): PredictionChatReliabilitySummary {
  return {
    rows: input.rows,
    settled: input.settled,
    pending: input.pending,
    wins: input.wins,
    losses: input.losses,
    voids: input.voids,
    hitRate: input.hitRate,
    roi: input.roi,
    profitUnits: input.hypotheticalProfitUnits,
    clvEligible: input.clvEligible,
    averageClv: input.averageClv,
    positiveClvRate: input.positiveClvRate,
    status: input.reliabilityStatus,
  };
}

function reliabilityGroup(group: ShadowReliabilityGroup): PredictionChatReliabilitySummaryWithKey {
  return {
    key: group.key,
    marketType: group.marketType,
    checkpointMinutes: group.checkpointMinutes,
    ...reliabilitySummary(group),
  };
}

interface PaperDecisionRow {
  id: number;
  providerFixtureId: number;
  kickoffAt: Date;
  decisionAsOf: Date;
  decisionType: string;
  selectedMarket: string | null;
  selectedSelection: string | null;
  lineValue: number | null;
  decimalOdds: number | null;
  modelProbability: number | null;
  settlement: {
    result: string;
    fulltimeHomeGoals: number;
    fulltimeAwayGoals: number;
    profitUnits: number;
    clv: number | null;
  } | null;
}

function normalizedSettlementResult(
  value: string | null | undefined,
): PredictionChatHistoryEntry['result'] {
  switch (value?.toUpperCase()) {
    case 'WIN':
      return 'WIN';
    case 'LOSS':
      return 'LOSS';
    case 'VOID':
      return 'VOID';
    case 'PUSH':
      return 'PUSH';
    default:
      return 'PENDING';
  }
}

export async function buildPredictionChatResearchReport(input: {
  reportAsOf: Date;
  providerFixtureId?: number | null;
  marketFilter?: 'TOTAL_GOALS' | 'BTTS' | null;
  limit?: number;
}): Promise<PredictionChatResearchReport> {
  const providerFixtureId = input.providerFixtureId ?? null;
  const marketFilter = input.marketFilter ?? null;
  const limit = Math.max(1, Math.min(30, input.limit ?? 12));
  const [shadowReport, decisionRows] = await Promise.all([
    buildShadowSettlementRuntimeReport({
      hours: 8760,
      providerFixtureId,
      reportAsOf: input.reportAsOf,
      maximumSnapshots: 3000,
    }),
    prisma.scientificPaperBetDecision.findMany({
      where: providerFixtureId == null ? undefined : { providerFixtureId },
      include: { settlement: true },
      orderBy: { decisionAsOf: 'desc' },
      take: 300,
    }),
  ]);
  const decisions = decisionRows as PaperDecisionRow[];
  const shadowRows = (shadowReport.rows as ShadowSettlementRow[]).filter(
    (row) =>
      row.decisionSource === 'paperShadowRecommendation' &&
      matchesMarket(row.marketType, marketFilter),
  );
  const filteredDecisions = decisions.filter(
    (row) =>
      marketFilter == null ||
      (row.selectedMarket != null && matchesMarket(row.selectedMarket, marketFilter)),
  );
  const providerFixtureIds = [
    ...new Set([
      ...shadowRows.map((row) => row.providerFixtureId),
      ...filteredDecisions.map((row) => row.providerFixtureId),
    ]),
  ];
  const snapshots =
    providerFixtureIds.length === 0
      ? []
      : await prisma.apiFootballFixtureSnapshot.findMany({
          where: {
            providerFixtureId: { in: providerFixtureIds },
            observedAt: { lte: input.reportAsOf },
          },
          select: {
            providerFixtureId: true,
            homeTeamName: true,
            awayTeamName: true,
            observedAt: true,
          },
          orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
          take: Math.min(10_000, providerFixtureIds.length * 12),
        });
  const names = new Map<number, { homeTeamName: string; awayTeamName: string }>();
  for (const snapshot of snapshots) {
    if (!names.has(snapshot.providerFixtureId)) {
      names.set(snapshot.providerFixtureId, snapshot);
    }
  }

  const ledgerHistory: PredictionChatHistoryEntry[] = filteredDecisions.map((row) => ({
    id: `ledger:${row.id}`,
    source: 'PAPER_LEDGER',
    providerFixtureId: row.providerFixtureId,
    homeTeamName: names.get(row.providerFixtureId)?.homeTeamName ?? null,
    awayTeamName: names.get(row.providerFixtureId)?.awayTeamName ?? null,
    kickoffAt: row.kickoffAt.toISOString(),
    decisionAsOf: row.decisionAsOf.toISOString(),
    decisionType: row.decisionType,
    marketType: row.selectedMarket,
    selection: row.selectedSelection,
    lineValue: row.lineValue,
    decimalOdds: row.decimalOdds,
    modelProbability: row.modelProbability,
    result: normalizedSettlementResult(row.settlement?.result),
    fulltimeHomeGoals: row.settlement?.fulltimeHomeGoals ?? null,
    fulltimeAwayGoals: row.settlement?.fulltimeAwayGoals ?? null,
    profitUnits: row.settlement?.profitUnits ?? null,
    clv: row.settlement?.clv ?? null,
  }));
  const shadowHistory: PredictionChatHistoryEntry[] = shadowRows.map((row) => ({
    id: `shadow:${row.snapshotId}`,
    source: 'PAPER_SHADOW',
    providerFixtureId: row.providerFixtureId,
    homeTeamName: names.get(row.providerFixtureId)?.homeTeamName ?? null,
    awayTeamName: names.get(row.providerFixtureId)?.awayTeamName ?? null,
    kickoffAt: row.kickoffAt,
    decisionAsOf: row.snapshotAsOf,
    decisionType: 'PAPER_PROPOSAL',
    marketType: row.marketType,
    selection: row.selection,
    lineValue: row.lineValue,
    decimalOdds: row.decisionOdds,
    modelProbability: row.paperModelProbability,
    result: row.settlementResult ?? 'PENDING',
    fulltimeHomeGoals: row.outcome.fulltimeHomeGoals,
    fulltimeAwayGoals: row.outcome.fulltimeAwayGoals,
    profitUnits: row.hypotheticalProfitUnits,
    clv: row.clv,
  }));
  const allHistory = [...ledgerHistory, ...shadowHistory].sort(
    (left, right) =>
      new Date(right.decisionAsOf).getTime() - new Date(left.decisionAsOf).getTime() ||
      right.id.localeCompare(left.id),
  );
  const reliability = aggregateShadowSettlements(shadowRows);
  const settledRows = reliability.overall.settled;

  return {
    version: PREDICTION_CHATBOT_RESEARCH_VERSION,
    generatedAt: input.reportAsOf.toISOString(),
    fixtureFilter: providerFixtureId,
    marketFilter,
    history: {
      rows: allHistory.slice(0, limit),
      totalRows: allHistory.length,
      settledRows: allHistory.filter((row) => row.result !== 'PENDING').length,
      pendingRows: allHistory.filter((row) => row.result === 'PENDING').length,
    },
    reliability: {
      overall: reliabilitySummary(reliability.overall),
      byMarket: reliability.byMarket.map(reliabilityGroup),
      byHorizon: reliability.byHorizon.map(reliabilityGroup),
      diagnosticTargetRows: 30,
      promotionTargetRows: 150,
      diagnosticProgressRate: Math.min(1, settledRows / 30),
      promotionProgressRate: Math.min(1, settledRows / 150),
      sampleWarning:
        settledRows < 30
          ? `Mới có ${settledRows}/30 settlement; chưa đủ mẫu reliability chẩn đoán.`
          : settledRows < 150
            ? `Đã đủ mẫu chẩn đoán nhưng mới có ${settledRows}/150 settlement cho promotion review.`
            : null,
      automaticPromotion: false,
    },
    safety: {
      appendOnlySource: true,
      derivedReadModel: true,
      pitSafe: true,
      paperOnly: true,
      databaseWritten: false,
      externalApiCalled: false,
      automaticPromotion: false,
      realMoneyExecution: false,
    },
  };
}
