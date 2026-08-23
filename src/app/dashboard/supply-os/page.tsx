import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SupplyOsOperatingShell } from "./supply-os-operating-shell";
import styles from "./supply-os-logistics.module.css";

export const metadata: Metadata = {
  title: { absolute: "Derya" },
  description: "Supply planning workspace.",
};

export default async function SupplyOsPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  const session = await requireSession();
  const currentUser = await prisma.user.findFirst({
    where: { id: session.userId, officeId: session.officeId, isActive: true },
    select: { role: true },
  });
  if (!currentUser) redirect("/login");
  const params = await searchParams;
  const contextEnabled = true;
  if (params.panel === "suppliers" || params.panel === "fulfillment" || params.panel === "tracking") {
    redirect("/dashboard/supply-os");
  }
  if (params.panel === "automations") {
    redirect("/dashboard/supply-os?panel=context");
  }
  return (
    <div className={styles.pageFrame}>
      <SupplyOsOperatingShell
        storageScope={`${session.officeId}:${session.userId}`}
        accountRole={currentUser.role}
        initialPanel={params.panel}
        canCreateCompany={currentUser.role === "ADMIN"}
        canImportSupplyData={currentUser.role === "ADMIN" || currentUser.role === "MANAGER"}
        canApproveProcurement={currentUser.role === "ADMIN" || currentUser.role === "MANAGER"}
        canAuthorizePurchase={currentUser.role === "ADMIN"}
        contextEnabled={contextEnabled}
      />
    </div>
  );
}
