'use client';

import { useEffect, useState } from 'react';

import { getAdminDashboard } from '../../lib/auth';

export default function AdminPage() {
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    void getAdminDashboard().then(setDashboard).catch(() => setDashboard(null));
  }, []);

  if (!dashboard) return <div className="auth-card">Loading...</div>;

  return (
    <div className="auth-card">
      <span className="eyebrow">ADMIN</span>
      <h1>Dashboard</h1>
      <pre className="admin-pre">{JSON.stringify(dashboard, null, 2)}</pre>
    </div>
  );
}
