const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function vn(date) {
  if (!date) return "-";
  return date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour12: false
  });
}

async function main() {
  const now = new Date();

  const rows =
    await prisma.apiFootballFreshOddsCheckpoint.findMany({
      where: {
        horizonMinutes: 180
      },
      orderBy: {
        dueAt: "asc"
      },
      select: {
        providerFixtureId: true,
        dueAt: true,
        kickoffAt: true,
        status: true,
        completedAt: true
      }
    });

  console.log("===== ALL T-180 CHECKPOINTS =====");
  console.log("Now:", vn(now));
  console.log("");

  for (const r of rows) {
    const delta =
      Math.round((r.dueAt.getTime() - now.getTime()) / 60000);

    console.log({
      fixture: r.providerFixtureId,
      status: r.status,
      T180: vn(r.dueAt),
      kickoff: vn(r.kickoffAt),
      completedAt: vn(r.completedAt),
      minutesFromNow: delta
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
