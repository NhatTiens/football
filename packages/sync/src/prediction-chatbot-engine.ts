import {
  matchPredictionChatFixture,
  PREDICTION_CHATBOT_CORE_VERSION,
  type PredictionChatFixtureIndex,
  type PredictionChatIntent,
  type PredictionChatSuggestion,
} from './prediction-chatbot-core.js';
import { getPersonalUpcomingAnalysis } from './personal-console-engine.js';

export const PREDICTION_CHATBOT_VERSION = 'v7.0-beta.2a.1-read-only-prediction-chatbot-engine-v1';

type SelectionCode = 'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO';

interface AnalysisFixtureRow {
  fixture: {
    id: number;
    apiFixtureId: number;
    kickoffAt: string;
    league: { name: string };
    homeTeam: { name: string };
    awayTeam: { name: string };
  };
  scientificHda: {
    available: boolean;
    homeProbability: number | null;
    drawProbability: number | null;
    awayProbability: number | null;
    predictedSelection: 'HOME' | 'DRAW' | 'AWAY' | null;
  };
  providerHda: {
    available: boolean;
    homeProbability: number | null;
    drawProbability: number | null;
    awayProbability: number | null;
    predictedSelection: 'HOME' | 'DRAW' | 'AWAY' | null;
  };
  currentRecommendationStatus: string;
  currentRecommendationError: string | null;
  currentRecommendation: {
    marketType: string;
    selection: SelectionCode;
    lineValue: number | null;
    decimalOdds: number;
    bookmakerName: string;
    modelProbability: number;
    edge: number;
    expectedValue: number;
  } | null;
  paperShadowRecommendation: {
    status: string;
    selected: {
      marketType: string;
      selection: SelectionCode;
      lineValue: number | null;
      decimalOdds: number;
      bookmakerName: string | null;
      modelProbability: number;
      boundedAdjustedProbability: number;
      boundedEdge: number;
      boundedExpectedValue: number;
      paperTrackEligible: boolean;
      reasonCodes: string[];
    } | null;
  } | null;
  decision: {
    decisionType: string;
    selectedMarket: string | null;
    selectedSelection: SelectionCode | null;
    lineValue: number | null;
    decimalOdds: number | null;
    bookmakerName: string | null;
    modelProbability: number | null;
    edge: number | null;
    expectedValue: number | null;
  } | null;
  marketPredictions: Array<{
    code: string;
    scientificMarketType: string;
    label: string;
    lineValue: number | null;
    selections: Array<{
      code: SelectionCode;
      modelProbability: number | null;
    }>;
  }>;
  oddsDiagnostics: {
    snapshotRows: number;
    pitUsableRows: number;
  };
  state: 'BEST_BET' | 'NO_BET' | 'PREDICTION_ONLY' | 'WAITING_DATA';
}

export interface PredictionChatHdaAnswer {
  source: 'SCIENTIFIC_DECISION' | 'API_FOOTBALL' | 'NONE';
  homeProbability: number | null;
  drawProbability: number | null;
  awayProbability: number | null;
  predictedSelection: 'HOME' | 'DRAW' | 'AWAY' | null;
}

export interface PredictionChatMarketAnswer {
  marketType: string;
  label: string;
  lineValue: number | null;
  predictedSelection: SelectionCode;
  modelProbability: number;
}

export interface PredictionChatRecommendationAnswer {
  status: 'BEST_BET' | 'PAPER_SHADOW' | 'CURRENT_SHADOW' | 'DIAGNOSTIC_SHADOW' | 'NONE';
  marketType: string | null;
  selection: SelectionCode | null;
  lineValue: number | null;
  decimalOdds: number | null;
  bookmakerName: string | null;
  modelProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  officialBestBet: boolean;
  paperOnly: true;
  reason: string;
}

export interface PredictionChatMatchedAnswer {
  fixture: PredictionChatFixtureIndex & { localFixtureId: number };
  fixtureState: AnalysisFixtureRow['state'];
  hda: PredictionChatHdaAnswer;
  markets: PredictionChatMarketAnswer[];
  recommendation: PredictionChatRecommendationAnswer;
  dataQuality: {
    oddsSnapshots: number;
    pitUsableOdds: number;
    currentRecommendationStatus: string;
  };
}

export interface PredictionChatResponse {
  version: string;
  coreVersion: string;
  generatedAt: string;
  status: 'ANSWER' | 'AMBIGUOUS' | 'NOT_FOUND';
  intent: PredictionChatIntent;
  message: string;
  answer: PredictionChatMatchedAnswer | null;
  suggestions: PredictionChatSuggestion[];
  safety: {
    readOnly: true;
    externalApiCalled: false;
    databaseWritten: false;
    probabilitiesInvented: false;
    pointInTimeSafe: true;
    paperOnly: true;
    realMoneyExecution: false;
  };
}

const statusReason: Record<string, string> = {
  AVAILABLE:
    'Có tín hiệu khoa học hiện tại nhưng chưa phải đề xuất chính thức.',
  NO_FRESH_PIT_ODDS: 'Chưa có dữ liệu PIT đủ mới để đánh giá mô hình.',
  NO_PROVIDER_FIXTURE_SNAPSHOT: 'Chưa có snapshot fixture từ nhà cung cấp để liên kết dữ liệu thị trường.',
  NO_MODEL: 'Chưa có model hợp lệ cho trận này.',
  NO_COMPLETE_MARKET: 'Chưa có đủ hai phía của market để đánh giá công bằng.',
  NO_VALUE_SIGNAL: 'Mô hình đã đánh giá nhưng các chỉ số chưa đạt ngưỡng.',
  UNMAPPED_FIXTURE: 'Chưa ánh xạ được fixture nội bộ với fixture của nhà cung cấp.',
  MAPPING_MISMATCH: 'Dữ liệu ánh xạ fixture không khớp nên tín hiệu bị chặn.',
  NOT_EVALUATED: 'Trận chưa tới lượt đánh giá hoặc đang chờ checkpoint.',
};

function safety(): PredictionChatResponse['safety'] {
  return {
    readOnly: true,
    externalApiCalled: false,
    databaseWritten: false,
    probabilitiesInvented: false,
    pointInTimeSafe: true,
    paperOnly: true,
    realMoneyExecution: false,
  };
}

function fixtureIndex(row: AnalysisFixtureRow): PredictionChatFixtureIndex {
  return {
    providerFixtureId: row.fixture.apiFixtureId,
    kickoffAt: row.fixture.kickoffAt,
    leagueName: row.fixture.league.name,
    homeTeamName: row.fixture.homeTeam.name,
    awayTeamName: row.fixture.awayTeam.name,
  };
}

function hdaAnswer(row: AnalysisFixtureRow): PredictionChatHdaAnswer {
  if (row.scientificHda.available) {
    return {
      source: 'SCIENTIFIC_DECISION',
      homeProbability: row.scientificHda.homeProbability,
      drawProbability: row.scientificHda.drawProbability,
      awayProbability: row.scientificHda.awayProbability,
      predictedSelection: row.scientificHda.predictedSelection,
    };
  }
  if (row.providerHda.available) {
    return {
      source: 'API_FOOTBALL',
      homeProbability: row.providerHda.homeProbability,
      drawProbability: row.providerHda.drawProbability,
      awayProbability: row.providerHda.awayProbability,
      predictedSelection: row.providerHda.predictedSelection,
    };
  }
  return {
    source: 'NONE',
    homeProbability: null,
    drawProbability: null,
    awayProbability: null,
    predictedSelection: null,
  };
}

function marketAnswers(row: AnalysisFixtureRow): PredictionChatMarketAnswer[] {
  return row.marketPredictions.flatMap((market) => {
    const candidates = market.selections
      .filter(
        (selection): selection is typeof selection & { modelProbability: number } =>
          selection.modelProbability != null && Number.isFinite(selection.modelProbability),
      )
      .sort((left, right) => right.modelProbability - left.modelProbability);
    const selected = candidates[0];
    return selected
      ? [
          {
            marketType: market.scientificMarketType,
            label: market.label,
            lineValue: market.lineValue,
            predictedSelection: selected.code,
            modelProbability: selected.modelProbability,
          },
        ]
      : [];
  });
}

function recommendationAnswer(row: AnalysisFixtureRow): PredictionChatRecommendationAnswer {
  if (row.state === 'BEST_BET' && row.decision?.selectedMarket && row.decision.selectedSelection) {
    return {
      status: 'BEST_BET',
      marketType: row.decision.selectedMarket,
      selection: row.decision.selectedSelection,
      lineValue: row.decision.lineValue,
      decimalOdds: row.decision.decimalOdds,
      bookmakerName: row.decision.bookmakerName,
      modelProbability: row.decision.modelProbability,
      edge: row.decision.edge,
      expectedValue: row.decision.expectedValue,
      officialBestBet: true,
      paperOnly: true,
      reason: 'Đề xuất khoa học đã được ghi vào nhật ký mô phỏng; không có giao dịch tài chính.',
    };
  }

  const paper = row.paperShadowRecommendation?.selected;
  if (paper?.paperTrackEligible) {
    return {
      status: 'PAPER_SHADOW',
      marketType: paper.marketType,
      selection: paper.selection,
      lineValue: paper.lineValue,
      decimalOdds: paper.decimalOdds,
      bookmakerName: paper.bookmakerName,
      modelProbability: paper.boundedAdjustedProbability,
      edge: paper.boundedEdge,
      expectedValue: paper.boundedExpectedValue,
      officialBestBet: false,
      paperOnly: true,
      reason: 'Tín hiệu mô phỏng đủ điều kiện theo dõi, chưa phải đề xuất chính thức.',
    };
  }

  if (row.currentRecommendation) {
    return {
      status: 'CURRENT_SHADOW',
      marketType: row.currentRecommendation.marketType,
      selection: row.currentRecommendation.selection,
      lineValue: row.currentRecommendation.lineValue,
      decimalOdds: row.currentRecommendation.decimalOdds,
      bookmakerName: row.currentRecommendation.bookmakerName,
      modelProbability: row.currentRecommendation.modelProbability,
      edge: row.currentRecommendation.edge,
      expectedValue: row.currentRecommendation.expectedValue,
      officialBestBet: false,
      paperOnly: true,
      reason: 'Tín hiệu khoa học hiện tại dùng cho nghiên cứu theo dõi, chưa thay đổi đề xuất chính thức.',
    };
  }

  if (paper) {
    return {
      status: 'DIAGNOSTIC_SHADOW',
      marketType: paper.marketType,
      selection: paper.selection,
      lineValue: paper.lineValue,
      decimalOdds: paper.decimalOdds,
      bookmakerName: paper.bookmakerName,
      modelProbability: paper.boundedAdjustedProbability,
      edge: paper.boundedEdge,
      expectedValue: paper.boundedExpectedValue,
      officialBestBet: false,
      paperOnly: true,
      reason: 'Có tín hiệu chẩn đoán nhưng chưa đủ điều kiện theo dõi mô phỏng.',
    };
  }

  return {
    status: 'NONE',
    marketType: null,
    selection: null,
    lineValue: null,
    decimalOdds: null,
    bookmakerName: null,
    modelProbability: null,
    edge: null,
    expectedValue: null,
    officialBestBet: false,
    paperOnly: true,
    reason:
      row.currentRecommendationError ??
      statusReason[row.currentRecommendationStatus] ??
      'Chưa có đề xuất đủ điều kiện; bot không tự tạo lựa chọn thay cho mô hình.',
  };
}

function selectionName(
  selection: 'HOME' | 'DRAW' | 'AWAY' | null,
  row: AnalysisFixtureRow,
): string {
  if (selection === 'HOME') return row.fixture.homeTeam.name;
  if (selection === 'AWAY') return row.fixture.awayTeam.name;
  if (selection === 'DRAW') return 'Hòa';
  return 'chưa đủ dữ liệu';
}

function matchedMessage(
  row: AnalysisFixtureRow,
  hda: PredictionChatHdaAnswer,
  recommendation: PredictionChatRecommendationAnswer,
): string {
  const match = `${row.fixture.homeTeam.name} vs ${row.fixture.awayTeam.name}`;
  const probability =
    hda.predictedSelection === 'HOME'
      ? hda.homeProbability
      : hda.predictedSelection === 'DRAW'
        ? hda.drawProbability
        : hda.predictedSelection === 'AWAY'
          ? hda.awayProbability
          : null;
  const hdaText =
    hda.source === 'NONE'
      ? 'Chưa có dự đoán HDA hợp lệ.'
      : `Hướng HDA hiện tại: ${selectionName(hda.predictedSelection, row)}${
          probability == null ? '' : ` (${(probability * 100).toFixed(1)}%)`
        }.`;
  const recommendationText =
    recommendation.status === 'NONE'
      ? `NO BET: ${recommendation.reason}`
      : `${recommendation.status}: ${recommendation.selection ?? ''}${
          recommendation.lineValue == null ? '' : ` ${recommendation.lineValue}`
        }${recommendation.decimalOdds == null ? '' : ` @ ${recommendation.decimalOdds.toFixed(2)}`}. ${recommendation.reason}`;
  return `${match}. ${hdaText} ${recommendationText}`;
}

export function answerPredictionChatForProviderFixtureFromAnalysis(input: {
  providerFixtureId: number;
  analysis: Record<string, unknown>;
  now?: Date;
  intent?: PredictionChatIntent;
}): PredictionChatResponse {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const rows = Array.isArray(input.analysis.fixtures)
    ? (input.analysis.fixtures as AnalysisFixtureRow[])
    : [];
  const row =
    rows.find((candidate) => candidate.fixture.apiFixtureId === input.providerFixtureId) ?? null;
  if (row == null) {
    return {
      version: PREDICTION_CHATBOT_VERSION,
      coreVersion: PREDICTION_CHATBOT_CORE_VERSION,
      generatedAt,
      status: 'NOT_FOUND',
      intent: input.intent ?? 'PREDICTION',
      message: 'Fixture đã chọn không còn trong snapshot đọc hiện tại. Hãy thử lại.',
      answer: null,
      suggestions: [],
      safety: safety(),
    };
  }
  const fixture = fixtureIndex(row);
  const hda = hdaAnswer(row);
  const recommendation = recommendationAnswer(row);
  return {
    version: PREDICTION_CHATBOT_VERSION,
    coreVersion: PREDICTION_CHATBOT_CORE_VERSION,
    generatedAt,
    status: 'ANSWER',
    intent: input.intent ?? 'PREDICTION',
    message: matchedMessage(row, hda, recommendation),
    answer: {
      fixture: {
        ...fixture,
        localFixtureId: row.fixture.id,
      },
      fixtureState: row.state,
      hda,
      markets: marketAnswers(row),
      recommendation,
      dataQuality: {
        oddsSnapshots: row.oddsDiagnostics.snapshotRows,
        pitUsableOdds: row.oddsDiagnostics.pitUsableRows,
        currentRecommendationStatus: row.currentRecommendationStatus,
      },
    },
    suggestions: [],
    safety: safety(),
  };
}

export function answerPredictionChatFromAnalysis(input: {
  message: string;
  analysis: Record<string, unknown>;
  now?: Date;
}): PredictionChatResponse {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const rows = Array.isArray(input.analysis.fixtures)
    ? (input.analysis.fixtures as AnalysisFixtureRow[])
    : [];
  const byProviderFixtureId = new Map(rows.map((row) => [row.fixture.apiFixtureId, row] as const));
  const match = matchPredictionChatFixture({
    message: input.message,
    fixtures: rows.map(fixtureIndex),
    now: input.now,
  });

  if (match.status !== 'MATCHED') {
    return {
      version: PREDICTION_CHATBOT_VERSION,
      coreVersion: PREDICTION_CHATBOT_CORE_VERSION,
      generatedAt,
      status: match.status,
      intent: match.intent,
      message:
        match.status === 'AMBIGUOUS'
          ? 'Tôi tìm thấy nhiều trận phù hợp. Hãy chọn đúng trận bên dưới.'
          : rows.length === 0
            ? 'Database chưa có trận sắp tới để chatbot phân tích. Hãy chạy đồng bộ fixture trước.'
            : 'Không tìm thấy trận này trong dữ liệu sắp tới. Tôi chỉ trả lời các fixture hiện có trong database.',
      answer: null,
      suggestions: match.suggestions,
      safety: safety(),
    };
  }

  const row = byProviderFixtureId.get(match.fixture.providerFixtureId);
  if (!row) {
    return {
      version: PREDICTION_CHATBOT_VERSION,
      coreVersion: PREDICTION_CHATBOT_CORE_VERSION,
      generatedAt,
      status: 'NOT_FOUND',
      intent: match.intent,
      message: 'Fixture vừa chọn không còn trong snapshot đọc hiện tại. Hãy thử lại.',
      answer: null,
      suggestions: [],
      safety: safety(),
    };
  }

  const hda = hdaAnswer(row);
  const recommendation = recommendationAnswer(row);
  return {
    version: PREDICTION_CHATBOT_VERSION,
    coreVersion: PREDICTION_CHATBOT_CORE_VERSION,
    generatedAt,
    status: 'ANSWER',
    intent: match.intent,
    message: matchedMessage(row, hda, recommendation),
    answer: {
      fixture: {
        ...match.fixture,
        localFixtureId: row.fixture.id,
      },
      fixtureState: row.state,
      hda,
      markets: marketAnswers(row),
      recommendation,
      dataQuality: {
        oddsSnapshots: row.oddsDiagnostics.snapshotRows,
        pitUsableOdds: row.oddsDiagnostics.pitUsableRows,
        currentRecommendationStatus: row.currentRecommendationStatus,
      },
    },
    suggestions: [],
    safety: safety(),
  };
}

export async function answerPredictionChat(input: {
  message: string;
  now?: Date;
  days?: number;
  limit?: number;
}): Promise<PredictionChatResponse> {
  const analysis = await getPersonalUpcomingAnalysis({
    now: input.now,
    days: input.days ?? 14,
    limit: input.limit ?? 300,
  });
  return answerPredictionChatFromAnalysis({
    message: input.message,
    analysis,
    now: input.now,
  });
}
