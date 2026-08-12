'use client';

import Link from 'next/link';
import { type FormEvent, type MouseEvent, useEffect, useState } from 'react';

import {
  getAuthMe,
  logoutAuth,
  type AuthMeResponse,
} from '../lib/auth';
import {
  PredictionChatbotAdvancedPanels,
  type PredictionChatbotAdvancedData,
} from './PredictionChatbotAdvancedPanels';

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

type ChatIntent =
  | 'PREDICTION'
  | 'BEST_BET'
  | 'TOTAL_GOALS'
  | 'BTTS'
  | 'EXPLANATION'
  | 'DISCOVERY'
  | 'HISTORY'
  | 'RELIABILITY';

type Selection = 'HOME' | 'DRAW' | 'AWAY' | 'OVER' | 'UNDER' | 'YES' | 'NO';

interface ChatSuggestion {
  providerFixtureId: number;
  kickoffAt: string;
  leagueName: string;
  homeTeamName: string;
  awayTeamName: string;
  prompt: string;
}

interface ChatContext {
  activeProviderFixtureId: number | null;
  activeHomeTeamName: string | null;
  activeAwayTeamName: string | null;
  lastIntent: ChatIntent | null;
  turnCount: number;
}

interface ChatResponse extends PredictionChatbotAdvancedData {
  version: string;
  generatedAt: string;
  status: 'ANSWER' | 'AMBIGUOUS' | 'NOT_FOUND';
  intent: ChatIntent;
  message: string;
  context: ChatContext;
  answer: {
    fixture: {
      providerFixtureId: number;
      localFixtureId: number;
      kickoffAt: string;
      leagueName: string;
      homeTeamName: string;
      awayTeamName: string;
    };
    fixtureState: 'BEST_BET' | 'NO_BET' | 'PREDICTION_ONLY' | 'WAITING_DATA';
    hda: {
      source: 'SCIENTIFIC_DECISION' | 'API_FOOTBALL' | 'NONE';
      homeProbability: number | null;
      drawProbability: number | null;
      awayProbability: number | null;
      predictedSelection: 'HOME' | 'DRAW' | 'AWAY' | null;
    };
    markets: Array<{
      marketType: string;
      label: string;
      lineValue: number | null;
      predictedSelection: Selection;
      modelProbability: number;
    }>;
    recommendation: {
      status: 'BEST_BET' | 'PAPER_SHADOW' | 'CURRENT_SHADOW' | 'DIAGNOSTIC_SHADOW' | 'NONE';
      marketType: string | null;
      selection: Selection | null;
      lineValue: number | null;
      decimalOdds: number | null;
      bookmakerName: string | null;
      modelProbability: number | null;
      edge: number | null;
      expectedValue: number | null;
      officialBestBet: boolean;
      paperOnly: true;
      reason: string;
    };
    dataQuality: {
      oddsSnapshots: number;
      pitUsableOdds: number;
      currentRecommendationStatus: string;
    };
  } | null;
  suggestions: ChatSuggestion[];
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

interface ChatMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  response?: ChatResponse;
}

const EMPTY_AUTH: AuthMeResponse = {
  authenticated: false,
  user: null,
  session: null,
  permissions: { chat: false, advancedChat: false, roleManagement: false },
};

const EMPTY_CHAT_CONTEXT: ChatContext = {
  activeProviderFixtureId: null,
  activeHomeTeamName: null,
  activeAwayTeamName: null,
  lastIntent: null,
  turnCount: 0,
};

const WELCOME_MESSAGE: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  text: 'Đăng nhập để hỏi về trận đấu, BTTS, Over/Under, lịch sử đánh giá hoặc độ tin cậy.',
};

const QUICK_PROMPTS = [
  'Danh sach phan tich noi bat toi nay',
  'Du doan Arsenal vs Chelsea',
  'Tai sao lai chon lua chon nay?',
  'Cho xem lich su dung sai va CLV',
  'Do tin cay hien tai the nao?',
];

function boundedMessages(rows: ChatMessage[]): ChatMessage[] {
  return rows.slice(-24);
}

function pct(value: number | null, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '--' : `${(value * 100).toFixed(digits)}%`;
}

function signedPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function localTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value));
}

function selectionLabel(
  selection: Selection | null,
  fixture: NonNullable<ChatResponse['answer']>['fixture'],
  lineValue?: number | null,
): string {
  if (selection === 'HOME') return fixture.homeTeamName;
  if (selection === 'AWAY') return fixture.awayTeamName;
  if (selection === 'DRAW') return 'Hoa';
  if (selection === 'OVER') return `Over ${lineValue ?? ''}`.trim();
  if (selection === 'UNDER') return `Under ${lineValue ?? ''}`.trim();
  if (selection === 'YES') return 'Both teams score';
  if (selection === 'NO') return 'No BTTS';
  return 'Chưa có lựa chọn';
}

function recommendationLabel(
  status: NonNullable<ChatResponse['answer']>['recommendation']['status'],
): string {
  if (status === 'BEST_BET') return 'ĐẠT TIÊU CHÍ';
  if (status === 'PAPER_SHADOW') return 'MÔ PHỎNG THEO DÕI';
  if (status === 'CURRENT_SHADOW') return 'TÍN HIỆU HIỆN TẠI';
  if (status === 'DIAGNOSTIC_SHADOW') return 'CHẨN ĐOÁN MÔ HÌNH';
  return 'CHƯA CÓ ĐỀ XUẤT';
}

function intentLabel(intent: ChatIntent): string {
  if (intent === 'BEST_BET') return 'Phân tích ưu tiên';
  if (intent === 'TOTAL_GOALS') return 'Total goals';
  if (intent === 'BTTS') return 'BTTS';
  if (intent === 'EXPLANATION') return 'Deep explanation';
  if (intent === 'DISCOVERY') return 'Fixture discovery';
  if (intent === 'HISTORY') return 'Lịch sử đánh giá';
  if (intent === 'RELIABILITY') return 'Reliability';
  return 'Prediction';
}

function AssistantDetails({ response }: { response: ChatResponse }) {
  const answer = response.answer;
  return (
    <div className="prediction-chatbot-details">
      {answer ? (
        <>
          <div className="prediction-chatbot-fixture">
            <div>
              <span>{answer.fixture.leagueName}</span>
              <strong>
                {answer.fixture.homeTeamName} <em>vs</em> {answer.fixture.awayTeamName}
              </strong>
              <small>{localTime(answer.fixture.kickoffAt)}</small>
            </div>
            <b className={`prediction-chatbot-state state-${answer.fixtureState.toLowerCase()}`}>
              {answer.fixtureState.replaceAll('_', ' ')}
            </b>
          </div>

          <div className="prediction-chatbot-hda">
            <div>
              <span>{answer.fixture.homeTeamName}</span>
              <strong>{pct(answer.hda.homeProbability)}</strong>
            </div>
            <div>
              <span>Draw</span>
              <strong>{pct(answer.hda.drawProbability)}</strong>
            </div>
            <div>
              <span>{answer.fixture.awayTeamName}</span>
              <strong>{pct(answer.hda.awayProbability)}</strong>
            </div>
          </div>

          <div
            className={`prediction-chatbot-recommendation recommendation-${answer.recommendation.status.toLowerCase()}`}
          >
            <div>
              <span>{recommendationLabel(answer.recommendation.status)}</span>
              <strong>
                {selectionLabel(
                  answer.recommendation.selection,
                  answer.fixture,
                  answer.recommendation.lineValue,
                )}
                {answer.recommendation.decimalOdds == null
                  ? ''
                  : ` @ ${answer.recommendation.decimalOdds.toFixed(2)}`}
              </strong>
            </div>
            <div className="prediction-chatbot-metrics">
              <span>Model {pct(answer.recommendation.modelProbability)}</span>
              <span>Edge {signedPct(answer.recommendation.edge)}</span>
              <span>EV {signedPct(answer.recommendation.expectedValue)}</span>
            </div>
            <small>{answer.recommendation.reason}</small>
          </div>

          {answer.markets.length > 0 ? (
            <details className="prediction-chatbot-markets">
              <summary>Market view ({answer.markets.length})</summary>
              <div>
                {answer.markets.map((market) => (
                  <span key={`${market.marketType}-${market.predictedSelection}`}>
                    <b>{market.label}</b>
                    {selectionLabel(market.predictedSelection, answer.fixture, market.lineValue)} ·{' '}
                    {pct(market.modelProbability)}
                  </span>
                ))}
              </div>
            </details>
          ) : null}

          <div className="prediction-chatbot-audit">
            <span>Odds snapshots: {answer.dataQuality.oddsSnapshots}</span>
            <span>PIT usable: {answer.dataQuality.pitUsableOdds}</span>
            <span>Status: {answer.dataQuality.currentRecommendationStatus}</span>
          </div>
        </>
      ) : null}

      {response.suggestions.length > 0 ? (
        <div className="prediction-chatbot-suggestions">
          <span>Gợi ý nhanh:</span>
          {response.suggestions.map((suggestion) => (
            <button
              key={suggestion.providerFixtureId}
              type="button"
              data-chat-prompt={suggestion.prompt}
            >
              {suggestion.homeTeamName} vs {suggestion.awayTeamName}
              <small>
                {suggestion.leagueName} · {localTime(suggestion.kickoffAt)}
              </small>
            </button>
          ))}
        </div>
      ) : null}

      <PredictionChatbotAdvancedPanels response={response} />

      <small className="prediction-chatbot-safety">
        Chỉ đọc · PIT-safe · mô phỏng nghiên cứu · không giao dịch tài chính
      </small>
    </div>
  );
}

export function PredictionChatbot() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<ChatContext>(EMPTY_CHAT_CONTEXT);
  const [auth, setAuth] = useState<AuthMeResponse>(EMPTY_AUTH);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadAuth(): Promise<void> {
      try {
        const payload = await getAuthMe();
        if (active) setAuth(payload);
      } catch {
        if (active) setAuth(EMPTY_AUTH);
      } finally {
        if (active) setAuthLoading(false);
      }
    }
    void loadAuth();
    return () => {
      active = false;
    };
  }, []);

  const canChat = auth.authenticated && auth.permissions.chat;

  async function sendMessage(rawMessage: string): Promise<void> {
    const message = rawMessage.trim();
    if (!message || loading || !canChat) return;

    const requestId = `${Date.now()}-${messages.length}`;
    setMessages((current) =>
      boundedMessages([...current, { id: `${requestId}-user`, role: 'user', text: message }]),
    );
    setInput('');
    setLoading(true);
    setAuthMessage(null);

    try {
      const response = await fetch(`${apiUrl}/personal/prediction-chat`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ message, context }),
      });

      if (response.status === 401) {
        setAuth(EMPTY_AUTH);
      }

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `API ${response.status}`);
      }

      const payload = (await response.json()) as ChatResponse;
      setContext(payload.context);
      setMessages((current) =>
        boundedMessages([
          ...current,
          {
            id: `${requestId}-assistant`,
            role: 'assistant',
            text: payload.message,
            response: payload,
          },
        ]),
      );
    } catch (error) {
      setMessages((current) =>
        boundedMessages([
          ...current,
          {
            id: `${requestId}-error`,
            role: 'assistant',
            text: `Chatbot error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ]),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout(): Promise<void> {
    await logoutAuth().catch(() => undefined);
    setAuth(EMPTY_AUTH);
    setAuthMessage('Signed out.');
    setMessages([WELCOME_MESSAGE]);
    setContext(EMPTY_CHAT_CONTEXT);
    setInput('');
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleSuggestionClick(event: MouseEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('button[data-chat-prompt]');
    const prompt = button?.dataset.chatPrompt;
    if (prompt && canChat) void sendMessage(prompt);
  }

  function clearConversation(): void {
    setMessages([WELCOME_MESSAGE]);
    setContext(EMPTY_CHAT_CONTEXT);
    setInput('');
  }

  return (
    <section className="prediction-chatbot" aria-labelledby="prediction-chatbot-title">
      <header>
        <div>
          <span className="prediction-chatbot-kicker">BETA · AUTHENTICATED CHATBOT</span>
          <h2 id="prediction-chatbot-title">Ask the chatbot about one fixture</h2>
          <p>Sign in with USER, ANALYST, or ADMIN access to use the production-ready session flow.</p>
          <div className="prediction-chatbot-session">
            {authLoading ? (
              <span>Checking account...</span>
            ) : auth.authenticated && auth.user ? (
              <>
                <span>{auth.user.name}</span>
                <span>{auth.user.role}</span>
                <span>{auth.permissions.advancedChat ? 'Advanced research on' : 'Basic mode'}</span>
                <button
                  type="button"
                  className="prediction-chatbot-clear"
                  onClick={() => void handleLogout()}
                  disabled={loading}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <span>Guest</span>
                <Link href="/login">Sign in</Link>
                <Link href="/register">Create account</Link>
              </>
            )}
          </div>
        </div>
        <div className="prediction-chatbot-badges">
          <span>Argon2id</span>
          <span>HttpOnly session</span>
          <button
            type="button"
            className="prediction-chatbot-clear"
            onClick={clearConversation}
            disabled={loading}
          >
            Clear
          </button>
        </div>
      </header>

      {!authLoading && !auth.authenticated ? (
        <div className="prediction-chatbot-auth-banner">
          Sign in to use the chatbot. USER can access basic predictions; ANALYST unlocks deep explanation,
          lịch sử đánh giá và độ tin cậy.
        </div>
      ) : null}

      {authMessage ? <div className="prediction-chatbot-auth-banner">{authMessage}</div> : null}

      <div className="prediction-chatbot-log" aria-live="polite" onClick={handleSuggestionClick}>
        {messages.map((message) => (
          <article key={message.id} className={`prediction-chatbot-message is-${message.role}`}>
            <div className="prediction-chatbot-avatar">{message.role === 'assistant' ? 'AI' : 'YOU'}</div>
            <div className="prediction-chatbot-bubble">
              {message.response ? <span>{intentLabel(message.response.intent)}</span> : null}
              <p>{message.text}</p>
              {message.response ? <AssistantDetails response={message.response} /> : null}
            </div>
          </article>
        ))}
        {loading ? (
          <article className="prediction-chatbot-message is-assistant">
            <div className="prediction-chatbot-avatar">AI</div>
            <div className="prediction-chatbot-bubble is-loading">Loading fixture evidence...</div>
          </article>
        ) : null}
      </div>

      <div className="prediction-chatbot-quick-prompts" onClick={handleSuggestionClick}>
        {QUICK_PROMPTS.map((prompt) => (
          <button key={prompt} type="button" data-chat-prompt={prompt} disabled={loading || !canChat}>
            {prompt}
          </button>
        ))}
      </div>

      <form className="prediction-chatbot-form" onSubmit={submit}>
        <label htmlFor="prediction-chatbot-input">Question</label>
        <div>
          <input
            id="prediction-chatbot-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Example: Du doan Arsenal vs Chelsea"
            maxLength={240}
            disabled={loading || !canChat}
          />
          <button type="submit" disabled={loading || input.trim().length === 0 || !canChat}>
            {loading ? 'Loading...' : canChat ? 'Ask now' : 'Sign in first'}
          </button>
        </div>
        <small>
          The bot only reads already-synced fixtures. If the intent needs ANALYST access, USER accounts will get a
          role error instead of hidden data.
        </small>
      </form>
    </section>
  );
}
