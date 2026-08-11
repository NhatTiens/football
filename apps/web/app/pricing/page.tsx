'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  createProPaymentOrder,
  formatVnd,
  getBillingPlans,
  type BillingPlan,
} from '../../lib/billing';

export default function PricingPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void getBillingPlans()
      .then((payload) => {
        if (active) setPlans(payload.plans);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : 'Không tải được bảng giá.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function buyPro(): Promise<void> {
    setCreating(true);
    setError(null);

    try {
      const payload = await createProPaymentOrder();
      router.push(`/checkout/${encodeURIComponent(payload.order.orderCode)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tạo đơn thanh toán.');
      setCreating(false);
    }
  }

  const free = plans.find((plan) => plan.code === 'FREE');
  const pro = plans.find((plan) => plan.code === 'PRO');

  return (
    <section className="billing-shell">
      <div className="page-heading billing-heading">
        <span className="eyebrow">PRICING</span>
        <h1>Chọn gói Football AI</h1>
        <p>
          Giá và thời hạn PRO được xác định ở máy chủ. Thanh toán qua chuyển khoản
          ngân hàng bằng VietQR.
        </p>
      </div>

      {error ? (
        <div className="billing-alert billing-alert-error">
          <strong>Không thể tiếp tục:</strong> {error}{' '}
          {error.toLowerCase().includes('authentication') ? (
            <Link href="/login">Đăng nhập</Link>
          ) : null}
        </div>
      ) : null}

      <div className="pricing-grid">
        <article className="pricing-card">
          <span className="pricing-badge">FREE</span>
          <h2>{free?.name ?? 'FREE'}</h2>
          <strong className="pricing-price">
            {loading ? '...' : formatVnd(free?.priceVnd ?? 0)}
          </strong>
          <p>Dùng các tính năng cơ bản và quota miễn phí của hệ thống.</p>
          <ul>
            <li>Tài khoản và lịch sử cá nhân</li>
            <li>Quota phân tích cơ bản</li>
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
              ? `Kích hoạt PRO trong ${pro.durationDays} ngày sau khi thanh toán được xác nhận.`
              : 'Gói PRO của Football AI.'}
          </p>
          <ul>
            <li>Quota PRO cao hơn</li>
            <li>Advanced analysis/chat theo entitlement</li>
            <li>Thanh toán VietQR bằng đúng số tiền và nội dung đơn hàng</li>
          </ul>
          <button
            type="button"
            className="button primary billing-action"
            disabled={creating || loading || !pro}
            onClick={() => void buyPro()}
          >
            {creating ? 'Đang tạo đơn...' : 'Nâng cấp PRO'}
          </button>
        </article>
      </div>
    </section>
  );
}
