import "dotenv/config";
import assert from "node:assert/strict";
import {
  requireCompanyContextWorkspace,
  resolveCustomerContextAccessForWorkspace,
  resolveCustomerContextWorkspace,
} from "../src/lib/customer-context-access";
import {
  appendRateLimitedCustomerContextMessage,
  CompanyContextLimitError,
  CUSTOMER_CONTEXT_STORAGE_MAX_BYTES,
  reserveCustomerContextUploadRequest,
  uploadCompanyContextDocument,
} from "../src/lib/company-context";
import { prisma } from "../src/lib/prisma";
import {
  archiveSupplyCustomerWorkspace,
  grantSupplyCustomerPortalAccess,
} from "../src/lib/supply-os/customer-workspace";
import { SupplyPersistenceError } from "../src/lib/supply-os/persistence";

async function main() {
  assert(process.env.DATABASE_URL, "DATABASE_URL is required for the customer Context database test.");
  const runId = `customer-context-access-${Date.now()}`;
  const [officeA, officeB] = await Promise.all([
    prisma.office.create({ data: { name: `${runId}-a` } }),
    prisma.office.create({ data: { name: `${runId}-b` } }),
  ]);

  try {
    const [companyA, companyB] = await Promise.all([
      prisma.company.create({ data: { officeId: officeA.id, name: `${runId}-company-a` } }),
      prisma.company.create({ data: { officeId: officeB.id, name: `${runId}-company-b` } }),
    ]);
    const [workspaceA, workspaceB] = await Promise.all([
      prisma.supplyWorkspace.create({
        data: { officeId: officeA.id, companyId: companyA.id, name: `${runId}-workspace-a` },
      }),
      prisma.supplyWorkspace.create({
        data: { officeId: officeB.id, companyId: companyB.id, name: `${runId}-workspace-b` },
      }),
    ]);
    const officeAAdmin = await prisma.user.create({
      data: {
        officeId: officeA.id,
        email: `${runId}-admin@example.com`,
        passwordHash: "test",
        fullName: "Context Test Admin",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const portalUser = await prisma.customerPortalUser.create({
      data: { officeId: officeA.id, email: `${runId}@example.com`, fullName: "Context Test Customer" },
    });
    const portalUserB = await prisma.customerPortalUser.create({
      data: {
        officeId: officeB.id,
        email: `${runId}-other-office@example.com`,
        fullName: "Other Office Customer",
      },
    });
    await assert.rejects(
      () => prisma.companyContext.create({
        data: {
          officeId: officeA.id,
          companyId: companyA.id,
          kind: "MESSAGE",
          name: "Cross-office portal creator",
          createdByPortalUserId: portalUserB.id,
          customerVisible: true,
        },
      }),
      (error) => error instanceof Error
        && error.message.includes("CompanyContext portal creator is outside the office scope"),
      "the database must reject a portal creator from another office",
    );
    const membership = await prisma.customerPortalMembership.create({
      data: {
        officeId: officeA.id,
        userId: portalUser.id,
        companyId: companyA.id,
        role: "VIEWER",
      },
    });
    const principal = {
      id: portalUser.id,
      officeId: officeA.id,
      memberships: [{ id: membership.id, companyId: companyA.id, role: membership.role }],
    };

    const selected = await resolveCustomerContextWorkspace(principal, companyA.id);
    assert.equal(selected?.workspace.id, workspaceA.id, "active assigned workspace should resolve");
    assert.equal(
      await resolveCustomerContextWorkspace(principal, companyB.id),
      null,
      "another office must not resolve",
    );
    assert.equal(
      await resolveCustomerContextAccessForWorkspace(principal, workspaceB.id),
      null,
      "another office workspace must not resolve",
    );
    assert.equal(
      (await resolveCustomerContextAccessForWorkspace(principal, workspaceA.id))?.membershipRole,
      "VIEWER",
      "the current membership role should be re-read from the database",
    );

    await assert.rejects(
      () => requireCompanyContextWorkspace(selected!.access, workspaceA.id, "edit"),
      (error) => error instanceof SupplyPersistenceError && error.code === "forbidden",
      "VIEWER must not edit customer Context",
    );

    await prisma.customerPortalMembership.update({
      where: { id: membership.id },
      data: { role: "MEMBER" },
    });
    await requireCompanyContextWorkspace(selected!.access, workspaceA.id, "edit");

    const messageAttempts = await Promise.allSettled(Array.from({ length: 3 }, (_, index) => (
      appendRateLimitedCustomerContextMessage({
        context: selected!.access,
        workspaceId: workspaceA.id,
        body: `Concurrent message ${index}`,
        maxMessages: 2,
        windowMs: 15 * 60 * 1000,
      })
    )));
    assert.equal(messageAttempts.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(messageAttempts.filter((result) => (
      result.status === "rejected"
      && result.reason instanceof CompanyContextLimitError
      && result.reason.code === "message_rate"
    )).length, 1, "concurrent customer messages must share one atomic rate limit");

    await prisma.companyContext.createMany({
      data: Array.from({ length: 39 }, (_, index) => ({
        officeId: officeA.id,
        companyId: companyA.id,
        kind: "UPLOAD_REQUEST",
        name: `Upload request ${index}`,
        processingState: "READY",
        createdByPortalUserId: portalUser.id,
        customerVisible: true,
      })),
    });
    const uploadAttempts = await Promise.allSettled([
      reserveCustomerContextUploadRequest({ context: selected!.access, workspaceId: workspaceA.id }),
      reserveCustomerContextUploadRequest({ context: selected!.access, workspaceId: workspaceA.id }),
    ]);
    assert.equal(uploadAttempts.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(uploadAttempts.filter((result) => (
      result.status === "rejected"
      && result.reason instanceof CompanyContextLimitError
      && result.reason.code === "upload_rate"
    )).length, 1, "concurrent uploads must share one atomic company request quota");
    await prisma.companyContext.deleteMany({
      where: { officeId: officeA.id, companyId: companyA.id, kind: "UPLOAD_REQUEST" },
    });

    const quotaRow = await prisma.companyContext.create({
      data: {
        officeId: officeA.id,
        companyId: companyA.id,
        kind: "DOCUMENT",
        name: "Existing company storage",
        sizeBytes: CUSTOMER_CONTEXT_STORAGE_MAX_BYTES,
        contentHash: `quota-${runId}`,
        processingState: "READY",
      },
    });
    await assert.rejects(
      () => uploadCompanyContextDocument({
        context: selected!.access,
        workspaceId: workspaceA.id,
        file: new File(["blocked by quota"], "quota.txt", { type: "text/plain" }),
      }),
      (error) => error instanceof CompanyContextLimitError && error.code === "document_storage",
      "company storage quota must be reserved before document processing",
    );
    await prisma.companyContext.delete({ where: { id: quotaRow.id } });

    await prisma.customerPortalMembership.update({
      where: { id: membership.id },
      data: { isActive: false },
    });
    assert.equal(
      await resolveCustomerContextAccessForWorkspace(principal, workspaceA.id),
      null,
      "disabled company access must be rejected",
    );

    await prisma.customerPortalMembership.update({
      where: { id: membership.id },
      data: { isActive: true },
    });
    const raceEmail = `${runId}-race@example.com`;
    await Promise.all([
      grantSupplyCustomerPortalAccess({
        officeId: officeA.id,
        companyId: companyA.id,
        email: raceEmail,
        fullName: "Archive Race Customer",
        role: "MEMBER",
      }),
      archiveSupplyCustomerWorkspace({
        officeId: officeA.id,
        userId: officeAAdmin.id,
        role: "ADMIN",
        canViewWholeOffice: true,
      }, workspaceA.id),
    ]);
    const raceMembership = await prisma.customerPortalMembership.findFirst({
      where: { officeId: officeA.id, companyId: companyA.id, user: { email: raceEmail } },
      select: { isActive: true },
    });
    assert.notEqual(raceMembership?.isActive, true, "archiving must win over a concurrent access grant");
    assert.equal(
      await resolveCustomerContextWorkspace(principal, companyA.id),
      null,
      "archived workspaces must be rejected",
    );

    console.log("Customer Context database access test passed.");
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
