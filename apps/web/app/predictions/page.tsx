import { PredictionChatbot } from '../../components/PredictionChatbot';
import { UpcomingPredictionBoard } from '../../components/UpcomingPredictionBoard';
import { apiFetch } from '../../lib/api';
import type { PersonalUpcomingAnalysisDto } from '../../lib/personal-types';

export default async function PredictionsPage() {
  const analysis = await apiFetch<PersonalUpcomingAnalysisDto>(
    '/personal/upcoming-analysis?days=14&limit=300',
  );

  return (
    <>
      <PredictionChatbot />
      <UpcomingPredictionBoard initialData={analysis} />
    </>
  );
}
