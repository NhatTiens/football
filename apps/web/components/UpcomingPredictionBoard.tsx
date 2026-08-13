// R4.10.2.9_UI_EXPLAINABILITY_STATUS_CONSISTENCY: board renders conservative value and auditable rejection reasons.
'use client';

import { useMemo, useState } from 'react';

import { classifyPersonalLeague, type PersonalLeagueGroup } from '../lib/league-profile';
import type {
  CurrentCompetitionGroup,
  PersonalFixtureState,
  PersonalMarketCode,
  PersonalMarketPredictionDto,
  PersonalMarketSelectionDto,
  PersonalRefreshResponse,
  PersonalUpcomingAnalysisDto,
  PersonalUpcomingFixtureDto,
} from '../lib/personal-types';

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

function signedPoints(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const points = value * 100;
  return `${points >= 0 ? '+' : ''}${points.toFixed(1)}đ%`;
}

function movementSelectionLabel(
  row: PersonalUpcomingFixtureDto,
  selection: 'HOME' | 'DRAW' | 'AWAY' | 'NONE',
): string {
  if (selection === 'HOME') return row.fixture.homeTeam.name;
  if (selection === 'AWAY') return row.fixture.awayTeam.name;
  if (selection === 'DRAW') return 'Hòa';
  return 'Không có';
}

function twoWayMovementSelectionLabel(
  selection: 'YES' | 'NO' | 'OVER' | 'UNDER',
  lineValue: number | null,
): string {
  if (selection === 'YES') return 'Có';
  if (selection === 'NO') return 'Không';
  if (selection === 'OVER') {
    return `Over ${lineValue ?? ''}`.trim();
  }
  return `Under ${lineValue ?? ''}`.trim();
}

function pct(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function decimal(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function localTime(value: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(value));
}

function hdaSelectionName(
  row: PersonalUpcomingFixtureDto,
  selection: 'HOME' | 'DRAW' | 'AWAY' | null,
): string {
  if (selection === 'HOME') return row.fixture.homeTeam.name;
  if (selection === 'AWAY') return row.fixture.awayTeam.name;
  if (selection === 'DRAW') return 'Hòa';
  return 'Chưa đủ dữ liệu';
}

function scientificPredictedName(row: PersonalUpcomingFixtureDto): string {
  return hdaSelectionName(row, row.scientificHda?.predictedSelection);
}

function providerPredictedName(row: PersonalUpcomingFixtureDto): string {
  return hdaSelectionName(row, row.providerHda?.predictedSelection);
}

function decisionSelectionName(row: PersonalUpcomingFixtureDto): string {
  const selection = row.decision?.selectedSelection;
  if (selection === 'HOME') return row.fixture.homeTeam.name;
  if (selection === 'AWAY') return row.fixture.awayTeam.name;
  if (selection === 'DRAW') return 'Hòa';
  return selection ?? '—';
}

function stateLabel(state: PersonalFixtureState): string {
  if (state === 'BEST_BET') return 'ĐẠT TIÊU CHÍ';
  if (state === 'NO_BET') return 'CHƯA ĐẠT TIÊU CHÍ';
  if (state === 'PREDICTION_ONLY') return 'ĐANG PHÂN TÍCH';
  return 'CHỜ DỮ LIỆU';
}

function probabilityWidth(value: number | null): string {
  const safe = value == null ? 0 : Math.max(0, Math.min(1, value));
  return `${safe * 100}%`;
}

function marketStatusLabel(status: PersonalMarketPredictionDto['status']): string {
  // R4.10.2.9_UI_EXPLAINABILITY_STATUS_CONSISTENCY
  if (status === 'BEST_BET') return 'ĐẠT TIÊU CHÍ';
  if (status === 'ELIGIBLE_VALUE') return 'ĐẠT NGƯỠNG MÔ HÌNH';
  if (status === 'EVALUATED_VALUE_AVAILABLE') return 'TÍN HIỆU NGHIÊN CỨU';
  if (status === 'EVALUATED_NO_VALUE') return 'CHƯA ĐẠT NGƯỠNG';
  if (status === 'ANALYSIS_ONLY') return 'CHỈ PHÂN TÍCH';
  if (status === 'ODDS_AVAILABLE_WAITING_DECISION') return 'CÓ DỮ LIỆU THỊ TRƯỜNG · CHỜ MODEL';
  if (status === 'WAITING_ODDS') return 'CHỜ DỮ LIỆU THỊ TRƯỜNG';
  return 'TRẠNG THÁI KHÁC';
}

function signedPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`;
}

function marketStatusClass(status: PersonalMarketPredictionDto['status']): string {
  return status.toLowerCase().replaceAll('_', '-');
}

function rejectionReasonList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((reason): reason is string => typeof reason === 'string' && reason.length > 0)
    : [];
}

function rejectionReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    CURRENT_ODDS_BELOW_MINIMUM: 'Tỷ lệ thị trường thấp hơn ngưỡng tối thiểu.',
    CURRENT_RAW_EDGE_BELOW_MINIMUM: 'Raw edge chưa đạt ngưỡng tối thiểu.',
    CURRENT_RAW_EV_BELOW_MINIMUM: 'Raw EV chưa đạt ngưỡng tối thiểu.',
    CURRENT_CONSERVATIVE_EDGE_BELOW_MINIMUM:
      'Conservative edge chưa đạt ngưỡng sau điều chỉnh rủi ro.',
    CURRENT_CONSERVATIVE_EV_BELOW_MINIMUM: 'Conservative EV chưa đạt ngưỡng sau điều chỉnh rủi ro.',
    CURRENT_BASELINE_FALLBACK_RESEARCH_ONLY:
      'Model hiện là baseline fallback, chỉ dùng nghiên cứu.',
    CURRENT_LIMITED_CONFIDENCE_RESEARCH_ONLY: 'Độ tin cậy LIMITED, chưa đủ điều kiện đề xuất.',
    CURRENT_MODEL_HISTORY_INSUFFICIENT: 'Lịch sử model chưa đủ mẫu để chứng minh độ tin cậy.',
    CURRENT_RELIABILITY_NOT_PROVEN: 'Reliability của market/horizon chưa được chứng minh.',
    CURRENT_LIMITED_CONFIDENCE_LONGSHOT_BLOCKED:
      'Longshot Guard chặn cửa dữ liệu thị trường cao khi confidence còn thấp.',
    CURRENT_LOW_CONFIDENCE_DIAGNOSTIC_ONLY: 'Candidate chỉ thuộc tầng chẩn đoán độ tin cậy thấp.',
    CURRENT_BOOKMAKER_AGREEMENT_BELOW_MINIMUM: 'Mức đồng thuận giữa các nguồn thị trường chưa đạt ngưỡng.',
    CURRENT_HIGH_QUOTE_OUTLIER_BLOCKED: 'Quote cao bất thường so với consensus bị chặn.',
    CURRENT_QUOTE_OUTLIER_BLOCKED: 'Tỷ lệ thị trường bị xác định là outlier so với thị trường.',
  };
  return labels[reason] ?? reason.toLowerCase().replaceAll('_', ' ');
}

function selectionAuditSummary(selection: PersonalMarketSelectionDto): string {
  if (selection.valueExplainabilityWired) {
    if (selection.eligible) return 'Candidate nghiên cứu đã vượt current value gate';
    const confidence = selection.modelConfidenceTier ?? selection.reliabilityStatus ?? '—';
    const history = selection.modelHistorySampleSize ?? 0;
    if (selection.signalTier === 'LOW_CONFIDENCE_DIAGNOSTIC') {
      return `Research only · ${confidence} · history ${history}`;
    }
    return `Đã đánh giá · chưa đạt ngưỡng mô hình · ${confidence}`;
  }
  if (selection.oddsSource === 'LATEST_SNAPSHOT') {
    return selection.oddsPitUsable
      ? 'Dữ liệu thị trường · PIT usable · chờ model hiện tại'
      : 'Dữ liệu thị trường · chưa PIT-usable';
  }
  return selection.eligible
    ? 'Scientific candidate · Eligible'
    : (selection.reliabilityStatus ?? 'Scientific candidate');
}

function hasResearchModel(row: PersonalUpcomingFixtureDto): boolean {
  return row.marketPredictions.some((market) =>
    market.selections.some((selection) => selection.modelProbability != null),
  );
}

// R4.10.2.9_UI_EXPLAINABILITY_STATUS_CONSISTENCY: helper functions

function marketSelectionLabel(
  row: PersonalUpcomingFixtureDto,
  market: PersonalMarketPredictionDto,
  selection: PersonalMarketSelectionDto,
): string {
  if (selection.code === 'HOME') return row.fixture.homeTeam.name;
  if (selection.code === 'AWAY') return row.fixture.awayTeam.name;
  if (selection.code === 'DRAW') return 'Hòa';
  if (selection.code === 'YES') return 'Có';
  if (selection.code === 'NO') return 'Không';
  if (selection.code === 'OVER') return `Over ${market.lineValue ?? ''}`.trim();
  return `Under ${market.lineValue ?? ''}`.trim();
}

function bestMarketSelection(
  market: PersonalMarketPredictionDto,
): PersonalMarketSelectionDto | null {
  return (
    market.selections
      .filter(
        (selection: PersonalMarketSelectionDto): boolean => selection.modelProbability != null,
      )
      .slice()
      .sort(
        (left: PersonalMarketSelectionDto, right: PersonalMarketSelectionDto): number =>
          (right.modelProbability ?? -1) - (left.modelProbability ?? -1),
      )[0] ?? null
  );
}

function currentRecommendationSelectionLabel(row: PersonalUpcomingFixtureDto): string {
  const recommendation = row.currentRecommendation;

  if (recommendation == null) {
    return '—';
  }

  if (recommendation.selection === 'HOME') {
    return row.fixture.homeTeam.name;
  }

  if (recommendation.selection === 'AWAY') {
    return row.fixture.awayTeam.name;
  }

  if (recommendation.selection === 'DRAW') {
    return 'Hòa';
  }

  if (recommendation.selection === 'YES') {
    return 'BTTS Có';
  }

  if (recommendation.selection === 'NO') {
    return 'BTTS Không';
  }

  if (recommendation.selection === 'OVER') {
    return `Over ${recommendation.lineValue ?? ''}`.trim();
  }

  return `Under ${recommendation.lineValue ?? ''}`.trim();
}

function currentRecommendationMarketLabel(row: PersonalUpcomingFixtureDto): string {
  const recommendation = row.currentRecommendation;

  if (recommendation == null) {
    return '—';
  }

  if (recommendation.marketType === 'MATCH_WINNER') {
    return 'HDA / 1X2';
  }

  if (recommendation.marketType === 'BTTS') {
    return 'BTTS';
  }

  return `O/U ${recommendation.lineValue ?? ''}`.trim();
}

function paperShadowSelectionLabel(row: PersonalUpcomingFixtureDto): string {
  const selected = row.paperShadowRecommendation?.selected;

  if (selected == null) return '—';
  if (selected.selection === 'HOME') {
    return row.fixture.homeTeam.name;
  }
  if (selected.selection === 'AWAY') {
    return row.fixture.awayTeam.name;
  }
  if (selected.selection === 'DRAW') {
    return 'Hòa';
  }
  if (selected.selection === 'YES') {
    return 'BTTS Có';
  }
  if (selected.selection === 'NO') {
    return 'BTTS Không';
  }
  if (selected.selection === 'OVER') {
    return `Over ${selected.lineValue ?? ''}`.trim();
  }
  return `Under ${selected.lineValue ?? ''}`.trim();
}

function paperShadowMarketLabel(row: PersonalUpcomingFixtureDto): string {
  const selected = row.paperShadowRecommendation?.selected;

  if (selected == null) return '—';
  if (selected.marketType === 'MATCH_WINNER') {
    return 'HDA / 1X2';
  }
  if (selected.marketType === 'BTTS') {
    return 'BTTS';
  }
  return `O/U ${selected.lineValue ?? ''}`.trim();
}

function paperShadowStatusLabel(
  status: PersonalUpcomingFixtureDto['paperShadowRecommendation'] extends infer T
    ? T extends { status: infer S }
      ? S
      : never
    : never,
): string {
  if (status === 'RAW_VALUE_SHADOW') return 'RAW VALUE SHADOW';
  if (status === 'HIERARCHICAL_VALUE_SHADOW') return 'HIERARCHICAL VALUE SHADOW';
  if (status === 'BOUNDED_VALUE_SHADOW') return 'BOUNDED VALUE SHADOW';
  return 'DIAGNOSTIC SHADOW';
}

// CURRENT_SCIENTIFIC_RECOMMENDATION_R4102

function currentRecommendationStatusLabel(
  status: PersonalUpcomingFixtureDto['currentRecommendationStatus'],
): string {
  if (status === 'AVAILABLE') {
    return 'Có đề xuất hiện tại';
  }

  if (status === 'NO_FRESH_PIT_ODDS') {
    return 'Chờ dữ liệu PIT mới';
  }

  if (status === 'NO_PROVIDER_FIXTURE_SNAPSHOT') {
    return 'Thiếu snapshot fixture provider';
  }

  if (status === 'NO_MODEL') {
    return 'Thiếu mô hình hiện tại';
  }

  if (status === 'NO_COMPLETE_MARKET') {
    return 'Thiếu market hoàn chỉnh';
  }

  if (status === 'NO_VALUE_SIGNAL') {
    return 'Đã tính, chưa đạt ngưỡng mô hình';
  }

  if (status === 'UNMAPPED_FIXTURE') {
    return 'Chưa ghép fixture';
  }

  if (status === 'MAPPING_MISMATCH') {
    return 'Sai lệch mapping';
  }

  return 'Chưa được đánh giá';
}

function currentRecommendationStatusDescription(row: PersonalUpcomingFixtureDto): string {
  const status = row.currentRecommendationStatus;

  if (status === 'NO_FRESH_PIT_ODDS') {
    return 'Không có phiên bản dữ liệu PIT đủ mới hoặc vừa được API tái xác nhận.';
  }

  if (status === 'NO_PROVIDER_FIXTURE_SNAPSHOT') {
    return row.currentRecommendationError === 'NO_PROVIDER_FIXTURE_SNAPSHOT_AT_CURRENT_AS_OF'
      ? 'Fixture local chưa có snapshot metadata tương ứng từ provider tại thời điểm phân tích. Hệ thống không tạo dữ liệu thị trường hoặc mapping giả.'
      : 'Thiếu snapshot fixture provider hợp lệ tại thời điểm phân tích.';
  }

  if (status === 'NO_MODEL') {
    if (row.currentRecommendationError === 'NO_DIXON_COLES_MODEL_AT_CURRENT_AS_OF') {
      return 'Chưa có mô hình Dixon–Coles hợp lệ tại thời điểm phân tích hiện tại.';
    }

    return (
      row.currentRecommendationError ??
      'Không xây dựng được mô hình khoa học tại thời điểm hiện tại.'
    );
  }

  if (status === 'NO_COMPLETE_MARKET') {
    return 'Dữ liệu thị trường đang có nhưng chưa đủ các cửa đồng bộ để tính xác suất thị trường no-vig.';
  }

  if (status === 'NO_VALUE_SIGNAL') {
    return 'Model đã chạy; không candidate nào vượt đồng thời conservative edge, conservative EV, độ tin cậy, longshot guard và kiểm tra đồng thuận nguồn dữ liệu.';
  }

  if (status === 'UNMAPPED_FIXTURE') {
    return 'Fixture provider chưa được ghép với fixture local.';
  }

  if (status === 'MAPPING_MISMATCH') {
    return 'League, đội hoặc kickoff giữa provider và local không khớp an toàn.';
  }

  if (status === 'NOT_EVALUATED') {
    return 'Fixture chưa nằm trong batch current-analysis hoặc chưa được xử lý ở lần tải này.';
  }

  return 'Current scientific recommendation đã khả dụng.';
}

function currentRecommendationStatusClass(
  status: PersonalUpcomingFixtureDto['currentRecommendationStatus'],
): string {
  return status.toLowerCase().replaceAll('_', '-');
}

// CURRENT_RECOMMENDATION_STATUS_DASHBOARD_R41023

const GROUPS: Array<{ value: CurrentCompetitionGroup; label: string; description: string }> = [
  {
    value: 'WAFCON',
    label: 'WAFCON 2026',
    description: "Women's Africa Cup of Nations · Morocco 2026",
  },
  {
    value: 'UCL',
    label: 'UEFA Champions League',
    description: '2026/27 · vòng loại và league phase',
  },
  {
    value: 'UEFA_EUROPA',
    label: 'Europa + Conference League',
    description: 'UEFA Europa League & UEFA Conference League 2026/27',
  },
  {
    value: 'ASEAN',
    label: 'ASEAN Championship 2026',
    description: 'AFF Cup / ASEAN Championship đội tuyển quốc gia',
  },
  {
    value: 'SEA',
    label: 'Đông Nam Á quốc nội',
    description: 'Việt Nam, Thái Lan, Indonesia, Malaysia…',
  },
  { value: 'ASIA', label: 'Châu Á', description: 'AFC, Nhật Bản, Hàn Quốc, Saudi…' },
  { value: 'EPL', label: 'Premier League', description: 'Ngoại hạng Anh · mùa hiện tại' },
  { value: 'LALIGA', label: 'La Liga', description: 'Tây Ban Nha · mùa hiện tại' },
];

function isAseanSeniorCompetition(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (
    ['u19', 'u20', 'u21', 'u22', 'u23', 'women', 'club'].some((variant: string): boolean =>
      normalized.includes(variant),
    )
  ) {
    return false;
  }

  return (
    normalized.includes('asean championship') ||
    normalized.includes('aff championship') ||
    normalized === 'aff cup'
  );
}

function isRequestedPriorityCompetition(name: string): boolean {
  const normalized = name.trim().toLowerCase();

  return (
    isAseanSeniorCompetition(name) ||
    normalized === 'africa cup of nations - women' ||
    normalized === "women's africa cup of nations" ||
    normalized === 'uefa champions league' ||
    normalized === 'uefa europa league' ||
    normalized === 'uefa europa conference league' ||
    normalized === 'uefa conference league'
  );
}

export function UpcomingPredictionBoard({
  initialData,
}: {
  initialData: PersonalUpcomingAnalysisDto;
}) {
  const [data, setData] = useState<PersonalUpcomingAnalysisDto>(initialData);
  const [days, setDays] = useState<string>(String(initialData.window.days));
  const [selectedGroups, setSelectedGroups] = useState<CurrentCompetitionGroup[]>([
    'WAFCON',
    'UCL',
    'UEFA_EUROPA',
    'ASEAN',
    'SEA',
    'ASIA',
    'EPL',
    'LALIGA',
  ]);
  const [leagueFilter, setLeagueFilter] = useState<number | 'ALL'>('ALL');
  const [stateFilter, setStateFilter] = useState<PersonalFixtureState | 'ALL'>('ALL');
  const [groupFilter, setGroupFilter] = useState<PersonalLeagueGroup | 'ALL'>('ALL');
  const [marketFilter, setMarketFilter] = useState<PersonalMarketCode | 'ALL'>('ALL');
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastDiscovery, setLastDiscovery] = useState<PersonalRefreshResponse['discovery'] | null>(
    null,
  );

  const visibleFixtures = useMemo(
    () =>
      data.fixtures.filter((row: PersonalUpcomingFixtureDto): boolean => {
        if (leagueFilter !== 'ALL' && row.fixture.league.id !== leagueFilter) return false;
        if (stateFilter !== 'ALL' && row.state !== stateFilter) return false;
        if (
          groupFilter !== 'ALL' &&
          classifyPersonalLeague({
            name: row.fixture.league.name,
            country: row.fixture.league.country,
          }) !== groupFilter
        ) {
          return false;
        }
        if (
          marketFilter !== 'ALL' &&
          !row.marketPredictions.some(
            (market: PersonalMarketPredictionDto): boolean =>
              market.code === marketFilter && market.status !== 'WAITING_ODDS',
          )
        ) {
          return false;
        }
        return true;
      }),
    [data.fixtures, groupFilter, leagueFilter, marketFilter, stateFilter],
  );

  function toggleGroup(group: CurrentCompetitionGroup): void {
    setSelectedGroups((current: CurrentCompetitionGroup[]) =>
      current.includes(group)
        ? current.filter((value: CurrentCompetitionGroup): boolean => value !== group)
        : [...current, group],
    );
  }

  async function reloadFromDb(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch(
        `${apiUrl}/personal/upcoming-analysis?days=${encodeURIComponent(days)}&limit=300`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData((await response.json()) as PersonalUpcomingAnalysisDto);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không tải được dữ liệu hiện tại.');
    } finally {
      setLoading(false);
    }
  }

  async function syncCurrentFixtures(): Promise<void> {
    if (selectedGroups.length === 0) {
      setMessage('Hãy chọn ít nhất một nhóm giải.');
      return;
    }

    const confirmed = window.confirm(
      'Hệ thống sẽ hỏi API-Football mùa đang hoạt động, chỉ lấy các trận từ hôm nay trở đi, sau đó chạy phân tích mô hình. Tiếp tục?',
    );
    if (!confirmed) return;

    setLoading(true);
    setMessage('Đang tìm mùa hiện tại trên API-Football → lấy lịch sắp tới → dự đoán…');

    try {
      const response = await fetch(`${apiUrl}/personal/upcoming/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          days: Number(days),
          groups: selectedGroups,
        }),
      });

      const payload = (await response.json()) as PersonalRefreshResponse & {
        error?: string;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? `HTTP ${response.status}`);
      }

      setData(payload.analysis);
      setLastDiscovery(payload.discovery);
      setMessage(
        `Đã đồng bộ ${payload.discovery.competitions.length} giải/mùa hiện tại · ${payload.analysis.counts.fixtures} trận sắp tới · ${payload.analysis.counts.bestBets} đề xuất đạt tiêu chí.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Đồng bộ thất bại.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pcr-page">
      <section className="pcr-hero">
        <div>
          <span className="eyebrow">CURRENT FIXTURES ONLY</span>
          <h1>Dự đoán các trận sắp tới</h1>
          <p>
            Chỉ dùng mùa đang hoạt động từ API-Football và fixture có kickoff sau thời điểm hiện
            tại. Demo, test và lịch quá khứ không được đưa vào màn hình dự đoán.
          </p>
        </div>

        <div className="pcr-actions">
          <button
            type="button"
            className="button primary"
            disabled={loading || selectedGroups.length === 0}
            onClick={() => void syncCurrentFixtures()}
          >
            {loading ? 'Đang lấy lịch thật…' : 'Lấy lịch thật & phân tích'}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void reloadFromDb()}
          >
            Làm mới từ DB
          </button>
        </div>
      </section>

      {message ? <div className="pcr-message">{message}</div> : null}

      <section className="pcr-current-groups">
        <div className="section-heading">
          <div>
            <span className="eyebrow">GIẢI MUỐN THEO DÕI</span>
            <h2>Mùa hiện tại, không chọn season thủ công</h2>
          </div>
          <small>
            {selectedGroups.length}/{GROUPS.length} nhóm
          </small>
        </div>
        <div className="pcr-current-group-grid">
          {GROUPS.map((group) => (
            <label
              key={group.value}
              className={selectedGroups.includes(group.value) ? 'selected' : ''}
            >
              <input
                type="checkbox"
                checked={selectedGroups.includes(group.value)}
                onChange={() => toggleGroup(group.value)}
              />
              <span>
                <b>{group.label}</b>
                <small>{group.description}</small>
              </span>
            </label>
          ))}
        </div>
        <p className="pcr-current-note">
          API-Football tự xác định season có <code>current=true</code>. Khoảng fixture: hôm nay →{' '}
          {days} ngày tới.
        </p>
      </section>

      {lastDiscovery ? (
        <section className="pcr-discovery-strip">
          <b>Đã xác định mùa hiện tại:</b>
          {lastDiscovery.competitions.map((competition) => (
            <span
              key={`${competition.apiLeagueId}:${competition.season}`}
              className={
                isRequestedPriorityCompetition(competition.name)
                  ? 'pcr-asean-competition-badge'
                  : undefined
              }
            >
              {isRequestedPriorityCompetition(competition.name) ? '★ ' : ''}
              {competition.name} {competition.season}
            </span>
          ))}
        </section>
      ) : null}

      <section className="pcr-kpis">
        <div>
          <span>Trận sắp tới</span>
          <strong>{data.counts.fixtures}</strong>
          <small>{data.window.days} ngày</small>
        </div>
        <div>
          <span>Có dữ liệu thị trường</span>
          <strong>{data.counts.fixturesWithOdds ?? 0}</strong>
          <small>{data.counts.fixturesWithPitUsableOdds ?? 0} fixture có dữ liệu PIT hợp lệ</small>
        </div>
        <div className="highlight">
          <span>Đạt tiêu chí</span>
          <strong>{data.counts.bestBets}</strong>
          <small>scientific policy</small>
        </div>
        <div>
          <span>Chưa đạt tiêu chí</span>
          <strong>{data.counts.noBets}</strong>
          <small>chưa đạt ngưỡng mô hình</small>
        </div>
        <div>
          <span>Đang chờ</span>
          <strong>{data.counts.predictionOnly + data.counts.waitingData}</strong>
          <small>odds / horizon / dữ liệu</small>
        </div>

        <div className="current-signal-kpi">
          <span>Đề xuất hiện tại</span>
          <strong>{data.counts.currentRecommendations}</strong>
          <small>scientific now · chưa chốt</small>
        </div>
        <div className="paper-signal-kpi">
          <span>BẢN GHI MÔ PHỎNG</span>
          <strong>{data.counts.paperRecommendations}</strong>
          <small>xác suất điều chỉnh · chuẩn 1 đơn vị · mô phỏng nghiên cứu</small>
        </div>
      </section>

      <section className="pcr-recommendation-status-dashboard">
        <div className="section-heading">
          <div>
            <span className="eyebrow">CURRENT RECOMMENDATION PIPELINE</span>
            <h2>Trạng thái tính đề xuất hiện tại</h2>
          </div>

          <small>{data.counts.fixtures} fixture</small>
        </div>

        <div className="pcr-current-batch-summary">
          <span>
            Đã đánh giá <strong>{data.currentRecommendationBatch.evaluatedFixtures}</strong>/
            {data.currentRecommendationBatch.requestedFixtures} fixture
          </span>

          <span>
            Fresh raw: {data.currentRecommendationBatch.recentRawAttemptFixtures}
            {' · '}PIT odds: {data.currentRecommendationBatch.pitOddsFixtures}
            {' · '}Checkpoint priority: {data.currentRecommendationBatch.checkpointPriorityFixtures}
          </span>

          <span>
            Chunk {data.currentRecommendationBatch.chunksCompleted}/
            {data.currentRecommendationBatch.chunksPlanned}
            {' · '}failed {data.currentRecommendationBatch.failedChunks}
            {' · '}single retry {data.currentRecommendationBatch.singleFixtureRetrySuccesses}/
            {data.currentRecommendationBatch.singleFixtureRetries}
            {' · '}classified{' '}
            {data.currentRecommendationBatch.missingProviderSnapshotClassifications}
          </span>
        </div>
        {/* CURRENT_RECOMMENDATION_BATCH_PRIORITY_R41025 */}

        <div className="pcr-recommendation-status-grid">
          <div className="status-available">
            <span>Có đề xuất</span>
            <strong>{data.currentRecommendationStatusCounts.AVAILABLE}</strong>
            <small>vượt current value gate</small>
          </div>

          <div className="status-no-value">
            <span>Không đủ value</span>
            <strong>{data.currentRecommendationStatusCounts.NO_VALUE_SIGNAL}</strong>
            <small>model đã tính xong</small>
          </div>

          <div className="status-odds">
            <span>Chờ dữ liệu thị trường mới</span>
            <strong>{data.currentRecommendationStatusCounts.NO_FRESH_PIT_ODDS}</strong>
            <small>PIT / re-observation</small>
          </div>

          <div className="status-provider-snapshot">
            <span>Thiếu fixture snapshot</span>
            <strong>{data.currentRecommendationStatusCounts.NO_PROVIDER_FIXTURE_SNAPSHOT}</strong>
            <small>thiếu immutable provider lineage</small>
          </div>

          <div className="status-model">
            <span>Thiếu model</span>
            <strong>{data.currentRecommendationStatusCounts.NO_MODEL}</strong>
            <small>current as-of</small>
          </div>

          <div className="status-market">
            <span>Thiếu market</span>
            <strong>{data.currentRecommendationStatusCounts.NO_COMPLETE_MARKET}</strong>
            <small>chưa đủ no-vig pair</small>
          </div>

          <div className="status-mapping">
            <span>Mapping cần kiểm tra</span>
            <strong>
              {data.currentRecommendationStatusCounts.UNMAPPED_FIXTURE +
                data.currentRecommendationStatusCounts.MAPPING_MISMATCH}
            </strong>
            <small>provider ↔ local</small>
          </div>

          <div className="status-not-evaluated">
            <span>Chưa đánh giá</span>
            <strong>{data.currentRecommendationStatusCounts.NOT_EVALUATED}</strong>
            <small>ngoài batch / chưa xử lý</small>
          </div>
        </div>
      </section>

      <section className="pcr-control-panel">
        <div className="pcr-control-row">
          <label>
            Khoảng sắp tới
            <select value={days} onChange={(event) => setDays(event.target.value)}>
              <option value="7">7 ngày</option>
              <option value="14">14 ngày</option>
              <option value="30">30 ngày</option>
            </select>
          </label>
          <label>
            Giải đang có trận
            <select
              value={leagueFilter}
              onChange={(event) =>
                setLeagueFilter(event.target.value === 'ALL' ? 'ALL' : Number(event.target.value))
              }
            >
              <option value="ALL">Tất cả giải hiện tại</option>
              {data.leagues.map((league) => (
                <option key={league.id} value={league.id}>
                  {league.country ? `${league.country} · ` : ''}
                  {league.name} · {league.season}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trạng thái
            <select
              value={stateFilter}
              onChange={(event) =>
                setStateFilter(event.target.value as PersonalFixtureState | 'ALL')
              }
            >
              <option value="ALL">Tất cả</option>
              <option value="BEST_BET">Đạt tiêu chí</option>
              <option value="NO_BET">Chưa đạt tiêu chí</option>
              <option value="PREDICTION_ONLY">Có dự đoán, chờ dữ liệu thị trường</option>
              <option value="WAITING_DATA">Chờ dữ liệu</option>
            </select>
          </label>
          <label>
            Khu vực
            <select
              value={groupFilter}
              onChange={(event) =>
                setGroupFilter(event.target.value as PersonalLeagueGroup | 'ALL')
              }
            >
              <option value="ALL">Tất cả</option>
              <option value="WAFCON">WAFCON 2026</option>
              <option value="UCL">UEFA Champions League</option>
              <option value="UEFA_EUROPA">Europa + Conference League</option>
              <option value="ASEAN">ASEAN Championship 2026</option>
              <option value="SEA">Đông Nam Á quốc nội</option>
              <option value="ASIA">Châu Á</option>
              <option value="EPL">Premier League</option>
              <option value="LALIGA">La Liga</option>
            </select>
          </label>
          <label>
            Market
            <select
              value={marketFilter}
              onChange={(event) =>
                setMarketFilter(event.target.value as PersonalMarketCode | 'ALL')
              }
            >
              <option value="ALL">Tất cả market</option>
              <option value="HDA">HDA / 1X2</option>
              <option value="BTTS">BTTS</option>
              <option value="OVER_UNDER_1_5">Over/Under 1.5</option>
              <option value="OVER_UNDER_2_5">Over/Under 2.5</option>
              <option value="OVER_UNDER_3_5">Over/Under 3.5</option>
            </select>
          </label>
        </div>
      </section>

      {/* NEUTRAL_PREDICTION_LANGUAGE_V1: dedicated BEST_BET presentation removed. */}
      <section className="pcr-match-list">
        <div className="section-heading">
          <div>
            <span className="eyebrow">UPCOMING REAL FIXTURES</span>
            <h2>Trận sắp diễn ra</h2>
          </div>
          <small>{visibleFixtures.length} trận</small>
        </div>

        {visibleFixtures.length === 0 ? (
          <div className="pcr-empty">
            Chưa có fixture thật trong DB cho khoảng này. Bấm “Lấy lịch thật & phân tích” để đồng bộ
            trực tiếp từ API-Football.
          </div>
        ) : (
          visibleFixtures.map((row) => (
            <article
              className={`pcr-match-card ${row.state === 'BEST_BET' ? 'is-best' : ''}`}
              key={row.fixture.id}
            >
              <div className="pcr-match-header">
                <div>
                  <span>
                    {isRequestedPriorityCompetition(row.fixture.league.name) ? '★ ' : ''}
                    {row.fixture.league.name} · {row.fixture.league.season}
                  </span>
                  <b>{localTime(row.fixture.kickoffAt)}</b>
                </div>
                <span className={`pcr-state state-${row.state.toLowerCase().replaceAll('_', '-')}`}>
                  {stateLabel(row.state)}
                </span>
              </div>

              <div className="pcr-match-title">
                <strong>{row.fixture.homeTeam.name}</strong>
                <span>vs</span>
                <strong>{row.fixture.awayTeam.name}</strong>
              </div>

              <div className="pcr-hda-split">
                <section className="pcr-hda-panel pcr-hda-scientific">
                  <div className="pcr-hda-panel-head">
                    <div>
                      <span>OFFICIAL SCIENTIFIC HDA</span>
                      <b>Quyết định khoa học theo horizon</b>
                    </div>
                    <em>
                      {row.scientificHda?.available
                        ? `T-${row.scientificHda?.horizonMinutes ?? '—'}`
                        : 'CHỜ SCIENTIFIC DECISION'}
                    </em>
                  </div>
                  {row.scientificHda?.available ? (
                    <>
                      <div className="pcr-probability-grid">
                        <div>
                          <div>
                            <span>Chủ</span>
                            <b>{pct(row.scientificHda?.homeProbability)}</b>
                          </div>
                          <i
                            style={{ width: probabilityWidth(row.scientificHda?.homeProbability) }}
                          />
                        </div>
                        <div>
                          <div>
                            <span>Hòa</span>
                            <b>{pct(row.scientificHda?.drawProbability)}</b>
                          </div>
                          <i
                            style={{ width: probabilityWidth(row.scientificHda?.drawProbability) }}
                          />
                        </div>
                        <div>
                          <div>
                            <span>Khách</span>
                            <b>{pct(row.scientificHda?.awayProbability)}</b>
                          </div>
                          <i
                            style={{ width: probabilityWidth(row.scientificHda?.awayProbability) }}
                          />
                        </div>
                      </div>
                      <div className="pcr-hda-summary">
                        Scientific dự đoán: <b>{scientificPredictedName(row)}</b>
                        {row.scientificHda.modelVersion ? (
                          <small>Model: {row.scientificHda.modelVersion}</small>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="pcr-scientific-waiting">
                      <b>Chưa có official Scientific HDA.</b>
                      <span>
                        Current research model ở các card thị trường chỉ là tín hiệu nghiên cứu.
                        API-Football không thay thế quyết định khoa học theo horizon.
                      </span>
                    </div>
                  )}
                </section>

                <section className="pcr-hda-panel pcr-hda-provider">
                  <div className="pcr-hda-panel-head">
                    <div>
                      <span>API-FOOTBALL · THAM KHẢO</span>
                      <b>Tín hiệu provider, không phải Scientific Model</b>
                    </div>
                    <em>{row.providerHda?.available ? 'REFERENCE' : 'CHƯA CÓ'}</em>
                  </div>
                  {row.providerHda?.available ? (
                    <>
                      <div className="pcr-probability-grid pcr-provider-probability-grid">
                        <div>
                          <div>
                            <span>Chủ</span>
                            <b>{pct(row.providerHda?.homeProbability)}</b>
                          </div>
                          <i style={{ width: probabilityWidth(row.providerHda?.homeProbability) }} />
                        </div>
                        <div>
                          <div>
                            <span>Hòa</span>
                            <b>{pct(row.providerHda?.drawProbability)}</b>
                          </div>
                          <i style={{ width: probabilityWidth(row.providerHda?.drawProbability) }} />
                        </div>
                        <div>
                          <div>
                            <span>Khách</span>
                            <b>{pct(row.providerHda?.awayProbability)}</b>
                          </div>
                          <i style={{ width: probabilityWidth(row.providerHda?.awayProbability) }} />
                        </div>
                      </div>
                      <div className="pcr-hda-summary">
                        API-Football nghiêng: <b>{providerPredictedName(row)}</b>
                        {row.providerHda.capturedAt ? (
                          <small>Snapshot: {localTime(row.providerHda.capturedAt)}</small>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="pcr-scientific-waiting">
                      <b>Chưa có prediction từ API-Football.</b>
                    </div>
                  )}
                </section>
              </div>

              {row.marketMovement ? (
                <section className="pcr-market-movement-panel">
                  <div className="pcr-market-movement-head">
                    <div>
                      <span>MARKET MOVEMENT · HDA / 1X2</span>
                      <b>Opening → Current · no-vig consensus</b>
                    </div>
                    <em>
                      {row.marketMovement.movementAvailable
                        ? `${row.marketMovement.matchedBookmakerCount} nguồn thị trường matched`
                        : `${row.marketMovement.bookmakerCount} nguồn thị trường`}
                    </em>
                  </div>

                  {row.marketMovement.available && row.marketMovement.currentConsensus ? (
                    <>
                      <div className="pcr-movement-grid">
                        {(['HOME', 'DRAW', 'AWAY'] as const).map((selection) => (
                          <div key={selection}>
                            <span>{movementSelectionLabel(row, selection)}</span>
                            <b>
                              {row.marketMovement?.openingConsensus
                                ? pct(row.marketMovement.openingConsensus[selection])
                                : '—'}
                              {' → '}
                              {pct(row.marketMovement?.currentConsensus?.[selection])}
                            </b>
                            <small>
                              Δ {signedPoints(row.marketMovement?.movement[selection])}
                              {' · '}60m{' '}
                              {signedPoints(row.marketMovement?.recentMovement[selection])}
                            </small>
                          </div>
                        ))}
                      </div>

                      <div className="pcr-movement-flags">
                        <span>
                          Quality <b>{pct(row.marketMovement.qualityScore)}</b>
                        </span>
                        <span>
                          Steam{' '}
                          <b>
                            {row.marketMovement.steamMoveDetected
                              ? movementSelectionLabel(row, row.marketMovement.steamDirection)
                              : 'Không'}
                          </b>
                        </span>
                        {row.marketMovement.steamMoveDetected ? (
                          <span>
                            Strength <b>{pct(row.marketMovement.steamStrength)}</b>
                          </span>
                        ) : null}
                        <span>
                          Late move <b>{row.marketMovement.lateMove ? 'Có' : 'Không'}</b>
                        </span>
                        {row.marketMovement.observedFrom ? (
                          <span>
                            Opening <b>{localTime(row.marketMovement.observedFrom)}</b>
                          </span>
                        ) : null}
                        {row.marketMovement.observedTo ? (
                          <span>
                            Current <b>{localTime(row.marketMovement.observedTo)}</b>
                          </span>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <div className="pcr-movement-empty">
                      Chưa đủ ít nhất 3 nguồn thị trường 1X2 hoàn chỉnh để tạo movement consensus đáng tin
                      cậy. Early Tỷ lệ thị trường vẫn tiếp tục thu theo cadence 3 giờ.
                    </div>
                  )}
                </section>
              ) : null}

              <div className="pcr-market-tabs">
                {row.marketPredictions
                  .filter(
                    (market: PersonalMarketPredictionDto): boolean =>
                      marketFilter === 'ALL' || market.code === marketFilter,
                  )
                  .map((market: PersonalMarketPredictionDto) => {
                    const strongest = bestMarketSelection(market);
                    const marketMovement =
                      row.multiMarketMovements?.find(
                        (movement): boolean => movement.code === market.code,
                      ) ?? null;

                    return (
                      <div
                        key={market.code}
                        className={[
                          'pcr-market-card',
                          `market-status-${marketStatusClass(market.status)}`,
                          market.status === 'BEST_BET' ? 'best-market' : '',
                          market.status === 'ANALYSIS_ONLY' ? 'analysis-only' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        <div className="pcr-market-card-head">
                          <b>{market.label}</b>
                          <span>{marketStatusLabel(market.status)}</span>
                        </div>

                        {market.status === 'WAITING_ODDS' ? (
                          <small>
                            Chưa có snapshot thị trường trong 6 giờ gần nhất. Xem checkpoint bên dưới.
                          </small>
                        ) : (
                          <>
                            <div className="pcr-market-selections">
                              {market.selections.map((selection: PersonalMarketSelectionDto) => (
                                <div
                                  key={selection.code}
                                  className={
                                    selection.eligible
                                      ? 'is-eligible-value'
                                      : selection.valueExplainabilityWired
                                        ? 'is-evaluated-no-value'
                                        : undefined
                                  }
                                >
                                  <span>{marketSelectionLabel(row, market, selection)}</span>
                                  <b className="pcr-odds-primary">
                                    Tỷ lệ thị trường {decimal(selection.decimalOdds)}
                                  </b>
                                  <div className="pcr-selection-metrics">
                                    <span>
                                      Model <b>{pct(selection.modelProbability)}</b>
                                    </span>
                                    <span>
                                      Market no-vig <b>{pct(selection.fairMarketProbability)}</b>
                                    </span>
                                    <span>
                                      Raw edge <b>{signedPct(selection.edge)}</b>
                                    </span>
                                    <span>
                                      Raw EV <b>{signedPct(selection.expectedValue)}</b>
                                    </span>
                                    {selection.valueExplainabilityWired ? (
                                      <>
                                        <span>
                                          Conservative edge{' '}
                                          <b>{signedPct(selection.conservativeEdge)}</b>
                                        </span>
                                        <span>
                                          Conservative EV{' '}
                                          <b>{signedPct(selection.conservativeExpectedValue)}</b>
                                        </span>
                                        <span>
                                          Risk score{' '}
                                          <b>{decimal(selection.riskAdjustedScore, 3)}</b>
                                        </span>
                                        <span>
                                          Confidence <b>{selection.modelConfidenceTier ?? '—'}</b>
                                        </span>
                                        <span>
                                          History <b>{selection.modelHistorySampleSize ?? '—'}</b>
                                        </span>
                                        <span>
                                          Tier <b>{selection.signalTier ?? '—'}</b>
                                        </span>
                                      </>
                                    ) : null}
                                  </div>
                                  <small>
                                    {selection.bookmakerName ?? 'Bookmaker —'}
                                    {selection.oddsObservedAt
                                      ? ` · snapshot ${localTime(selection.oddsObservedAt)}`
                                      : ''}
                                  </small>
                                  <em
                                    className={
                                      selection.eligible
                                        ? 'is-eligible'
                                        : selection.valueExplainabilityWired
                                          ? 'is-research-only'
                                          : undefined
                                    }
                                  >
                                    {selectionAuditSummary(selection)}
                                  </em>
                                  {rejectionReasonList(selection.rejectionReasons).length > 0 ? (
                                    <details className="pcr-selection-audit">
                                      <summary>
                                        Vì sao bị loại? (
                                        {rejectionReasonList(selection.rejectionReasons).length})
                                      </summary>
                                      <ul>
                                        {rejectionReasonList(selection.rejectionReasons).map(
                                          (reason) => (
                                            <li key={reason} title={reason}>
                                              {rejectionReasonLabel(reason)}
                                            </li>
                                          ),
                                        )}
                                      </ul>
                                    </details>
                                  ) : null}
                                </div>
                              ))}
                            </div>

                            {marketMovement ? (
                              <div className="pcr-two-way-movement">
                                <div className="pcr-two-way-movement-head">
                                  <span>MULTI-MARKET MOVEMENT</span>
                                  <em>
                                    {marketMovement.movementAvailable
                                      ? `${marketMovement.matchedBookmakerCount} nguồn thị trường matched`
                                      : `${marketMovement.bookmakerCount} nguồn thị trường current`}
                                  </em>
                                </div>

                                {marketMovement.available ? (
                                  <>
                                    <div className="pcr-two-way-movement-grid">
                                      {marketMovement.selections.map((selection) => (
                                        <div key={selection.code}>
                                          <span>
                                            {twoWayMovementSelectionLabel(
                                              selection.code,
                                              marketMovement.lineValue,
                                            )}
                                          </span>
                                          <b>
                                            {selection.openingProbability != null
                                              ? `${pct(selection.openingProbability)} → `
                                              : 'Current '}
                                            {pct(selection.currentProbability)}
                                          </b>
                                          <small>
                                            Δ {signedPoints(selection.movement)}
                                            {' · '}60m {signedPoints(selection.recentMovement)}
                                          </small>
                                        </div>
                                      ))}
                                    </div>

                                    <div className="pcr-two-way-movement-flags">
                                      <span>
                                        Quality <b>{pct(marketMovement.qualityScore)}</b>
                                      </span>
                                      <span>
                                        Agreement <b>{pct(marketMovement.bookmakerAgreement)}</b>
                                      </span>
                                      <span>
                                        Steam{' '}
                                        <b>
                                          {marketMovement.steamMoveDetected
                                            ? twoWayMovementSelectionLabel(
                                                marketMovement.steamDirection === 'NONE'
                                                  ? (marketMovement.selections[0]?.code ?? 'YES')
                                                  : marketMovement.steamDirection,
                                                marketMovement.lineValue,
                                              )
                                            : 'Không'}
                                        </b>
                                      </span>
                                      {marketMovement.steamMoveDetected ? (
                                        <span>
                                          Strength <b>{pct(marketMovement.steamStrength)}</b>
                                        </span>
                                      ) : null}
                                      <span>
                                        Late <b>{marketMovement.lateMove ? 'Có' : 'Không'}</b>
                                      </span>
                                    </div>

                                    {!marketMovement.movementAvailable ? (
                                      <div className="pcr-two-way-movement-wait">
                                        Current no-vig consensus đã có · chờ thêm provider-version
                                        để tạo Opening → Current đáng tin cậy.
                                      </div>
                                    ) : null}
                                  </>
                                ) : (
                                  <div className="pcr-two-way-movement-wait">
                                    Chưa đủ market 2 cửa hoàn chỉnh từ ít nhất 3 nguồn thị trường.
                                  </div>
                                )}
                              </div>
                            ) : null}

                            {strongest ? (
                              <div className="pcr-market-lean">
                                Research model nghiêng:{' '}
                                <b>{marketSelectionLabel(row, market, strongest)}</b>{' '}
                                {pct(strongest.modelProbability)}
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>

              <div className="pcr-odds-diagnostics">
                <span>
                  Dữ liệu thị trường: <b>{row.oddsDiagnostics.snapshotRows}</b> rows · PIT{' '}
                  <b>{row.oddsDiagnostics.pitUsableRows}</b> · markets{' '}
                  <b>{row.oddsDiagnostics.marketsWithOdds}</b>
                </span>
                <span>
                  Early Odds: <b>1–14 ngày · refresh 3h</b>
                </span>
                {row.oddsDiagnostics.latestObservedAt ? (
                  <span>
                    Snapshot mới nhất: <b>{localTime(row.oddsDiagnostics.latestObservedAt)}</b>
                  </span>
                ) : null}
                {row.oddsDiagnostics.latestCheckpoint ? (
                  <span
                    className={`checkpoint-${row.oddsDiagnostics.latestCheckpoint.status.toLowerCase()}`}
                  >
                    Checkpoint:{' '}
                    <b>
                      {row.oddsDiagnostics.latestCheckpoint.horizonLabel} ·{' '}
                      {row.oddsDiagnostics.latestCheckpoint.status}
                    </b>{' '}
                    · normalized {row.oddsDiagnostics.latestCheckpoint.normalizedOdds} · PIT{' '}
                    {row.oddsDiagnostics.latestCheckpoint.pitUsableOdds}
                  </span>
                ) : (
                  <span>
                    Checkpoint: <b>chưa có</b>
                  </span>
                )}
              </div>

              {row.currentRecommendation == null ? (
                <div
                  className={[
                    'pcr-current-status',
                    `current-status-${currentRecommendationStatusClass(
                      row.currentRecommendationStatus,
                    )}`,
                  ].join(' ')}
                >
                  <span className="eyebrow">TRẠNG THÁI ĐỀ XUẤT HIỆN TẠI</span>

                  <b>{currentRecommendationStatusLabel(row.currentRecommendationStatus)}</b>

                  <small>{currentRecommendationStatusDescription(row)}</small>

                  {row.currentRecommendationError ? (
                    <code>{row.currentRecommendationError}</code>
                  ) : null}
                </div>
              ) : null}
              {row.currentRecommendation == null && row.paperShadowRecommendation?.selected ? (
                <div
                  className={[
                    'pcr-paper-shadow-signal',
                    row.paperShadowRecommendation.selected.paperTrackEligible
                      ? 'is-trackable'
                      : 'is-diagnostic',
                  ].join(' ')}
                >
                  <span className="eyebrow">
                    {row.paperShadowRecommendation.selected.paperTrackEligible
                      ? 'ĐỀ XUẤT MÔ PHỎNG | CHUẨN 1 ĐƠN VỊ'
                      : 'CHẨN ĐOÁN MÔ PHỎNG'}
                  </span>
                  <b>
                    {paperShadowSelectionLabel(row)}
                    {' · '}
                    {paperShadowMarketLabel(row)}
                    {' @ '}
                    {decimal(row.paperShadowRecommendation.selected.decimalOdds)}
                  </b>
                  <small>
                    {paperShadowStatusLabel(row.paperShadowRecommendation.status)}
                    {' · '}Raw edge {pct(row.paperShadowRecommendation.selected.rawEdge)}
                    {' · '}Raw EV {pct(row.paperShadowRecommendation.selected.rawExpectedValue)}
                  </small>
                  <small>
                    Hierarchical probability{' '}
                    {pct(
                      row.paperShadowRecommendation.selected.hierarchicalConservativeProbability,
                    )}
                    {' · '}edge {pct(row.paperShadowRecommendation.selected.hierarchicalEdge)}
                    {' · '}EV{' '}
                    {pct(row.paperShadowRecommendation.selected.hierarchicalExpectedValue)}
                  </small>
                  <small>
                    Xác suất mô phỏng điều chỉnh{' '}
                    {pct(row.paperShadowRecommendation.selected.boundedAdjustedProbability)}
                    {' | '}adjustment{' '}
                    {pct(row.paperShadowRecommendation.selected.boundedProbabilityAdjustment)}
                    {' | '}edge {pct(row.paperShadowRecommendation.selected.boundedEdge)}
                    {' | '}EV {pct(row.paperShadowRecommendation.selected.boundedExpectedValue)}
                  </small>
                  <small>
                    Model {row.paperShadowRecommendation.selected.modelSource ?? 'UNKNOWN'}
                    {' · '}history {row.paperShadowRecommendation.selected.modelHistorySampleSize}
                    {' · '}trọng số mô phỏng{' '}
                    {row.paperShadowRecommendation.selected.hypotheticalFlatStakeUnits}u{' · '}real
                    stake 0u
                  </small>
                  {row.paperShadowRecommendation.selected.ouOppositeLineStrategy ? (
                    <small>
                      Kết quả O/U từ mô hình:{' '}
                      {
                        row.paperShadowRecommendation.selected.ouOppositeLineStrategy
                          .predictionSelection
                      }{' '}
                      {
                        row.paperShadowRecommendation.selected.ouOppositeLineStrategy
                          .predictionLineValue
                      }
                      {' ('}
                      {pct(
                        row.paperShadowRecommendation.selected.ouOppositeLineStrategy
                          .predictionProbability,
                      )}
                      {') · giữ nguyên cửa và line tính toán'}
                    </small>
                  ) : null}
                  <small>
                    {row.paperShadowRecommendation.selected.reasonCodes.slice(0, 4).join(' · ')}
                  </small>
                </div>
              ) : null}
              {row.currentRecommendation ? (
                <div className="pcr-current-signal">
                  <span className="eyebrow">TÍN HIỆU NGHIÊN CỨU ĐÃ ĐIỀU CHỈNH RỦI RO</span>

                  <b>
                    {currentRecommendationSelectionLabel(row)} ·{' '}
                    {currentRecommendationMarketLabel(row)} @{' '}
                    {decimal(row.currentRecommendation.decimalOdds)}
                  </b>

                  <small>
                    Model {pct(row.currentRecommendation.modelProbability)} · Market{' '}
                    {pct(row.currentRecommendation.fairMarketProbability)} · Edge{' '}
                    {pct(row.currentRecommendation.edge)} · Raw EV{' '}
                    {pct(row.currentRecommendation.expectedValue)}
                  </small>

                  <small>
                    Adjusted model {pct(row.currentRecommendation.adjustedModelProbability)}
                    {' · '}Conservative probability{' '}
                    {pct(row.currentRecommendation.conservativeProbability)}
                    {' · '}Conservative edge {pct(row.currentRecommendation.conservativeEdge)}
                    {' · '}Conservative EV{' '}
                    {pct(row.currentRecommendation.conservativeExpectedValue)}
                  </small>
                  {row.currentRecommendation.ouOppositeLineStrategy ? (
                    <small>
                      Kết quả O/U từ mô hình:{' '}
                      {row.currentRecommendation.ouOppositeLineStrategy.predictionSelection}{' '}
                      {row.currentRecommendation.ouOppositeLineStrategy.predictionLineValue}
                      {' ('}
                      {pct(row.currentRecommendation.ouOppositeLineStrategy.predictionProbability)}
                      {') · giữ nguyên cửa và line tính toán'}
                    </small>
                  ) : null}

                  <small>
                    Risk score {decimal(row.currentRecommendation.riskAdjustedScore, 3)}
                    {' · '}model weight {pct(row.currentRecommendation.effectiveModelWeight)}
                    {' · '}probability haircut {pct(row.currentRecommendation.probabilityHaircut)}
                    {' · '}longshot penalty {decimal(row.currentRecommendation.longshotPenalty, 3)}
                  </small>

                  <small>
                    Quote consensus: {row.currentRecommendation.quoteCount} nguồn · median @
                    {decimal(row.currentRecommendation.quoteMedianOdds)}
                    {' · '}agreement {pct(row.currentRecommendation.quoteAgreementRatio)}
                    {' · '}deviation {pct(row.currentRecommendation.quoteDeviationRatio)}
                  </small>

                  <small>
                    T-
                    {row.currentRecommendation.horizonMinutes} · Risk-adjusted research signal ·
                    chưa phải đề xuất chính thức
                  </small>

                  <small>
                    Model source:{' '}
                    {row.currentRecommendation.modelSource === 'DYNAMIC_DIXON_COLES'
                      ? 'Dynamic Dixon–Coles'
                      : 'PIT-safe scientific baseline'}
                    {' · '}
                    {row.currentRecommendation.modelConfidenceTier}
                    {' · history '}
                    {row.currentRecommendation.modelHistorySampleSize}
                    {' · quality '}
                    {pct(row.currentRecommendation.dataQualityScore)}
                  </small>

                  {row.currentRecommendation.modelSource === 'SCIENTIFIC_BASELINE_FALLBACK' ? (
                    <small>
                      Fallback reason: {row.currentRecommendation.modelFallbackReason}
                      {' · research signal only · không được nâng thành đề xuất chính thức'}
                    </small>
                  ) : null}

                  <small>
                    Tỷ lệ thị trường evidence:{' '}
                    {row.currentRecommendation.oddsFreshnessBasis === 'REOBSERVED_AT'
                      ? 'API vừa tái xác nhận phiên bản giá'
                      : 'source update còn mới'}
                    {row.currentRecommendation.sourceOddsFreshnessAt
                      ? ` · ${localTime(row.currentRecommendation.sourceOddsFreshnessAt)}`
                      : ''}
                  </small>
                  {/* PIT_SAFE_BASELINE_FALLBACK_R41024 */}
                  {/* FRESH_ODDS_REOBSERVATION_R41022 */}
                </div>
              ) : null}
              <div className="pcr-meta-row">
                <span>
                  Current research model: <b>{hasResearchModel(row) ? 'CÓ' : 'CHỜ MODEL'}</b>
                </span>
                <span>
                  Official Scientific HDA:{' '}
                  <b>
                    {row.scientificHda?.available ? scientificPredictedName(row) : 'CHỜ DECISION'}
                  </b>
                </span>
                <span>
                  API-Football:{' '}
                  <b>{row.providerHda?.available ? providerPredictedName(row) : '—'}</b>
                </span>
                {row.nextCheckpoint ? (
                  <span>
                    Mốc dữ liệu thị trường kế: <b>{row.nextCheckpoint.horizonLabel}</b> ·{' '}
                    {localTime(row.nextCheckpoint.dueAt)}
                  </span>
                ) : null}
              </div>

              {row.decision ? (
                <div className="pcr-decision-row">
                  <div>
                    <span>Decision</span>
                    <b>{row.decision.decisionType}</b>
                  </div>
                  <div>
                    <span>Pick</span>
                    <b>{decisionSelectionName(row)}</b>
                  </div>
                  <div>
                    <span>Odds</span>
                    <b>{decimal(row.decision.decimalOdds)}</b>
                  </div>
                  <div>
                    <span>Edge</span>
                    <b>{pct(row.decision.edge)}</b>
                  </div>
                  <div>
                    <span>EV</span>
                    <b>{pct(row.decision.expectedValue)}</b>
                  </div>
                  <div>
                    <span>Reliability</span>
                    <b>{row.decision.reliabilityStatus ?? '—'}</b>
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}
      </section>

      <div className="pcr-safety-note">
        Early Tỷ lệ thị trường 1–14 ngày dùng để lưu opening/current · HDA, BTTS và O/U đều có market movement
        khi đủ snapshot · không tự tạo đề xuất · Scientific HDA và API-Football được tách riêng ·
        HDA/BTTS/Over-Under chỉ thành đề xuất khi scientific/reliability gate cho phép · không
        auto-bet · không real-money.
      </div>
    </div>
  );
}
