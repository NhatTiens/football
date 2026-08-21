'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

function realtimeUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL?.trim();
  if (configured) return configured;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const localDevelopment =
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    window.location.port === '3000';
  const host = localDevelopment ? `${window.location.hostname}:4000` : window.location.host;
  return `${protocol}//${host}/ws`;
}

type RealtimePayload = Record<string, unknown> & { event?: string; type?: string };

function dispatchRealtime(payload: RealtimePayload): void {
  window.dispatchEvent(new CustomEvent('football-ai:realtime', { detail: payload }));
}

export function RealtimeHistoryRefresh() {
  const pathname = usePathname();
  const router = useRouter();
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectAttempt = 0;

    const refreshHistory = (eventName: string) => {
      if (
        pathnameRef.current?.startsWith('/history') &&
        ['history_updated', 'PREDICTION_RESULT_UPDATED', 'MATCH_FINISHED', 'SNAPSHOT_REQUIRED'].includes(
          eventName,
        )
      ) {
        router.refresh();
      }
    };

    const fetchLatestSnapshot = async (reason: string) => {
      try {
        const response = await fetch(`${apiUrl}/automation/status`, { cache: 'no-store' });
        const status = response.ok ? ((await response.json()) as Record<string, unknown>) : null;
        const payload: RealtimePayload = {
          event: 'SNAPSHOT_REQUIRED',
          type: 'SNAPSHOT_REQUIRED',
          reason,
          status,
          occurredAt: new Date().toISOString(),
        };
        dispatchRealtime(payload);
        refreshHistory('SNAPSHOT_REQUIRED');
      } catch {
        // Backend-only fallback is best effort. The next reconnect/tick retries.
      }
    };

    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };

    const startFallback = () => {
      if (fallbackTimer) return;
      void fetchLatestSnapshot('REALTIME_DISCONNECTED');
      fallbackTimer = setInterval(
        () => void fetchLatestSnapshot('REALTIME_FALLBACK_POLL'),
        75_000,
      );
    };

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(realtimeUrl());

      socket.addEventListener('open', () => {
        const reconnected = reconnectAttempt > 0;
        reconnectAttempt = 0;
        stopFallback();
        void fetchLatestSnapshot(reconnected ? 'REALTIME_RECONNECTED' : 'REALTIME_CONNECTED');
      });

      socket.addEventListener('message', (message) => {
        try {
          const payload = JSON.parse(String(message.data)) as RealtimePayload;
          const eventName = String(payload.event ?? payload.type ?? 'UNKNOWN');
          dispatchRealtime({ ...payload, event: eventName, type: eventName });
          refreshHistory(eventName);
        } catch {
          // Ignore non-JSON websocket messages.
        }
      });

      socket.addEventListener('close', () => {
        if (stopped) return;
        startFallback();
        const baseDelay = Math.min(30_000, 2_000 * 2 ** reconnectAttempt);
        const jitter = Math.floor(Math.random() * 750);
        reconnectAttempt += 1;
        reconnectTimer = setTimeout(connect, baseDelay + jitter);
      });

      socket.addEventListener('error', () => socket?.close());
    };

    connect();
    return () => {
      stopped = true;
      stopFallback();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [router]);

  return null;
}
