'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  getAdminDashboard,
  type AdminDashboard,
} from '../../lib/admin';
import {
  adminPaymentLabel,
  formatAdminDate,
  formatAdminMoney,
} from '../../lib/admin-format';

// ADMIN_UI_REAL_V1
export default function AdminPage() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDashboard(await getAdminDashboard());
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Không tải được dashboard.',
      );
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

  if (!dashboard && !error) {
    return <div className="admin-panel">Đang tải dashboard...</div>;
  }

  if (!dashboard) {
    return (
      <div className="admin-panel">
        <h1>Admin Dashboard</h1>
        <p className="admin-error">{error}</p>
        <button className="button primary" type="button" onClick={() => void load()}>
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <header className="admin-page-heading">
        <div>
          <span className="eyebrow">ADMIN DASHBOARD</span>
          <h1>Vận hành thương mại</h1>
          <p>
            Dữ liệu trực tiếp từ AuthUser, PaymentOrder, Subscription và
            PaymentWebhookEvent.
          </p>
        </div>
        <button className="button secondary" type="button" onClick={() => void load()}>
          Làm mới
        </button>
      </header>

      {error ? <div className="admin-error-banner">{error}</div> : null}

      <div className="admin-kpi-grid">
        <article>
          <span>Người dùng</span>
          <strong>{dashboard.totalUsers}</strong>
          <small>{dashboard.verifiedUsers} đã xác minh</small>
        </article>
        <article>
          <span>PRO đang hiệu lực</span>
          <strong>{dashboard.activeProUsers}</strong>
          <small>{dashboard.proUsers} tài khoản plan PRO</small>
        </article>
        <article>
          <span>Doanh thu hôm nay</span>
          <strong>{formatAdminMoney(dashboard.revenueToday)}</strong>
          <small>{dashboard.paidOrders} đơn PAID tổng cộng</small>
        </article>
        <article>
          <span>Doanh thu 30 ngày</span>
          <strong>{formatAdminMoney(dashboard.revenue30d)}</strong>
          <small>7 ngày: {formatAdminMoney(dashboard.revenue7d)}</small>
        </article>
        <article>
          <span>Đơn đang chờ</span>
          <strong>{dashboard.pendingOrders}</strong>
          <small>{dashboard.expiredOrders} đã hết hạn</small>
        </article>
        <article>
          <span>Webhook cần chú ý</span>
          <strong>{dashboard.failedWebhookCount}</strong>
          <small>Rejected / failed events</small>
        </article>
        <article>
          <span>User mới hôm nay</span>
          <strong>{dashboard.newUsersToday}</strong>
          <small>{dashboard.newUsers7d} trong 7 ngày</small>
        </article>
        <article>
          <span>System</span>
          <strong>
            {dashboard.systemHealth.api === 'ok' &&
            dashboard.systemHealth.db === 'ok'
              ? 'OK'
              : 'CHECK'}
          </strong>
          <small>
            API {dashboard.systemHealth.api} · DB {dashboard.systemHealth.db}
          </small>
        </article>
      </div>

      <div className="admin-two-column">
        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <span className="eyebrow">PAYMENTS</span>
              <h2>Thanh toán gần đây</h2>
            </div>
            <Link href="/admin/payments">Xem tất cả →</Link>
          </div>

          {dashboard.recentPayments.length === 0 ? (
            <div className="empty-state">Chưa có payment gần đây.</div>
          ) : (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>User</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.recentPayments.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <code>{row.orderCode}</code>
                      </td>
                      <td>{row.user?.email ?? `#${row.userId ?? '—'}`}</td>
                      <td>{formatAdminMoney(row.amountVnd)}</td>
                      <td>
                        <span
                          className={`admin-chip admin-chip-${row.status.toLowerCase()}`}
                        >
                          {adminPaymentLabel(row.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="admin-panel">
          <div className="admin-panel-heading">
            <div>
              <span className="eyebrow">USERS</span>
              <h2>User gần đây</h2>
            </div>
            <Link href="/admin/users">Quản lý →</Link>
          </div>

          <div className="admin-compact-list">
            {dashboard.recentUsers.map((user) => (
              <div key={user.id}>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </div>
                <div className="admin-compact-meta">
                  <span>{user.role}</span>
                  <span>{user.plan}</span>
                  <span>{formatAdminDate(user.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
