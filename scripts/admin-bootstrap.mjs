import 'dotenv/config';

import { PrismaClient } from '@prisma/client';
import { Algorithm, hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

function readEnv(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

const email = readEnv('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
const password = readEnv('BOOTSTRAP_ADMIN_PASSWORD');
const name = readEnv('BOOTSTRAP_ADMIN_NAME', 'Administrator');
const overwritePassword = readEnv('BOOTSTRAP_ADMIN_OVERWRITE_PASSWORD', 'false') === 'true';

if (!email || !password) {
  throw new Error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required.');
}

const passwordHash = await hash(password, {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

const existing = await prisma.authUser.findUnique({ where: { email } });
const data = {
  name,
  role: 'ADMIN',
  status: 'ACTIVE',
  plan: 'FREE',
  emailVerifiedAt: new Date(),
  forcePasswordChange: true,
  failedLoginCount: 0,
  lockedUntil: null,
  proExpiresAt: null,
  lastLoginAt: null,
  lastLoginIp: null,
  lastLoginUserAgent: null,
};

const user = existing
  ? await prisma.authUser.update({
      where: { email },
      data: overwritePassword ? { ...data, passwordHash } : data,
    })
  : await prisma.authUser.create({
      data: { ...data, email, passwordHash },
    });

console.log(`Admin ready: ${user.email} (#${user.id})`);
await prisma.$disconnect();
