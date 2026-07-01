import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEMO_ADMIN_EMAIL = "admin@demo.local";

function parseArgs(argv: string[]) {
  return {
    apply: argv.includes("--apply"),
    verifyOnly: argv.includes("--verify-only"),
  };
}

async function getDemoAdminUsers() {
  return prisma.user.findMany({
    where: { email: DEMO_ADMIN_EMAIL },
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
      office: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

async function verifyRemoved() {
  const remaining = await getDemoAdminUsers();
  if (remaining.length > 0) {
    throw new Error(`${DEMO_ADMIN_EMAIL} still exists in ${remaining.length} office(s).`);
  }
  return { removed: true, email: DEMO_ADMIN_EMAIL };
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required.");
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.verifyOnly) {
    console.log(JSON.stringify({ ok: true, verified: await verifyRemoved() }, null, 2));
    return;
  }

  const users = await getDemoAdminUsers();
  if (!args.apply) {
    console.log(JSON.stringify({
      applyRequired: true,
      command: "npm run cleanup:demo-admin -- --apply",
      found: users.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        officeId: user.office.id,
        officeName: user.office.name,
      })),
    }, null, 2));
    return;
  }

  await prisma.user.deleteMany({ where: { email: DEMO_ADMIN_EMAIL } });
  console.log(JSON.stringify({
    ok: true,
    deletedEmail: DEMO_ADMIN_EMAIL,
    deletedCount: users.length,
    verified: await verifyRemoved(),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
