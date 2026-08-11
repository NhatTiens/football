import { prisma } from '@football-ai/database';

import { bootstrapAdmin } from '../apps/api/src/admin-bootstrap.js';

async function main(): Promise<void> {
  const result = await bootstrapAdmin();

  if (result.kind === 'CREATED') {
    console.log('ADMIN_BOOTSTRAP_CREATED');
    console.log(`userId=${result.userId}`);
    console.log(`email=${result.email}`);
    console.log('role=ADMIN');
    console.log('plan=FREE');
    console.log('status=ACTIVE');
    console.log(`forcePasswordChange=${result.forcePasswordChange}`);
    console.log('passwordPrinted=false');
    return;
  }

  if (result.kind === 'ALREADY_ADMIN') {
    console.log('ADMIN_BOOTSTRAP_ALREADY_ADMIN');
    console.log(`userId=${result.userId}`);
    console.log(`email=${result.email}`);
    console.log('existingPasswordOverwritten=false');
    console.log(`forcePasswordChange=${result.forcePasswordChange}`);
    return;
  }

  if (result.kind === 'REFUSED_TARGET_EXISTS') {
    console.error('ADMIN_BOOTSTRAP_REFUSED_TARGET_EXISTS');
    console.error(`email=${result.email}`);
    console.error(`currentRole=${result.currentRole}`);
    console.error('Existing non-admin accounts are never silently promoted by bootstrap.');
    process.exitCode = 2;
    return;
  }

  console.error('ADMIN_BOOTSTRAP_REFUSED_ADMIN_EXISTS');
  console.error(`adminCount=${result.adminCount}`);
  console.error('Bootstrap is first-admin only and will not create additional admins.');
  process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error('ADMIN_BOOTSTRAP_FAILED');
    console.error(error instanceof Error ? error.message : 'Unknown bootstrap error.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
