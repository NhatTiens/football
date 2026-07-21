import { RecommendationCard } from '../../components/RecommendationCard';
import { apiFetch } from '../../lib/api';
import type { RecommendationDto } from '../../lib/types';

export default async function RecommendationsPage() {
  const response = await apiFetch<{ data: RecommendationDto[] }>('/recommendations?status=ACTIVE&limit=100');
  return (
    <>
      <section className="page-heading">
        <span className="eyebrow">EXPECTED VALUE</span>
        <h1>Top bet được hệ thống lựa chọn</h1>
        <p>Chỉ hiển thị bet vượt toàn bộ ngưỡng odds, edge, EV, confidence, freshness và data quality.</p>
      </section>
      <div className="recommendation-list">
        {response.data.length > 0 ? response.data.map((item) => (
          <RecommendationCard key={item.id} recommendation={item} />
        )) : <div className="empty-state">Không có bet đủ điều kiện tại thời điểm này.</div>}
      </div>
    </>
  );
}
