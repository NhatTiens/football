'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  getAccountSubscription,
  getAccountUsage,
  type AccountSubscriptionResponse,
  type AccountUsageFeature,
  type AccountUsageResponse,
} from '../../../lib/auth';
import {
  formatAccountDate,
  quotaPercent,
  quotaValue,
} from '../../../lib/commercial-account';

function FeatureUsage({
  title,
  feature,
}: {
  title: string;
  feature: AccountUsageFeature;
}) {
  const percent = quotaPercent(feature.used, feature.limit);
  const unavailable = feature.limit === 0;

  return (
    <article className="commercial-usage-card">
      <div className="commercial-usage-title">
        <h2>{title}</h2>
        <span>{unavailable ? 'Không khả dụng' : `${feature.used} đã dùng`}</span>
      </div>
      <div className="commercial-usage-numbers">
        <strong>{quotaValue(feature.remaining)}</strong>
        <span>còn lại / {quotaValue(feature.limit)}</span>
      </div>
      {percent == null ? (
        <div className="commercial-unlimited">Không giới hạn theo cấu hình hiện tại</div>
      ) : (
        <div
          className="commercial-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      )}
      <small>Reset: {formatAccountDate(feature.resetAt)}</small>
    </article>
  );
}

// USER_UI_FINAL_V1
export default function AccountUsagePage() {
  const [usage, setUsage] = useState<AccountUsageResponse | null>(null);
  const [subscription, setSubscription] =
    useState<AccountSubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [usagePayload, subscriptionPayload] = await Promise.all([
        getAccountUsage(),
        getAccountSubscription(),
      ]);
      setUsage(usagePayload);
      setSubscription(subscriptionPayload);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Không tải được quota.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !usage) {
    return <div className="auth-card">Đang tải quota...</div>;
  }

  if (error && !usage) {
    return (
      <div className="auth-card">
        <span className="eyebrow">USAGE</span>
        <h1>Không tải được quota</h1>
        <p>{error}</p>
        <button type="button" className="button primary" onClick={() => void load()}>
          Thử lại
        </button>
      </div>
    );
  }

  if (!usage) return null;

  const totalPercent = quotaPercent(usage.quotaUsed, usage.quotaLimit);

  return (
    <div className="auth-card commercial-account-page">
      <div className="commercial-account-heading">
        <div>
          <span className="eyebrow">USAGE</span>
          <h1>Quota hằng ngày</h1>
          <p>
            Quota được tính tại backend theo gói{' '}
            <strong>{subscription?.plan ?? '—'}</strong>.
          </p>
        </div>
        <Link href="/pricing" className="button primary">
          {subscription?.plan === 'PRO' ? 'Gia hạn PRO' : 'Nâng cấp PRO'}
        </Link>
      </div>

      <div className="commercial-quota-summary">
        <div>
          <span>Đã dùng</span>
          <strong>{quotaValue(usage.quotaUsed)}</strong>
        </div>
        <div>
          <span>Giới hạn</span>
          <strong>{quotaValue(usage.quotaLimit)}</strong>
        </div>
        <div>
          <span>Còn lại</span>
          <strong>{quotaValue(usage.quotaRemaining)}</strong>
        </div>
        <div>
          <span>Reset</span>
          <strong>{formatAccountDate(usage.resetAt)}</strong>
        </div>
      </div>

      {totalPercent != null ? (
        <div className="commercial-total-progress">
          <div>
            <span>Tổng quota đã sử dụng</span>
            <strong>{totalPercent}%</strong>
          </div>
          <div className="commercial-progress">
            <span style={{ width: `${totalPercent}%` }} />
          </div>
        </div>
      ) : null}

      <div className="commercial-usage-grid">
        <FeatureUsage title="Basic chat / analysis" feature={usage.features.basic} />
        <FeatureUsage
          title="Advanced chat / analysis"
          feature={usage.features.advanced}
        />
      </div>

      <div className="hero-actions commercial-account-actions">
        <Link href="/account/subscription" className="button secondary">
          Quyền sử dụng
        </Link>
        <Link href="/account/billing" className="button secondary">
          Thanh toán
        </Link>
      </div>
    </div>
  );
}
