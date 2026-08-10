import { Suspense } from 'react';

import { ResetPasswordClient } from '../../components/ResetPasswordClient';

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="auth-card">Loading...</div>}>
      <ResetPasswordClient />
    </Suspense>
  );
}
