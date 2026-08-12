import Link from 'next/link';

import { apiFetch } from '../lib/api';
import type { PersonalUpcomingAnalysisDto } from '../lib/personal-types';
import type { DashboardStats } from '../lib/types';

function pct(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

export default async function HomePage() {
  const [stats, analysis] = await Promise.all([
    apiFetch<DashboardStats>('/stats'),
    apiFetch<PersonalUpcomingAnalysisDto>('/personal/upcoming-analysis?days=7&limit=120'),
  ]);

  return (
    <div className="pcr-home">
      <section className="pcr-hero">
        <div>
          <span className="eyebrow">FOOTBALL AI V7 · PERSONAL</span>
          <h1>Dự đoán và đánh giá mô hình trên một giao diện</h1>
          <p>
            Dùng prediction để hiểu trận đấu; dùng scientific value policy để quyết định đề xuất đạt tiêu chí;
            dùng backtest point-in-time để kiểm chứng model trước khi tin kết quả.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/predictions">
              Xem trận sắp tới
            </Link>
            <Link className="button secondary" href="/backtest">
              Mở đánh giá mô hình
            </Link>
          </div>
        </div>

        <div className="pcr-principles">
          <span>Nguyên tắc</span>
          <strong>Dự đoán ≠ kết luận chắc chắn</strong>
          <strong>Đề xuất cần dữ liệu thị trường + độ lệch mô hình + độ tin cậy</strong>
          <small>Chỉ mô phỏng nghiên cứu · không giao dịch tài chính</small>
        </div>
      </section>

      <section className="pcr-kpis">
        <div><span>Trận 7 ngày tới</span><strong>{analysis.counts.fixtures}</strong><small>{analysis.counts.predicted} có prediction</small></div>
        <div className="highlight"><span>Đạt tiêu chí</span><strong>{analysis.counts.bestBets}</strong><small>scientific decision</small></div>
        <div><span>Chưa đạt tiêu chí</span><strong>{analysis.counts.noBets}</strong><small>không đủ value</small></div>
        <div><span>Đang phân tích</span><strong>{analysis.counts.predictionOnly}</strong><small>chưa đủ điều kiện đề xuất</small></div>
        <div><span>Độ chính xác mô phỏng</span><strong>{pct(stats.hitRate)}</strong><small>{stats.wins}W / {stats.losses}L</small></div>
      </section>

      <section className="pcr-home-grid">
        <Link href="/predictions" className="pcr-home-card">
          <span className="eyebrow">01</span>
          <h2>Dự đoán</h2>
          <p>
            Trận hiện tại gồm ASEAN Championship, Đông Nam Á, châu Á, Premier League và La Liga;
            có BTTS, Over/Under, xác suất, độ lệch mô hình và độ tin cậy.
          </p>
          <b>Mở dự đoán →</b>
        </Link>

        <Link href="/backtest" className="pcr-home-card">
          <span className="eyebrow">02</span>
          <h2>Backtest nhiều giải</h2>
          <p>Không cần admin token. Chạy tối đa 16 giải một lượt và so sánh kết quả theo giải.</p>
          <b>Mở backtest →</b>
        </Link>

        <Link href="/history" className="pcr-home-card">
          <span className="eyebrow">03</span>
          <h2>Audit & lịch sử</h2>
          <p>Theo dõi quyết định, settlement và lịch sử paper-bet để đánh giá hệ thống theo thời gian.</p>
          <b>Mở lịch sử →</b>
        </Link>
      </section>
    </div>
  );
}
