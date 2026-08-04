import type { Route } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icon";
import { LogoMark } from "@/components/logo-mark";
import {
  logoutCustomerPortal,
  requireCustomerPortalPrincipal,
} from "@/lib/customer-portal-auth";
import {
  loadCustomerPortalWorkspace,
  type CustomerPortalPrincipal,
} from "@/lib/customer-portal-data";
import {
  CUSTOMER_PORTAL_STATUS_ORDER,
  CUSTOMER_PORTAL_STATUS_SHORT_LABEL,
  type CustomerPortalShipment,
} from "@/lib/customer-portal-view";
import styles from "../portal-workspace.module.css";

export const metadata = { title: "Shipment overview" };

type WorkspaceParams = {
  company?: string;
  job?: string;
};

function fmtDate(value: Date | null | undefined) {
  if (!value) return "To be confirmed";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(value);
}

function fmtUpdated(value: Date) {
  const elapsed = Date.now() - value.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Updated ${days}d ago`;
}

function workspaceHref(companyId: string) {
  return `/portal/workspace?company=${encodeURIComponent(companyId)}`;
}

function shipmentHref(jobId: string) {
  return `/portal/shipments/${encodeURIComponent(jobId)}`;
}

function statusClass(status: string) {
  if (status === "DELIVERED") return styles.statusDone;
  if (status === "QUOTED") return styles.statusAlert;
  if (status === "CUSTOMS") return styles.statusCustoms;
  return styles.status;
}

function ModeIcon({ mode }: { mode: string | null }) {
  if (mode === "AIR") return <Icon name="plane" size={16} />;
  if (mode === "ROAD") return <Icon name="truck" size={16} />;
  if (mode === "COURIER") return <Icon name="box" size={16} />;
  return <Icon name="ship" size={16} />;
}

function ShipmentProgress({ shipment, compact = false }: { shipment: CustomerPortalShipment; compact?: boolean }) {
  return (
    <div className={compact ? styles.progressCompact : styles.progress} aria-label={`Shipment progress: ${shipment.statusLabel}`}>
      <div className={styles.progressTrack} aria-hidden="true">
        <span style={{ width: `${shipment.progressPercent}%` }} />
      </div>
      <div className={styles.progressSteps}>
        {CUSTOMER_PORTAL_STATUS_ORDER.map((status, index) => (
          <div
            className={index <= shipment.progressIndex ? styles.progressStepDone : styles.progressStep}
            key={status}
          >
            <span className={styles.progressDot} aria-hidden="true" />
            {!compact && <span>{CUSTOMER_PORTAL_STATUS_SHORT_LABEL[status]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function CustomerPortalWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<WorkspaceParams>;
}) {
  const principal = await requireCustomerPortalPrincipal();
  const query = await searchParams;
  const data = await loadCustomerPortalWorkspace(principal as CustomerPortalPrincipal, query.company);
  if (!data) redirect("/portal");

  if (query.job && data.shipments.some((shipment) => shipment.id === query.job)) {
    redirect(shipmentHref(query.job) as Route);
  }

  async function logoutAction() {
    "use server";
    await logoutCustomerPortal();
    redirect("/portal");
  }

  const firstName = principal.fullName?.trim().split(/\s+/)[0] ?? null;
  const canAct = data.membership.role !== "VIEWER";
  const visibleActionCount = canAct ? data.actionCount : 0;

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <a href="/portal/workspace" className={styles.brand}>
            <LogoMark className={styles.brandMark} />
            <div>
              <div className={styles.brandTitle}>{data.officeName}</div>
              <div className={styles.brandSub}>Customer control tower</div>
            </div>
          </a>
          <nav className={styles.portalNav} aria-label="Customer workspace">
            <a className={styles.portalNavActive} href={workspaceHref(data.company.id)}>Overview</a>
            <a className={styles.portalNavLink} href="#shipments">Shipments</a>
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

      <main className={styles.main}>
        {principal.memberships.length > 1 && (
          <nav className={styles.companyNav} aria-label="Companies">
            {principal.memberships.map((membership) => (
              <a
                key={membership.id}
                className={membership.companyId === data.company.id ? styles.companyLinkActive : styles.companyLink}
                href={workspaceHref(membership.companyId)}
              >
                {membership.company.name}
              </a>
            ))}
          </nav>
        )}

        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>{data.company.name}</div>
            <h1 className={styles.title}>{firstName ? `${firstName}, here is your shipment overview` : "Shipment overview"}</h1>
            <p className={styles.subtitle}>
              {canAct
                ? "Track every active shipment, review requested decisions, and find approved documents without chasing email updates."
                : "Track every active shipment and find approved documents without chasing email updates."}
            </p>
          </div>
          <div className={styles.heroSupport}>
            <span className={styles.supportDot} aria-hidden="true" />
            <div>
              <strong>Derya operations is handling your freight</strong>
              <span>{canAct ? "We only surface items that need your input." : "Your portal access is read-only."}</span>
            </div>
          </div>
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <div className={styles.metricIcon}><Icon name="layers" size={17} /></div>
              <div><div className={styles.metricValue}>{data.activeShipments.length}</div><div className={styles.metricLabel}>In progress</div></div>
            </div>
            <div className={styles.metric}>
              <div className={styles.metricIcon}><Icon name="ship" size={17} /></div>
              <div><div className={styles.metricValue}>{data.inTransitShipments.length}</div><div className={styles.metricLabel}>In transit</div></div>
            </div>
            <div className={visibleActionCount > 0 ? styles.metricAttention : styles.metric}>
              <div className={styles.metricIcon}><Icon name="alert" size={17} /></div>
              <div><div className={styles.metricValue}>{visibleActionCount}</div><div className={styles.metricLabel}>Needs your input</div></div>
            </div>
            <div className={styles.metric}>
              <div className={styles.metricIcon}><Icon name="check" size={17} /></div>
              <div><div className={styles.metricValue}>{data.completedShipments.length}</div><div className={styles.metricLabel}>Delivered</div></div>
            </div>
          </div>
        </section>

        {visibleActionCount > 0 && (
          <section className={styles.attentionPanel} aria-labelledby="attention-heading">
            <div className={styles.attentionHeader}>
              <div className={styles.attentionIcon}><Icon name="alert" size={18} /></div>
              <div>
                <h2 id="attention-heading">Your input is needed</h2>
                <p>Derya is handling the operation. These are the only items currently waiting on you.</p>
              </div>
            </div>
            <div className={styles.attentionList}>
              {data.quoteActions.map((shipment) => (
                <a className={styles.attentionRow} href={shipmentHref(shipment.id)} key={`quote-${shipment.id}`}>
                  <div>
                    <strong>Review quote for {shipment.reference}</strong>
                    <span>{shipment.route}</span>
                  </div>
                  <span className={styles.attentionAction}>Review quote <Icon name="arrow-right" size={14} /></span>
                </a>
              ))}
              {data.documentActions.map(({ shipment, document }) => (
                <a className={styles.attentionRow} href={`${shipmentHref(shipment.id)}#documents`} key={`document-${document.id}`}>
                  <div>
                    <strong>Upload {document.name}</strong>
                    <span>{shipment.reference} · {shipment.route}</span>
                  </div>
                  <span className={styles.attentionAction}>Open request <Icon name="arrow-right" size={14} /></span>
                </a>
              ))}
            </div>
          </section>
        )}

        <section className={styles.shipmentSection} id="shipments" aria-labelledby="active-shipments-heading">
          <div className={styles.sectionHeading}>
            <div>
              <div className={styles.eyebrow}>Live operations</div>
              <h2 id="active-shipments-heading">Active shipments</h2>
            </div>
            <span>{data.activeShipments.length} total</span>
          </div>

          <div className={styles.shipmentList}>
            {data.activeShipments.length > 0 ? data.activeShipments.map((shipment) => (
              <a className={styles.shipmentCard} href={shipmentHref(shipment.id)} key={shipment.id}>
                <div className={styles.shipmentIdentity}>
                  <div className={styles.modeIcon}><ModeIcon mode={shipment.mode} /></div>
                  <div>
                    <div className={styles.shipmentReference}>{shipment.reference}</div>
                    <div className={styles.shipmentTitle}>{shipment.title}</div>
                  </div>
                </div>
                <div className={styles.routeBlock}>
                  <div className={styles.routeLine}>
                    <span className={styles.routePoint} aria-hidden="true" />
                    <span className={styles.routePath} aria-hidden="true" />
                    <span className={styles.routePointDestination} aria-hidden="true" />
                  </div>
                  <div className={styles.routeLabels}>
                    <span>{shipment.origin ?? "Origin pending"}</span>
                    <Icon name="arrow-right" size={13} />
                    <span>{shipment.destination ?? "Destination pending"}</span>
                  </div>
                </div>
                <div className={styles.shipmentProgressBlock}>
                  <div className={styles.shipmentProgressTop}>
                    <span className={statusClass(shipment.status)}>{shipment.statusLabel}</span>
                    <span>{fmtUpdated(shipment.updatedAt)}</span>
                  </div>
                  <ShipmentProgress shipment={shipment} compact />
                  <div className={styles.nextMilestone}>
                    {shipment.nextMilestone
                      ? `Next: ${shipment.nextMilestone.label}${shipment.nextMilestone.plannedAt ? ` · ${fmtDate(shipment.nextMilestone.plannedAt)}` : ""}`
                      : `${shipment.completedMilestones} milestones completed`}
                  </div>
                </div>
                <div className={styles.shipmentDates}>
                  <div><span>ETD</span><strong>{fmtDate(shipment.etd)}</strong></div>
                  <div><span>ETA</span><strong>{fmtDate(shipment.eta)}</strong></div>
                </div>
                <span className={styles.openShipment} aria-label={`Open ${shipment.reference}`}><Icon name="chevron-right" size={18} /></span>
              </a>
            )) : (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}><Icon name="ship" size={22} /></div>
                <h3>No active shipments</h3>
                <p>Send your next request to <a href="mailto:rfq@usederya.com">rfq@usederya.com</a>. It will appear here after intake.</p>
              </div>
            )}
          </div>
        </section>

        <div className={styles.lowerGrid}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Open requests</h2>
                <p className={styles.cardCopy}>RFQs that are still being qualified or priced.</p>
              </div>
              <span className={styles.count}>{data.inquiries.length}</span>
            </div>
            <div className={styles.rowList}>
              {data.inquiries.length > 0 ? data.inquiries.map((inquiry) => (
                <div className={styles.row} key={inquiry.id}>
                  <div>
                    <div className={styles.rowTitle}>{inquiry.reference ?? inquiry.subject}</div>
                    <div className={styles.rowMeta}>
                      {inquiry.origin && inquiry.destination ? `${inquiry.origin} to ${inquiry.destination}` : inquiry.subject}
                    </div>
                  </div>
                  <span className={styles.status}>{inquiry.status.toLowerCase()}</span>
                </div>
              )) : <div className={styles.empty}>No standalone RFQs are waiting.</div>}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Delivered shipments</h2>
                <p className={styles.cardCopy}>Completed shipment records and published documents.</p>
              </div>
              <span className={styles.count}>{data.completedShipments.length}</span>
            </div>
            <div className={styles.rowList}>
              {data.completedShipments.length > 0 ? data.completedShipments.slice(0, 5).map((shipment) => (
                <a className={styles.rowLink} href={shipmentHref(shipment.id)} key={shipment.id}>
                  <div>
                    <div className={styles.rowTitle}>{shipment.reference} · {shipment.title}</div>
                    <div className={styles.rowMeta}>{shipment.route}</div>
                  </div>
                  <span className={styles.statusDone}>Delivered</span>
                </a>
              )) : <div className={styles.empty}>Delivered shipments will remain available here.</div>}
            </div>
          </section>
        </div>

        <section className={styles.requestStrip}>
          <div>
            <strong>Need to start another shipment?</strong>
            <span>Email the lane, cargo, dimensions or container, weight, and requested timing.</span>
          </div>
          <a className={styles.button} href="mailto:rfq@usederya.com">Email a new request <Icon name="arrow-right" size={14} /></a>
        </section>
      </main>
    </div>
  );
}
