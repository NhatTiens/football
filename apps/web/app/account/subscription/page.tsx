'use client';

import { useEffect, useState } from 'react';

import { getAccountSubscription, type AccountSubscriptionResponse } from '../../../lib/auth';

export default function AccountSubscriptionPage() {
  const [subscription, setSubscription] = useState<AccountSubscriptionResponse | null>(null);

  useEffect(() => {
    void getAccountSubscription().then(setSubscription).catch(() => setSubscription(null));
  }, []);

  if (!subscription) return <div className="auth-card">Loading...</div>;

  return (
    <div className="auth-card">
      <span className="eyebrow">SUBSCRIPTION</span>
      <h1>{subscription.plan}</h1>
      <div className="auth-meta">
        <span>Status: {subscription.status}</span>
        <span>Verified: {subscription.emailVerifiedAt ? 'Yes' : 'No'}</span>
        <span>Pro expires: {subscription.proExpiresAt ?? 'N/A'}</span>
        <span>Advanced chat: {subscription.canAccessAdvancedChat ? 'Yes' : 'No'}</span>
      </div>
    </div>
  );
}
