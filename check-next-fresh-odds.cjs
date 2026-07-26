const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const r = await prisma.apiFootballFreshOddsCheckpoint.findFirst({
    where: {
      completedAt: null
    },
    orderBy: {
      dueAt: "asc"
    },
    select: {
      providerFixtureId: true,
      horizonLabel: true,
      dueAt: true,
      kickoffAt: true,
      status: true
    }
  });

  if (!r) {
    console.log("NO PENDING CHECKPOINT");
    return;
  }

  console.log({
    fixture: r.providerFixtureId,
    horizon: r.horizonLabel,
    status: r.status,
    dueAtUTC: r.dueAt.toISOString(),
    dueAtVietnam: r.dueAt.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour12: false
    }),
    kickoffVietnam: r.kickoffAt.toLocaleString("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour12: false
    })
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
