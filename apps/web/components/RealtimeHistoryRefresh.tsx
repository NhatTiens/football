'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';

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

    const refreshHistory = () => {
      if (pathnameRef.current?.startsWith('/history')) router.refresh();
    };

    const stopFallback = () => {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
    };

    const startFallback = () => {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(refreshHistory, 75_000);
    };

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(realtimeUrl());

      socket.addEventListener('open', () => {
        reconnectAttempt = 0;
        stopFallback();
      });

      socket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(String(event.data)) as { event?: string };
          if (payload.event === 'history_updated' || payload.event === 'connected') {
            refreshHistory();
          }
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
