'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  listAuthUsers,
  logoutAuth,
  getAuthMe,
  updateAuthUserRole,
  type AdminAuthUser,
  type AuthMeResponse,
  type AuthRole,
} from '../lib/auth';

function timeLabel(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AuthPanel() {
  const router = useRouter();
  const [me, setMe] = useState<AuthMeResponse | null>(null);
  const [users, setUsers] = useState<AdminAuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load(): Promise<void> {
      try {
        const auth = await getAuthMe();
        if (!active) return;
        setMe(auth);
        if (auth.permissions.roleManagement) {
          const payload = await listAuthUsers();
          if (active) setUsers(payload.users);
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Unable to load account.');
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
    router.push('/login');
    router.refresh();
  }

  async function changeRole(userId: number, role: AuthRole): Promise<void> {
    setSavingId(userId);
    setMessage(null);
    try {
      const payload = await updateAuthUserRole({ userId, role });
      setUsers((current) => current.map((user) => (user.id === userId ? payload.user : user)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Role update failed.');
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <section className="auth-shell"><div className="auth-card">Loading account...</div></section>;
  }

  if (!me?.authenticated || !me.user) {
    return (
      <section className="auth-shell">
        <div className="auth-card">
          <span className="eyebrow">ACCOUNT</span>
          <h1>Sign in required</h1>
          <p>Use the chatbot after login.</p>
          <div className="auth-actions">
            <Link className="button primary" href="/login">Sign in</Link>
            <Link className="button secondary" href="/register">Create account</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-shell">
      <div className="auth-card">
        <span className="eyebrow">ACCOUNT</span>
        <h1>{me.user.name}</h1>
        <p>{me.user.email}</p>
        <div className="auth-meta">
          <span>Role: {me.user.role}</span>
          <span>Plan: {me.user.plan}</span>
          <span>Status: {me.user.status}</span>
          <span>Verified: {me.user.emailVerifiedAt ? 'Yes' : 'No'}</span>
          <span>Session: {timeLabel(me.session?.expiresAt ?? null)}</span>
          <span>Last login: {timeLabel(me.user.lastLoginAt)}</span>
        </div>
        <div className="auth-actions">
          <Link className="button secondary" href="/account/profile">Profile</Link>
          <Link className="button secondary" href="/account/security">Security</Link>
          <Link className="button secondary" href="/account/sessions">Sessions</Link>
          <Link className="button secondary" href="/account/subscription">Subscription</Link>
          <Link className="button secondary" href="/account/usage">Usage</Link>
          <button className="button primary" type="button" onClick={handleLogout}>
            Sign out
          </button>
        </div>

        {me.permissions.roleManagement ? (
          <div className="auth-admin">
            <h2>Role management</h2>
            <div className="auth-admin-list">
              {users.map((user) => (
                <div key={user.id} className="auth-admin-row">
                  <div>
                    <strong>{user.name}</strong>
                    <small>{user.email}</small>
                  </div>
                  <select
                    value={user.role}
                    onChange={(event) => void changeRole(user.id, event.target.value as AuthRole)}
                    disabled={savingId === user.id}
                  >
                    <option value="USER">USER</option>
                    <option value="ANALYST">ANALYST</option>
                    <option value="ADMIN">ADMIN</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {message ? <p className="auth-message">{message}</p> : null}
      </div>
    </section>
  );
}
