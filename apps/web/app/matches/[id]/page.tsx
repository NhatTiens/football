import { notFound } from 'next/navigation';
import { SportsbookMatch } from '../../../components/SportsbookMatch';
import { apiFetch } from '../../../lib/api';
import type { FixtureDetailDto } from '../../../lib/types';

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let fixture: FixtureDetailDto;
  try {
    fixture = await apiFetch<FixtureDetailDto>(`/fixtures/${id}`);
  } catch {
    notFound();
  }
  return <SportsbookMatch fixture={fixture} />;
}
