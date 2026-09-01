import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/logo-mark";
import { SupplyOsContext } from "@/app/dashboard/supply-os/supply-os-context";
import {
  logoutCustomerPortal,
  requireCustomerPortalPrincipal,
} from "@/lib/customer-portal-auth";
import {
  customerContextCanEditRole,
  resolveCustomerContextWorkspace,
  selectCustomerContextMembership,
} from "@/lib/customer-context-access";
import {
  customerPortalProcurementHref,
  customerPortalWorkspaceHref,
} from "@/lib/customer-portal-navigation";
import styles from "../portal-workspace.module.css";

export const metadata: Metadata = {
  title: { absolute: "Procurement | Derya" },
};

export default async function CustomerProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const principal = await requireCustomerPortalPrincipal();
  const query = await searchParams;
  const membership = selectCustomerContextMembership(principal.memberships, query.company);
  if (!membership) redirect("/portal/workspace");
  const selected = await resolveCustomerContextWorkspace(principal, membership.companyId);
  const company = principal.memberships.find((entry) => entry.companyId === membership.companyId)?.company;
  if (!company) redirect("/portal/workspace");

  async function logoutAction() {
    "use server";
    await logoutCustomerPortal();
    redirect("/portal");
  }

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <a href={customerPortalWorkspaceHref(company.id)} className={styles.brand}>
            <LogoMark className={styles.brandMark} />
            <div>
              <div className={styles.brandTitle}>{company.name}</div>
              <div className={styles.brandSub}>Customer workspace</div>
            </div>
          </a>
          <nav className={styles.portalNav} aria-label="Customer workspace">
            <a className={styles.portalNavLink} href={customerPortalWorkspaceHref(company.id)}>Overview</a>
            <a className={styles.portalNavLink} href={`${customerPortalWorkspaceHref(company.id)}#shipments`}>Shipments</a>
            <a aria-current="page" className={styles.portalNavActive} href={customerPortalProcurementHref(company.id)}>Procurement</a>
            <a className={styles.portalNavLink} href="mailto:rfq@usederya.com">New request</a>
          </nav>
          <div className={styles.userNav}>
            <span>{principal.email}</span>
            <form action={logoutAction}>
              <button className={styles.signOutButton} type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className={`${styles.main} ${styles.procurementMain}`}>
        {principal.memberships.length > 1 ? (
          <nav className={styles.companyNav} aria-label="Companies">
            {principal.memberships.map((entry) => (
              <a
                key={entry.id}
                className={entry.companyId === company.id ? styles.companyLinkActive : styles.companyLink}
                href={customerPortalProcurementHref(entry.companyId)}
              >
                {entry.company.name}
              </a>
            ))}
          </nav>
        ) : null}

        {selected ? (
          <div className={styles.procurementFrame}>
            <SupplyOsContext
              workspaceId={selected.workspace.id}
              apiBasePath={`/api/portal/procurement/${selected.workspace.id}/context`}
              readOnly={!customerContextCanEditRole(membership.role)}
              messageRole="CUSTOMER"
              showOrderId={false}
              memoryEnabled={false}
              threadDeleteEnabled={false}
            />
          </div>
        ) : (
          <section className={styles.procurementUnavailable}>
            <strong>Procurement unavailable</strong>
            <span>Contact your Derya operator.</span>
          </section>
        )}
      </main>
    </div>
  );
}
