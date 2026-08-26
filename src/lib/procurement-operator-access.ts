import "server-only";

import { prisma } from "@/lib/prisma";
import { SupplyPersistenceError, type SupplyAccessContext } from "@/lib/supply-os/persistence";

// Operator commands write execution tasks and supply events, both of which
// record an acting user, so a command runs as the office operator who owns the
// sourcing request rather than as an anonymous caller.
export async function procurementOperatorAccess(officeId: string): Promise<SupplyAccessContext> {
  const user = await prisma.user.findFirst({
    where: {
      officeId,
      isActive: true,
      customerPortalIdentity: null,
      OR: [{ role: "ADMIN" }, { role: "MANAGER" }, { canViewWholeOffice: true }],
    },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, role: true, canViewWholeOffice: true },
  });
  if (!user) {
    throw new SupplyPersistenceError("This office has no active operator who can run supplier commands.", "forbidden");
  }
  return {
    officeId,
    userId: user.id,
    role: user.role,
    canViewWholeOffice: user.canViewWholeOffice,
    accessKind: "operator",
  };
}
