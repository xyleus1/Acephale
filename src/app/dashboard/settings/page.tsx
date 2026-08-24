import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { supplyAccessContext } from "@/lib/supply-os/http";
import { getSupplyWorkspaceManagement } from "@/lib/supply-os/workspace-management";
import { CustomerSettings } from "./customer-settings";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; workspaceId?: string }>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  const previewMode = session.accessKind !== "customer" && query.preview === "customer";
  if (session.accessKind === "customer" || previewMode) {
    const workspaceId = previewMode
      ? query.workspaceId ?? null
      : query.workspaceId && session.restrictedWorkspaceIds?.includes(query.workspaceId)
        ? query.workspaceId
        : session.restrictedWorkspaceIds?.[0] ?? null;
    if (!workspaceId) redirect("/dashboard/supply-os" as Route);
    const settings = await getSupplyWorkspaceManagement(supplyAccessContext(session), workspaceId);
    const account = session.customerPortalUserId
      ? await prisma.customerPortalUser.findFirst({
          where: { id: session.customerPortalUserId, officeId: session.officeId, isActive: true },
          select: { username: true, fullName: true },
        })
      : null;
    return (
      <CustomerSettings
        initialSettings={settings}
        account={{
          name: previewMode ? settings.companyName : account?.fullName || settings.companyName,
          username: previewMode ? "No customer identity impersonated" : account?.username || "Customer account",
          role: previewMode ? "Read-only preview" : session.customerRole || "MEMBER",
        }}
        canEdit={!previewMode && session.customerRole !== "VIEWER"}
        previewMode={previewMode}
        backHref={previewMode
          ? `/dashboard/supply-os?previewWorkspace=${encodeURIComponent(workspaceId)}`
          : "/dashboard/supply-os"}
      />
    );
  }
  redirect((session.role === "ADMIN"
    ? "/dashboard/settings/customers"
    : "/dashboard/settings/integrations") as Route);
}
