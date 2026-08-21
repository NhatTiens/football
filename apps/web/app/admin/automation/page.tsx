'use client';

import { useEffect, useState } from 'react';

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

interface AutomationStatus {
  status: string;
  phase?: string;
  automatic: boolean;
  lastUpdated: string | null;
  lastSuccessfulFixtureSync: string | null;
  lastSuccessfulPredictionSync: string | null;
  lastSuccessfulResultSync: string | null;
  apiQuota: { limit: number; used: number; remaining: number; pressure: string };
  apiErrorsToday: number;
  predictionQueue: { pending: number };
  resultQueue: { pending: number; processing: number; failed: number };
  failedJobs24h: number;
  worker: { status?: string; heartbeatAt?: string };
  scheduler: { status?: string };
  realtime: { status?: string; clients?: number; heartbeatAt?: string };
  forceSyncPending: boolean;
}

function displayTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('vi-VN') : '—';
}

export default function AutomationAdminPage() {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const response = await fetch(`${apiUrl}/automation/status`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as AutomationStatus;
        if (!stopped) {
          setStatus(payload);
          setError(null);
        }
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : 'Không tải được trạng thái automation.');
      }
    };
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <main style={{ display: 'grid', gap: 16 }}>
      <header>
        <p style={{ margin: 0, opacity: 0.7 }}>PRODUCTION AUTOMATION</p>
        <h1>Fixture · Prediction · Result · Realtime</h1>
        <p>Trang này chỉ giám sát. Pipeline production được điều khiển bởi backend worker, không phụ thuộc user online.</p>
      </header>

      {error ? <p role="alert">Không tải được trạng thái: {error}</p> : null}
      {!status ? <p>Đang tải trạng thái hệ thống…</p> : (
        <>
          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
            <article><b>Scheduler</b><div>{status.scheduler.status ?? status.status}{status.phase ? ` · ${status.phase}` : ''}</div><small>{displayTime(status.lastUpdated)}</small></article>
            <article><b>Worker</b><div>{status.worker.status ?? '—'}</div><small>{displayTime(status.worker.heartbeatAt)}</small></article>
            <article><b>Realtime</b><div>{status.realtime.status ?? '—'} · {status.realtime.clients ?? 0} client</div><small>{displayTime(status.realtime.heartbeatAt)}</small></article>
            <article><b>API quota</b><div>{status.apiQuota.remaining}/{status.apiQuota.limit} còn lại</div><small>{status.apiQuota.used} calls · {status.apiQuota.pressure}</small></article>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <article><b>Fixture sync gần nhất</b><div>{displayTime(status.lastSuccessfulFixtureSync)}</div></article>
            <article><b>Prediction sync gần nhất</b><div>{displayTime(status.lastSuccessfulPredictionSync)}</div></article>
            <article><b>Result sync gần nhất</b><div>{displayTime(status.lastSuccessfulResultSync)}</div></article>
          </section>

          <section>
            <h2>Queues & errors</h2>
            <p>Prediction pending: <b>{status.predictionQueue.pending}</b></p>
            <p>Result pending / processing / failed: <b>{status.resultQueue.pending} / {status.resultQueue.processing} / {status.resultQueue.failed}</b></p>
            <p>API errors hôm nay: <b>{status.apiErrorsToday}</b> · Failed jobs 24h: <b>{status.failedJobs24h}</b></p>
            <p>Admin force-sync pending: <b>{status.forceSyncPending ? 'YES' : 'NO'}</b></p>
          </section>
        </>
      )}
    </main>
  );
}
