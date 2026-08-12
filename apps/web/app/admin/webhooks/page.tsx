'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  getAdminWebhooks,
  type AdminWebhook,
} from '../../../lib/admin';
import {
  formatAdminDate,
  formatAdminMoney,
} from '../../../lib/admin-format';

const filters = [
  '',
  'PROCESSED',
  'RECEIVED',
  'DUPLICATE_ORDER_PAID',
  'DUPLICATE_ORDER_CLAIMED',
  'REJECTED_AMOUNT',
  'REJECTED_ACCOUNT',
  'REJECTED_ORDER_CODE',
  'REJECTED_ORDER_NOT_FOUND',
  'REJECTED_EXPIRED',
  'REJECTED_ORDER_STATE',
  'REJECTED_DIRECTION',
  'FAILED',
];

// ADMIN_UI_REAL_V1
export default function AdminWebhooksPage() {
  const [processingStatus, setProcessingStatus] = useState('');
  const [rows, setRows] = useState<AdminWebhook[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (filter = processingStatus) => {
    setError(null);
    try {
      const payload = await getAdminWebhooks(filter || undefined, 100);
      setRows(payload.webhooks);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Không tải được webhooks.',
      );
    }
  }, [processingStatus]);

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
          <span className="eyebrow">WEBHOOKS</span>
          <h1>SePay webhook audit</h1>
          <p>
            Theo dõi processed, duplicate và business rejection mà không hiển thị
            secret API key.
          </p>
        </div>
        <button className="button secondary" type="button" onClick={() => void load()}>
          Làm mới
        </button>
      </header>

      <section className="admin-panel">
        <div className="admin-toolbar">
          <label>
            <span>Processing status</span>
            <select
              value={processingStatus}
              onChange={(event) => {
                const next = event.target.value;
                setProcessingStatus(next);
                void load(next);
              }}
            >
              {filters.map((item) => (
                <option key={item || 'ALL'} value={item}>
                  {item || 'Tất cả'}
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
                <th>External ID</th>
                <th>Status</th>
                <th>Order</th>
                <th>Amount</th>
                <th>Error</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="admin-user-cell">
                      <code>{row.externalId}</code>
                      <span>{row.provider}</span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`admin-chip ${
                        row.processingStatus.startsWith('REJECTED') ||
                        row.processingStatus === 'FAILED'
                          ? 'admin-chip-danger'
                          : row.processingStatus === 'PROCESSED'
                            ? 'admin-chip-pro'
                            : ''
                      }`}
                    >
                      {row.processingStatus}
                    </span>
                  </td>
                  <td>
                    {row.order ? (
                      <code>{row.order.orderCode}</code>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {row.order ? formatAdminMoney(row.order.amountVnd) : '—'}
                  </td>
                  <td>{row.errorReason ?? '—'}</td>
                  <td>{formatAdminDate(row.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
