import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listSwitchableOffices } from "@/lib/office-switch";
import { SupplyOsOperatingShell } from "./supply-os-operating-shell";
import { switchOfficeAction } from "./actions";
import styles from "./supply-os-logistics.module.css";

export const metadata: Metadata = {
  title: { absolute: "Derya" },
  description: "Supply planning workspace.",
};

export default async function SupplyOsPage({
  searchParams,
}: {
  searchParams: Promise<{
    panel?: string;
    previewWorkspace?: string;
    workspace?: string;
    materialsView?: string;
    researchList?: string;
    q?: string;
    status?: string;
    page?: string;
  }>;
}) {
  const session = await requireSession();
  const currentUser = await prisma.user.findFirst({
    where: { id: session.userId, officeId: session.officeId, isActive: true },
    select: { role: true },
  });
  if (!currentUser) redirect("/login");
  const params = await searchParams;
  const isCustomer = session.accessKind === "customer";
  const previewWorkspace = !isCustomer
    && params.previewWorkspace
    && (session.role === "ADMIN" || session.role === "MANAGER")
    ? await prisma.supplyWorkspace.findFirst({
        where: { id: params.previewWorkspace, officeId: session.officeId, status: "ACTIVE" },
        select: { id: true },
      })
    : null;
  const initialWorkspace = !isCustomer
    && !previewWorkspace
    && params.workspace
    ? await prisma.supplyWorkspace.findFirst({
        where: { id: params.workspace, officeId: session.officeId, status: "ACTIVE" },
        select: { id: true },
      })
    : null;
  const previewMode = Boolean(previewWorkspace);
  const canSwitchOffice = !previewMode
    && session.accessKind !== "customer"
    && session.role !== "CUSTOMER";
  const switchableOffices = canSwitchOffice
    ? await listSwitchableOffices(session)
    : [];
  const allowedWorkspaceIds = isCustomer
    ? session.restrictedWorkspaceIds
    : previewWorkspace ? [previewWorkspace.id] : undefined;
  const customerCanEdit = isCustomer && session.customerRole !== "VIEWER";
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
        accountRole={isCustomer || previewMode ? "CUSTOMER" : currentUser.role}
        initialPanel={params.panel}
        canCreateCompany={!isCustomer && !previewMode && currentUser.role === "ADMIN"}
        canImportSupplyData={!previewMode && (customerCanEdit || (!isCustomer && (currentUser.role === "ADMIN" || currentUser.role === "MANAGER")))}
        canApproveProcurement={!previewMode && (customerCanEdit || (!isCustomer && (currentUser.role === "ADMIN" || currentUser.role === "MANAGER")))}
        canAuthorizePurchase={!previewMode && (customerCanEdit || (!isCustomer && currentUser.role === "ADMIN"))}
        contextEnabled={contextEnabled}
        allowedWorkspaceIds={allowedWorkspaceIds}
        initialWorkspaceId={initialWorkspace?.id}
        initialMaterialsView={
          !isCustomer && !previewMode && (params.materialsView === "prospects" || params.materialsView === "messages")
            ? params.materialsView
            : undefined
        }
        initialResearchListSlug={!isCustomer && !previewMode ? params.researchList : undefined}
        previewMode={previewMode}
        switchableOffices={switchableOffices.length > 1 ? switchableOffices : undefined}
        switchOfficeAction={switchableOffices.length > 1 ? switchOfficeAction : undefined}
      />
    </div>
  );
}
