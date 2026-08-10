'use client';

import { type FormEvent, useState } from 'react';

import { changePasswordAuth, logoutAllAuth } from '../../../lib/auth';

export default function AccountSecurityPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      await changePasswordAuth({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setMessage('Password updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Change failed.');
    }
  }

  async function logoutAll(): Promise<void> {
    try {
      await logoutAllAuth();
      setMessage('Logged out from all devices.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Logout all failed.');
    }
  }

  return (
    <div className="auth-card">
      <span className="eyebrow">SECURITY</span>
      <h1>Password & sessions</h1>
      <form className="auth-form" onSubmit={submit}>
        <label>Current password<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
        <label>New password<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} /></label>
        <button className="button primary" type="submit">Change password</button>
      </form>
      <div className="auth-actions">
        <button className="button secondary" type="button" onClick={() => void logoutAll()}>Logout all devices</button>
      </div>
      {message ? <p className="auth-message">{message}</p> : null}
    </div>
  );
}
