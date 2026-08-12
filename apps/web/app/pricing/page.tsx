'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  createProPaymentOrder,
  formatVnd,
  getBillingPlans,
  type BillingPlan,
} from '../../lib/billing';
import {
  getAccountSubscription,
  type AccountSubscriptionResponse,
} from '../../lib/auth';
import {
  formatAccountDate,
  remainingEntitlementText,
} from '../../lib/commercial-account';

// USER_UI_FINAL_V1
export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [account, setAccount] = useState<AccountSubscriptionResponse | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const plansPayload = await getBillingPlans();
      setPlans(plansPayload.plans);

      try {
        const entitlement = await getAccountSubscription();
        setAccount(entitlement);
        setAuthenticated(true);
      } catch {
        setAccount(null);
        setAuthenticated(false);
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Không tải được bảng giá.',
      );
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

  async function buyPro(): Promise<void> {
    setCreating(true);
    setError(null);

    try {
      const payload = await createProPaymentOrder();
      router.push(`/checkout/${encodeURIComponent(payload.order.orderCode)}`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Không thể tạo đơn thanh toán.',
      );
      setCreating(false);
    }
  }

  const free = plans.find((plan) => plan.code === 'FREE');
  const pro = plans.find((plan) => plan.code === 'PRO');
  const activePro = account?.plan === 'PRO';

  return (
    <section className="billing-shell commercial-pricing-shell">
      <div className="page-heading billing-heading">
        <span className="eyebrow">PRICING</span>
        <h1>Chọn gói Football AI</h1>
        <p>
          Giá và thời hạn PRO luôn lấy từ máy chủ. Client không gửi số tiền
          thanh toán lên backend.
        </p>
      </div>

      {account ? (
        <div className="commercial-current-plan">
          <div>
            <span>Gói hiện tại</span>
            <strong>{account.plan}</strong>
          </div>
          <div>
            <span>Thời hạn PRO</span>
            <strong>
              {account.plan === 'PRO'
                ? remainingEntitlementText(account.proExpiresAt)
                : 'Chưa kích hoạt'}
            </strong>
            {account.proExpiresAt ? (
              <small>Đến {formatAccountDate(account.proExpiresAt)}</small>
            ) : null}
          </div>
          <Link href="/account/subscription">Chi tiết quyền sử dụng →</Link>
        </div>
      ) : null}

      {error ? (
        <div className="billing-alert billing-alert-error">
          <strong>Không thể tiếp tục:</strong> {error}{' '}
          <button
            type="button"
            className="commercial-link-button"
            onClick={() => void load()}
          >
            Thử lại
          </button>
        </div>
      ) : null}

      <div className="pricing-grid">
        <article className="pricing-card">
          <span className="pricing-badge">FREE</span>
          <h2>{free?.name ?? 'FREE'}</h2>
          <strong className="pricing-price">
            {loading ? '...' : formatVnd(free?.priceVnd ?? 0)}
          </strong>
          <p>Dùng các tính năng cơ bản với quota FREE của hệ thống.</p>
          <ul>
            <li>Tài khoản và lịch sử cá nhân</li>
            <li>Chat/phân tích cơ bản theo quota FREE</li>
            <li>Không yêu cầu thanh toán</li>
          </ul>
          <Link href="/account" className="button secondary billing-action">
            Xem tài khoản
          </Link>
        </article>

        <article className="pricing-card pricing-card-featured">
          <span className="pricing-badge">PRO</span>
          <h2>{pro?.name ?? 'PRO'}</h2>
          <strong className="pricing-price">
            {loading || !pro ? '...' : formatVnd(pro.priceVnd)}
          </strong>
          <p>
            {pro?.durationDays
              ? `${pro.durationDays} ngày cho mỗi lần thanh toán được xác nhận.`
              : 'Gói PRO của Football AI.'}
          </p>
          {pro && !pro.purchasable ? (
            <p className="billing-alert billing-alert-error">
              Thanh toán PRO đang tạm khóa cho đến khi cấu hình production được xác nhận.
            </p>
          ) : null}
          <ul>
            <li>Quota PRO cao hơn theo cấu hình máy chủ</li>
            <li>Advanced chat/analysis theo entitlement PRO</li>
            <li>Gia hạn nối tiếp nếu PRO hiện tại vẫn còn hạn</li>
            <li>Thanh toán VietQR với số tiền và nội dung do server tạo</li>
          </ul>

          {!authenticated ? (
            <Link href="/login" className="button primary billing-action">
              Đăng nhập để nâng cấp
            </Link>
          ) : (
            <button
              type="button"
              className="button primary billing-action"
              disabled={creating || loading || !pro?.purchasable}
              onClick={() => void buyPro()}
            >
              {creating
                ? 'Đang tạo đơn...'
                : activePro
                  ? 'Gia hạn PRO'
                  : 'Nâng cấp PRO'}
            </button>
          )}
        </article>
      </div>
    </section>
  );
}
