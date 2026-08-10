'use client';

import { useEffect, useState } from 'react';

import { deleteAuthSession, listAuthSessions, type AuthSessionInfo } from '../../../lib/auth';

export default function AccountSessionsPage() {
  const [sessions, setSessions] = useState<AuthSessionInfo[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void listAuthSessions().then((payload) => setSessions(payload.sessions)).catch((error) => {
      setMessage(error instanceof Error ? error.message : 'Unable to load sessions.');
    });
  }, []);

  async function revoke(sessionId: number): Promise<void> {
    try {
      await deleteAuthSession(sessionId);
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      setMessage('Session revoked.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Revoke failed.');
    }
  }

  return (
    <div className="auth-card">
      <span className="eyebrow">SESSIONS</span>
      <h1>Active devices</h1>
      <div className="auth-admin-list">
        {sessions.map((session) => (
          <div key={session.id} className="auth-admin-row">
            <div>
              <strong>Session #{session.id}{session.current ? ' (current)' : ''}</strong>
              <small>{session.userAgent ?? 'Unknown device'}</small>
            </div>
            <button className="button secondary" type="button" onClick={() => void revoke(session.id)}>
              Revoke
            </button>
          </div>
        ))}
      </div>
      {message ? <p className="auth-message">{message}</p> : null}
    </div>
  );
}
