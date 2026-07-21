import { FixtureCard } from '../../components/FixtureCard';
import { apiFetch } from '../../lib/api';
import type { FixtureDto } from '../../lib/types';

export default async function MatchesPage() {
  const response = await apiFetch<{ data: FixtureDto[] }>('/fixtures?limit=100');
  return (
    <>
      <section className="page-heading">
        <span className="eyebrow">MATCH CENTER</span>
        <h1>Danh sách trận đấu</h1>
        <p>Fixtures, trạng thái, tỷ số và số lượng recommendation hiện có.</p>
      </section>
      <div className="fixture-grid">
        {response.data.length > 0 ? response.data.map((fixture) => (
          <FixtureCard key={fixture.id} fixture={fixture} />
        )) : <div className="empty-state">Chưa có dữ liệu trận đấu.</div>}
      </div>
    </>
  );
}
