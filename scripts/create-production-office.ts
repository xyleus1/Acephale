import "dotenv/config";
import { hashPassword } from "../src/lib/password";
import { isUsernameIdentifier, usernameLoginEmail } from "../src/lib/login-code";
import { prisma } from "../src/lib/prisma";
import { provisionOffice } from "../src/lib/office-provisioning";

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
  if (adminPassword.length < 12) {
    throw new Error("PRODUCTION_ADMIN_PASSWORD must be at least 12 characters for production.");
  }

  const passwordHash = await hashPassword(adminPassword);
  const result = await provisionOffice(prisma, {
    officeName,
    admins: [{ email: adminEmail, fullName: adminName, passwordHash }],
    companyName,
    workspaceName: process.env.PRODUCTION_WORKSPACE_NAME?.trim() || companyName,
    workspaceExternalKey: process.env.PRODUCTION_WORKSPACE_EXTERNAL_KEY?.trim() || "production:primary",
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
