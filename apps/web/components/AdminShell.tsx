'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';

import { getAuthMe } from '../lib/auth';

const items = [
  { href: '/admin', label: 'Tổng quan', exact: true },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/payments', label: 'Payments' },
  { href: '/admin/subscriptions', label: 'Subscriptions' },
  { href: '/admin/webhooks', label: 'Webhooks' },
  { href: '/admin/audit', label: 'Audit' },
  { href: '/admin/system', label: 'System' },
];

// ADMIN_UI_REAL_V1
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<'loading' | 'allowed' | 'denied'>('loading');
  const [name, setName] = useState('');

  useEffect(() => {
    let active = true;

    void getAuthMe()
      .then((payload) => {
        if (!active) return;

        if (
          payload.authenticated &&
          payload.user?.role === 'ADMIN' &&
          payload.user.status === 'ACTIVE'
        ) {
          setName(payload.user.name || payload.user.email);
          setState('allowed');
        } else {
          setState('denied');
        }
      })
      .catch(() => {
        if (active) setState('denied');
      });

    return () => {
      active = false;
    };
  }, []);

  if (state === 'loading') {
    return <div className="auth-card">Đang xác minh quyền ADMIN...</div>;
  }

  if (state === 'denied') {
    return (
      <div className="auth-card admin-access-denied">
        <span className="eyebrow">ADMIN</span>
        <h1>Không có quyền truy cập</h1>
        <p>Trang này chỉ dành cho tài khoản có role ADMIN đang hoạt động.</p>
        <Link href="/login" className="button primary">
          Đăng nhập
        </Link>
      </div>
    );
  }

  return (
    <section className="admin-ui-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          <span className="eyebrow">CONTROL PLANE</span>
          <strong>Football AI Admin</strong>
          <small>{name}</small>
        </div>

        <nav className="admin-nav" aria-label="Admin navigation">
          {items.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? 'admin-nav-active' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar-note">
          <strong>ADMIN · PRO</strong>
          <span>Tài khoản ADMIN luôn có quyền PRO không thời hạn.</span>
        </div>
      </aside>

      <div className="admin-content">{children}</div>
    </section>
  );
}
