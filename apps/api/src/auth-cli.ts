import 'dotenv/config';

import { prisma } from '@football-ai/database';

import { hashPassword, normalizeEmail, normalizeName } from './auth.js';

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

async function createAdmin(): Promise<void> {
  const args = process.argv.slice(2);
  const email = readFlag(args, '--email');
  const password = readFlag(args, '--password');
  const name = readFlag(args, '--name') ?? 'Administrator';

  if (!email || !password) {
    throw new Error('Usage: npm run cli -w @football-ai/api -- create-admin --email admin@example.com --password "secret" [--name "Admin"]');
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedName = normalizeName(name);
  const passwordHash = await hashPassword(password);

  const user = await prisma.authUser.upsert({
    where: { email: normalizedEmail },
    update: {
      name: normalizedName,
      passwordHash,
      role: 'ADMIN',
      failedLoginCount: 0,
      lockedUntil: null,
    },
    create: {
      email: normalizedEmail,
      name: normalizedName,
      passwordHash,
      role: 'ADMIN',
    },
  });

  console.log(`Admin account ready: ${user.email} (#${user.id})`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'create-admin') {
    throw new Error('Unknown command. Available: create-admin');
  }
  await createAdmin();
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
