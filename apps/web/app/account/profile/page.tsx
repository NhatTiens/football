'use client';

import { type FormEvent, useEffect, useState } from 'react';

import { getAccountAuth, updateAccountProfileAuth, type PublicAuthUser } from '../../../lib/auth';

export default function AccountProfilePage() {
  const [user, setUser] = useState<PublicAuthUser | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getAccountAuth().then((payload) => {
      setUser(payload.user);
      setName(payload.user.name);
    }).catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load profile.'));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const result = await updateAccountProfileAuth({ name });
      setUser(result.user);
      setMessage('Profile saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed.');
    }
  }

  if (!user) return <div className="auth-card">Loading...</div>;

  return (
    <div className="auth-card">
      <span className="eyebrow">PROFILE</span>
      <h1>Update profile</h1>
      <form className="auth-form" onSubmit={submit}>
        <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Email<input value={user.email} readOnly /></label>
        <button className="button primary" type="submit">Save</button>
      </form>
      {message ? <p className="auth-message">{message}</p> : null}
    </div>
  );
}
