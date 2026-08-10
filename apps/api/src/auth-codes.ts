import crypto from 'node:crypto';

import { prisma } from '@football-ai/database';

import type { AuthCodePurpose } from './auth.js';

export function generateSixDigitCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashAuthCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim()).digest('hex');
}

export function codeExpiresAt(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export async function revokePendingCodes(input: {
  userId: number;
  purpose: AuthCodePurpose;
}): Promise<void> {
  await prisma.authVerificationCode.updateMany({
    where: {
      userId: input.userId,
      purpose: input.purpose,
      usedAt: null,
      supersededAt: null,
    },
    data: { supersededAt: new Date() },
  });
}

export async function createAuthCode(input: {
  userId: number;
  purpose: AuthCodePurpose;
  code: string;
  expiresAt: Date;
}): Promise<number> {
  await revokePendingCodes({ userId: input.userId, purpose: input.purpose });
  const row = await prisma.authVerificationCode.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      codeHash: hashAuthCode(input.code),
      expiresAt: input.expiresAt,
    },
    select: { id: true },
  });
  return row.id;
}

export async function verifyAuthCode(input: {
  userId: number;
  purpose: AuthCodePurpose;
  code: string;
}): Promise<{ ok: boolean; usedAt: Date | null }> {
  const codeHash = hashAuthCode(input.code);
  const now = new Date();
  const row = await prisma.authVerificationCode.findFirst({
    where: {
      userId: input.userId,
      purpose: input.purpose,
      codeHash,
      usedAt: null,
      supersededAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!row) return { ok: false, usedAt: null };

  const updated = await prisma.authVerificationCode.update({
    where: { id: row.id },
    data: { usedAt: now },
    select: { usedAt: true },
  });
  return { ok: true, usedAt: updated.usedAt };
}

export async function cleanupExpiredAuthCodes(): Promise<number> {
  const result = await prisma.authVerificationCode.updateMany({
    where: {
      usedAt: null,
      supersededAt: null,
      expiresAt: { lt: new Date() },
    },
    data: { supersededAt: new Date() },
  });
  return result.count;
}
