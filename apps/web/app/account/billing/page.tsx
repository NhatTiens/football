'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  formatVnd,
  getAccountPayments,
  type BillingOrder,
} from '../../../lib/billing';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function AccountBillingPage() {
  const [payments, setPayments] = useState<BillingOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void getAccountPayments(50)
      .then((payload) => {
        if (active) setPayments(payload.payments);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Không tải được lịch sử thanh toán.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="auth-card billing-history-card">
      <span className="eyebrow">BILLING</span>
      <div className="billing-history-heading">
        <div>
          <h1>Lịch sử thanh toán</h1>
          <p>Các đơn thanh toán thuộc tài khoản hiện tại.</p>
        </div>
        <Link href="/pricing" className="button primary">
          Nâng cấp PRO
        </Link>
      </div>

      {error ? <div className="billing-alert billing-alert-error">{error}</div> : null}

      {loading ? <p>Đang tải...</p> : null}

      {!loading && payments.length === 0 ? (
        <div className="empty-state">Chưa có đơn thanh toán.</div>
      ) : null}

      {payments.length > 0 ? (
        <div className="table-scroll">
          <table className="billing-table">
            <thead>
              <tr>
                <th>Mã đơn</th>
                <th>Gói</th>
                <th>Số tiền</th>
                <th>Trạng thái</th>
                <th>Tạo lúc</th>
                <th>Thanh toán</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id}>
                  <td><code>{payment.orderCode}</code></td>
                  <td>{payment.planCode}</td>
                  <td>{formatVnd(payment.amountVnd)}</td>
                  <td>
                    <span className={`billing-status billing-status-${payment.status.toLowerCase()}`}>
                      {payment.status}
                    </span>
                  </td>
                  <td>{formatDate(payment.createdAt)}</td>
                  <td>{formatDate(payment.paidAt)}</td>
                  <td>
                    <Link href={`/checkout/${encodeURIComponent(payment.orderCode)}`}>
                      Xem
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
