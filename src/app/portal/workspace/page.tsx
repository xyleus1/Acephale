import type { Metadata, Route } from "next";
import { notFound, redirect } from "next/navigation";
import { LogoMark } from "@/components/logo-mark";
import {
  CustomerOperationsOverview,
} from "@/app/portal/components/customer-operations-overview";
import {
  logoutCustomerPortal,
  requireCustomerPortalPrincipal,
} from "@/lib/customer-portal-auth";
import {
  loadCustomerPortalWorkspace,
  type CustomerPortalPrincipal,
} from "@/lib/customer-portal-data";
import {
  customerPortalProcurementHref,
  customerPortalShipmentHref,
  customerPortalWorkspaceHref,
} from "@/lib/customer-portal-navigation";
import { requireCustomerPortalPreviewPrincipal } from "@/lib/customer-portal-preview";
import { buildCustomerPortalOperationsBrief } from "@/lib/customer-portal-view";
import styles from "../portal-workspace.module.css";

export const metadata: Metadata = {
  title: { absolute: "Freight operations | Derya" },
};

type WorkspaceParams = {
  company?: string;
  job?: string;
  preview?: string;
};

export default async function CustomerPortalWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<WorkspaceParams>;
}) {
  const query = await searchParams;
  const isPreview = query.preview === "1";
  if (!isPreview) {
    await requireCustomerPortalPrincipal();
    redirect("/dashboard/supply-os");
  }
  const principal = await requireCustomerPortalPreviewPrincipal(query.company);
  if (!principal) notFound();

  const data = await loadCustomerPortalWorkspace(principal as CustomerPortalPrincipal, query.company);
  if (!data) {
    if (isPreview) notFound();
    redirect("/portal");
  }

  const navigationContext = {
    companyId: data.company.id,
    isPreview,
  };

  if (query.job && data.shipments.some((shipment) => shipment.id === query.job)) {
    redirect(customerPortalShipmentHref(query.job, navigationContext) as Route);
  }

  async function logoutAction() {
    "use server";
    await logoutCustomerPortal();
    redirect("/portal");
  }

  const canAct = data.membership.role !== "VIEWER";
  const now = new Date();
  const shipmentHrefs = Object.fromEntries(data.shipments.map((shipment) => [
    shipment.id,
    customerPortalShipmentHref(shipment.id, navigationContext),
  ]));

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <a href={customerPortalWorkspaceHref(data.company.id, isPreview)} className={styles.brand}>
            <LogoMark className={styles.brandMark} />
            <div>
              <div className={styles.brandTitle}>{data.officeName}</div>
              <div className={styles.brandSub}>Shipment workspace</div>
            </div>
          </a>
          <nav className={styles.portalNav} aria-label="Customer workspace">
            <a aria-current="page" className={styles.portalNavActive} href={customerPortalWorkspaceHref(data.company.id, isPreview)}>Overview</a>
            <a className={styles.portalNavLink} href="#shipments">Shipments</a>
            {!isPreview ? <a className={styles.portalNavLink} href={customerPortalProcurementHref(data.company.id)}>Procurement</a> : null}
            <a className={styles.portalNavLink} href="mailto:rfq@usederya.com">New request</a>
          </nav>
          <div className={styles.userNav}>
            <span>{isPreview ? "Customer preview" : principal.email}</span>
            {isPreview ? (
              <a className={styles.signOutButton} href="/dashboard/customer-portal">Exit preview</a>
            ) : (
              <form action={logoutAction}>
                <button className={styles.signOutButton} type="submit">Sign out</button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {isPreview && (
          <aside className={styles.previewBanner} aria-label="Customer preview mode">
            <div>
              <strong>Customer preview: {data.company.name}</strong>
              <span>This is the member experience using current shipment data. Quote and upload actions are disabled.</span>
            </div>
            <a href="/dashboard/customer-portal">Exit preview</a>
          </aside>
        )}

        {principal.memberships.length > 1 && (
          <nav className={styles.companyNav} aria-label="Companies">
            {principal.memberships.map((membership) => (
              <a
                key={membership.id}
                className={membership.companyId === data.company.id ? styles.companyLinkActive : styles.companyLink}
                href={customerPortalWorkspaceHref(membership.companyId, isPreview)}
              >
                {membership.company.name}
              </a>
            ))}
          </nav>
        )}

        <CustomerOperationsOverview
          companyName={data.company.name}
          now={now}
          canAct={canAct}
          activeShipments={data.activeShipments}
          completedShipments={data.completedShipments}
          inTransitShipments={data.inTransitShipments}
          quoteActions={data.quoteActions}
          documentActions={data.documentActions}
          openRequests={data.inquiries}
          operationsBrief={buildCustomerPortalOperationsBrief(data.shipments, now)}
          shipmentHrefs={shipmentHrefs}
        />
      </main>
    </div>
  );
}
