import {
  canPredictionChatUseActiveFixture,
  detectAdvancedPredictionChatIntent,
  isPredictionChatAggregateQuery,
  nextPredictionChatContext,
  predictionChatMarketFilter,
  sanitizePredictionChatContext,
  type AdvancedPredictionChatIntent,
  type PredictionChatConversationContext,
} from './prediction-chatbot-conversation-core.js';
import {
  normalizePredictionChatText,
  type PredictionChatIntent,
} from './prediction-chatbot-core.js';
import {
  answerPredictionChatFromAnalysis,
  answerPredictionChatForProviderFixtureFromAnalysis,
  type PredictionChatMatchedAnswer,
  type PredictionChatResponse,
} from './prediction-chatbot-engine.js';
import {
  buildPredictionChatDeepExplanation,
  buildPredictionChatResearchReport,
  type PredictionChatDeepExplanation,
  type PredictionChatResearchFixture,
  type PredictionChatResearchReport,
} from './prediction-chatbot-research-engine.js';
import { getPersonalUpcomingAnalysis } from './personal-console-engine.js';

export const PREDICTION_CHATBOT_ADVANCED_VERSION =
  'v7.0-chatbot.3-8-read-only-research-assistant-v1';

export const predictionChatCapabilities = {
  version: PREDICTION_CHATBOT_ADVANCED_VERSION,
  fixturePrediction: true,
  boundedConversationContext: true,
  maximumContextTurns: 24,
  deepScientificExplanation: true,
  upcomingFixtureDiscovery: true,
  paperHistoryAndSettlement: true,
  clvAndReliability: true,
  persistentUserChatHistory: false,
  generativeExternalLlm: false,
  authenticationRequired: false,
  paidPlansEnabled: false,
  paperOnly: true,
  realMoneyExecution: false,
} as const;

interface AdvancedAnalysisFixtureRow {
  fixture: {
    id: number;
    apiFixtureId: number;
    kickoffAt: string;
    league: { id: number; name: string };
    homeTeam: { id: number; name: string };
    awayTeam: { id: number; name: string };
  };
  scientificHda: { available: boolean };
  providerHda: { available: boolean };
  currentRecommendation: { expectedValue: number } | null;
  paperShadowRecommendation: {
    selected: { paperTrackEligible: boolean; boundedExpectedValue: number } | null;
  } | null;
  decision: { expectedValue: number | null } | null;
  marketPredictions: Array<{
    scientificMarketType: string;
    selections: Array<{ modelProbability: number | null }>;
  }>;
  state: 'BEST_BET' | 'NO_BET' | 'PREDICTION_ONLY' | 'WAITING_DATA';
}

export interface PredictionChatCollection {
  kind: 'UPCOMING' | 'BEST_BET';
  officialBestBets: number;
  paperShadowCandidates: number;
  rows: PredictionChatMatchedAnswer[];
}

export type AdvancedPredictionChatResponse = Omit<PredictionChatResponse, 'intent'> & {
  version: string;
  intent: AdvancedPredictionChatIntent;
  context: PredictionChatConversationContext;
  collection: PredictionChatCollection | null;
  explanation: PredictionChatDeepExplanation | null;
  research: PredictionChatResearchReport | null;
  researchError: 'EXPLANATION_UNAVAILABLE' | 'RESEARCH_UNAVAILABLE' | null;
  capabilities: typeof predictionChatCapabilities;
};

function analysisRows(analysis: Record<string, unknown>): AdvancedAnalysisFixtureRow[] {
  return Array.isArray(analysis.fixtures)
    ? (analysis.fixtures as AdvancedAnalysisFixtureRow[])
    : [];
}

function requestedMarketFilter(
  message: string,
  intent: AdvancedPredictionChatIntent,
): 'TOTAL_GOALS' | 'BTTS' | null {
  const direct = predictionChatMarketFilter(intent);
  if (direct != null) return direct;
  const normalized = normalizePredictionChatText(message);
  if (/\b(btts|hai doi ghi ban|ca hai doi ghi ban)\b/.test(normalized)) return 'BTTS';
  if (/\b(over|under|o u|tai|xiu|tong ban|tong so ban)\b/.test(normalized)) {
    return 'TOTAL_GOALS';
  }
  return null;
}

function baseIntent(intent: AdvancedPredictionChatIntent): PredictionChatIntent {
  if (intent === 'BEST_BET' || intent === 'TOTAL_GOALS' || intent === 'BTTS') return intent;
  return 'PREDICTION';
}

function fixtureByProviderId(
  rows: AdvancedAnalysisFixtureRow[],
  providerFixtureId: number | null,
): AdvancedAnalysisFixtureRow | null {
  if (providerFixtureId == null) return null;
  return rows.find((row) => row.fixture.apiFixtureId === providerFixtureId) ?? null;
}

function hasMarket(
  row: AdvancedAnalysisFixtureRow,
  marketFilter: 'TOTAL_GOALS' | 'BTTS' | null,
): boolean {
  if (marketFilter == null) return true;
  return row.marketPredictions.some((market) => {
    const marketType = market.scientificMarketType.toUpperCase();
    const matches =
      marketFilter === 'BTTS' ? marketType === 'BTTS' : marketType.startsWith('TOTAL_GOALS');
    return matches && market.selections.some((selection) => selection.modelProbability != null);
  });
}

function recommendationRank(row: AdvancedAnalysisFixtureRow): number {
  if (row.state === 'BEST_BET') return 500;
  if (row.paperShadowRecommendation?.selected?.paperTrackEligible) return 400;
  if (row.currentRecommendation != null) return 300;
  if (row.scientificHda.available) return 200;
  if (row.providerHda.available) return 100;
  return 0;
}

function recommendationExpectedValue(row: AdvancedAnalysisFixtureRow): number {
  return (
    row.decision?.expectedValue ??
    row.paperShadowRecommendation?.selected?.boundedExpectedValue ??
    row.currentRecommendation?.expectedValue ??
    Number.NEGATIVE_INFINITY
  );
}

export function buildPredictionChatCollectionFromAnalysis(input: {
  analysis: Record<string, unknown>;
  message: string;
  intent: AdvancedPredictionChatIntent;
  now: Date;
  limit?: number;
}): PredictionChatCollection {
  const marketFilter = requestedMarketFilter(input.message, input.intent);
  const maximumRows = Math.max(1, Math.min(8, input.limit ?? 5));
  const ranked = analysisRows(input.analysis)
    .filter((row) => hasMarket(row, marketFilter))
    .filter((row) =>
      input.intent === 'BEST_BET'
        ? row.state === 'BEST_BET' ||
          row.paperShadowRecommendation?.selected?.paperTrackEligible === true ||
          row.currentRecommendation != null
        : true,
    )
    .sort(
      (left, right) =>
        recommendationRank(right) - recommendationRank(left) ||
        recommendationExpectedValue(right) - recommendationExpectedValue(left) ||
        new Date(left.fixture.kickoffAt).getTime() - new Date(right.fixture.kickoffAt).getTime(),
    )
    .slice(0, maximumRows);
  const answers = ranked.flatMap((row) => {
    const response = answerPredictionChatForProviderFixtureFromAnalysis({
      providerFixtureId: row.fixture.apiFixtureId,
      analysis: input.analysis,
      now: input.now,
      intent: baseIntent(input.intent),
    });
    return response.answer == null ? [] : [response.answer];
  });

  return {
    kind: input.intent === 'BEST_BET' ? 'BEST_BET' : 'UPCOMING',
    officialBestBets: answers.filter((row) => row.recommendation.officialBestBet).length,
    paperShadowCandidates: answers.filter(
      (row) => row.recommendation.status !== 'BEST_BET' && row.recommendation.status !== 'NONE',
    ).length,
    rows: answers,
  };
}

function researchFixture(row: AdvancedAnalysisFixtureRow): PredictionChatResearchFixture {
  return {
    localFixtureId: row.fixture.id,
    providerFixtureId: row.fixture.apiFixtureId,
    leagueId: row.fixture.league.id,
    homeTeamId: row.fixture.homeTeam.id,
    awayTeamId: row.fixture.awayTeam.id,
    homeTeamName: row.fixture.homeTeam.name,
    awayTeamName: row.fixture.awayTeam.name,
    kickoffAt: row.fixture.kickoffAt,
  };
}

function collectionMessage(collection: PredictionChatCollection): string {
  if (collection.rows.length === 0) {
    return collection.kind === 'BEST_BET'
      ? 'Hiện chưa có BEST BET hoặc tín hiệu paper/shadow đủ điều kiện trong dữ liệu sắp tới.'
      : 'Hiện chưa có trận sắp tới phù hợp với bộ lọc này trong database.';
  }
  if (collection.kind === 'BEST_BET') {
    return collection.officialBestBets > 0
      ? `Có ${collection.officialBestBets} BEST BET chính thức trong danh sách. Tất cả vẫn chỉ là paper, không đặt tiền thật.`
      : `Chưa có BEST BET chính thức. Tôi hiển thị ${collection.paperShadowCandidates} tín hiệu paper/shadow để theo dõi, không đổi chúng thành BEST BET.`;
  }
  return `Tìm thấy ${collection.rows.length} trận sắp tới phù hợp. Xếp hạng ưu tiên tín hiệu đã có trong dữ liệu, không tự tạo xác suất.`;
}

function withAdvancedFields(input: {
  base: PredictionChatResponse;
  intent: AdvancedPredictionChatIntent;
  context: PredictionChatConversationContext;
  message?: string;
  collection?: PredictionChatCollection | null;
  explanation?: PredictionChatDeepExplanation | null;
  research?: PredictionChatResearchReport | null;
  researchError?: AdvancedPredictionChatResponse['researchError'];
}): AdvancedPredictionChatResponse {
  return {
    ...input.base,
    version: PREDICTION_CHATBOT_ADVANCED_VERSION,
    intent: input.intent,
    context: input.context,
    message: input.message ?? input.base.message,
    collection: input.collection ?? null,
    explanation: input.explanation ?? null,
    research: input.research ?? null,
    researchError: input.researchError ?? null,
    capabilities: predictionChatCapabilities,
  };
}

export async function answerAdvancedPredictionChatFromAnalysis(input: {
  message: string;
  context?: unknown;
  analysis: Record<string, unknown>;
  now?: Date;
}): Promise<AdvancedPredictionChatResponse> {
  const now = input.now ?? new Date();
  const previousContext = sanitizePredictionChatContext(input.context);
  const intent = detectAdvancedPredictionChatIntent(input.message);
  const rows = analysisRows(input.analysis);
  const aggregate = isPredictionChatAggregateQuery({
    message: input.message,
    intent,
    context: previousContext,
  });
  let base = answerPredictionChatFromAnalysis({
    message: input.message,
    analysis: input.analysis,
    now,
  });
  const activeRow = fixtureByProviderId(rows, previousContext.activeProviderFixtureId);
  if (
    base.answer == null &&
    activeRow != null &&
    canPredictionChatUseActiveFixture({
      message: input.message,
      intent,
      context: previousContext,
    })
  ) {
    base = answerPredictionChatForProviderFixtureFromAnalysis({
      providerFixtureId: activeRow.fixture.apiFixtureId,
      analysis: input.analysis,
      now,
      intent: baseIntent(intent),
    });
  }
  const matchedRow = fixtureByProviderId(
    rows,
    base.answer?.fixture.providerFixtureId ?? previousContext.activeProviderFixtureId,
  );
  const context = nextPredictionChatContext({
    previous: previousContext,
    intent,
    fixture:
      base.answer == null
        ? null
        : {
            providerFixtureId: base.answer.fixture.providerFixtureId,
            homeTeamName: base.answer.fixture.homeTeamName,
            awayTeamName: base.answer.fixture.awayTeamName,
          },
  });

  if (aggregate && (intent === 'DISCOVERY' || intent === 'BEST_BET')) {
    const collection = buildPredictionChatCollectionFromAnalysis({
      analysis: input.analysis,
      message: input.message,
      intent,
      now,
    });
    return withAdvancedFields({
      base: {
        ...base,
        status: collection.rows.length > 0 ? 'ANSWER' : 'NOT_FOUND',
        answer: collection.rows[0] ?? null,
        suggestions: [],
      },
      intent,
      context: nextPredictionChatContext({
        previous: previousContext,
        intent,
        fixture: collection.rows[0]?.fixture ?? null,
      }),
      message: collectionMessage(collection),
      collection,
    });
  }

  if (intent === 'EXPLANATION' && matchedRow != null && base.answer != null) {
    try {
      const explanation = await buildPredictionChatDeepExplanation({
        fixture: researchFixture(matchedRow),
        predictionAsOf: now,
      });
      return withAdvancedFields({
        base,
        intent,
        context,
        message: `${base.message} Phần dưới trình bày bằng chứng mô hình và dữ liệu còn thiếu tại thời điểm trả lời.`,
        explanation,
      });
    } catch {
      return withAdvancedFields({
        base,
        intent,
        context,
        message: `${base.message} Chưa thể tải phần giải thích sâu; dự đoán gốc không bị thay đổi.`,
        researchError: 'EXPLANATION_UNAVAILABLE',
      });
    }
  }

  if (intent === 'HISTORY' || intent === 'RELIABILITY') {
    const fixtureFilter = aggregate ? null : (matchedRow?.fixture.apiFixtureId ?? null);
    try {
      const research = await buildPredictionChatResearchReport({
        reportAsOf: now,
        providerFixtureId: fixtureFilter,
        marketFilter: requestedMarketFilter(input.message, intent),
      });
      const message =
        intent === 'HISTORY'
          ? `Tìm thấy ${research.history.totalRows} bản ghi paper; ${research.history.settledRows} đã settlement và ${research.history.pendingRows} đang chờ.`
          : `Reliability hiện có ${research.reliability.overall.settled} settlement, ROI ${research.reliability.overall.roi == null ? 'chưa đủ dữ liệu' : `${(research.reliability.overall.roi * 100).toFixed(1)}%`}. Không tự động promotion.`;
      return withAdvancedFields({
        base: { ...base, status: 'ANSWER', suggestions: [] },
        intent,
        context,
        message,
        research,
      });
    } catch {
      return withAdvancedFields({
        base,
        intent,
        context,
        message:
          'Chưa thể đọc báo cáo paper settlement lúc này; chatbot không thay thế bằng số liệu ước đoán.',
        researchError: 'RESEARCH_UNAVAILABLE',
      });
    }
  }

  return withAdvancedFields({ base, intent, context });
}

export async function answerAdvancedPredictionChat(input: {
  message: string;
  context?: unknown;
  now?: Date;
  days?: number;
  limit?: number;
}): Promise<AdvancedPredictionChatResponse> {
  const analysis = await getPersonalUpcomingAnalysis({
    now: input.now,
    days: input.days ?? 14,
    limit: input.limit ?? 300,
  });
  return answerAdvancedPredictionChatFromAnalysis({
    message: input.message,
    context: input.context,
    analysis,
    now: input.now,
  });
}
