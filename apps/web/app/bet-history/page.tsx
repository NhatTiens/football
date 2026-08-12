import { redirect } from 'next/navigation';

export default function LegacyBetHistoryRedirect() {
  redirect('/history');
}
