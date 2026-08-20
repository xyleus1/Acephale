import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SupplyOsOperatingShell } from "./supply-os-operating-shell";
import styles from "./supply-os-logistics.module.css";
import { supplyContextEnabled } from "@/lib/supply-os/context-feature";

export const metadata: Metadata = {
  title: { absolute: "Derya" },
  description: "Supply planning workspace.",
};

export default async function SupplyOsPage({
  searchParams,
}: {
  searchParams: Promise<{ present?: string; panel?: string }>;
}) {
  const session = await requireSession();
  const currentUser = await prisma.user.findFirst({
    where: { id: session.userId, officeId: session.officeId, isActive: true },
    select: { role: true },
  });
  if (!currentUser) redirect("/login");
  const params = await searchParams;
  const contextEnabled = supplyContextEnabled(session.officeId);
  if (params.panel === "suppliers") {
    redirect(params.present === "1" ? "/dashboard/supply-os?present=1" : "/dashboard/supply-os");
  }
  if (params.panel === "automations") {
    redirect(contextEnabled
      ? params.present === "1" ? "/dashboard/supply-os?present=1&panel=context" : "/dashboard/supply-os?panel=context"
      : params.present === "1" ? "/dashboard/supply-os?present=1" : "/dashboard/supply-os");
  }
  if (params.panel === "context" && !contextEnabled) redirect(params.present === "1" ? "/dashboard/supply-os?present=1" : "/dashboard/supply-os");
  return (
    <div className={styles.pageFrame}>
      <SupplyOsOperatingShell
        storageScope={`${session.officeId}:${session.userId}`}
        presentationMode={params.present === "1"}
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
