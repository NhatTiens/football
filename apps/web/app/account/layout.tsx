import type { ReactNode } from 'react';
import Link from 'next/link';

export default function AccountLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="account-layout">
      <aside className="account-sidebar">
        <span className="eyebrow">ACCOUNT</span>
        <h1>Dashboard</h1>
        <nav>
          <Link href="/account">Overview</Link>
          <Link href="/account/profile">Profile</Link>
          <Link href="/account/security">Security</Link>
          <Link href="/account/sessions">Sessions</Link>
          <Link href="/account/subscription">Subscription</Link>
          <Link href="/account/usage">Usage</Link>
          <Link href="/account/billing">Billing</Link>
        </nav>
      </aside>
      <section className="account-content">{children}</section>
    </div>
  );
}
