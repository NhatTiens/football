import crypto from 'node:crypto';

import type { RequestHandler } from 'express';

export function constantTimeSecretEquals(
  received: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const left = received?.trim() ?? '';
  const right = expected?.trim() ?? '';

  if (!left || !right) return false;

  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    // Keep a timing-safe operation on the mismatch path too. The return value
    // remains false, but callers do not fall back to a plain secret compare.
    const digestA = crypto.createHash('sha256').update(leftBuffer).digest();
    const digestB = crypto.createHash('sha256').update(rightBuffer).digest();
    crypto.timingSafeEqual(digestA, digestB);
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function allowedCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isAllowedWriteOrigin(
  origin: string | null | undefined,
  configuredOrigins: string,
): boolean {
  if (!origin) return true;
  return allowedCorsOrigins(configuredOrigins).includes(origin);
}

export const sensitiveNoStore: RequestHandler = (_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');
  next();
};
