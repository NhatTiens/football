'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { forgotPasswordAuth } from '../../lib/auth';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const result = await forgotPasswordAuth({ email });
      setMessage(result.debugCode ? `Debug reset code: ${result.debugCode}` : 'Reset email sent.');
      router.push(`/reset-password?email=${encodeURIComponent(email)}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Request failed.');
    }
  }

  return (
    <section className="auth-shell">
      <div className="auth-card">
        <span className="eyebrow">FORGOT PASSWORD</span>
        <h1>Reset access</h1>
        <form className="auth-form" onSubmit={submit}>
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button className="button primary" type="submit">Send reset code</button>
        </form>
        {message ? <p className="auth-message">{message}</p> : null}
      </div>
    </section>
  );
}
