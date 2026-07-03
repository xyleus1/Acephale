import "server-only";
import { requireSession } from "@/lib/auth";
import type { CrmUserScope } from "@/lib/crm/scope";

export async function getCrmScope(): Promise<CrmUserScope & { session: Awaited<ReturnType<typeof requireSession>> }> {
  const session = await requireSession();
  return {
    session,
    officeId: session.officeId,
    userId: session.userId,
    canViewAll: session.role === "ADMIN" || session.role === "MANAGER" || session.canViewWholeOffice,
  };
}
