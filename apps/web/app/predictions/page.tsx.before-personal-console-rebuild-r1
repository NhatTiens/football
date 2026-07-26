import { UpcomingPredictionBoard } from '../../components/UpcomingPredictionBoard';
import { apiFetch } from '../../lib/api';
import type { PersonalLeagueDto, PersonalUpcomingAnalysisDto } from '../../lib/personal-types';

export default async function PredictionsPage() {
  const [analysis, leaguesResponse] = await Promise.all([
    apiFetch<PersonalUpcomingAnalysisDto>('/personal/upcoming-analysis?days=7&limit=120'),
    apiFetch<{ data: PersonalLeagueDto[] }>('/leagues'),
  ]);

  return (
    <UpcomingPredictionBoard
      initialData={analysis}
      leagues={leaguesResponse.data}
    />
  );
}
