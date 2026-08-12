'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';

import {
  formatVnd,
  getBillingOrder,
  type BillingOrderResponse,
} from '../lib/billing';

function remainingText(expiresAt: string | null, now: number): string {
  if (!expiresAt) return 'Không xác định';
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return 'Đã hết hạn';
  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function statusLabel(status: string): string {
  if (status === 'PAID') return 'ĐÃ THANH TOÁN';
  if (status === 'EXPIRED') return 'ĐÃ HẾT HẠN';
  if (status === 'CANCELLED') return 'ĐÃ HỦY';
  return 'CHỜ THANH TOÁN';
}

// USER_UI_FINAL_V1
export function BillingCheckout({ orderCode }: { orderCode: string }) {
  const [payload, setPayload] = useState<BillingOrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState<string | null>(null);

  const status = payload?.order.status ?? null;

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load(): Promise<void> {
      try {
        const next = await getBillingOrder(orderCode);
        if (active) {
          setPayload(next);
          setError(null);
        }
      } catch (reason) {
        if (active) {
          setError(
            reason instanceof Error ? reason.message : 'Không tải được đơn hàng.',
          );
        }
      }
    }

    void load();

    if (status == null || status === 'PENDING') {
      timer = setInterval(() => {
        void load();
      }, 4000);
    }

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [orderCode, status]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const countdown = useMemo(
    () => remainingText(payload?.order.expiresAt ?? null, now),
    [payload?.order.expiresAt, now],
  );

  async function copy(value: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  if (error && !payload) {
    return (
      <section className="checkout-shell">
        <div className="billing-alert billing-alert-error">
          <strong>Không tải được checkout:</strong> {error}
        </div>
        <Link href="/pricing" className="button secondary">
          Quay lại Pricing
        </Link>
      </section>
    );
  }

  if (!payload) {
    return <div className="auth-card">Đang tải đơn thanh toán...</div>;
  }

  const { order, paymentInstructions: payment } = payload;
  const terminal = order.status !== 'PENDING';

  return (
    <section className="checkout-shell">
      <div className="checkout-header">
        <div>
          <span className="eyebrow">CHECKOUT</span>
          <h1>Thanh toán gói {order.planCode}</h1>
          <p>
            Quét VietQR hoặc chuyển khoản thủ công. Giữ nguyên chính xác số tiền
            và nội dung chuyển khoản.
          </p>
        </div>
        <div
          className={`checkout-status checkout-status-${order.status.toLowerCase()}`}
        >
          <span>{statusLabel(order.status)}</span>
          <strong>{order.status === 'PENDING' ? countdown : order.status}</strong>
        </div>
      </div>

      {order.status === 'PAID' ? (
        <div className="billing-alert billing-alert-success">
          <strong>Thanh toán đã được xác nhận.</strong> SePay webhook đã xử lý
          PaymentOrder và entitlement PRO. Bạn có thể kiểm tra ngay trong tài khoản.
          <div className="hero-actions">
            <Link href="/account/subscription" className="button primary">
              Xem quyền PRO
            </Link>
            <Link href="/account/usage" className="button secondary">
              Xem quota
            </Link>
          </div>
        </div>
      ) : null}

      {order.status === 'EXPIRED' ? (
        <div className="billing-alert billing-alert-error">
          <strong>Đơn hàng đã hết hạn.</strong> Không chuyển khoản theo QR này.
          Hãy tạo đơn mới từ trang Pricing.
        </div>
      ) : null}

      <div className="checkout-grid">
        <article className="checkout-qr-card">
          <span className="pricing-badge">VIETQR</span>
          {payment.qrUrl ? (
            <Image
              src={payment.qrUrl}
              alt={`VietQR cho đơn ${order.orderCode}`}
              className="checkout-qr-image"
              width={420}
              height={420}
              unoptimized
            />
          ) : (
            <div className="checkout-qr-placeholder">QR chưa khả dụng</div>
          )}
          <small>
            QR chứa sẵn số tiền và nội dung chuyển khoản của riêng đơn hàng này.
          </small>
        </article>

        <article className="checkout-detail-card">
          <div className="checkout-amount">
            <span>Số tiền</span>
            <strong>{formatVnd(order.amountVnd)}</strong>
          </div>
          <dl className="checkout-details">
            <div>
              <dt>Ngân hàng</dt>
              <dd>{payment.bankName}</dd>
            </div>
            <div>
              <dt>Chủ tài khoản</dt>
              <dd>{payment.accountName}</dd>
            </div>
            <div>
              <dt>Số tài khoản</dt>
              <dd>
                <code>{payment.accountNo}</code>
                <button
                  type="button"
                  onClick={() => void copy(payment.accountNo, 'account')}
                  disabled={terminal}
                >
                  {copied === 'account' ? 'Đã copy' : 'Copy'}
                </button>
              </dd>
            </div>
            <div>
              <dt>Nội dung chuyển khoản</dt>
              <dd>
                <code>{payment.transferContent}</code>
                <button
                  type="button"
                  onClick={() => void copy(payment.transferContent, 'content')}
                  disabled={terminal}
                >
                  {copied === 'content' ? 'Đã copy' : 'Copy'}
                </button>
              </dd>
            </div>
            <div>
              <dt>Mã đơn</dt>
              <dd>
                <code>{order.orderCode}</code>
                <button
                  type="button"
                  onClick={() => void copy(order.orderCode, 'order')}
                >
                  {copied === 'order' ? 'Đã copy' : 'Copy'}
                </button>
              </dd>
            </div>
            <div>
              <dt>Trạng thái</dt>
              <dd>{statusLabel(order.status)}</dd>
            </div>
          </dl>

          <div className="checkout-note">
            <strong>Tự động xác nhận:</strong> checkout polling trạng thái
            PaymentOrder. Khi SePay webhook xác nhận đúng tài khoản, số tiền và
            orderCode, backend chuyển đơn sang PAID và cập nhật PRO.
          </div>

          <div className="hero-actions">
            {order.status === 'EXPIRED' || order.status === 'CANCELLED' ? (
              <Link href="/pricing" className="button primary">
                Tạo đơn mới
              </Link>
            ) : null}
            <Link href="/account/billing" className="button secondary">
              Lịch sử thanh toán
            </Link>
          </div>
        </article>
      </div>
    </section>
  );
}
