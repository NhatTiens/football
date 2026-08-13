'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createProPaymentOrder,
  formatVnd,
  getBillingPlans,
  validateCoupon,
  type BillingPlan,
  type BillingPlansResponse,
  type PricingQuote,
} from '../../lib/billing';
import { getAccountSubscription, type AccountSubscriptionResponse } from '../../lib/auth';
import { formatAccountDate, remainingEntitlementText } from '../../lib/commercial-account';

function durationText(plan: BillingPlan): string {
  return `${plan.durationCount} ${plan.durationUnit === 'MONTH' ? 'tháng' : 'ngày'}`;
}

function promotionEnd(value: string | null): string | null {
  if (!value) return null;
  // Backend stores an exclusive end instant; show the inclusive business date.
  const inclusiveInstant = new Date(new Date(value).getTime() - 1);
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(inclusiveInstant);
}

export default function PricingPage() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<BillingPlansResponse | null>(null);
  const [account, setAccount] = useState<AccountSubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [creatingPlanId, setCreatingPlanId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponPlanId, setCouponPlanId] = useState<number | null>(null);
  const [couponQuote, setCouponQuote] = useState<PricingQuote | null>(null);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const plansPayload = await getBillingPlans();
      setCatalog(plansPayload);
      const firstPurchasable = plansPayload.plans.find((plan) => plan.purchasable);
      setCouponPlanId((current) => current ?? firstPurchasable?.id ?? null);
      try {
        setAccount(await getAccountSubscription());
      } catch {
        setAccount(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được bảng giá.');
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

  const purchasablePlans = useMemo(
    () => catalog?.plans.filter((plan) => plan.purchasable) ?? [],
    [catalog],
  );
  const monthly = catalog?.plans.find((plan) => plan.code === 'PRO_MONTHLY') ?? null;
  const sixMonths = catalog?.plans.find((plan) => plan.code === 'PRO_6_MONTH') ?? null;
  const authenticated = account != null;
  const adminPermanentPro = account?.role === 'ADMIN';
  const sixMonthPromotionActive = sixMonths?.promotion?.code === 'PRO_6_MONTH_PROMO';

  function displayedPrice(
    plan: BillingPlan,
  ): Pick<
    PricingQuote,
    'basePrice' | 'discountAmount' | 'finalPrice' | 'promotion' | 'promotionCode'
  > {
    if (couponQuote?.plan.id === plan.id) return couponQuote;
    return plan;
  }

  async function applyCoupon(): Promise<void> {
    if (!couponPlanId || !couponCode.trim()) {
      setCouponMessage('Hãy chọn gói và nhập mã khuyến mãi.');
      return;
    }
    if (!authenticated) {
      setCouponMessage('Đăng nhập để backend kiểm tra điều kiện của coupon.');
      return;
    }
    setCheckingCoupon(true);
    setCouponMessage(null);
    try {
      const result = await validateCoupon({
        planId: couponPlanId,
        promotionCode: couponCode.trim().toUpperCase(),
      });
      if (!result.valid) {
        setCouponQuote(null);
        setCouponMessage(`Mã không hợp lệ: ${result.coupon?.reason ?? 'NOT_FOUND'}.`);
        return;
      }
      setCouponQuote(result.quote);
      setCouponMessage(
        `Đã áp dụng ${result.quote.promotion?.name ?? couponCode.trim().toUpperCase()}.`,
      );
    } catch (reason) {
      setCouponQuote(null);
      setCouponMessage(reason instanceof Error ? reason.message : 'Không kiểm tra được coupon.');
    } finally {
      setCheckingCoupon(false);
    }
  }

  async function buy(plan: BillingPlan): Promise<void> {
    setCreatingPlanId(plan.id);
    setError(null);
    try {
      const appliedCode = couponQuote?.plan.id === plan.id ? couponCode.trim().toUpperCase() : null;
      const payload = await createProPaymentOrder({
        planId: plan.id,
        promotionCode: appliedCode || null,
      });
      router.push(`/checkout/${encodeURIComponent(payload.order.orderCode)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tạo đơn thanh toán.');
      setCreatingPlanId(null);
    }
  }

  function cta(plan: BillingPlan, enabled = true) {
    if (adminPermanentPro)
      return <span className="button primary billing-action">ADMIN · PRO không thời hạn</span>;
    if (!authenticated)
      return (
        <Link href="/login" className="button primary billing-action">
          Đăng nhập để nâng cấp
        </Link>
      );
    return (
      <button
        type="button"
        className="button primary billing-action"
        disabled={creatingPlanId != null || loading || !catalog?.billingAvailable || !enabled}
        onClick={() => void buy(plan)}
      >
        {creatingPlanId === plan.id
          ? 'Đang tạo đơn...'
          : account?.plan === 'PRO'
            ? 'Gia hạn Pro'
            : 'Nâng cấp Pro'}
      </button>
    );
  }

  return (
    <section className="billing-shell commercial-pricing-shell">
      <div className="page-heading billing-heading">
        <span className="eyebrow">PRICING · SERVER VERIFIED</span>
        <h1>Chọn gói Prediction AI</h1>
        <p>
          Giá, điều kiện và promotion đều do backend tính. Trình duyệt chỉ hiển thị báo giá đã xác
          nhận.
        </p>
      </div>

      {account ? (
        <div className="commercial-current-plan">
          <div>
            <span>Gói hiện tại</span>
            <strong>{account.plan}</strong>
          </div>
          <div>
            <span>Thời hạn quyền Pro</span>
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
          <strong>Không thể tiếp tục:</strong> {error}
        </div>
      ) : null}
      {catalog && !catalog.billingAvailable ? (
        <div className="billing-alert billing-alert-error">
          Thanh toán đang tạm khóa: {catalog.billingUnavailableReason}.
        </div>
      ) : null}

      <div className="pricing-grid pricing-grid-three">
        <article className="pricing-card">
          <span className="pricing-badge">FREE TRIAL</span>
          <h2>7 ngày miễn phí</h2>
          <strong className="pricing-price">0 ₫</strong>
          <p>Mỗi danh tính email chỉ nhận trial một lần. Việc tạo lại account không reset trial.</p>
          <ul>
            <li>Quyền Pro trong đủ {catalog?.trial.days ?? 7} ngày</li>
            <li>Tự kích hoạt khi đăng ký lần đầu</li>
            <li>Không tự động gia hạn hoặc charge</li>
          </ul>
          <Link
            href={authenticated ? '/account/subscription' : '/register'}
            className="button secondary billing-action"
          >
            {authenticated ? 'Xem trạng thái trial' : 'Đăng ký dùng thử'}
          </Link>
        </article>

        <article className="pricing-card pricing-card-featured">
          <span className="pricing-badge">PRO MONTHLY</span>
          <h2>{monthly?.name ?? 'Pro Monthly'}</h2>
          {monthly ? (
            (() => {
              const price = displayedPrice(monthly);
              return (
                <>
                  {price.discountAmount > 0 ? (
                    <span className="pricing-original">{formatVnd(price.basePrice)}</span>
                  ) : null}
                  <strong className="pricing-price">{formatVnd(price.finalPrice)}</strong>
                  <p>
                    {price.promotion?.code === 'PRO_FIRST_PURCHASE'
                      ? 'Lần nâng cấp Pro đầu tiên.'
                      : 'Giá chuẩn theo tháng.'}
                  </p>
                </>
              );
            })()
          ) : (
            <strong className="pricing-price">...</strong>
          )}
          <ul>
            <li>Thời hạn {monthly ? durationText(monthly) : '1 tháng'}</li>
            <li>Ưu đãi lần mua đầu chỉ hiện khi backend xác nhận đủ điều kiện</li>
            <li>
              Giá mua/gia hạn chuẩn:{' '}
              {monthly ? `${formatVnd(monthly.basePrice)} / tháng` : 'đang tải'}
            </li>
          </ul>
          {monthly ? cta(monthly) : null}
        </article>

        <article className="pricing-card">
          <span className="pricing-badge">6 MONTHS</span>
          <h2>{sixMonths?.name ?? 'Pro 6 Months'}</h2>
          {sixMonths && sixMonthPromotionActive ? (
            (() => {
              const price = displayedPrice(sixMonths);
              return (
                <>
                  <span className="pricing-original">{formatVnd(price.basePrice)}</span>
                  <strong className="pricing-price">{formatVnd(price.finalPrice)}</strong>
                  <p>
                    <strong>
                      {formatVnd(Math.round(price.finalPrice / sixMonths.durationCount))}/tháng
                    </strong>{' '}
                    · {sixMonths.durationCount} tháng = {formatVnd(price.finalPrice)}
                  </p>
                  <small>
                    Khuyến mãi đến hết {promotionEnd(sixMonths.promotionExpiresAt)} theo giờ Việt
                    Nam.
                  </small>
                </>
              );
            })()
          ) : (
            <>
              <strong className="pricing-price">Khuyến mãi đã kết thúc</strong>
              <p>Promotion đã hết hạn. Giá renewal mới do backend tính theo gói tháng hiện tại.</p>
            </>
          )}
          <ul>
            <li>Subscription đã mua giữ đủ 6 tháng</li>
            <li>Promotion hết hạn không cắt quyền đang active</li>
            <li>Renewal mới được backend tính theo giá tại thời điểm renewal</li>
          </ul>
          {sixMonths ? cta(sixMonths, Boolean(sixMonthPromotionActive)) : null}
        </article>
      </div>

      <section className="pricing-coupon-panel">
        <div>
          <span className="eyebrow">COUPON</span>
          <h2>Nhập mã khuyến mãi</h2>
          <p>
            Coupon được kiểm tra theo user, plan, thời gian, priority và giới hạn sử dụng trên
            backend.
          </p>
        </div>
        <div className="pricing-coupon-form">
          <select
            value={couponPlanId ?? ''}
            onChange={(event) => {
              setCouponPlanId(Number(event.target.value));
              setCouponQuote(null);
            }}
          >
            {purchasablePlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
          <input
            value={couponCode}
            onChange={(event) => {
              setCouponCode(event.target.value.toUpperCase());
              setCouponQuote(null);
            }}
            placeholder="WELCOME"
            maxLength={64}
          />
          <button
            type="button"
            className="button secondary"
            disabled={checkingCoupon}
            onClick={() => void applyCoupon()}
          >
            {checkingCoupon ? 'Đang kiểm tra...' : 'Áp dụng'}
          </button>
        </div>
        {couponMessage ? (
          <div
            className={
              couponQuote
                ? 'billing-alert billing-alert-success'
                : 'billing-alert billing-alert-error'
            }
          >
            {couponMessage}
          </div>
        ) : null}
      </section>

      {catalog ? (
        <small className="pricing-source-note">
          Nguồn giá: {catalog.engineVersion} · server time {formatAccountDate(catalog.serverTime)} ·
          timezone {catalog.timezone}
        </small>
      ) : null}
    </section>
  );
}
