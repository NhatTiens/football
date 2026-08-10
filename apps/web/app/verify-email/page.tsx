import { Suspense } from 'react';

import { VerifyEmailClient } from '../../components/VerifyEmailClient';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="auth-card">Loading...</div>}>
      <VerifyEmailClient />
    </Suspense>
  );
}
