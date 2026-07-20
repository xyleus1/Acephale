import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

// Create (or fix up) a loadboard employee account.
//
//   EMPLOYEE_EMAIL=atahan@usederya.com \
//   EMPLOYEE_NAME="Atahan" \
//   EMPLOYEE_PASSWORD="..." \
//   ALLOW_EMPLOYEE_USER_CREATE=1 \
//   DATABASE_URL=... npx tsx scripts/create-employee-user.ts
//
// Optional: EMPLOYEE_ROLE (default EMPLOYEE), EMPLOYEE_OFFICE_NAME (default:
// the only office in the database — errors if there are several).
// Remember: sign-in is also allowlist-gated (LOGIN_ALLOWED_EMAILS /
// DEFAULT_ALLOWED_LOGIN_EMAILS in src/lib/login-code.ts).

const prisma = new PrismaClient();

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  if (process.env.ALLOW_EMPLOYEE_USER_CREATE !== "1") {
    throw new Error("Refusing to create a user. Set ALLOW_EMPLOYEE_USER_CREATE=1.");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required.");
  }

  const email = requiredEnv("EMPLOYEE_EMAIL").toLowerCase();
  const fullName = requiredEnv("EMPLOYEE_NAME");
  const password = requiredEnv("EMPLOYEE_PASSWORD");
  const roleRaw = (process.env.EMPLOYEE_ROLE?.trim() || "EMPLOYEE") as UserRole;
  if (!Object.values(UserRole).includes(roleRaw)) {
    throw new Error(`Unknown role "${roleRaw}". Valid: ${Object.values(UserRole).join(", ")}.`);
  }
  if (password.length < 12) {
    throw new Error("EMPLOYEE_PASSWORD must be at least 12 characters.");
  }

  const officeName = process.env.EMPLOYEE_OFFICE_NAME?.trim();
  const office = officeName
    ? await prisma.office.findUnique({ where: { name: officeName }, select: { id: true, name: true } })
    : await (async () => {
        const offices = await prisma.office.findMany({ select: { id: true, name: true } });
        if (offices.length !== 1) {
          throw new Error(
            `Expected exactly one office, found ${offices.length} (${offices.map((o) => o.name).join(", ")}). Set EMPLOYEE_OFFICE_NAME.`,
          );
        }
        return offices[0];
      })();
  if (!office) throw new Error(`Office "${officeName}" not found.`);

  const existing = await prisma.user.findFirst({
    where: { email },
    select: { id: true, email: true, role: true, isActive: true, officeId: true },
  });

  const passwordHash = await hashPassword(password);
  const user = existing
    ? await prisma.user.update({
        // Same person re-provisioned: refresh password/role/name, reactivate.
        where: { id: existing.id },
        data: { passwordHash, role: roleRaw, fullName, isActive: true, canViewWholeOffice: false },
        select: { id: true, email: true, role: true, isActive: true },
      })
    : await prisma.user.create({
        data: {
          officeId: office.id,
          email,
          fullName,
          role: roleRaw,
          isActive: true,
          canViewWholeOffice: false,
          passwordHash,
        },
        select: { id: true, email: true, role: true, isActive: true },
      });

  console.log(JSON.stringify({ ok: true, office, user, updatedExisting: Boolean(existing) }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
