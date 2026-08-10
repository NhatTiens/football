'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { resendVerificationAuth, verifyEmailAuth } from '../lib/auth';

export function VerifyEmailClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get('email') ?? '';
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      await verifyEmailAuth({ email, code });
      router.push('/login');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Verification failed.');
    }
  }

  async function resend(): Promise<void> {
    try {
      const result = await resendVerificationAuth({ email });
      setMessage(result.debugCode ? `Debug code: ${result.debugCode}` : 'Verification email sent.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Resend failed.');
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-card">
        <span className="eyebrow">VERIFY EMAIL</span>
        <h1>Confirm your account</h1>
        <form className="auth-form" onSubmit={submit}>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Code<input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} /></label>
          <button className="button primary" type="submit">Verify</button>
        </form>
        <div className="auth-actions">
          <button className="button secondary" type="button" onClick={() => void resend()}>Resend code</button>
        </div>
        {message ? <p className="auth-message">{message}</p> : null}
      </div>
    </section>
  );
}
