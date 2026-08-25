import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { isUsernameIdentifier, usernameLoginEmail } from "../src/lib/login-code";

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
  const adminUsername = process.env.PRODUCTION_ADMIN_USERNAME?.trim().toLowerCase();
  if (adminUsername && !isUsernameIdentifier(adminUsername)) {
    throw new Error("PRODUCTION_ADMIN_USERNAME must be 2-31 characters of a-z, 0-9, dot, dash or underscore.");
  }
  const adminEmail = adminUsername
    ? usernameLoginEmail(adminUsername)
    : normalizeEmail(requiredEnv("PRODUCTION_ADMIN_EMAIL"));
  const adminPassword = requiredEnv("PRODUCTION_ADMIN_PASSWORD");
  const adminName = process.env.PRODUCTION_ADMIN_NAME?.trim() || adminUsername || adminEmail;
  const companyName = process.env.PRODUCTION_COMPANY_NAME?.trim() || officeName;
  const workspaceName = process.env.PRODUCTION_WORKSPACE_NAME?.trim() || companyName;
  const workspaceExternalKey = process.env.PRODUCTION_WORKSPACE_EXTERNAL_KEY?.trim() || "production:primary";

  if (adminPassword.length < 12) {
    throw new Error("PRODUCTION_ADMIN_PASSWORD must be at least 12 characters for production.");
  }

  const passwordHash = await hashPassword(adminPassword);

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
      select: { id: true, email: true, role: true, isActive: true, canViewWholeOffice: true },
    });

    const admin = existingAdmin
      ? await tx.user.update({
        where: { id: existingAdmin.id },
        data: {
          fullName: adminName,
          passwordHash,
          role: UserRole.ADMIN,
          isActive: true,
          canViewWholeOffice: true,
        },
        select: { id: true, email: true, role: true, isActive: true },
      })
      : await tx.user.create({
        data: {
          officeId: office.id,
          email: adminEmail,
          fullName: adminName,
          role: UserRole.ADMIN,
          isActive: true,
          canViewWholeOffice: true,
          passwordHash,
        },
        select: { id: true, email: true, role: true, isActive: true },
      });

    const existingCompany = await tx.company.findUnique({
      where: { officeId_name: { officeId: office.id, name: companyName } },
      select: { id: true, name: true },
    });
    const company = existingCompany ?? await tx.company.create({
      data: {
        officeId: office.id,
        name: companyName,
        status: "IN_PROGRESS",
        crmCategory: "customer",
        crmStage: "active",
        crmPriority: "high",
        crmSource: "production_commissioning",
      },
      select: { id: true, name: true },
    });

    const existingWorkspace = await tx.supplyWorkspace.findUnique({
      where: {
        officeId_externalKey: {
          officeId: office.id,
          externalKey: workspaceExternalKey,
        },
      },
      select: { id: true, name: true, companyId: true, externalKey: true },
    });
    const workspace = existingWorkspace
      ? await tx.supplyWorkspace.update({
        where: { id: existingWorkspace.id },
        data: {
          companyId: company.id,
          createdByUserId: admin.id,
          name: workspaceName,
          status: "ACTIVE",
          archivedAt: null,
        },
        select: { id: true, name: true, companyId: true, externalKey: true },
      })
      : await tx.supplyWorkspace.create({
        data: {
          officeId: office.id,
          companyId: company.id,
          createdByUserId: admin.id,
          externalKey: workspaceExternalKey,
          name: workspaceName,
        },
        select: { id: true, name: true, companyId: true, externalKey: true },
      });

    await tx.supplyWorkspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: admin.id } },
      create: {
        officeId: office.id,
        workspaceId: workspace.id,
        userId: admin.id,
        role: "OWNER",
        isActive: true,
      },
      update: { officeId: office.id, role: "OWNER", isActive: true },
    });

    return {
      office,
      admin,
      company,
      workspace,
      createdOffice,
      createdAdmin: !existingAdmin,
      createdCompany: !existingCompany,
      createdWorkspace: !existingWorkspace,
    };
  });

  console.log(JSON.stringify({
    ok: true,
    office: result.office,
    admin: result.admin,
    company: result.company,
    workspace: result.workspace,
    createdOffice: result.createdOffice,
    createdAdmin: result.createdAdmin,
    createdCompany: result.createdCompany,
    createdWorkspace: result.createdWorkspace,
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
