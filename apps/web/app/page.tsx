import Link from 'next/link';
import { apiFetch } from '../lib/api';
import type { DashboardStats } from '../lib/types';
import type { PersonalUpcomingAnalysisDto } from '../lib/personal-types';

function pct(value: number | null | undefined): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export default async function HomePage() {
  const [stats, analysis] = await Promise.all([
    apiFetch<DashboardStats>('/stats'),
    apiFetch<PersonalUpcomingAnalysisDto>('/personal/upcoming-analysis?days=7&limit=80'),
  ]);

  return (
    <div className="beta1e-home">
      <section className="beta1e-home-hero">
        <div>
          <span className="eyebrow">FOOTBALL AI V7 · PERSONAL</span>
          <h1>Một màn hình cho dự đoán, BEST BET và kiểm định</h1>
          <p>
            Theo dõi trận sắp tới, chỉ nhận BEST BET khi đủ odds + reliability,
            và kiểm tra model bằng backtest point-in-time nhiều giải.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/predictions">Xem dự đoán sắp tới</Link>
            <Link className="button secondary" href="/backtest">Mở Backtest Lab</Link>
          </div>
        </div>
        <div className="beta1e-home-status">
          <span>Scientific discipline</span>
          <strong>Prediction ≠ Bet</strong>
          <strong>BEST BET chỉ khi có value</strong>
          <small>Không real-money · paper/research only</small>
        </div>
      </section>

      <section className="beta1e-kpis">
        <div><span>Trận 7 ngày tới</span><strong>{analysis.counts.fixtures}</strong><small>{analysis.counts.predicted} có prediction</small></div>
        <div className="accent"><span>BEST BET</span><strong>{analysis.counts.bestBets}</strong><small>scientific policy</small></div>
        <div><span>Đang chờ</span><strong>{analysis.counts.waiting}</strong><small>odds / horizon</small></div>
        <div><span>Active legacy rec</span><strong>{stats.activeRecommendations}</strong><small>tách khỏi BEST BET v7</small></div>
        <div><span>Paper hit rate</span><strong>{pct(stats.hitRate)}</strong><small>{stats.wins}W / {stats.losses}L</small></div>
      </section>

      <section className="beta1e-home-grid">
        <Link href="/predictions" className="beta1e-home-card">
          <span className="eyebrow">01</span>
          <h2>Dự đoán & BEST BET</h2>
          <p>Xem xác suất Hòa/Chủ/Khách, mốc T-90 và BEST BET chính thức.</p>
          <strong>Mở →</strong>
        </Link>
        <Link href="/backtest" className="beta1e-home-card">
          <span className="eyebrow">02</span>
          <h2>Backtest nhiều giải</h2>
          <p>Không cần ADMIN_API_TOKEN. Chọn nhiều giải và so sánh run riêng.</p>
          <strong>Mở →</strong>
        </Link>
        <Link href="/bet-history" className="beta1e-home-card">
          <span className="eyebrow">03</span>
          <h2>Audit & lịch sử</h2>
          <p>BEST BET / NO BET, stake overlay, settlement và lịch sử quyết định.</p>
          <strong>Mở →</strong>
        </Link>
      </section>
    </div>
  );
}
