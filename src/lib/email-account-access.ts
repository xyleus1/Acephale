import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canManageEmailAccounts } from "@/lib/email-account-policy";

export async function isEmailAccountAdminSession(session: { userId: string; officeId: string }) {
  const actor = await prisma.user.findFirst({
    where: {
      id: session.userId,
      officeId: session.officeId,
      isActive: true,
    },
    select: { role: true },
  });
  return actor ? canManageEmailAccounts(actor) : false;
}

export async function requireEmailAccountAdminSession() {
  const session = await requireSession();
  if (!(await isEmailAccountAdminSession(session))) redirect("/dashboard/supply-os");
  return session;
}
