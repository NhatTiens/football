'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  formatVnd,
  getAccountPayments,
  type BillingOrder,
} from '../../../lib/billing';
import {
  getAccountSubscription,
  type AccountSubscriptionResponse,
} from '../../../lib/auth';
import {
  billingStatusLabel,
  formatAccountDate,
  remainingEntitlementText,
} from '../../../lib/commercial-account';

// USER_UI_FINAL_V1
export default function AccountBillingPage() {
  const [payments, setPayments] = useState<BillingOrder[]>([]);
  const [subscription, setSubscription] =
    useState<AccountSubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [paymentPayload, entitlement] = await Promise.all([
        getAccountPayments(50),
        getAccountSubscription(),
      ]);
      setPayments(paymentPayload.payments);
      setSubscription(entitlement);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Không tải được lịch sử thanh toán.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(
    () => ({
      paid: payments.filter((row) => row.status === 'PAID').length,
      pending: payments.filter((row) => row.status === 'PENDING').length,
      totalPaid: payments
        .filter((row) => row.status === 'PAID')
        .reduce((sum, row) => sum + row.amountVnd, 0),
    }),
    [payments],
  );

  const latestPending = payments.find((row) => row.status === 'PENDING') ?? null;

  return (
    <div className="auth-card billing-history-card commercial-account-page">
      <div className="commercial-account-heading">
        <div>
          <span className="eyebrow">BILLING</span>
          <h1>Thanh toán &amp; gia hạn</h1>
          <p>Lịch sử PaymentOrder thuộc đúng tài khoản đang đăng nhập.</p>
        </div>
        <Link href="/pricing" className="button primary">
          {subscription?.plan === 'PRO' ? 'Gia hạn PRO' : 'Nâng cấp PRO'}
        </Link>
      </div>

      {subscription ? (
        <div className="commercial-current-plan commercial-billing-plan">
          <div>
            <span>Gói hiện tại</span>
            <strong>{subscription.plan}</strong>
          </div>
          <div>
            <span>PRO còn lại</span>
            <strong>
              {subscription.plan === 'PRO'
                ? remainingEntitlementText(subscription.proExpiresAt)
                : 'Chưa kích hoạt'}
            </strong>
          </div>
          <Link href="/account/subscription">Xem entitlement →</Link>
        </div>
      ) : null}

      {latestPending ? (
        <div className="billing-alert commercial-pending-order">
          <div>
            <strong>Có đơn đang chờ thanh toán</strong>
            <span>
              {latestPending.orderCode} · {formatVnd(latestPending.amountVnd)}
            </span>
          </div>
          <Link
            href={`/checkout/${encodeURIComponent(latestPending.orderCode)}`}
            className="button primary"
          >
            Tiếp tục thanh toán
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="billing-alert billing-alert-error">
          {error}{' '}
          <button
            type="button"
            className="commercial-link-button"
            onClick={() => void load()}
          >
            Thử lại
          </button>
        </div>
      ) : null}

      <div className="commercial-stat-grid commercial-billing-stats">
        <article>
          <span>Đã thanh toán</span>
          <strong>{summary.paid}</strong>
        </article>
        <article>
          <span>Đang chờ</span>
          <strong>{summary.pending}</strong>
        </article>
        <article>
          <span>Tổng đã xác nhận</span>
          <strong>{formatVnd(summary.totalPaid)}</strong>
        </article>
        <article>
          <span>Tổng đơn</span>
          <strong>{payments.length}</strong>
        </article>
      </div>

      {loading ? <p>Đang tải...</p> : null}

      {!loading && payments.length === 0 ? (
        <div className="empty-state">
          Chưa có đơn thanh toán.{' '}
          <Link href="/pricing">Xem gói PRO</Link>
        </div>
      ) : null}

      {payments.length > 0 ? (
        <div className="table-scroll">
          <table className="billing-table commercial-table">
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
                  <td>
                    <code>{payment.orderCode}</code>
                  </td>
                  <td>{payment.planCode}</td>
                  <td>{formatVnd(payment.amountVnd)}</td>
                  <td>
                    <span
                      className={`billing-status billing-status-${payment.status.toLowerCase()}`}
                    >
                      {billingStatusLabel(payment.status)}
                    </span>
                  </td>
                  <td>{formatAccountDate(payment.createdAt)}</td>
                  <td>{formatAccountDate(payment.paidAt)}</td>
                  <td>
                    <Link
                      href={`/checkout/${encodeURIComponent(payment.orderCode)}`}
                    >
                      {payment.status === 'PENDING' ? 'Thanh toán' : 'Xem'}
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
