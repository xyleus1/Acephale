import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CustomerContextWorkspace } from "@/app/portal/components/customer-context-workspace";
import { LogoMark } from "@/components/logo-mark";
import { logoutCustomerPortal, requireCustomerPortalPrincipal } from "@/lib/customer-portal-auth";
import { customerPortalWorkspaceHref } from "@/lib/customer-portal-navigation";
import styles from "../portal-workspace.module.css";
import { supplyContextEnabled } from "@/lib/supply-os/context-feature";

export const metadata: Metadata = { title: { absolute: "Company context | Derya" } };

export default async function CustomerContextPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const principal = await requireCustomerPortalPrincipal();
  if (!principal) notFound();
  if (!supplyContextEnabled(principal.officeId)) notFound();
  const query = await searchParams;
  const membership = principal.memberships.find((item) => item.companyId === query.company) ?? principal.memberships[0];
  if (!membership) redirect("/portal");
  async function logoutAction() { "use server"; await logoutCustomerPortal(); redirect("/portal"); }
  return <div className={styles.shell}>
    <header className={styles.topbar}><div className={styles.topbarInner}>
      <a href={customerPortalWorkspaceHref(membership.companyId, false)} className={styles.brand}><LogoMark className={styles.brandMark} /><div><div className={styles.brandTitle}>Derya</div><div className={styles.brandSub}>{membership.company.name}</div></div></a>
      <nav className={styles.portalNav} aria-label="Customer workspace"><a className={styles.portalNavLink} href={customerPortalWorkspaceHref(membership.companyId, false)}>Overview</a><a aria-current="page" className={styles.portalNavActive} href={`/portal/context?company=${encodeURIComponent(membership.companyId)}`}>Context</a><a className={styles.portalNavLink} href="mailto:rfq@usederya.com">New request</a></nav>
      <div className={styles.userNav}><span>{principal.email}</span><form action={logoutAction}><button className={styles.signOutButton} type="submit">Sign out</button></form></div>
    </div></header>
    <main className={styles.main}>
      {principal.memberships.length > 1 ? <nav className={styles.companyNav} aria-label="Companies">{principal.memberships.map((item) => <a key={item.id} className={item.companyId === membership.companyId ? styles.companyLinkActive : styles.companyLink} href={`/portal/context?company=${encodeURIComponent(item.companyId)}`}>{item.company.name}</a>)}</nav> : null}
      <CustomerContextWorkspace companyId={membership.companyId} canAct={membership.role !== "VIEWER"} />
    </main>
  </div>;
}
