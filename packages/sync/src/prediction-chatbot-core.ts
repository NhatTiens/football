export const PREDICTION_CHATBOT_CORE_VERSION =
  'v7.0-beta.2a.1-read-only-prediction-chatbot-core-v1';

export type PredictionChatIntent = 'PREDICTION' | 'BEST_BET' | 'TOTAL_GOALS' | 'BTTS';

export type PredictionChatTemporalHint = 'TODAY' | 'TOMORROW' | 'UNSPECIFIED';

export interface PredictionChatFixtureIndex {
  providerFixtureId: number;
  kickoffAt: string;
  leagueName: string;
  homeTeamName: string;
  awayTeamName: string;
}

export interface PredictionChatSuggestion extends PredictionChatFixtureIndex {
  prompt: string;
}

export type PredictionChatMatchResult =
  | {
      status: 'MATCHED';
      intent: PredictionChatIntent;
      temporalHint: PredictionChatTemporalHint;
      fixture: PredictionChatFixtureIndex;
      suggestions: PredictionChatSuggestion[];
    }
  | {
      status: 'AMBIGUOUS' | 'NOT_FOUND';
      intent: PredictionChatIntent;
      temporalHint: PredictionChatTemporalHint;
      fixture: null;
      suggestions: PredictionChatSuggestion[];
    };

const QUERY_STOP_WORDS = new Set([
  'ai',
  'banh',
  'bet',
  'bong',
  'cho',
  'co',
  'cuoc',
  'dat',
  'doan',
  'du',
  'giai',
  'gap',
  'giup',
  'hom',
  'keo',
  'ket',
  'luc',
  'mai',
  'nay',
  'ngay',
  'nhan',
  'soi',
  'tai',
  'the',
  'toi',
  'tran',
  'tu',
  'van',
  'va',
  'voi',
  'vs',
  'xem',
  'xiu',
]);

const TEAM_STOP_WORDS = new Set(['afc', 'cf', 'club', 'fc', 'football', 'sc', 'the']);

const TEAM_ALIASES: Record<string, string[]> = {
  'manchester united': ['man utd', 'man united', 'mu'],
  'manchester city': ['man city', 'mcfc'],
  'paris saint germain': ['psg'],
  internazionale: ['inter milan'],
  'bayern munich': ['bayern', 'bayern munchen'],
};

export function normalizePredictionChatText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function detectPredictionChatIntent(message: string): PredictionChatIntent {
  const normalized = normalizePredictionChatText(message);
  if (/\b(best bet|bestbet|cuoc|dat keo)\b/.test(normalized)) return 'BEST_BET';
  if (/\b(over|under|o u|tai|xiu|tong ban|tong so ban)\b/.test(normalized)) {
    return 'TOTAL_GOALS';
  }
  if (/\b(btts|hai doi ghi ban|ca hai doi ghi ban)\b/.test(normalized)) return 'BTTS';
  return 'PREDICTION';
}

export function detectPredictionChatTemporalHint(message: string): PredictionChatTemporalHint {
  const normalized = normalizePredictionChatText(message);
  if (/\b(ngay mai|toi mai|sang mai|mai)\b/.test(normalized)) return 'TOMORROW';
  if (/\b(hom nay|toi nay|sang nay|chieu nay)\b/.test(normalized)) return 'TODAY';
  return 'UNSPECIFIED';
}

function localDateKey(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function temporalDateKey(
  hint: PredictionChatTemporalHint,
  now: Date,
  timeZone: string,
): string | null {
  if (hint === 'UNSPECIFIED') return null;
  const offset = hint === 'TOMORROW' ? 86_400_000 : 0;
  return localDateKey(new Date(now.getTime() + offset), timeZone);
}

function significantTokens(value: string, stopWords: Set<string>): string[] {
  return normalizePredictionChatText(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function includesPhrase(query: string, phrase: string): boolean {
  return ` ${query} `.includes(` ${phrase} `);
}

function aliasesForTeam(teamName: string): string[] {
  const normalized = normalizePredictionChatText(teamName);
  const direct = TEAM_ALIASES[normalized] ?? [];
  const reverse = Object.entries(TEAM_ALIASES)
    .filter(([, aliases]) => aliases.includes(normalized))
    .flatMap(([canonical, aliases]) => [canonical, ...aliases]);
  return [...new Set([normalized, ...direct, ...reverse])];
}

function teamMatchScore(query: string, queryTokens: Set<string>, teamName: string): number {
  const variants = aliasesForTeam(teamName);
  if (variants.some((variant) => variant.length >= 2 && includesPhrase(query, variant))) {
    return 100;
  }

  const teamTokens = significantTokens(teamName, TEAM_STOP_WORDS);
  if (teamTokens.length === 0) return 0;
  const matches = teamTokens.filter((token) => queryTokens.has(token));
  if (matches.length === 0) return 0;
  return Math.min(95, 45 + (matches.length / teamTokens.length) * 40 + matches.length * 5);
}

function toSuggestion(fixture: PredictionChatFixtureIndex): PredictionChatSuggestion {
  return {
    ...fixture,
    prompt: `Dự đoán fixture ${fixture.providerFixtureId}: ${fixture.homeTeamName} vs ${fixture.awayTeamName}`,
  };
}

export function matchPredictionChatFixture(input: {
  message: string;
  fixtures: PredictionChatFixtureIndex[];
  now?: Date;
  timeZone?: string;
  suggestionLimit?: number;
}): PredictionChatMatchResult {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? 'Asia/Ho_Chi_Minh';
  const suggestionLimit = Math.max(1, Math.min(8, input.suggestionLimit ?? 5));
  const intent = detectPredictionChatIntent(input.message);
  const temporalHint = detectPredictionChatTemporalHint(input.message);
  const query = normalizePredictionChatText(input.message);
  const queryTokens = new Set(significantTokens(query, QUERY_STOP_WORDS));
  const requestedDate = temporalDateKey(temporalHint, now, timeZone);
  const chronological = input.fixtures
    .slice()
    .sort(
      (left, right) => new Date(left.kickoffAt).getTime() - new Date(right.kickoffAt).getTime(),
    );
  const dateEligible = requestedDate
    ? chronological.filter((fixture) => localDateKey(fixture.kickoffAt, timeZone) === requestedDate)
    : chronological;
  const searchPool = dateEligible.length > 0 ? dateEligible : chronological;
  const explicitFixtureMatch = /\bfixture (\d+)\b/.exec(query);
  const explicitProviderFixtureId =
    explicitFixtureMatch == null ? null : Number(explicitFixtureMatch[1]);
  const explicitFixture =
    explicitProviderFixtureId == null
      ? null
      : (searchPool.find((fixture) => fixture.providerFixtureId === explicitProviderFixtureId) ??
        null);
  if (explicitFixture != null) {
    return {
      status: 'MATCHED',
      intent,
      temporalHint,
      fixture: explicitFixture,
      suggestions: [],
    };
  }

  const scored = searchPool
    .map((fixture) => {
      const homeScore = teamMatchScore(query, queryTokens, fixture.homeTeamName);
      const awayScore = teamMatchScore(query, queryTokens, fixture.awayTeamName);
      const matchedTeams = Number(homeScore >= 55) + Number(awayScore >= 55);
      return {
        fixture,
        matchedTeams,
        score: homeScore + awayScore + (matchedTeams === 2 ? 120 : 0),
      };
    })
    .filter((candidate) => candidate.matchedTeams > 0)
    .sort(
      (left, right) =>
        right.matchedTeams - left.matchedTeams ||
        right.score - left.score ||
        new Date(left.fixture.kickoffAt).getTime() - new Date(right.fixture.kickoffAt).getTime(),
    );

  const twoTeamMatches = scored.filter((candidate) => candidate.matchedTeams === 2);
  if (twoTeamMatches.length > 0) {
    const best = twoTeamMatches[0]!;
    const equallyStrong = twoTeamMatches.filter(
      (candidate) => Math.abs(candidate.score - best.score) < 1,
    );
    if (equallyStrong.length === 1) {
      return {
        status: 'MATCHED',
        intent,
        temporalHint,
        fixture: best.fixture,
        suggestions: [],
      };
    }
    return {
      status: 'AMBIGUOUS',
      intent,
      temporalHint,
      fixture: null,
      suggestions: equallyStrong
        .slice(0, suggestionLimit)
        .map(({ fixture }) => toSuggestion(fixture)),
    };
  }

  if (scored.length === 1) {
    return {
      status: 'MATCHED',
      intent,
      temporalHint,
      fixture: scored[0]!.fixture,
      suggestions: [],
    };
  }

  if (scored.length > 1) {
    return {
      status: 'AMBIGUOUS',
      intent,
      temporalHint,
      fixture: null,
      suggestions: scored.slice(0, suggestionLimit).map(({ fixture }) => toSuggestion(fixture)),
    };
  }

  return {
    status: 'NOT_FOUND',
    intent,
    temporalHint,
    fixture: null,
    suggestions: searchPool.slice(0, suggestionLimit).map(toSuggestion),
  };
}
