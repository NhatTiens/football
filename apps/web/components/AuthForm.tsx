'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { loginAuth, registerAuth, type RegisterResponse } from '../lib/auth';

type AuthMode = 'login' | 'register';

export function AuthForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (mode === 'register' && password !== confirmPassword) {
        throw new Error('Passwords do not match.');
      }

      if (mode === 'login') {
        await loginAuth({ email, password });
        router.push('/account');
        router.refresh();
      } else {
        const result: RegisterResponse = await registerAuth({ name, email, password });
        router.push(`/verify-email?email=${encodeURIComponent(result.email)}`);
        router.refresh();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-card">
        <span className="eyebrow">{mode === 'login' ? 'SIGN IN' : 'CREATE ACCOUNT'}</span>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p>Sign in to unlock the chatbot and role-based analyst tools.</p>

        <form className="auth-form" onSubmit={submit}>
          {mode === 'register' ? (
            <label>
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
            </label>
          ) : null}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              minLength={8}
            />
          </label>
          {mode === 'register' ? (
            <label>
              Confirm password
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
              />
            </label>
          ) : null}
          <button className="button primary" type="submit" disabled={loading}>
            {loading ? 'Working...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        {message ? <p className="auth-message">{message}</p> : null}
        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              New here? <Link href="/register">Create an account</Link>
              {' · '}
              <Link href="/forgot-password">Forgot password?</Link>
            </>
          ) : (
            <>
              Already have an account? <Link href="/login">Sign in</Link>
            </>
          )}
        </p>
      </div>
    </section>
  );
}
