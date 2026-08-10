'use client';

import { useEffect, useState } from 'react';

import { getAccountUsage, type AccountUsageResponse } from '../../../lib/auth';

export default function AccountUsagePage() {
  const [usage, setUsage] = useState<AccountUsageResponse | null>(null);

  useEffect(() => {
    void getAccountUsage().then(setUsage).catch(() => setUsage(null));
  }, []);

  if (!usage) return <div className="auth-card">Loading...</div>;

  return (
    <div className="auth-card">
      <span className="eyebrow">USAGE</span>
      <h1>Daily quota</h1>
      <div className="auth-meta">
        <span>Used: {usage.quotaUsed}</span>
        <span>Limit: {usage.quotaLimit ?? 'Unlimited'}</span>
        <span>Remaining: {usage.quotaRemaining ?? 'Unlimited'}</span>
        <span>Reset: {usage.resetAt}</span>
      </div>
    </div>
  );
}
