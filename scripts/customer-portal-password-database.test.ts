import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  authenticateCustomerPortal,
  loadCustomerPortalPrincipal,
} from "../src/lib/customer-portal-password";
import { consumeCustomerPortalLoginAttempt } from "../src/lib/customer-portal-login-rate-limit";
import {
  decryptCustomerPassword,
  encryptCustomerPassword,
} from "../src/lib/customer-password-vault";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { grantSupplyCustomerPortalAccess } from "../src/lib/supply-os/customer-workspace";
import {
  currentSupplyAccessContext,
  listSupplyWorkspaces,
} from "../src/lib/supply-os/persistence";

async function main() {
  process.env.AUTH_SECRET = "customer-portal-password-database-test";
  const runId = `customer-password-${Date.now()}`;
  const email = `${runId}@example.com`;
  const username = runId;
  const initialPassword = "Initial-Customer-Password!27";
  const replacementPassword = "Replacement-Customer-Password!54";
  const office = await prisma.office.create({ data: { name: runId } });

  try {
    const company = await prisma.company.create({
      data: {
        officeId: office.id,
        name: `${runId} company`,
        crmStage: "active",
      },
    });
    await prisma.supplyWorkspace.create({
      data: {
        officeId: office.id,
        companyId: company.id,
        name: company.name,
      },
    });

    const initialHash = await hashPassword(initialPassword);
    const initialEncrypted = encryptCustomerPassword(initialPassword);
    await grantSupplyCustomerPortalAccess({
      officeId: office.id,
      companyId: company.id,
      username,
      email,
      fullName: "Password Test Customer",
      role: "MEMBER",
      passwordHash: initialHash,
      passwordEncrypted: initialEncrypted,
    });
    const created = await prisma.customerPortalUser.findUniqueOrThrow({
      where: { officeId_email: { officeId: office.id, email } },
    });
    assert.notEqual(created.passwordHash, initialPassword, "plaintext password must never be stored");
    assert.notEqual(created.passwordEncrypted, initialPassword, "readable passwords must be encrypted at rest");
    assert.equal(decryptCustomerPassword(created.passwordEncrypted), initialPassword);
    assert.ok(created.internalUserId);
    assert.equal(created.passwordVersion, 1);
    assert.ok(created.passwordUpdatedAt);

    assert.equal((await authenticateCustomerPortal(username, initialPassword, office.id)).ok, true);
    const customerAccess = await currentSupplyAccessContext({
      officeId: office.id,
      userId: created.internalUserId!,
      role: "ADMIN",
      canViewWholeOffice: false,
    });
    const customerWorkspaces = await listSupplyWorkspaces(customerAccess);
    assert.deepEqual(customerWorkspaces.map((workspace) => workspace.companyId), [company.id]);
    const originalSession = {
      portalUserId: created.id,
      officeId: office.id,
      username,
      email,
      passwordVersion: 1,
      expiresAt: Date.now() + 60_000,
    };
    assert.ok(await loadCustomerPortalPrincipal(originalSession));
    assert.equal((await authenticateCustomerPortal(email, "Wrong-Customer-Password!", office.id)).ok, false);
    let failedState = await prisma.customerPortalUser.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(failedState.failedLoginAttempts, 1);
    assert.equal(failedState.lockedUntil, null);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      assert.equal(
        (await authenticateCustomerPortal(email, "Wrong-Customer-Password!", office.id)).ok,
        false,
      );
    }
    failedState = await prisma.customerPortalUser.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(failedState.failedLoginAttempts, 5);
    assert.ok(failedState.lockedUntil && failedState.lockedUntil > new Date());
    assert.equal(
      (await authenticateCustomerPortal(email, initialPassword, office.id)).ok,
      false,
      "a locked account must reject the correct password",
    );

    const replacementHash = await hashPassword(replacementPassword);
    const replacementEncrypted = encryptCustomerPassword(replacementPassword);
    await grantSupplyCustomerPortalAccess({
      officeId: office.id,
      companyId: company.id,
      username,
      email,
      fullName: "Password Test Customer",
      role: "MEMBER",
      passwordHash: replacementHash,
      passwordEncrypted: replacementEncrypted,
    });
    const reset = await prisma.customerPortalUser.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(reset.passwordVersion, 2);
    assert.equal(reset.failedLoginAttempts, 0);
    assert.equal(reset.lockedUntil, null);
    assert.equal(
      await loadCustomerPortalPrincipal(originalSession),
      null,
      "a password reset must invalidate sessions issued under the old version",
    );
    assert.ok(await loadCustomerPortalPrincipal({ ...originalSession, passwordVersion: 2 }));
    assert.equal((await authenticateCustomerPortal(username, initialPassword, office.id)).ok, false);
    assert.equal((await authenticateCustomerPortal(username, replacementPassword, office.id)).ok, true);

    const recovered = await prisma.customerPortalUser.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(recovered.failedLoginAttempts, 0);
    assert.equal(recovered.lastFailedLoginAt, null);
    assert.equal(recovered.lockedUntil, null);

    await Promise.all(Array.from({ length: 5 }, () => (
      authenticateCustomerPortal(email, "Concurrent-Wrong-Password!", office.id)
    )));
    const concurrentFailureState = await prisma.customerPortalUser.findUniqueOrThrow({
      where: { id: created.id },
    });
    assert.equal(concurrentFailureState.failedLoginAttempts, 5);
    assert.ok(concurrentFailureState.lockedUntil && concurrentFailureState.lockedUntil > new Date());
    assert.equal(
      (await authenticateCustomerPortal(`${runId}-missing@example.com`, replacementPassword, office.id)).ok,
      false,
    );
    const expiredThrottleTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expiredThrottleAddress = `${runId}-expired`;
    const expiredThrottleKey = createHmac("sha256", process.env.AUTH_SECRET!)
      .update(expiredThrottleAddress)
      .digest("hex");
    await consumeCustomerPortalLoginAttempt(expiredThrottleAddress, expiredThrottleTime);
    assert.ok(await prisma.customerPortalLoginThrottle.findUnique({
      where: { keyHash: expiredThrottleKey },
    }));
    const throttleAddress = `203.0.113.${Date.now()}`;
    assert.equal(await consumeCustomerPortalLoginAttempt(throttleAddress), true);
    assert.equal(
      await prisma.customerPortalLoginThrottle.findUnique({
        where: { keyHash: expiredThrottleKey },
      }),
      null,
      "a login attempt must remove expired throttle rows in a bounded batch",
    );
    for (let attempt = 2; attempt <= 30; attempt += 1) {
      assert.equal(await consumeCustomerPortalLoginAttempt(throttleAddress), true);
    }
    assert.equal(
      await consumeCustomerPortalLoginAttempt(throttleAddress),
      false,
      "the persistent client-address throttle must reject attempt 31",
    );

    console.log("Customer portal password database test passed.");
  } finally {
    await prisma.office.delete({ where: { id: office.id } }).catch(() => null);
    await prisma.$disconnect();
  }
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
