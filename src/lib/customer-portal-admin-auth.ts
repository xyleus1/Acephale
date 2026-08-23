import "server-only";

import { prisma } from "@/lib/prisma";

type CustomerManagementSession = {
  userId: string;
  officeId: string;
  role: string;
  accessKind?: string;
};

export async function resolveCustomerManagementOperator(
  session: CustomerManagementSession,
  allowedRoles: readonly ("ADMIN" | "MANAGER")[],
) {
  if (session.accessKind === "customer" || session.role === "CUSTOMER") return null;
  const operator = await prisma.user.findFirst({
    where: {
      id: session.userId,
      officeId: session.officeId,
      isActive: true,
      role: { in: [...allowedRoles] },
    },
    select: {
      email: true,
      role: true,
      canViewWholeOffice: true,
      customerPortalIdentity: { select: { id: true } },
    },
  });
  return operator && !operator.customerPortalIdentity ? operator : null;
}

export async function requireCustomerManagementOperator(
  session: CustomerManagementSession,
  allowedRoles: readonly ("ADMIN" | "MANAGER")[],
) {
  const operator = await resolveCustomerManagementOperator(session, allowedRoles);
  if (!operator) throw new Error("Not authorized.");
  return operator;
}
