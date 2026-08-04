import { normalizePredictionChatText } from './prediction-chatbot-core.js';

export const PREDICTION_CHATBOT_CONVERSATION_VERSION =
  'v7.0-chatbot.3-8-bounded-conversation-context-v1';

export type AdvancedPredictionChatIntent =
  | 'PREDICTION'
  | 'BEST_BET'
  | 'TOTAL_GOALS'
  | 'BTTS'
  | 'EXPLANATION'
  | 'DISCOVERY'
  | 'HISTORY'
  | 'RELIABILITY';

export interface PredictionChatConversationContext {
  activeProviderFixtureId: number | null;
  activeHomeTeamName: string | null;
  activeAwayTeamName: string | null;
  lastIntent: AdvancedPredictionChatIntent | null;
  turnCount: number;
}

export const EMPTY_PREDICTION_CHAT_CONTEXT: PredictionChatConversationContext = {
  activeProviderFixtureId: null,
  activeHomeTeamName: null,
  activeAwayTeamName: null,
  lastIntent: null,
  turnCount: 0,
};

function boundedText(value: unknown, maximumLength = 120): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : null;
}

function fixtureId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function validIntent(value: unknown): AdvancedPredictionChatIntent | null {
  return [
    'PREDICTION',
    'BEST_BET',
    'TOTAL_GOALS',
    'BTTS',
    'EXPLANATION',
    'DISCOVERY',
    'HISTORY',
    'RELIABILITY',
  ].includes(String(value))
    ? (value as AdvancedPredictionChatIntent)
    : null;
}

export function sanitizePredictionChatContext(value: unknown): PredictionChatConversationContext {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { ...EMPTY_PREDICTION_CHAT_CONTEXT };
  }
  const input = value as Record<string, unknown>;
  const activeProviderFixtureId = fixtureId(input.activeProviderFixtureId);
  const activeHomeTeamName = boundedText(input.activeHomeTeamName);
  const activeAwayTeamName = boundedText(input.activeAwayTeamName);
  const parsedTurns = Number(input.turnCount);
  const turnCount = Number.isFinite(parsedTurns)
    ? Math.max(0, Math.min(24, Math.trunc(parsedTurns)))
    : 0;

  if (activeProviderFixtureId == null) {
    return {
      activeProviderFixtureId: null,
      activeHomeTeamName: null,
      activeAwayTeamName: null,
      lastIntent: validIntent(input.lastIntent),
      turnCount,
    };
  }

  return {
    activeProviderFixtureId,
    activeHomeTeamName,
    activeAwayTeamName,
    lastIntent: validIntent(input.lastIntent),
    turnCount,
  };
}

export function detectAdvancedPredictionChatIntent(message: string): AdvancedPredictionChatIntent {
  const normalized = normalizePredictionChatText(message);

  if (/\b(lich su|ket qua|dung sai|thang thua|lai lo|profit|settlement|clv)\b/.test(normalized)) {
    return 'HISTORY';
  }
  if (
    /\b(reliability|do tin cay|hieu suat|hit rate|roi|brier|log loss|du mau|co mau)\b/.test(
      normalized,
    )
  ) {
    return 'RELIABILITY';
  }
  if (/\b(tai sao|vi sao|giai thich|ly do|dua vao dau|co so nao)\b/.test(normalized)) {
    return 'EXPLANATION';
  }
  if (/\b(best bet|bestbet|cuoc|dat keo)\b/.test(normalized)) return 'BEST_BET';
  if (
    /\b(tran nao|keo nao|liet ke|danh sach|hom nay co gi|toi nay co gi|goi y tran)\b/.test(
      normalized,
    )
  ) {
    return 'DISCOVERY';
  }
  if (/\b(over|under|o u|tai|xiu|tong ban|tong so ban)\b/.test(normalized)) {
    return 'TOTAL_GOALS';
  }
  if (/\b(btts|hai doi ghi ban|ca hai doi ghi ban)\b/.test(normalized)) return 'BTTS';
  return 'PREDICTION';
}

export function predictionChatMarketFilter(
  intent: AdvancedPredictionChatIntent,
): 'TOTAL_GOALS' | 'BTTS' | null {
  if (intent === 'TOTAL_GOALS') return 'TOTAL_GOALS';
  if (intent === 'BTTS') return 'BTTS';
  return null;
}

export function isPredictionChatAggregateQuery(input: {
  message: string;
  intent: AdvancedPredictionChatIntent;
  context: PredictionChatConversationContext;
}): boolean {
  const normalized = normalizePredictionChatText(input.message);
  if (input.intent === 'DISCOVERY' || input.intent === 'RELIABILITY') return true;
  if (input.intent === 'HISTORY') {
    const fixtureFollowUp = /\b(tran nay|keo nay|no|tran do|keo do)\b/.test(normalized);
    return !(fixtureFollowUp && input.context.activeProviderFixtureId != null);
  }
  if (input.intent === 'BEST_BET') {
    return /\b(tran nao|keo nao|danh sach|hom nay|toi nay|sap toi)\b/.test(normalized);
  }
  return false;
}

export function canPredictionChatUseActiveFixture(input: {
  message: string;
  intent: AdvancedPredictionChatIntent;
  context: PredictionChatConversationContext;
}): boolean {
  if (input.context.activeProviderFixtureId == null) return false;
  if (isPredictionChatAggregateQuery(input)) return false;
  if (input.intent === 'EXPLANATION') return true;
  const normalized = normalizePredictionChatText(input.message);
  return (
    /\b(tran nay|keo nay|no|tran do|keo do|con o u|con btts|tai sao|vi sao)\b/.test(normalized) ||
    ['TOTAL_GOALS', 'BTTS', 'BEST_BET', 'HISTORY'].includes(input.intent)
  );
}

export function nextPredictionChatContext(input: {
  previous: PredictionChatConversationContext;
  intent: AdvancedPredictionChatIntent;
  fixture?: {
    providerFixtureId: number;
    homeTeamName: string;
    awayTeamName: string;
  } | null;
}): PredictionChatConversationContext {
  const fixture = input.fixture;
  return {
    activeProviderFixtureId: fixture?.providerFixtureId ?? input.previous.activeProviderFixtureId,
    activeHomeTeamName: fixture?.homeTeamName ?? input.previous.activeHomeTeamName,
    activeAwayTeamName: fixture?.awayTeamName ?? input.previous.activeAwayTeamName,
    lastIntent: input.intent,
    turnCount: Math.min(24, input.previous.turnCount + 1),
  };
}
