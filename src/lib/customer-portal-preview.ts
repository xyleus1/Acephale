import "server-only";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import type { CustomerPortalPrincipal } from "@/lib/customer-portal-data";
import { prisma } from "@/lib/prisma";

export async function requireCustomerPortalPreviewPrincipal(
  companyId: string | null | undefined,
): Promise<CustomerPortalPrincipal | null> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && session.role !== "MANAGER") {
    redirect("/dashboard");
  }
  if (!companyId) return null;

  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      officeId: session.officeId,
    },
    select: {
      id: true,
      name: true,
    },
  });
  if (!company) return null;

  return {
    id: `internal-preview:${session.userId}`,
    officeId: session.officeId,
    email: session.email,
    fullName: null,
    memberships: [
      {
        id: `internal-preview:${company.id}`,
        companyId: company.id,
        role: "MEMBER",
        company,
      },
    ],
  };
}
