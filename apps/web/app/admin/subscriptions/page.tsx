'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  getAdminSubscriptions,
  type AdminSubscription,
  type AdminSubscriptionStatus,
} from '../../../lib/admin';
import {
  adminSubscriptionLabel,
  formatAdminDate,
} from '../../../lib/admin-format';

const statuses: Array<{ value: '' | AdminSubscriptionStatus; label: string }> = [
  { value: '', label: 'Tất cả' },
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'EXPIRED', label: 'EXPIRED' },
  { value: 'REVOKED', label: 'REVOKED' },
];

// ADMIN_UI_REAL_V1
export default function AdminSubscriptionsPage() {
  const [status, setStatus] = useState<'' | AdminSubscriptionStatus>('');
  const [rows, setRows] = useState<AdminSubscription[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (filter: '' | AdminSubscriptionStatus = status) => {
      setError(null);
      try {
        const payload = await getAdminSubscriptions(filter || undefined, 100);
        setRows(payload.subscriptions);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : 'Không tải được subscriptions.',
        );
      }
    },
    [status],
  );

  useEffect(() => {
    void load('');
  }, [load]);

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <span className="eyebrow">SUBSCRIPTIONS</span>
          <h1>Entitlement history</h1>
          <p>ACTIVE, EXPIRED và REVOKED từ lifecycle SUBSCRIPTION-1.</p>
        </div>
        <button className="button secondary" type="button" onClick={() => void load()}>
          Làm mới
        </button>
      </header>

      <section className="admin-panel">
        <div className="admin-toolbar">
          <label>
            <span>Trạng thái</span>
            <select
              value={status}
              onChange={(event) => {
                const next = event.target.value as '' | AdminSubscriptionStatus;
                setStatus(next);
                void load(next);
              }}
            >
              {statuses.map((item) => (
                <option key={item.value || 'ALL'} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <strong>{rows.length} bản ghi</strong>
        </div>

        {error ? <div className="admin-error-banner">{error}</div> : null}

        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Starts</th>
                <th>Expires</th>
                <th>Source payment</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="admin-user-cell">
                      <strong>{row.user?.name ?? `User #${row.userId}`}</strong>
                      <span>{row.user?.email ?? '—'}</span>
                    </div>
                  </td>
                  <td>{row.planCode}</td>
                  <td>
                    <span className={`admin-chip admin-sub-${row.status.toLowerCase()}`}>
                      {adminSubscriptionLabel(row.status)}
                    </span>
                  </td>
                  <td>{formatAdminDate(row.startsAt)}</td>
                  <td>{formatAdminDate(row.expiresAt)}</td>
                  <td>
                    {row.sourcePaymentOrder ? (
                      <code>{row.sourcePaymentOrder.orderCode}</code>
                    ) : (
                      <span className="admin-muted">Manual admin grant</span>
                    )}
                  </td>
                  <td>{formatAdminDate(row.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
