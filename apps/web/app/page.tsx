import Link from 'next/link';
import { FixtureCard } from '../components/FixtureCard';
import { RecommendationCard } from '../components/RecommendationCard';
import { StatCard } from '../components/StatCard';
import { apiFetch } from '../lib/api';
import { percent } from '../lib/format';
import type { DashboardStats, FixtureDto, RecommendationDto } from '../lib/types';

export default async function HomePage() {
  const [stats, fixturesResponse, recommendationsResponse] = await Promise.all([
    apiFetch<DashboardStats>('/stats'),
    apiFetch<{ data: FixtureDto[] }>('/fixtures?status=UPCOMING&limit=6'),
    apiFetch<{ data: RecommendationDto[] }>('/recommendations?status=ACTIVE&limit=5'),
  ]);

  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">ODDS · PROBABILITY · EV</span>
          <h1>Phát hiện value bet từ dữ liệu thị trường</h1>
          <p>
            Hệ thống lưu lịch sử odds, loại biên nhà cái, mô hình hóa xác suất bàn thắng và chỉ xếp
            hạng lựa chọn vượt ngưỡng edge, EV và chất lượng dữ liệu.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/recommendations">Xem khuyến nghị</Link>
            <Link className="button secondary" href="/matches">Xem trận đấu</Link>
          </div>
        </div>
        <div className="hero-panel">
          <span>Nguyên tắc</span>
          <strong>Không chọn đội mạnh.</strong>
          <strong>Chọn mức giá có lợi thế.</strong>
          <small>Model Probability − Fair Market Probability = Edge</small>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard label="Trận sắp tới" value={stats.upcomingFixtures} />
        <StatCard label="Khuyến nghị đang hoạt động" value={stats.activeRecommendations} />
        <StatCard label="Tỷ lệ thắng mô phỏng" value={percent(stats.hitRate)} note={`${stats.wins} thắng / ${stats.losses} thua`} />
        <StatCard label="Lợi nhuận mô phỏng" value={`${stats.simulatedProfitUnits >= 0 ? '+' : ''}${stats.simulatedProfitUnits.toFixed(2)}u`} note={`Yield ${percent(stats.yield)}`} />
      </section>

      <section className="section-heading">
        <div><span className="eyebrow">TOP VALUE</span><h2>Khuyến nghị mới nhất</h2></div>
        <Link href="/recommendations">Xem tất cả →</Link>
      </section>
      <div className="recommendation-list">
        {recommendationsResponse.data.length > 0 ? recommendationsResponse.data.map((item) => (
          <RecommendationCard key={item.id} recommendation={item} />
        )) : <div className="empty-state">Chưa có lựa chọn vượt ngưỡng. Chạy worker generate sau khi có odds.</div>}
      </div>

      <section className="section-heading">
        <div><span className="eyebrow">FIXTURES</span><h2>Trận sắp diễn ra</h2></div>
        <Link href="/matches">Xem tất cả →</Link>
      </section>
      <div className="fixture-grid">
        {fixturesResponse.data.map((fixture) => <FixtureCard key={fixture.id} fixture={fixture} />)}
      </div>
    </>
  );
}
