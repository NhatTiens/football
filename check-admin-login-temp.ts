import { prisma } from "@football-ai/database";

async function main() {
  const user = await prisma.authUser.findUnique({
    where: { email: "footballai.vn@gmail.com" },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      plan: true,
      emailVerifiedAt: true,
      forcePasswordChange: true,
      lockedUntil: true,
      failedLoginCount: true
    }
  });

  console.table(user ? [user] : []);
}

main()
  .catch(console.error)
  .finally(async () => prisma.$disconnect());
