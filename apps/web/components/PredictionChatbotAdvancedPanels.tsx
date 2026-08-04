'use client';

export interface PredictionChatbotAdvancedData {
  collection: {
    kind: 'UPCOMING' | 'BEST_BET';
    officialBestBets: number;
    paperShadowCandidates: number;
    rows: Array<{
      fixture: {
        providerFixtureId: number;
        kickoffAt: string;
        homeTeamName: string;
        awayTeamName: string;
      };
      fixtureState: string;
      recommendation: {
        status: string;
        selection: string | null;
        lineValue: number | null;
        decimalOdds: number | null;
        expectedValue: number | null;
        officialBestBet: boolean;
      };
    }>;
  } | null;
  explanation: {
    expectedGoals: { home: number; away: number; total: number };
    form: { homePointsPerGame: number; awayPointsPerGame: number };
    elo: { home: number; away: number; differenceHomeMinusAway: number };
    lineup: {
      available: boolean;
      home: {
        confirmed: boolean;
        starterCount: number;
        formation: string | null;
        rotationCount: number | null;
        missingRegulars: MissingRegular[];
      };
      away: {
        confirmed: boolean;
        starterCount: number;
        formation: string | null;
        rotationCount: number | null;
        missingRegulars: MissingRegular[];
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
  } | null;
  research: {
    history: {
      totalRows: number;
      settledRows: number;
      pendingRows: number;
      rows: Array<{
        id: string;
        source: string;
        homeTeamName: string | null;
        awayTeamName: string | null;
        kickoffAt: string;
        marketType: string | null;
        selection: string | null;
        lineValue: number | null;
        decimalOdds: number | null;
        result: string;
        fulltimeHomeGoals: number | null;
        fulltimeAwayGoals: number | null;
        profitUnits: number | null;
        clv: number | null;
      }>;
    };
    reliability: {
      overall: ReliabilityRow;
      diagnosticTargetRows: number;
      promotionTargetRows: number;
      diagnosticProgressRate: number;
      promotionProgressRate: number;
      sampleWarning: string | null;
      automaticPromotion: false;
    };
  } | null;
  researchError: 'EXPLANATION_UNAVAILABLE' | 'RESEARCH_UNAVAILABLE' | null;
}

interface MissingRegular {
  playerName: string;
  positionGroup: string;
  startRate: number;
}

interface ReliabilityRow {
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

function pct(value: number | null, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function number(value: number | null, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function signed(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function localTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value));
}

function CollectionPanel({
  collection,
}: {
  collection: NonNullable<PredictionChatbotAdvancedData['collection']>;
}) {
  return (
    <section className="prediction-chatbot-panel">
      <h4>Danh sách ưu tiên</h4>
      <p>
        BEST BET chính thức: <b>{collection.officialBestBets}</b> · Paper/shadow:{' '}
        <b>{collection.paperShadowCandidates}</b>
      </p>
      <div className="prediction-chatbot-collection">
        {collection.rows.map((row) => (
          <article key={row.fixture.providerFixtureId}>
            <div>
              <strong>
                {row.fixture.homeTeamName} vs {row.fixture.awayTeamName}
              </strong>
              <small>
                {localTime(row.fixture.kickoffAt)} · {row.fixtureState.replaceAll('_', ' ')}
              </small>
            </div>
            <div>
              <b>{row.recommendation.status.replaceAll('_', ' ')}</b>
              <small>
                {row.recommendation.selection ?? 'NO BET'}
                {row.recommendation.lineValue == null ? '' : ` ${row.recommendation.lineValue}`}
                {row.recommendation.decimalOdds == null
                  ? ''
                  : ` @ ${row.recommendation.decimalOdds.toFixed(2)}`}
                {' · '}EV {pct(row.recommendation.expectedValue)}
              </small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MissingPlayers({ title, rows }: { title: string; rows: MissingRegular[] }) {
  return (
    <div>
      <b>{title}</b>
      {rows.length === 0 ? (
        <small>Chưa ghi nhận cầu thủ trụ cột vắng mặt.</small>
      ) : (
        rows.map((row) => (
          <small key={`${row.playerName}-${row.positionGroup}`}>
            {row.playerName} · {row.positionGroup} · đá chính {pct(row.startRate)}
          </small>
        ))
      )}
    </div>
  );
}

function ExplanationPanel({
  explanation,
}: {
  explanation: NonNullable<PredictionChatbotAdvancedData['explanation']>;
}) {
  return (
    <section className="prediction-chatbot-panel">
      <h4>Bằng chứng khoa học tại thời điểm hỏi</h4>
      <div className="prediction-chatbot-evidence-grid">
        <span>
          xG chủ nhà <b>{number(explanation.expectedGoals.home)}</b>
        </span>
        <span>
          xG đội khách <b>{number(explanation.expectedGoals.away)}</b>
        </span>
        <span>
          Tổng xG <b>{number(explanation.expectedGoals.total)}</b>
        </span>
        <span>
          Form PPG{' '}
          <b>
            {number(explanation.form.homePointsPerGame)} –{' '}
            {number(explanation.form.awayPointsPerGame)}
          </b>
        </span>
        <span>
          Elo{' '}
          <b>
            {number(explanation.elo.home, 0)} – {number(explanation.elo.away, 0)}
          </b>
        </span>
        <span>
          H2H PIT-safe <b>{explanation.headToHead.eligibleMatches} trận</b>
        </span>
        <span>
          Data quality <b>{pct(explanation.modelEvidence.dataQualityScore)}</b>
        </span>
        <span>
          Confidence <b>{pct(explanation.modelEvidence.confidenceScore)}</b>
        </span>
      </div>
      <div className="prediction-chatbot-lineups">
        <MissingPlayers title="Vắng mặt chủ nhà" rows={explanation.lineup.home.missingRegulars} />
        <MissingPlayers title="Vắng mặt đội khách" rows={explanation.lineup.away.missingRegulars} />
      </div>
      <details>
        <summary>Lý do mô hình và dữ liệu còn thiếu</summary>
        <ul>
          {[...explanation.reasons, ...explanation.missingData].map((reason, index) => (
            <li key={`${index}-${reason}`}>{reason}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function ReliabilityPanel({
  data,
}: {
  data: NonNullable<PredictionChatbotAdvancedData['research']>;
}) {
  const reliability = data.reliability.overall;
  return (
    <section className="prediction-chatbot-panel">
      <h4>Reliability paper</h4>
      <div className="prediction-chatbot-evidence-grid">
        <span>
          Settled <b>{reliability.settled}</b>
        </span>
        <span>
          W–L–Void{' '}
          <b>
            {reliability.wins}–{reliability.losses}–{reliability.voids}
          </b>
        </span>
        <span>
          Hit rate <b>{pct(reliability.hitRate)}</b>
        </span>
        <span>
          ROI <b>{pct(reliability.roi)}</b>
        </span>
        <span>
          P/L units <b>{signed(reliability.profitUnits)}</b>
        </span>
        <span>
          CLV trung bình <b>{pct(reliability.averageClv)}</b>
        </span>
      </div>
      <div className="prediction-chatbot-progress">
        <label>
          Diagnostic {reliability.settled}/{data.reliability.diagnosticTargetRows}
        </label>
        <progress max={1} value={data.reliability.diagnosticProgressRate} />
        <label>
          Promotion review {reliability.settled}/{data.reliability.promotionTargetRows}
        </label>
        <progress max={1} value={data.reliability.promotionProgressRate} />
      </div>
      {data.reliability.sampleWarning ? <small>{data.reliability.sampleWarning}</small> : null}
    </section>
  );
}

function HistoryPanel({ data }: { data: NonNullable<PredictionChatbotAdvancedData['research']> }) {
  if (data.history.rows.length === 0) return null;
  return (
    <section className="prediction-chatbot-panel">
      <h4>Lịch sử dự đoán paper</h4>
      <div className="prediction-chatbot-history">
        {data.history.rows.map((row) => (
          <article key={row.id}>
            <div>
              <strong>
                {row.homeTeamName ?? `Fixture ${row.id}`} vs {row.awayTeamName ?? '—'}
              </strong>
              <small>
                {localTime(row.kickoffAt)} · {row.source}
              </small>
            </div>
            <div>
              <b className={`result-${row.result.toLowerCase()}`}>{row.result}</b>
              <small>
                {row.selection ?? 'NO BET'}
                {row.lineValue == null ? '' : ` ${row.lineValue}`}
                {row.decimalOdds == null ? '' : ` @ ${row.decimalOdds.toFixed(2)}`}
                {' · '}P/L {signed(row.profitUnits)} · CLV {pct(row.clv)}
              </small>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function PredictionChatbotAdvancedPanels({
  response,
}: {
  response: PredictionChatbotAdvancedData;
}) {
  return (
    <>
      {response.collection ? <CollectionPanel collection={response.collection} /> : null}
      {response.explanation ? <ExplanationPanel explanation={response.explanation} /> : null}
      {response.research ? (
        <>
          <ReliabilityPanel data={response.research} />
          <HistoryPanel data={response.research} />
        </>
      ) : null}
      {response.researchError ? (
        <small className="prediction-chatbot-research-error">
          Báo cáo nghiên cứu tạm thời chưa sẵn sàng; bot không tự điền số liệu thay thế.
        </small>
      ) : null}
    </>
  );
}
