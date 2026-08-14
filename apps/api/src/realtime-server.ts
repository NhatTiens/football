import '../../../scripts/api-football-quota-preload.mjs';
import 'dotenv/config';

import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { prisma } from '@football-ai/database';

import { app } from './app.js';

const clients = new Set<Duplex>();
const httpServer = createServer(app);

function configuredOrigins(): Set<string> {
  return new Set(
    (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function originAllowed(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  const allowed = configuredOrigins();
  return allowed.has('*') || allowed.has(origin);
}

function websocketFrame(message: string): Buffer {
  const payload = Buffer.from(message, 'utf8');
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }
  if (length <= 0xffff) {
    const header = Buffer.allocUnsafe(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.allocUnsafe(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function sendJson(socket: Duplex, payload: unknown): void {
  if (!socket.destroyed && socket.writable) {
    socket.write(websocketFrame(JSON.stringify(payload)));
  }
}

httpServer.on('upgrade', (request, socket) => {
  const host = request.headers.host ?? 'localhost';
  const requestUrl = new URL(request.url ?? '/', `http://${host}`);
  if (requestUrl.pathname !== '/ws' || !originAllowed(request)) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const key = request.headers['sec-websocket-key'];
  const version = request.headers['sec-websocket-version'];
  if (typeof key !== 'string' || version !== '13') {
    socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      '\r\n',
  );

  clients.add(socket);
  sendJson(socket, { event: 'connected', occurredAt: new Date().toISOString() });

  const cleanup = () => clients.delete(socket);
  socket.on('close', cleanup);
  socket.on('end', cleanup);
  socket.on('error', cleanup);

  // Client frames are not used for application messages. A browser close/error
  // simply removes the socket; server-to-client history events remain one-way.
  socket.on('data', (chunk: Buffer) => {
    if (chunk.length > 0 && (chunk[0]! & 0x0f) === 0x08) {
      socket.end();
    }
  });
});

let dispatching = false;

async function dispatchRealtimeOutbox(): Promise<void> {
  if (dispatching) return;
  dispatching = true;

  const now = new Date();
  const staleBefore = new Date(now.getTime() - 30_000);
  try {
    const rows = await prisma.realtimeOutbox.findMany({
      where: { publishedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });

    for (const row of rows) {
      const lockToken = randomUUID();
      const claim = await prisma.realtimeOutbox.updateMany({
        where: {
          id: row.id,
          publishedAt: null,
          OR: [{ lockedAt: null }, { lockedAt: { lt: staleBefore } }],
        },
        data: {
          lockedAt: now,
          lockToken,
          attempts: { increment: 1 },
        },
      });
      if (claim.count !== 1) continue;

      try {
        const frame = websocketFrame(JSON.stringify(row.payload));
        for (const socket of clients) {
          if (!socket.destroyed && socket.writable) socket.write(frame);
        }

        await prisma.realtimeOutbox.updateMany({
          where: { id: row.id, publishedAt: null, lockToken },
          data: { publishedAt: new Date(), lockedAt: null, lockToken: null },
        });
      } catch (error) {
        await prisma.realtimeOutbox.updateMany({
          where: { id: row.id, publishedAt: null, lockToken },
          data: { lockedAt: null, lockToken: null },
        });
        console.error('[realtime] failed to publish outbox event', row.id, error);
      }
    }
  } finally {
    dispatching = false;
  }
}

void dispatchRealtimeOutbox();
const outboxTimer = setInterval(() => void dispatchRealtimeOutbox(), 1_000);

const apiPort = Number(process.env.API_PORT ?? process.env.PORT ?? '4000');
const apiHost = process.env.API_HOST ?? process.env.HOST ?? '0.0.0.0';

httpServer.listen(apiPort, apiHost, () => {
  console.log(`[api] listening on http://${apiHost}:${apiPort}`);
  console.log('[api] websocket ready at /ws');
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[api] received ${signal}; shutting down.`);
  clearInterval(outboxTimer);
  for (const socket of clients) socket.destroy();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
