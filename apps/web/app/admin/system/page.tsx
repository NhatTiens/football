'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  getAdminDashboard,
  type AdminDashboard,
} from '../../../lib/admin';

// ADMIN_UI_REAL_V1
export default function AdminSystemPage() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDashboard(await getAdminDashboard());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Không tải được system health.',
      );
    }
  }, []);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (active) void load();
    });

    return () => {
      active = false;
    };
  }, [load]);

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <span className="eyebrow">SYSTEM</span>
          <h1>Commercial system health</h1>
          <p>
            Trang vận hành nhanh cho API, database, payment queue và webhook anomalies.
          </p>
        </div>
        <button className="button secondary" type="button" onClick={() => void load()}>
          Kiểm tra lại
        </button>
      </header>

      {error ? <div className="admin-error-banner">{error}</div> : null}

      <div className="admin-health-grid">
        <article>
          <span>API</span>
          <strong>{dashboard?.systemHealth.api ?? '...'}</strong>
          <small>Admin dashboard API</small>
        </article>
        <article>
          <span>Database</span>
          <strong>{dashboard?.systemHealth.db ?? '...'}</strong>
          <small>Commercial DB query</small>
        </article>
        <article>
          <span>Pending orders</span>
          <strong>{dashboard?.pendingOrders ?? '...'}</strong>
          <small>
            <Link href="/admin/payments">Mở Payments →</Link>
          </small>
        </article>
        <article>
          <span>Webhook anomalies</span>
          <strong>{dashboard?.failedWebhookCount ?? '...'}</strong>
          <small>
            <Link href="/admin/webhooks">Mở Webhooks →</Link>
          </small>
        </article>
      </div>

      <section className="admin-panel admin-system-rules">
        <span className="eyebrow">GUARDRAILS</span>
        <h2>Quy tắc vận hành hiện tại</h2>
        <div className="admin-rule-grid">
          <div>
            <strong>ADMIN ≠ PRO</strong>
            <span>Role quản trị độc lập với plan thương mại.</span>
          </div>
          <div>
            <strong>Payment exactly-once</strong>
            <span>Webhook duplicate không được gia hạn PRO lần hai.</span>
          </div>
          <div>
            <strong>Entitlement append history</strong>
            <span>Grant/revoke được phản ánh trong Subscription và Audit.</span>
          </div>
          <div>
            <strong>No secrets in UI</strong>
            <span>Trang này không hiển thị SePay key, DB URL hay password.</span>
          </div>
        </div>
      </section>
    </div>
  );
}
