import { BacktestDashboard } from '../../components/BacktestDashboard';
import { apiFetch } from '../../lib/api';
import type { BacktestDetailDto, BacktestRunDto, LeagueDto } from '../../lib/types';

export default async function BacktestPage() {
  const [runsResponse, leaguesResponse] = await Promise.all([
    apiFetch<{ data: BacktestRunDto[] }>('/backtests?limit=20'),
    apiFetch<{ data: LeagueDto[] }>('/leagues'),
  ]);
  const latest = runsResponse.data.find((run) => run.status === 'SUCCESS') ?? runsResponse.data[0];
  let detail: BacktestDetailDto | null = null;
  if (latest) {
    try {
      detail = await apiFetch<BacktestDetailDto>(`/backtests/${latest.id}`);
    } catch {
      detail = null;
    }
  }
  return <BacktestDashboard initialRuns={runsResponse.data} initialDetail={detail} leagues={leaguesResponse.data} />;
}
