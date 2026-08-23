import assert from "node:assert/strict";
import {
  CustomerPortalAccountAdminError,
  removeCustomerPortalAccountRecord,
  updateCustomerPortalAccountRecord,
} from "../src/lib/customer-portal-account-admin";
import { resolveCustomerManagementOperator } from "../src/lib/customer-portal-admin-auth";
import {
  isManagedCustomerEmail,
  isRemovedCustomerUsername,
  managedCustomerEmail,
} from "../src/lib/customer-portal-account";
import {
  decryptCustomerPassword,
  encryptCustomerPassword,
} from "../src/lib/customer-password-vault";
import { loadCustomerPortalPrincipal } from "../src/lib/customer-portal-password";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { grantSupplyCustomerPortalAccess } from "../src/lib/supply-os/customer-workspace";

async function expectNotFound(run: () => Promise<unknown>) {
  await assert.rejects(
    run,
    (error) => error instanceof CustomerPortalAccountAdminError && error.code === "not_found",
  );
}

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for the customer account admin database test.");
  process.env.AUTH_SECRET = "customer-account-admin-database-test";
  const runId = `customer-admin-${Date.now()}`;
  const initialPassword = "Initial-Customer-Password!27";
  const replacementPassword = "Replacement-Customer-Password!54";
  const [officeA, officeB] = await Promise.all([
    prisma.office.create({ data: { name: `${runId}-a` } }),
    prisma.office.create({ data: { name: `${runId}-b` } }),
  ]);

  try {
    const [companyA1, companyA2, unassignedCompanyA, companyB] = await Promise.all([
      prisma.company.create({ data: { officeId: officeA.id, name: `${runId}-company-a1`, crmStage: "active" } }),
      prisma.company.create({ data: { officeId: officeA.id, name: `${runId}-company-a2`, crmStage: "active" } }),
      prisma.company.create({ data: { officeId: officeA.id, name: `${runId}-unassigned`, crmStage: "active" } }),
      prisma.company.create({ data: { officeId: officeB.id, name: `${runId}-company-b`, crmStage: "active" } }),
    ]);
    const [workspaceA1, workspaceA2, workspaceB] = await Promise.all([
      prisma.supplyWorkspace.create({ data: { officeId: officeA.id, companyId: companyA1.id, name: companyA1.name } }),
      prisma.supplyWorkspace.create({ data: { officeId: officeA.id, companyId: companyA2.id, name: companyA2.name } }),
      prisma.supplyWorkspace.create({ data: { officeId: officeB.id, companyId: companyB.id, name: companyB.name } }),
    ]);
    const [adminA, managerA, inactiveAdminA, adminB] = await Promise.all([
      prisma.user.create({
        data: {
          officeId: officeA.id,
          email: `${runId}-admin-a@example.com`,
          passwordHash: "test",
          fullName: "Admin A",
          role: "ADMIN",
          canViewWholeOffice: true,
        },
      }),
      prisma.user.create({
        data: {
          officeId: officeA.id,
          email: `${runId}-manager-a@example.com`,
          passwordHash: "test",
          fullName: "Manager A",
          role: "MANAGER",
          canViewWholeOffice: true,
        },
      }),
      prisma.user.create({
        data: {
          officeId: officeA.id,
          email: `${runId}-inactive-a@example.com`,
          passwordHash: "test",
          fullName: "Inactive admin A",
          role: "ADMIN",
          isActive: false,
          canViewWholeOffice: true,
        },
      }),
      prisma.user.create({
        data: {
          officeId: officeB.id,
          email: `${runId}-admin-b@example.com`,
          passwordHash: "test",
          fullName: "Admin B",
          role: "ADMIN",
          canViewWholeOffice: true,
        },
      }),
    ]);

    const username = `${runId}-user`;
    const genericEmail = managedCustomerEmail(username);
    const initialHash = await hashPassword(initialPassword);
    const initialEncrypted = encryptCustomerPassword(initialPassword);
    const granted = await grantSupplyCustomerPortalAccess({
      officeId: officeA.id,
      companyId: companyA1.id,
      username,
      email: genericEmail,
      fullName: null,
      role: "MEMBER",
      passwordHash: initialHash,
      passwordEncrypted: initialEncrypted,
      existingUser: "reject",
    });
    assert.ok(granted);
    const created = await prisma.customerPortalUser.findUniqueOrThrow({ where: { id: granted!.userId } });
    assert.equal(created.fullName, companyA1.name, "blank display name must default to the company name");
    assert.equal(isManagedCustomerEmail(created.email), true, "blank contact email must use a managed address");
    assert.equal(decryptCustomerPassword(created.passwordEncrypted), initialPassword);
    assert.ok(created.internalUserId);

    assert.equal(
      (await resolveCustomerManagementOperator({
        userId: adminA.id,
        officeId: officeA.id,
        role: "ADMIN",
        accessKind: "operator",
      }, ["ADMIN"]))?.role,
      "ADMIN",
    );
    assert.equal(
      (await resolveCustomerManagementOperator({
        userId: managerA.id,
        officeId: officeA.id,
        role: "MANAGER",
        accessKind: "operator",
      }, ["ADMIN", "MANAGER"]))?.role,
      "MANAGER",
    );
    assert.equal(
      await resolveCustomerManagementOperator({
        userId: managerA.id,
        officeId: officeA.id,
        role: "MANAGER",
        accessKind: "operator",
      }, ["ADMIN"]),
      null,
      "a manager must not pass the admin-only account mutation boundary",
    );
    assert.equal(
      await resolveCustomerManagementOperator({
        userId: created.internalUserId!,
        officeId: officeA.id,
        role: "CUSTOMER",
        accessKind: "customer",
      }, ["ADMIN", "MANAGER"]),
      null,
      "a customer session must not pass the management boundary",
    );
    assert.equal(
      await resolveCustomerManagementOperator({
        userId: created.internalUserId!,
        officeId: officeA.id,
        role: "ADMIN",
        accessKind: "operator",
      }, ["ADMIN"]),
      null,
      "a customer-linked internal admin-shaped record must not pass the management boundary",
    );
    assert.equal(
      await resolveCustomerManagementOperator({
        userId: inactiveAdminA.id,
        officeId: officeA.id,
        role: "ADMIN",
        accessKind: "operator",
      }, ["ADMIN"]),
      null,
      "an inactive admin must not pass the management boundary",
    );
    assert.equal(
      await resolveCustomerManagementOperator({
        userId: adminB.id,
        officeId: officeA.id,
        role: "ADMIN",
        accessKind: "operator",
      }, ["ADMIN"]),
      null,
      "an admin from another office must not pass the management boundary",
    );

    await prisma.customerPortalMembership.create({
      data: {
        officeId: officeA.id,
        userId: created.id,
        companyId: companyA2.id,
        role: "VIEWER",
      },
    });
    await prisma.supplyWorkspaceMember.create({
      data: {
        officeId: officeA.id,
        workspaceId: workspaceA2.id,
        userId: created.internalUserId!,
        role: "VIEWER",
      },
    });
    const auditAction = await prisma.customerPortalAction.create({
      data: {
        officeId: officeA.id,
        companyId: companyA1.id,
        portalUserId: created.id,
        type: "DOCUMENT_UPLOADED",
      },
    });

    const updateInput = {
      userId: created.id,
      username: `${username}-updated`,
      email: managedCustomerEmail(`${username}-updated`),
      fullName: null,
      isActive: true,
      passwordHash: await hashPassword(replacementPassword),
      passwordEncrypted: encryptCustomerPassword(replacementPassword),
    };
    await expectNotFound(() => updateCustomerPortalAccountRecord({
      ...updateInput,
      officeId: officeB.id,
      companyId: companyB.id,
    }));
    await expectNotFound(() => updateCustomerPortalAccountRecord({
      ...updateInput,
      officeId: officeA.id,
      companyId: unassignedCompanyA.id,
    }));
    await expectNotFound(() => removeCustomerPortalAccountRecord({
      officeId: officeB.id,
      userId: created.id,
      companyId: companyB.id,
    }));

    const originalSession = {
      portalUserId: created.id,
      officeId: officeA.id,
      username: created.username!,
      email: created.email,
      passwordVersion: created.passwordVersion,
      expiresAt: Date.now() + 60_000,
    };
    assert.ok(await loadCustomerPortalPrincipal(originalSession));
    const update = await updateCustomerPortalAccountRecord({
      ...updateInput,
      officeId: officeA.id,
      companyId: companyA1.id,
    });
    assert.equal(update.fullName, companyA1.name);
    const reset = await prisma.customerPortalUser.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(reset.username, updateInput.username);
    assert.equal(reset.email, updateInput.email);
    assert.equal(reset.passwordVersion, created.passwordVersion + 1);
    assert.equal(decryptCustomerPassword(reset.passwordEncrypted), replacementPassword);
    assert.equal(await loadCustomerPortalPrincipal(originalSession), null, "identity or password changes must revoke old sessions");

    await prisma.customerPortalLoginCode.create({
      data: {
        officeId: officeA.id,
        userId: created.id,
        email: reset.email,
        codeHash: "test-code",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await removeCustomerPortalAccountRecord({
      officeId: officeA.id,
      userId: created.id,
      companyId: companyA1.id,
    });

    const removed = await prisma.customerPortalUser.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(removed.isActive, false);
    assert.equal(isRemovedCustomerUsername(removed.username), true);
    assert.equal(removed.passwordHash, null);
    assert.equal(removed.passwordEncrypted, null);
    assert.equal(removed.passwordVersion, reset.passwordVersion + 1);
    assert.equal(
      await prisma.customerPortalMembership.count({ where: { officeId: officeA.id, userId: created.id, isActive: true } }),
      0,
      "deleting one multi-company user must revoke every company membership",
    );
    assert.equal(
      await prisma.supplyWorkspaceMember.count({
        where: {
          officeId: officeA.id,
          userId: created.internalUserId!,
          workspaceId: { in: [workspaceA1.id, workspaceA2.id] },
          isActive: true,
        },
      }),
      0,
      "deleting one multi-company user must revoke every workspace membership",
    );
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: created.internalUserId! } })).isActive,
      false,
    );
    assert.equal(
      await prisma.customerPortalLoginCode.count({ where: { userId: created.id, consumedAt: null } }),
      0,
    );
    assert.ok(
      await prisma.customerPortalAction.findUnique({ where: { id: auditAction.id } }),
      "audit records must survive customer user removal",
    );
    await expectNotFound(() => updateCustomerPortalAccountRecord({
      ...updateInput,
      officeId: officeA.id,
      companyId: companyA1.id,
      username: `${username}-stale-edit`,
      email: managedCustomerEmail(`${username}-stale-edit`),
    }));
    const stillRemoved = await prisma.customerPortalUser.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(stillRemoved.isActive, false, "a stale edit must not restore a removed customer user");
    assert.equal(isRemovedCustomerUsername(stillRemoved.username), true);
    assert.ok(await prisma.supplyWorkspace.findUnique({ where: { id: workspaceB.id } }));

    console.log("Customer portal account admin database test passed.");
  } finally {
    await prisma.office.delete({ where: { id: officeA.id } }).catch(() => null);
    await prisma.office.delete({ where: { id: officeB.id } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
