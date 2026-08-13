'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { getAccountSubscription, type AccountSubscriptionResponse } from '../../../lib/auth';
import {
  formatAccountDate,
  remainingEntitlementText,
  subscriptionStatusLabel,
} from '../../../lib/commercial-account';

// USER_UI_FINAL_V1
export default function AccountSubscriptionPage() {
  const [subscription, setSubscription] = useState<AccountSubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setSubscription(await getAccountSubscription());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được thông tin gói.');
    } finally {
      setLoading(false);
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

  if (loading && !subscription) {
    return <div className="auth-card">Đang tải quyền sử dụng...</div>;
  }

  if (error && !subscription) {
    return (
      <div className="auth-card">
        <span className="eyebrow">SUBSCRIPTION</span>
        <h1>Không tải được quyền sử dụng</h1>
        <p>{error}</p>
        <button type="button" className="button primary" onClick={() => void load()}>
          Thử lại
        </button>
      </div>
    );
  }

  if (!subscription) return null;

  const history = subscription.subscriptions ?? [];
  const isPro = subscription.plan === 'PRO';
  const isAdmin = subscription.role === 'ADMIN';

  return (
    <div className="auth-card commercial-account-page">
      <div className="commercial-account-heading">
        <div>
          <span className="eyebrow">SUBSCRIPTION</span>
          <h1>Quyền sử dụng {subscription.plan}</h1>
          <p>
            Trạng thái này được đồng bộ từ entitlement phía máy chủ, không lấy quyết định từ client.
          </p>
        </div>
        <span
          className={`commercial-plan-badge ${
            isPro ? 'commercial-plan-pro' : 'commercial-plan-free'
          }`}
        >
          {subscription.plan}
        </span>
      </div>

      <div className="commercial-stat-grid">
        <article>
          <span>Trạng thái tài khoản</span>
          <strong>{subscription.status}</strong>
        </article>
        <article>
          <span>PRO còn lại</span>
          <strong>
            {isPro ? remainingEntitlementText(subscription.proExpiresAt) : 'Chưa kích hoạt'}
          </strong>
        </article>
        <article>
          <span>PRO hết hạn lúc</span>
          <strong>{formatAccountDate(subscription.proExpiresAt)}</strong>
        </article>
        <article>
          <span>Advanced chat</span>
          <strong>{subscription.canAccessAdvancedChat ? 'Được phép' : 'Chưa có'}</strong>
        </article>
      </div>

      <div className="commercial-account-meta">
        <span>Email: {subscription.emailVerifiedAt ? 'Đã xác minh' : 'Chưa xác minh'}</span>
        <span>Role: {subscription.role}</span>
        <span>
          Trial:{' '}
          {subscription.trialStartedAt
            ? `${formatAccountDate(subscription.trialStartedAt)} → ${formatAccountDate(subscription.trialEndsAt)}`
            : subscription.trialUsed
              ? 'Đã sử dụng trước đây'
              : 'Chưa sử dụng'}
        </span>
        {subscription.forcePasswordChange ? (
          <span className="commercial-warning-text">Tài khoản cần đổi mật khẩu.</span>
        ) : null}
      </div>

      <div className="hero-actions commercial-account-actions">
        {isAdmin ? (
          <span className="button primary">ADMIN · PRO không thời hạn</span>
        ) : (
          <Link href="/pricing" className="button primary">
            {isPro ? 'Gia hạn PRO' : 'Nâng cấp PRO'}
          </Link>
        )}
        <Link href="/account/usage" className="button secondary">
          Xem quota
        </Link>
        <Link href="/account/billing" className="button secondary">
          Lịch sử thanh toán
        </Link>
      </div>

      <section className="commercial-history-section">
        <div className="commercial-section-heading">
          <div>
            <span className="eyebrow">HISTORY</span>
            <h2>Lịch sử subscription</h2>
          </div>
          <span>{history.length} bản ghi</span>
        </div>

        {history.length === 0 ? (
          <div className="empty-state">Chưa có lịch sử subscription.</div>
        ) : (
          <div className="table-scroll">
            <table className="billing-table commercial-table">
              <thead>
                <tr>
                  <th>Gói</th>
                  <th>Trạng thái</th>
                  <th>Bắt đầu</th>
                  <th>Hết hạn</th>
                  <th>Payment order</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.planCode}</strong>
                    </td>
                    <td>
                      <span
                        className={`commercial-sub-status commercial-sub-${row.status.toLowerCase()}`}
                      >
                        {subscriptionStatusLabel(row.status)}
                      </span>
                    </td>
                    <td>{formatAccountDate(row.startsAt)}</td>
                    <td>{formatAccountDate(row.expiresAt)}</td>
                    <td>{row.sourcePaymentOrderId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
