'use client';

import { type FormEvent, useState } from 'react';
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

function pct(value: number | null, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function signedPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
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
  if (selection === 'DRAW') return 'Hòa';
  if (selection === 'OVER') return `Over ${lineValue ?? ''}`.trim();
  if (selection === 'UNDER') return `Under ${lineValue ?? ''}`.trim();
  if (selection === 'YES') return 'Có — hai đội ghi bàn';
  if (selection === 'NO') return 'Không — hai đội ghi bàn';
  return 'Chưa có';
}

function recommendationLabel(
  status: NonNullable<ChatResponse['answer']>['recommendation']['status'],
): string {
  if (status === 'BEST_BET') return 'BEST BET · PAPER';
  if (status === 'PAPER_SHADOW') return 'PAPER SHADOW';
  if (status === 'CURRENT_SHADOW') return 'CURRENT SHADOW';
  if (status === 'DIAGNOSTIC_SHADOW') return 'DIAGNOSTIC SHADOW';
  return 'NO BET';
}

function intentLabel(intent: ChatIntent): string {
  if (intent === 'BEST_BET') return 'Tìm BEST BET';
  if (intent === 'TOTAL_GOALS') return 'Phân tích O/U';
  if (intent === 'BTTS') return 'Phân tích BTTS';
  if (intent === 'EXPLANATION') return 'Giải thích khoa học';
  if (intent === 'DISCOVERY') return 'Danh sách trận';
  if (intent === 'HISTORY') return 'Lịch sử paper';
  if (intent === 'RELIABILITY') return 'Reliability';
  return 'Dự đoán trận';
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
              <span>Hòa</span>
              <strong>{pct(answer.hda.drawProbability)}</strong>
            </div>
            <div>
              <span>{answer.fixture.awayTeamName}</span>
              <strong>{pct(answer.hda.awayProbability)}</strong>
            </div>
          </div>
          <small className="prediction-chatbot-source">
            Nguồn HDA:{' '}
            {answer.hda.source === 'SCIENTIFIC_DECISION'
              ? 'mô hình khoa học nội bộ'
              : answer.hda.source === 'API_FOOTBALL'
                ? 'tham khảo API-Football, không gắn nhãn mô hình khoa học'
                : 'chưa có'}
          </small>

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
              <summary>Xem hướng dự đoán từng market ({answer.markets.length})</summary>
              <div>
                {answer.markets.map((market) => (
                  <span key={`${market.marketType}-${market.predictedSelection}`}>
                    <b>{market.label}</b>
                    {selectionLabel(
                      market.predictedSelection,
                      answer.fixture,
                      market.lineValue,
                    )} · {pct(market.modelProbability)}
                  </span>
                ))}
              </div>
            </details>
          ) : null}

          <div className="prediction-chatbot-audit">
            <span>Odds snapshot: {answer.dataQuality.oddsSnapshots}</span>
            <span>PIT usable: {answer.dataQuality.pitUsableOdds}</span>
            <span>Status: {answer.dataQuality.currentRecommendationStatus}</span>
          </div>
        </>
      ) : null}

      {response.suggestions.length > 0 ? (
        <div className="prediction-chatbot-suggestions">
          <span>Chọn trận:</span>
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
        Read-only · PIT-safe · PAPER-only · không đặt cược tiền thật · không tự tạo xác suất
      </small>
    </div>
  );
}

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
  text: 'Bạn có thể hỏi một trận, hỏi tiếp về O/U hoặc lý do, xem danh sách trận, lịch sử paper và reliability.',
};

const QUICK_PROMPTS = [
  'Tối nay có trận nào?',
  'Danh sách BEST BET tối nay',
  'Cho xem lịch sử đúng sai và CLV',
  'Độ tin cậy hiện tại thế nào?',
  'Tại sao lại chọn kèo này?',
];

function boundedMessages(rows: ChatMessage[]): ChatMessage[] {
  return rows.slice(-24);
}

export function PredictionChatbot() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Bạn muốn xem trận nào? Ví dụ: “Dự đoán Arsenal vs Chelsea”, “Kèo O/U trận Liverpool” hoặc “Trận này có BEST BET không?”.',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState<ChatContext>(EMPTY_CHAT_CONTEXT);

  async function sendMessage(rawMessage: string): Promise<void> {
    const message = rawMessage.trim();
    if (!message || loading) return;
    const requestId = `${Date.now()}-${messages.length}`;
    setMessages((current) =>
      boundedMessages([...current, { id: `${requestId}-user`, role: 'user', text: message }]),
    );
    setInput('');
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/personal/prediction-chat`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ message, context }),
      });
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
            text: `Không kết nối được API chatbot: ${error instanceof Error ? error.message : String(error)}`,
          },
        ]),
      );
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleSuggestionClick(event: React.MouseEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('button[data-chat-prompt]');
    const prompt = button?.dataset.chatPrompt;
    if (prompt) void sendMessage(prompt);
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
          <span className="prediction-chatbot-kicker">BETA · INTERNAL PREDICTION CHAT</span>
          <h2 id="prediction-chatbot-title">Hỏi chatbot về một trận đấu</h2>
          <p>Tìm fixture trong DB và giải thích đúng kết quả mà engine hiện có.</p>
        </div>
        <div className="prediction-chatbot-badges">
          <span>Không LLM trả phí</span>
          <span>Không ghi DB</span>
          <button
            type="button"
            className="prediction-chatbot-clear"
            onClick={clearConversation}
            disabled={loading}
          >
            Xóa hội thoại
          </button>
        </div>
      </header>

      <div className="prediction-chatbot-log" aria-live="polite" onClick={handleSuggestionClick}>
        {messages.map((message) => (
          <article key={message.id} className={`prediction-chatbot-message is-${message.role}`}>
            <div className="prediction-chatbot-avatar">
              {message.role === 'assistant' ? 'AI' : 'BẠN'}
            </div>
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
            <div className="prediction-chatbot-bubble is-loading">
              Đang đọc dữ liệu trận và tín hiệu hiện có…
            </div>
          </article>
        ) : null}
      </div>

      <div className="prediction-chatbot-quick-prompts" onClick={handleSuggestionClick}>
        {QUICK_PROMPTS.map((prompt) => (
          <button key={prompt} type="button" data-chat-prompt={prompt} disabled={loading}>
            {prompt}
          </button>
        ))}
      </div>
      <form className="prediction-chatbot-form" onSubmit={submit}>
        <label htmlFor="prediction-chatbot-input">Câu hỏi</label>
        <div>
          <input
            id="prediction-chatbot-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ví dụ: Việt Nam vs Thái Lan có kèo O/U nào?"
            maxLength={240}
            disabled={loading}
          />
          <button type="submit" disabled={loading || input.trim().length === 0}>
            {loading ? 'Đang xem…' : 'Hỏi trận này'}
          </button>
        </div>
        <small>
          Bot chỉ tìm trong các trận sắp tới đã đồng bộ. Không có dữ liệu thì sẽ trả NO BET/chờ dữ
          liệu.
        </small>
      </form>
    </section>
  );
}
