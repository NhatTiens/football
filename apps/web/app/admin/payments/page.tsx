'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  getAdminPayments,
  type AdminPayment,
  type AdminPaymentStatus,
} from '../../../lib/admin';
import {
  adminPaymentLabel,
  formatAdminDate,
  formatAdminMoney,
} from '../../../lib/admin-format';

const statuses: Array<{ value: '' | AdminPaymentStatus; label: string }> = [
  { value: '', label: 'Tất cả' },
  { value: 'PENDING', label: 'PENDING' },
  { value: 'PAID', label: 'PAID' },
  { value: 'EXPIRED', label: 'EXPIRED' },
  { value: 'CANCELLED', label: 'CANCELLED' },
];

// ADMIN_UI_REAL_V1
export default function AdminPaymentsPage() {
  const [status, setStatus] = useState<'' | AdminPaymentStatus>('');
  const [rows, setRows] = useState<AdminPayment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filter: '' | AdminPaymentStatus = status) => {
    setError(null);
    try {
      const payload = await getAdminPayments(filter || undefined, 100);
      setRows(payload.payments);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Không tải được payments.',
      );
    }
  }, [status]);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (active) void load('');
    });

    return () => {
      active = false;
    };
  }, [load]);

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <span className="eyebrow">PAYMENTS</span>
          <h1>PaymentOrder</h1>
          <p>Đơn thanh toán thật từ billing database, không dùng dữ liệu giả.</p>
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
                const next = event.target.value as '' | AdminPaymentStatus;
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
                <th>Order</th>
                <th>User</th>
                <th>Plan</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Provider txn</th>
                <th>Created</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><code>{row.orderCode}</code></td>
                  <td>
                    <div className="admin-user-cell">
                      <strong>{row.user?.name ?? `User #${row.userId ?? '—'}`}</strong>
                      <span>{row.user?.email ?? '—'}</span>
                    </div>
                  </td>
                  <td>{row.planCode}</td>
                  <td>{formatAdminMoney(row.amountVnd)}</td>
                  <td>
                    <span className={`admin-chip admin-chip-${row.status.toLowerCase()}`}>
                      {adminPaymentLabel(row.status)}
                    </span>
                  </td>
                  <td><code>{row.providerTransactionId ?? '—'}</code></td>
                  <td>{formatAdminDate(row.createdAt)}</td>
                  <td>{formatAdminDate(row.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
