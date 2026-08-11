import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { PersonalBacktestDashboard } from '../../components/PersonalBacktestDashboard';
import { ScientificBacktestPanel } from '../../components/ScientificBacktestPanel';

import { apiFetch } from '../../lib/api';
import type { AuthMeResponse } from '../../lib/auth';
import type {
  PersonalBacktestLeagueCoverageDto,
} from '../../lib/personal-types';
import type { ScientificDashboardDto } from '../../lib/scientific-types';
import type { BacktestDetailDto, BacktestRunDto } from '../../lib/types';

// BACKTEST_INTERNAL_ACCESS_V1
export default async function BacktestPage() {
  const incomingHeaders = await headers();
  const cookie = incomingHeaders.get('cookie') ?? '';
  const internalInit: RequestInit = {
    headers: {
      cookie,
    },
  };

  let auth: AuthMeResponse;
  try {
    auth = await apiFetch<AuthMeResponse>('/auth/me', internalInit);
  } catch {
    redirect('/login?next=%2Fbacktest');
  }

  if (!auth.authenticated || !auth.user) {
    redirect('/login?next=%2Fbacktest');
  }

  if (auth.user.status !== 'ACTIVE') {
    redirect('/account');
  }

  if (auth.user.role !== 'ADMIN' && auth.user.role !== 'ANALYST') {
    redirect('/predictions');
  }

  const [runsResponse, leaguesResponse] = await Promise.all([
    apiFetch<{ data: BacktestRunDto[] }>('/backtests?limit=40', internalInit),
    apiFetch<{ data: PersonalBacktestLeagueCoverageDto[] }>(
      '/backtest/leagues',
      internalInit,
    ),
  ]);

  const latest =
    runsResponse.data.find((run: BacktestRunDto): boolean => run.status === 'SUCCESS') ??
    runsResponse.data[0];

  let detail: BacktestDetailDto | null = null;

  if (latest) {
    try {
      detail = await apiFetch<BacktestDetailDto>(
        `/backtests/${latest.id}`,
        internalInit,
      );
    } catch {
      detail = null;
    }
  }

  let scientific: ScientificDashboardDto | null = null;

  try {
    scientific = await apiFetch<ScientificDashboardDto>(
      '/scientific/dashboard',
      internalInit,
    );
  } catch {
    scientific = null;
  }

  return (
    <>
      <PersonalBacktestDashboard
        initialRuns={runsResponse.data}
        initialDetail={detail}
        leagues={leaguesResponse.data}
      />

      <details className="pcr-scientific-details">
        <summary>Scientific evidence / audit nâng cao</summary>
        <ScientificBacktestPanel initialData={scientific} />
      </details>
    </>
  );
}
