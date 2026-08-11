import { prisma } from "@football-ai/database";

async function main() {
  const users = await prisma.authUser.findMany({
    where: {
      OR: [
        { role: "ADMIN" },
        { email: "footballai.vn@gmail.com" }
      ]
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      plan: true,
      emailVerifiedAt: true,
      forcePasswordChange: true,
      proExpiresAt: true,
      createdAt: true
    }
  });

  console.table(users);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
