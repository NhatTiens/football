'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { getAuthMe, logoutAuth, type AuthMeResponse } from '../lib/auth';

const GUEST: AuthMeResponse = {
  authenticated: false,
  user: null,
  session: null,
  permissions: { chat: false, advancedChat: false, roleManagement: false },
};

export function Header() {
  const [auth, setAuth] = useState<AuthMeResponse>(GUEST);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        const payload = await getAuthMe();
        if (active) setAuth(payload);
      } catch {
        if (active) setAuth(GUEST);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  async function handleLogout(): Promise<void> {
    await logoutAuth().catch(() => undefined);
    setAuth(GUEST);
  }

  const isAdmin = Boolean(auth.authenticated && auth.user?.role === 'ADMIN');
  const isPro = Boolean(auth.authenticated && auth.user?.plan === 'PRO');
const canAccessBacktest = Boolean(
  auth.authenticated &&
    (auth.user?.role === 'ANALYST' || auth.user?.role === 'ADMIN'),
);

  return (
    <header className="site-header pcr-header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">FA</span>
          <span>
            <strong>Football AI</strong>
            <small>{loading ? 'Loading account...' : isAdmin ? 'Admin console' : auth.authenticated ? 'Member console' : 'Guest console'}</small>
          </span>
        </Link>

        <nav className="navigation pcr-navigation" aria-label="Điều hướng chính">
          <Link href="/">Tổng quan</Link>
          <Link href="/predictions">Dự đoán</Link>
          {canAccessBacktest ? <Link href="/backtest">Đánh giá mô hình</Link> : null}
          <Link href="/matches">Trận đấu</Link>
          <Link href="/history">Lịch sử</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/account">Account</Link>
          {isAdmin ? <Link href="/admin">Admin</Link> : null}
          {!auth.authenticated ? (
            <>
              <Link href="/login">Login</Link>
              <Link href="/register">Register</Link>
            </>
          ) : (
            <button type="button" className="header-logout" onClick={() => void handleLogout()}>
              Logout{isPro ? ' · PRO' : ''}
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
