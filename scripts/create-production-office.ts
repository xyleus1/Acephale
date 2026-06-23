import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/password";

const prisma = new PrismaClient();

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function main() {
  if (process.env.ALLOW_PRODUCTION_OFFICE_SEED !== "1") {
    throw new Error("Refusing to create production office/admin. Set ALLOW_PRODUCTION_OFFICE_SEED=1.");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required.");
  }

  const officeName = requiredEnv("PRODUCTION_OFFICE_NAME");
  const adminEmail = normalizeEmail(requiredEnv("PRODUCTION_ADMIN_EMAIL"));
  const adminPassword = requiredEnv("PRODUCTION_ADMIN_PASSWORD");

  if (adminPassword.length < 12) {
    throw new Error("PRODUCTION_ADMIN_PASSWORD must be at least 12 characters for production.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const existingOffice = await tx.office.findUnique({
      where: { name: officeName },
      select: { id: true, name: true, createdAt: true },
    });
    const office = existingOffice ?? await tx.office.create({
      data: { name: officeName },
      select: { id: true, name: true, createdAt: true },
    });
    const createdOffice = !existingOffice;

    const existingAdmin = await tx.user.findUnique({
      where: { officeId_email: { officeId: office.id, email: adminEmail } },
      select: { id: true, email: true, role: true, isActive: true },
    });

    if (existingAdmin) {
      const admin = existingAdmin.role === UserRole.ADMIN && existingAdmin.isActive
        ? existingAdmin
        : await tx.user.update({
          where: { id: existingAdmin.id },
          data: { role: UserRole.ADMIN, isActive: true, canViewWholeOffice: true },
          select: { id: true, email: true, role: true, isActive: true },
        });
      return { office, admin, createdOffice, createdAdmin: false };
    }

    const passwordHash = await hashPassword(adminPassword);
    const admin = await tx.user.create({
      data: {
        officeId: office.id,
        email: adminEmail,
        fullName: adminEmail,
        role: UserRole.ADMIN,
        isActive: true,
        canViewWholeOffice: true,
        passwordHash,
      },
      select: { id: true, email: true, role: true, isActive: true },
    });

    return { office, admin, createdOffice, createdAdmin: true };
  });

  console.log(JSON.stringify({
    ok: true,
    office: result.office,
    admin: result.admin,
    createdOffice: result.createdOffice,
    createdAdmin: result.createdAdmin,
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
