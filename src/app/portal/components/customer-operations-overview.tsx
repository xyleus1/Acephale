import { Icon } from "@/components/icon";
import type {
  CustomerPortalOperationsBrief,
  CustomerPortalShipment,
} from "@/lib/customer-portal-view";
import {
  CUSTOMER_PORTAL_STATUS_ORDER,
  CUSTOMER_PORTAL_STATUS_SHORT_LABEL,
} from "@/lib/customer-portal-view";
import styles from "../portal-workspace.module.css";

export type CustomerPortalOpenRequest = {
  id: string;
  reference: string | null;
  subject: string;
  status: string;
  origin: string | null;
  destination: string | null;
};

type CustomerOperationsOverviewProps = {
  companyName: string;
  now: Date;
  canAct: boolean;
  activeShipments: CustomerPortalShipment[];
  completedShipments: CustomerPortalShipment[];
  inTransitShipments: CustomerPortalShipment[];
  quoteActions: CustomerPortalShipment[];
  documentActions: Array<{
    shipment: CustomerPortalShipment;
    document: CustomerPortalShipment["documentRequests"][number];
  }>;
  openRequests: CustomerPortalOpenRequest[];
  operationsBrief: CustomerPortalOperationsBrief;
  shipmentHrefs: Record<string, string>;
};

function fmtDate(value: Date | null | undefined) {
  if (!value) return "To be confirmed";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function fmtUpdated(value: Date, now: Date) {
  const elapsed = now.getTime() - value.getTime();
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${Math.floor(hours / 24)}d ago`;
}

function dateDistance(daysFromToday: number) {
  if (daysFromToday === 0) return "Today";
  if (daysFromToday === 1) return "Tomorrow";
  if (daysFromToday < 0) {
    const days = Math.abs(daysFromToday);
    return `${days} day${days === 1 ? "" : "s"} past plan`;
  }
  return `In ${daysFromToday} days`;
}

function statusClass(status: string) {
  if (status === "DELIVERED") return styles.statusDone;
  if (status === "QUOTED") return styles.statusAlert;
  if (status === "CUSTOMS") return styles.statusCustoms;
  return styles.status;
}

function updateKindLabel(kind: CustomerPortalOperationsBrief["recentUpdates"][number]["kind"]) {
  if (kind === "MILESTONE") return "Milestone";
  if (kind === "DOCUMENT") return "Published file";
  if (kind === "DOCUMENT_REVIEW") return "Document review";
  return "Quote response";
}

function ModeIcon({ mode }: { mode: string | null }) {
  if (mode === "AIR") return <Icon name="plane" size={16} />;
  if (mode === "ROAD") return <Icon name="truck" size={16} />;
  if (mode === "COURIER") return <Icon name="box" size={16} />;
  return <Icon name="ship" size={16} />;
}

function ShipmentProgress({ shipment }: { shipment: CustomerPortalShipment }) {
  return (
    <div className={styles.progressCompact} aria-label={`Shipment progress: ${shipment.statusLabel}`}>
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
            <span className={styles.srOnly}>{CUSTOMER_PORTAL_STATUS_SHORT_LABEL[status]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function shipmentHref(shipmentHrefs: Record<string, string>, shipmentId: string, anchor?: string) {
  const href = shipmentHrefs[shipmentId] ?? "#shipments";
  return anchor ? `${href}#${anchor}` : href;
}

export function CustomerOperationsOverview({
  companyName,
  now,
  canAct,
  activeShipments,
  completedShipments,
  inTransitShipments,
  quoteActions,
  documentActions,
  openRequests,
  operationsBrief,
  shipmentHrefs,
}: CustomerOperationsOverviewProps) {
  const visibleQuoteActions = canAct ? quoteActions : [];
  const visibleDocumentActions = canAct ? documentActions : [];
  const actionCount = visibleQuoteActions.length + visibleDocumentActions.length;
  const latestPublishedUpdate = operationsBrief.recentUpdates[0]?.occurredAt ?? null;
  const visibleUpdates = operationsBrief.recentUpdates.slice(0, 6);
  const overdueShipmentIds = new Set<string>();
  const visibleOverdueMilestones = operationsBrief.overdueMilestones.filter((milestone) => {
    if (overdueShipmentIds.has(milestone.shipmentId)) return false;
    overdueShipmentIds.add(milestone.shipmentId);
    return true;
  }).slice(0, 3);
  const scheduledShipmentIds = new Set(visibleOverdueMilestones.map((milestone) => milestone.shipmentId));
  const visibleUpcomingMilestones = operationsBrief.upcomingMilestones.filter((milestone) => {
    if (scheduledShipmentIds.has(milestone.shipmentId)) return false;
    scheduledShipmentIds.add(milestone.shipmentId);
    return true;
  }).slice(0, 7);

  return (
    <>
      <section className={styles.operationsHero} aria-labelledby="operations-heading">
        <div className={styles.operationsHeading}>
          <div>
            <div className={styles.eyebrow}>{companyName}</div>
            <h1 className={styles.operationsTitle} id="operations-heading">Freight operations</h1>
          </div>
          <div className={styles.publishedStamp}>
            <span>Latest workspace update</span>
            <strong>{latestPublishedUpdate ? fmtDate(latestPublishedUpdate) : "No workspace update"}</strong>
          </div>
        </div>
        <p className={styles.operationsLead}>
          {actionCount > 0
            ? `${actionCount} item${actionCount === 1 ? "" : "s"} need your team. `
            : "Nothing is waiting on your team. "}
          {activeShipments.length} active shipment{activeShipments.length === 1 ? "" : "s"}, with {inTransitShipments.length} in transit or customs.
        </p>
        <div className={styles.operationsSummary} aria-label="Current shipment and document summary">
          <span><strong>{activeShipments.length}</strong> active</span>
          <span><strong>{inTransitShipments.length}</strong> in transit / customs</span>
          <span><strong>{operationsBrief.documents.published}</strong> published files</span>
          <span><strong>{operationsBrief.documents.underReview}</strong> under review</span>
          <span className={actionCount > 0 ? styles.summaryAttention : undefined}><strong>{actionCount}</strong> from your team</span>
        </div>
      </section>

      <div className={styles.operationsGrid}>
        <section className={styles.operationsDesk} aria-labelledby="customer-actions-heading">
          <header className={styles.operationsSectionHeader}>
            <div>
              <span className={styles.sectionKicker}>Customer queue</span>
              <h2 id="customer-actions-heading">Your actions</h2>
            </div>
            <span>{actionCount}</span>
          </header>
          {actionCount > 0 ? (
            <div className={styles.actionLedger}>
              {visibleQuoteActions.map((shipment) => (
                <a
                  className={styles.actionLedgerRow}
                  href={shipmentHref(shipmentHrefs, shipment.id, "quote")}
                  key={`quote-${shipment.id}`}
                >
                  <span className={styles.actionType}>Quote</span>
                  <span className={styles.actionCopy}>
                    <strong>Approve or change {shipment.reference}</strong>
                    <small>{shipment.route}</small>
                  </span>
                  <span className={styles.actionDue}>Ready now</span>
                  <Icon name="arrow-right" size={15} />
                </a>
              ))}
              {visibleDocumentActions.map(({ shipment, document }) => (
                <a
                  className={styles.actionLedgerRow}
                  href={shipmentHref(shipmentHrefs, shipment.id, "documents")}
                  key={`document-${document.id}`}
                >
                  <span className={styles.actionType}>Document</span>
                  <span className={styles.actionCopy}>
                    <strong>Upload {document.name}</strong>
                    <small>{shipment.reference} · {shipment.route}</small>
                  </span>
                  <span className={styles.actionDue}>Needed</span>
                  <Icon name="arrow-right" size={15} />
                </a>
              ))}
            </div>
          ) : (
            <div className={styles.operationsEmpty}>
              <strong>No action needed</strong>
              <span>Derya will place quote decisions and requested uploads here.</span>
            </div>
          )}
        </section>

        <section className={styles.scheduleDesk} aria-labelledby="schedule-heading">
          <header className={styles.operationsSectionHeader}>
            <div>
              <span className={styles.sectionKicker}>Recorded plan</span>
              <h2 id="schedule-heading">Schedule watch</h2>
            </div>
            <span>21 days</span>
          </header>
          <div className={styles.scheduleLedger}>
            {visibleOverdueMilestones.map((milestone) => (
              <a
                className={styles.scheduleWatchRow}
                href={shipmentHref(shipmentHrefs, milestone.shipmentId)}
                key={`overdue-${milestone.id}`}
              >
                <span className={styles.scheduleDate}>{fmtDate(milestone.plannedAt)}</span>
                <span>
                  <strong>{milestone.label}</strong>
                  <small>{milestone.reference} · Awaiting confirmation</small>
                </span>
                <span className={styles.scheduleLate}>{dateDistance(milestone.daysFromToday)}</span>
              </a>
            ))}
            {visibleUpcomingMilestones.map((milestone) => (
              <a
                className={styles.scheduleRow}
                href={shipmentHref(shipmentHrefs, milestone.shipmentId)}
                key={`upcoming-${milestone.id}`}
              >
                <span className={styles.scheduleDate}>{fmtDate(milestone.plannedAt)}</span>
                <span>
                  <strong>{milestone.label}</strong>
                  <small>{milestone.reference} · {milestone.route}</small>
                </span>
                <span>{dateDistance(milestone.daysFromToday)}</span>
              </a>
            ))}
            {visibleOverdueMilestones.length === 0 && visibleUpcomingMilestones.length === 0 && (
              <div className={styles.operationsEmpty}>
                <strong>No confirmed dates in the next 21 days</strong>
                <span>Planned milestones will appear after Derya records them.</span>
              </div>
            )}
          </div>
          {operationsBrief.overdueMilestones.length > 0 && (
            <p className={styles.scheduleNote}>A planned date passed without a confirmed milestone update. Derya is responsible for publishing the next confirmation.</p>
          )}
        </section>
      </div>

      <section className={styles.shipmentSection} id="shipments" aria-labelledby="active-shipments-heading">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>Current loads</span>
            <h2 id="active-shipments-heading">Active shipments</h2>
          </div>
          <span>{activeShipments.length} total</span>
        </div>

        <div className={styles.shipmentList}>
          {activeShipments.length > 0 ? activeShipments.map((shipment) => (
            <a className={styles.shipmentCard} href={shipmentHref(shipmentHrefs, shipment.id)} key={shipment.id}>
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
                  <span>{fmtUpdated(shipment.updatedAt, now)}</span>
                </div>
                <ShipmentProgress shipment={shipment} />
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
              <h3>No active shipments</h3>
              <p>Send your next request to <a href="mailto:rfq@usederya.com">rfq@usederya.com</a>. It will appear here after intake.</p>
            </div>
          )}
        </div>
      </section>

      <div className={styles.activityGrid}>
        <section className={styles.activityDesk} aria-labelledby="recent-updates-heading">
          <header className={styles.operationsSectionHeader}>
            <div>
              <span className={styles.sectionKicker}>Shared activity</span>
              <h2 id="recent-updates-heading">Recent updates</h2>
            </div>
            <span>{visibleUpdates.length}</span>
          </header>
          <div className={styles.activityLedger}>
            {visibleUpdates.length > 0 ? visibleUpdates.map((update) => (
              <a
                className={styles.activityRow}
                href={shipmentHref(shipmentHrefs, update.shipmentId, update.kind.startsWith("DOCUMENT") ? "documents" : undefined)}
                key={update.id}
              >
                <span className={styles.activityDate}>{fmtDate(update.occurredAt)}</span>
                <span className={styles.activityCopy}>
                  <strong>{update.label}</strong>
                  <small>{update.reference} · {update.detail}</small>
                </span>
                <span className={styles.activityKind}>{updateKindLabel(update.kind)}</span>
              </a>
            )) : (
              <div className={styles.operationsEmpty}>
                <strong>No published updates yet</strong>
                <span>Confirmed milestones and approved files will appear here.</span>
              </div>
            )}
          </div>
        </section>

        <div className={styles.recordsDesk}>
          <section aria-labelledby="open-requests-heading">
            <header className={styles.operationsSectionHeader}>
              <div>
                <span className={styles.sectionKicker}>Before booking</span>
                <h2 id="open-requests-heading">Open requests</h2>
              </div>
              <span>{openRequests.length}</span>
            </header>
            <div className={styles.compactLedger}>
              {openRequests.length > 0 ? openRequests.map((request) => (
                <div className={styles.compactRow} key={request.id}>
                  <span>
                    <strong>{request.reference ?? request.subject}</strong>
                    <small>{request.origin && request.destination ? `${request.origin} to ${request.destination}` : request.subject}</small>
                  </span>
                  <span>{request.status.toLowerCase()}</span>
                </div>
              )) : <div className={styles.compactEmpty}>No standalone RFQs are waiting.</div>}
            </div>
          </section>

          <section aria-labelledby="delivered-heading">
            <header className={styles.operationsSectionHeader}>
              <div>
                <span className={styles.sectionKicker}>Archive</span>
                <h2 id="delivered-heading">Delivered</h2>
              </div>
              <span>{completedShipments.length}</span>
            </header>
            <div className={styles.compactLedger}>
              {completedShipments.length > 0 ? completedShipments.slice(0, 5).map((shipment) => (
                <a className={styles.compactRowLink} href={shipmentHref(shipmentHrefs, shipment.id)} key={shipment.id}>
                  <span>
                    <strong>{shipment.reference} · {shipment.title}</strong>
                    <small>{shipment.route}</small>
                  </span>
                  <span>Delivered</span>
                </a>
              )) : <div className={styles.compactEmpty}>Delivered shipments will remain available here.</div>}
            </div>
          </section>
        </div>
      </div>

      <section className={styles.requestStrip}>
        <div>
          <strong>Start another shipment</strong>
          <span>Email the lane, cargo details, weight, and timing.</span>
        </div>
        <a className={styles.button} href="mailto:rfq@usederya.com">Email a new request <Icon name="arrow-right" size={14} /></a>
      </section>
    </>
  );
}
