import {
  matchPredictionChatFixture,
  PREDICTION_CHATBOT_CORE_VERSION,
  type PredictionChatFixtureIndex,
  type PredictionChatIntent,
  type PredictionChatSuggestion,
} from './prediction-chatbot-core.js';
import { getPersonalUpcomingAnalysis } from './personal-console-engine.js';

export const PREDICTION_CHATBOT_VERSION = 'v7.0-chatbot-current-analysis-freshness-v2';

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
    calculatedAt?: string;
    sourceOddsFreshnessAt?: string | null;
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
    calculatedAt?: string;
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
      sourceOddsEffectiveAt?: string | null;
      reasonCodes: string[];
    } | null;
  } | null;
  currentAnalysisFreshness?: {
    calculatedAt: string;
    latestOddsFreshnessAt: string | null;
    engineMaximumOddsAgeMinutes: number;
  } | null;
  decision: {
    decisionAsOf?: string;
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
    freshnessStatus: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
    freshnessSource: 'CURRENT_ANALYSIS' | 'PAPER_LEDGER' | 'NONE';
    sourceCalculatedAt: string | null;
    sourceAgeMinutes: number | null;
    maximumAgeMinutes: number;
  };
}

interface PredictionChatFreshness {
  status: 'CURRENT' | 'STALE' | 'UNAVAILABLE';
  source: 'CURRENT_ANALYSIS' | 'PAPER_LEDGER' | 'NONE';
  calculatedAt: string | null;
  ageMinutes: number | null;
  maximumAgeMinutes: number;
}

function boundedEnvironmentInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

function freshnessFor(row: AnalysisFixtureRow, now: Date): PredictionChatFreshness {
  const usesCurrentAnalysis = row.currentRecommendationStatus !== 'NOT_EVALUATED';
  const currentAnalysisMaximumAgeMinutes = boundedEnvironmentInteger(
    'PREDICTION_CHAT_CURRENT_ANALYSIS_MAX_AGE_MINUTES',
    10,
    1,
    60,
  );
  const maximumAgeMinutes = usesCurrentAnalysis
    ? boundedEnvironmentInteger('PREDICTION_CHAT_CURRENT_DATA_MAX_AGE_MINUTES', 60, 1, 360)
    : boundedEnvironmentInteger('PREDICTION_CHAT_LEDGER_MAX_AGE_MINUTES', 360, 1, 1440);
  const analysisCalculatedAt = usesCurrentAnalysis
    ? (row.currentAnalysisFreshness?.calculatedAt ??
      row.currentRecommendation?.calculatedAt ??
      row.paperShadowRecommendation?.calculatedAt ??
      null)
    : null;
  const currentStatusCanExposeModel = ['AVAILABLE', 'NO_VALUE_SIGNAL'].includes(
    row.currentRecommendationStatus,
  );
  const currentOddsFreshnessAt = currentStatusCanExposeModel
    ? (row.currentAnalysisFreshness?.latestOddsFreshnessAt ??
      row.currentRecommendation?.sourceOddsFreshnessAt ??
      row.paperShadowRecommendation?.selected?.sourceOddsEffectiveAt ??
      null)
    : analysisCalculatedAt;
  const calculatedAt = usesCurrentAnalysis
    ? currentOddsFreshnessAt
    : (row.decision?.decisionAsOf ?? null);
  const analysisTimestamp =
    analysisCalculatedAt == null ? Number.NaN : new Date(analysisCalculatedAt).getTime();
  if (
    usesCurrentAnalysis &&
    (!Number.isFinite(analysisTimestamp) ||
      now.getTime() - analysisTimestamp < -60_000 ||
      now.getTime() - analysisTimestamp > currentAnalysisMaximumAgeMinutes * 60_000)
  ) {
    return {
      status: Number.isFinite(analysisTimestamp) ? 'STALE' : 'UNAVAILABLE',
      source: Number.isFinite(analysisTimestamp) ? 'CURRENT_ANALYSIS' : 'NONE',
      calculatedAt: analysisCalculatedAt,
      ageMinutes: Number.isFinite(analysisTimestamp)
        ? Math.max(0, (now.getTime() - analysisTimestamp) / 60_000)
        : null,
      maximumAgeMinutes: currentAnalysisMaximumAgeMinutes,
    };
  }
  const parsed = calculatedAt == null ? Number.NaN : new Date(calculatedAt).getTime();
  if (!Number.isFinite(parsed)) {
    return {
      status: 'UNAVAILABLE',
      source: 'NONE',
      calculatedAt: null,
      ageMinutes: null,
      maximumAgeMinutes,
    };
  }
  const ageMinutes = (now.getTime() - parsed) / 60_000;
  const current = ageMinutes >= -1 && ageMinutes <= maximumAgeMinutes;
  return {
    status: current ? 'CURRENT' : 'STALE',
    source: usesCurrentAnalysis ? 'CURRENT_ANALYSIS' : 'PAPER_LEDGER',
    calculatedAt,
    ageMinutes: Math.max(0, ageMinutes),
    maximumAgeMinutes,
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
  AVAILABLE: 'Có tín hiệu khoa học hiện tại nhưng chưa phải đề xuất chính thức.',
  NO_FRESH_PIT_ODDS: 'Chưa có dữ liệu PIT đủ mới để đánh giá mô hình.',
  NO_PROVIDER_FIXTURE_SNAPSHOT:
    'Chưa có snapshot fixture từ nhà cung cấp để liên kết dữ liệu thị trường.',
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

function hdaAnswer(
  row: AnalysisFixtureRow,
  freshness: PredictionChatFreshness,
): PredictionChatHdaAnswer {
  // HDA fields in the personal read model come from the persisted ledger/provider
  // prediction. Once a current analysis exists, do not relabel those older fields
  // as a current-model answer.
  if (freshness.status !== 'CURRENT' || row.currentRecommendationStatus !== 'NOT_EVALUATED') {
    return {
      source: 'NONE',
      homeProbability: null,
      drawProbability: null,
      awayProbability: null,
      predictedSelection: null,
    };
  }

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

function marketAnswers(
  row: AnalysisFixtureRow,
  freshness: PredictionChatFreshness,
): PredictionChatMarketAnswer[] {
  const currentStatusCanExposeModel = ['AVAILABLE', 'NO_VALUE_SIGNAL'].includes(
    row.currentRecommendationStatus,
  );
  if (
    freshness.status !== 'CURRENT' ||
    (row.currentRecommendationStatus !== 'NOT_EVALUATED' && !currentStatusCanExposeModel)
  ) {
    return [];
  }

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

function noRecommendation(reason: string): PredictionChatRecommendationAnswer {
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
    reason,
  };
}

function recommendationAnswer(
  row: AnalysisFixtureRow,
  freshness: PredictionChatFreshness,
): PredictionChatRecommendationAnswer {
  if (freshness.status !== 'CURRENT') {
    return noRecommendation(
      freshness.status === 'STALE'
        ? 'Dữ liệu phân tích đã quá thời hạn cho phép; chatbot chờ chu kỳ đồng bộ mới và không trả lại lựa chọn cũ.'
        : 'Chưa xác minh được thời điểm tạo dữ liệu; chatbot không sử dụng bản ghi cũ làm tín hiệu hiện tại.',
    );
  }

  const currentAnalysisAvailable = row.currentRecommendationStatus !== 'NOT_EVALUATED';

  // The current scientific calculation is the source of truth for chatbot answers.
  // An append-only ledger decision remains available for audit, but cannot mask a
  // newer current-model result for the same fixture.
  if (currentAnalysisAvailable && row.currentRecommendation) {
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
      reason:
        'Kết quả mô hình hiện tại dùng dữ liệu PIT mới nhất đã được backend xác nhận; chưa phải giao dịch thực.',
    };
  }

  const paper = row.paperShadowRecommendation?.selected;
  if (currentAnalysisAvailable && paper?.paperTrackEligible) {
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
      reason: 'Tín hiệu mô phỏng hiện tại đủ điều kiện theo dõi, chưa phải đề xuất chính thức.',
    };
  }

  if (currentAnalysisAvailable && paper) {
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
      reason: 'Có tín hiệu chẩn đoán hiện tại nhưng chưa đủ điều kiện theo dõi mô phỏng.',
    };
  }

  if (currentAnalysisAvailable) {
    return noRecommendation(
      row.currentRecommendationError ??
        statusReason[row.currentRecommendationStatus] ??
        'Mô hình hiện tại chưa có lựa chọn đủ điều kiện.',
    );
  }

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

  return noRecommendation(
    statusReason[row.currentRecommendationStatus] ??
      'Chưa có đề xuất đủ điều kiện; bot không tự tạo lựa chọn thay cho mô hình.',
  );
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

function fixtureStateFor(
  row: AnalysisFixtureRow,
  recommendation: PredictionChatRecommendationAnswer,
): AnalysisFixtureRow['state'] {
  if (row.currentRecommendationStatus === 'NOT_EVALUATED') return row.state;
  return recommendation.status === 'NONE' ? 'NO_BET' : 'PREDICTION_ONLY';
}

export function answerPredictionChatForProviderFixtureFromAnalysis(input: {
  providerFixtureId: number;
  analysis: Record<string, unknown>;
  now?: Date;
  intent?: PredictionChatIntent;
}): PredictionChatResponse {
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
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
  const freshness = freshnessFor(row, now);
  const hda = hdaAnswer(row, freshness);
  const recommendation = recommendationAnswer(row, freshness);
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
      fixtureState: fixtureStateFor(row, recommendation),
      hda,
      markets: marketAnswers(row, freshness),
      recommendation,
      dataQuality: {
        oddsSnapshots: row.oddsDiagnostics.snapshotRows,
        pitUsableOdds: row.oddsDiagnostics.pitUsableRows,
        currentRecommendationStatus: row.currentRecommendationStatus,
        freshnessStatus: freshness.status,
        freshnessSource: freshness.source,
        sourceCalculatedAt: freshness.calculatedAt,
        sourceAgeMinutes: freshness.ageMinutes,
        maximumAgeMinutes: freshness.maximumAgeMinutes,
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
  const now = input.now ?? new Date();
  const generatedAt = now.toISOString();
  const rows = Array.isArray(input.analysis.fixtures)
    ? (input.analysis.fixtures as AnalysisFixtureRow[])
    : [];
  const byProviderFixtureId = new Map(rows.map((row) => [row.fixture.apiFixtureId, row] as const));
  const match = matchPredictionChatFixture({
    message: input.message,
    fixtures: rows.map(fixtureIndex),
    now,
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

  const freshness = freshnessFor(row, now);
  const hda = hdaAnswer(row, freshness);
  const recommendation = recommendationAnswer(row, freshness);
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
      fixtureState: fixtureStateFor(row, recommendation),
      hda,
      markets: marketAnswers(row, freshness),
      recommendation,
      dataQuality: {
        oddsSnapshots: row.oddsDiagnostics.snapshotRows,
        pitUsableOdds: row.oddsDiagnostics.pitUsableRows,
        currentRecommendationStatus: row.currentRecommendationStatus,
        freshnessStatus: freshness.status,
        freshnessSource: freshness.source,
        sourceCalculatedAt: freshness.calculatedAt,
        sourceAgeMinutes: freshness.ageMinutes,
        maximumAgeMinutes: freshness.maximumAgeMinutes,
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
    limit: input.limit ?? 180,
  });
  return answerPredictionChatFromAnalysis({
    message: input.message,
    analysis,
    now: input.now,
  });
}
