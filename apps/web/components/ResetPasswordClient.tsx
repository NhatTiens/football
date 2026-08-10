'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { resetPasswordAuth } from '../lib/auth';

export function ResetPasswordClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get('email') ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      await resetPasswordAuth({ email, code, password });
      router.push('/login');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Reset failed.');
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-card">
        <span className="eyebrow">RESET PASSWORD</span>
        <h1>Choose a new password</h1>
        <form className="auth-form" onSubmit={submit}>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Code<input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} /></label>
          <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} /></label>
          <button className="button primary" type="submit">Reset password</button>
        </form>
        {message ? <p className="auth-message">{message}</p> : null}
      </div>
    </section>
  );
}
