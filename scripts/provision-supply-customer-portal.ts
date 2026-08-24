import "dotenv/config";

import { randomBytes } from "node:crypto";
import { encryptCustomerPassword } from "../src/lib/customer-password-vault";
import { managedCustomerEmail, customerPortalUsernameIsAllowed } from "../src/lib/customer-portal-account";
import { hashPassword } from "../src/lib/password";

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  if (process.env.ALLOW_SUPPLY_CUSTOMER_PROVISIONING !== "1") {
    throw new Error(
      "Refusing to provision a Supply OS customer. Set ALLOW_SUPPLY_CUSTOMER_PROVISIONING=1.",
    );
  }

  const workflowDatabaseUrl = requiredEnv("WORKFLOW_DATABASE_URL");
  process.env.DATABASE_URL = workflowDatabaseUrl;
  const officeId = requiredEnv("SUPPLY_PROVISION_OFFICE_ID");
  const companyName = requiredEnv("SUPPLY_PROVISION_COMPANY_NAME");
  const username = requiredEnv("SUPPLY_PROVISION_USERNAME").toLowerCase();
  const password = requiredEnv("SUPPLY_PROVISION_PASSWORD");
  const role = (process.env.SUPPLY_PROVISION_ROLE?.trim().toUpperCase() || "MEMBER");
  const operatorEmail = requiredEnv("SUPPLY_PROVISION_OPERATOR_EMAIL").toLowerCase();
  const operatorName = requiredEnv("SUPPLY_PROVISION_OPERATOR_NAME");
  const vaultSecret = requiredEnv("SUPPLY_PROVISION_VAULT_SECRET");

  if (!customerPortalUsernameIsAllowed(username)) {
    throw new Error("SUPPLY_PROVISION_USERNAME is not allowed.");
  }
  if (!["ADMIN", "MEMBER", "VIEWER"].includes(role)) {
    throw new Error("SUPPLY_PROVISION_ROLE must be ADMIN, MEMBER, or VIEWER.");
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error("SUPPLY_PROVISION_PASSWORD must contain 12 to 128 characters.");
  }

  const [{ PrismaClient }, workspaceModule, httpModule] = await Promise.all([
    import("@prisma/client"),
    import("../src/lib/supply-os/customer-workspace"),
    import("../src/lib/supply-os/http"),
  ]);
  const prisma = new PrismaClient();

  try {
    const office = await prisma.office.findUnique({
      where: { id: officeId },
      select: { id: true, name: true },
    });
    if (!office) throw new Error("Target office was not found.");

    const existingAdmin = await prisma.user.findFirst({
      where: {
        officeId,
        role: "ADMIN",
        isActive: true,
        customerPortalIdentity: null,
      },
      select: { id: true },
    });
    if (!existingAdmin && process.env.SUPPLY_PROVISION_CREATE_OPERATOR !== "1") {
      throw new Error(
        `Target office "${office.name}" (${office.id}) has no active internal ADMIN. Set SUPPLY_PROVISION_CREATE_OPERATOR=1 to create the provisioning service account.`,
      );
    }
    const admin = existingAdmin ?? await prisma.user.create({
      data: {
        officeId,
        email: operatorEmail,
        fullName: `${operatorName} - Supply provisioning service account for ${office.id}`,
        role: "ADMIN",
        isActive: true,
        canViewWholeOffice: false,
        passwordHash: await hashPassword(randomBytes(32).toString("base64url")),
      },
      select: { id: true },
    });

    const access = httpModule.supplyAccessContext({
      officeId,
      userId: admin.id,
      role: "ADMIN",
      canViewWholeOffice: false,
      accessKind: "operator",
    });
    const workspaceResult = await workspaceModule.createSupplyCustomerWorkspace(access, {
      name: companyName,
    });
    const portal = await workspaceModule.grantSupplyCustomerPortalAccess({
      officeId,
      companyId: workspaceResult.company.id,
      username,
      email: managedCustomerEmail(username),
      fullName: companyName,
      role,
      passwordHash: await hashPassword(password),
      passwordEncrypted: encryptCustomerPassword(password, vaultSecret),
      existingUser: "reset",
    });
    if (!portal) throw new Error("Customer workspace could not be linked.");

    console.warn(
      "Warning: the encrypted portal password is decryptable only with the same SUPPLY_PROVISION_VAULT_SECRET.",
    );
    console.log(JSON.stringify({
      officeId: office.id,
      workspaceId: workspaceResult.workspace.id,
      companyId: workspaceResult.company.id,
      portalUserId: portal.userId,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const secretValues = [
    process.env.WORKFLOW_DATABASE_URL,
    process.env.SUPPLY_PROVISION_PASSWORD,
    process.env.SUPPLY_PROVISION_VAULT_SECRET,
  ].filter((value): value is string => Boolean(value));
  const message = error instanceof Error ? error.message : "Provisioning failed.";
  console.error(secretValues.reduce((output, secret) => output.replaceAll(secret, "[redacted]"), message));
  process.exitCode = 1;
});
