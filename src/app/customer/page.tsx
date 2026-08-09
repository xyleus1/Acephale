import type { Metadata } from "next";
import { CustomerOperationsOverview } from "@/app/portal/components/customer-operations-overview";
import { Icon } from "@/components/icon";
import { LogoMark } from "@/components/logo-mark";
import {
  buildCustomerPortalShipment,
  buildCustomerPortalOperationsBrief,
  CUSTOMER_PORTAL_STATUS_ORDER,
  CUSTOMER_PORTAL_STATUS_SHORT_LABEL,
  customerPortalCanRespondToQuote,
  type CustomerPortalShipment,
} from "@/lib/customer-portal-view";
import portalStyles from "../portal/portal-workspace.module.css";
import previewStyles from "./customer-preview.module.css";

export const metadata: Metadata = {
  title: { absolute: "Customer preview | Derya" },
  robots: { index: false, follow: false },
};

type CustomerPreviewParams = {
  shipment?: string;
};

type DemoJob = Parameters<typeof buildCustomerPortalShipment>[0];

const PREVIEW_NOW = new Date("2026-08-04T16:00:00.000Z");

const demoJobs: DemoJob[] = [
  {
    id: "dry-2608-014",
    reference: "DRY-2608-014",
    title: "Electronics enclosures",
    status: "QUOTED",
    mode: "SEA-FCL",
    origin: "Shenzhen, CN",
    destination: "Long Beach, US",
    commodity: "Aluminum electronics enclosures",
    incoterms: "FOB",
    weight: 12400,
    volume: 61,
    packages: 24,
    containerCount: 1,
    containerType: "40HC",
    etd: new Date("2026-08-12T00:00:00.000Z"),
    eta: new Date("2026-09-02T00:00:00.000Z"),
    currency: "USD",
    quoteLines: "Ocean freight|3850|USD\nOrigin handling|420|USD\nDocumentation|95|USD",
    createdAt: new Date("2026-08-02T15:00:00.000Z"),
    updatedAt: new Date("2026-08-04T15:42:00.000Z"),
    milestones: [
      { id: "014-booking", type: "BOOKING", plannedAt: new Date("2026-08-07T00:00:00.000Z"), actualAt: null },
      { id: "014-ready", type: "CARGO_READY", plannedAt: new Date("2026-08-09T00:00:00.000Z"), actualAt: null },
      { id: "014-etd", type: "ETD", plannedAt: new Date("2026-08-12T00:00:00.000Z"), actualAt: null },
      { id: "014-eta", type: "ETA", plannedAt: new Date("2026-09-02T00:00:00.000Z"), actualAt: null },
      { id: "014-delivery", type: "DELIVERY", plannedAt: new Date("2026-09-06T00:00:00.000Z"), actualAt: null },
    ],
    documents: [
      {
        id: "014-commercial-invoice",
        name: "Commercial invoice",
        docType: "INVOICE",
        status: "PENDING",
        customerVisible: false,
        customerRequested: true,
        updatedAt: new Date("2026-08-04T14:00:00.000Z"),
      },
      {
        id: "014-quote",
        name: "Customer quote.pdf",
        docType: "QUOTE",
        status: "APPROVED",
        customerVisible: true,
        customerRequested: false,
        updatedAt: new Date("2026-08-04T15:40:00.000Z"),
      },
    ],
    customerPortalActions: [],
  },
  {
    id: "dry-2607-089",
    reference: "DRY-2607-089",
    title: "CNC machine components",
    status: "IN_TRANSIT",
    mode: "SEA-FCL",
    origin: "Busan, KR",
    destination: "Seattle, US",
    commodity: "Machined steel components",
    incoterms: "FCA",
    weight: 18600,
    volume: 49,
    packages: 18,
    containerCount: 1,
    containerType: "40GP",
    etd: new Date("2026-07-27T00:00:00.000Z"),
    eta: new Date("2026-08-15T00:00:00.000Z"),
    currency: "USD",
    quoteLines: "Ocean freight|4210|USD\nDestination handling|680|USD",
    createdAt: new Date("2026-07-15T17:00:00.000Z"),
    updatedAt: new Date("2026-08-04T12:20:00.000Z"),
    milestones: [
      { id: "089-booking", type: "BOOKING", plannedAt: new Date("2026-07-19T00:00:00.000Z"), actualAt: new Date("2026-07-18T00:00:00.000Z") },
      { id: "089-ready", type: "CARGO_READY", plannedAt: new Date("2026-07-23T00:00:00.000Z"), actualAt: new Date("2026-07-23T00:00:00.000Z") },
      { id: "089-etd", type: "ETD", plannedAt: new Date("2026-07-27T00:00:00.000Z"), actualAt: new Date("2026-07-28T00:00:00.000Z") },
      { id: "089-eta", type: "ETA", plannedAt: new Date("2026-08-15T00:00:00.000Z"), actualAt: null },
      { id: "089-customs", type: "CUSTOMS_ENTRY", plannedAt: new Date("2026-08-16T00:00:00.000Z"), actualAt: null },
      { id: "089-delivery", type: "DELIVERY", plannedAt: new Date("2026-08-19T00:00:00.000Z"), actualAt: null },
    ],
    documents: [
      {
        id: "089-packing-list",
        name: "Packing list",
        docType: "PACKING_LIST",
        status: "UPLOADED",
        customerVisible: false,
        customerRequested: true,
        updatedAt: new Date("2026-08-04T11:30:00.000Z"),
      },
      {
        id: "089-bill-of-lading",
        name: "House bill of lading.pdf",
        docType: "BL",
        status: "APPROVED",
        customerVisible: true,
        customerRequested: false,
        updatedAt: new Date("2026-07-29T18:00:00.000Z"),
      },
    ],
    customerPortalActions: [
      {
        id: "089-quote-accepted",
        type: "QUOTE_ACCEPTED",
        status: "RESOLVED",
        message: null,
        createdAt: new Date("2026-07-18T16:00:00.000Z"),
        portalUser: { fullName: "Alex Morgan", email: "alex@northstar.example" },
      },
    ],
  },
  {
    id: "dry-2607-104",
    reference: "DRY-2607-104",
    title: "Prototype sensor assemblies",
    status: "CUSTOMS",
    mode: "AIR",
    origin: "Frankfurt, DE",
    destination: "Chicago, US",
    commodity: "Industrial sensor assemblies",
    incoterms: "DAP",
    weight: 820,
    volume: 4.8,
    packages: 12,
    containerCount: null,
    containerType: null,
    etd: new Date("2026-08-01T00:00:00.000Z"),
    eta: new Date("2026-08-04T00:00:00.000Z"),
    currency: "USD",
    quoteLines: "Air freight|6140|USD\nCustoms entry|275|USD",
    createdAt: new Date("2026-07-24T16:00:00.000Z"),
    updatedAt: new Date("2026-08-04T15:05:00.000Z"),
    milestones: [
      { id: "104-booking", type: "BOOKING", plannedAt: new Date("2026-07-27T00:00:00.000Z"), actualAt: new Date("2026-07-27T00:00:00.000Z") },
      { id: "104-ready", type: "CARGO_READY", plannedAt: new Date("2026-07-30T00:00:00.000Z"), actualAt: new Date("2026-07-30T00:00:00.000Z") },
      { id: "104-etd", type: "ETD", plannedAt: new Date("2026-08-01T00:00:00.000Z"), actualAt: new Date("2026-08-01T00:00:00.000Z") },
      { id: "104-eta", type: "ETA", plannedAt: new Date("2026-08-04T00:00:00.000Z"), actualAt: new Date("2026-08-04T00:00:00.000Z") },
      { id: "104-entry", type: "CUSTOMS_ENTRY", plannedAt: new Date("2026-08-04T00:00:00.000Z"), actualAt: null },
      { id: "104-release", type: "CUSTOMS_RELEASE", plannedAt: new Date("2026-08-05T00:00:00.000Z"), actualAt: null },
      { id: "104-delivery", type: "DELIVERY", plannedAt: new Date("2026-08-06T00:00:00.000Z"), actualAt: null },
    ],
    documents: [
      {
        id: "104-air-waybill",
        name: "Air waybill.pdf",
        docType: "AWB",
        status: "APPROVED",
        customerVisible: true,
        customerRequested: false,
        updatedAt: new Date("2026-08-02T13:00:00.000Z"),
      },
      {
        id: "104-customs-packet",
        name: "Customs entry packet.pdf",
        docType: "CUSTOMS",
        status: "APPROVED",
        customerVisible: true,
        customerRequested: false,
        updatedAt: new Date("2026-08-04T14:45:00.000Z"),
      },
    ],
    customerPortalActions: [],
  },
  {
    id: "dry-2606-041",
    reference: "DRY-2606-041",
    title: "Assembly line tooling",
    status: "DELIVERED",
    mode: "ROAD",
    origin: "Monterrey, MX",
    destination: "Austin, US",
    commodity: "Manufacturing tooling",
    incoterms: "DDP",
    weight: 5400,
    volume: 18,
    packages: 9,
    containerCount: null,
    containerType: null,
    etd: new Date("2026-06-22T00:00:00.000Z"),
    eta: new Date("2026-06-27T00:00:00.000Z"),
    currency: "USD",
    quoteLines: "Cross-border trucking|2950|USD\nCustoms clearance|340|USD",
    createdAt: new Date("2026-06-15T00:00:00.000Z"),
    updatedAt: new Date("2026-06-28T18:00:00.000Z"),
    milestones: [
      { id: "041-booking", type: "BOOKING", plannedAt: new Date("2026-06-18T00:00:00.000Z"), actualAt: new Date("2026-06-18T00:00:00.000Z") },
      { id: "041-ready", type: "CARGO_READY", plannedAt: new Date("2026-06-21T00:00:00.000Z"), actualAt: new Date("2026-06-21T00:00:00.000Z") },
      { id: "041-etd", type: "ETD", plannedAt: new Date("2026-06-22T00:00:00.000Z"), actualAt: new Date("2026-06-22T00:00:00.000Z") },
      { id: "041-delivery", type: "DELIVERY", plannedAt: new Date("2026-06-27T00:00:00.000Z"), actualAt: new Date("2026-06-27T00:00:00.000Z") },
    ],
    documents: [
      {
        id: "041-proof-of-delivery",
        name: "Proof of delivery.pdf",
        docType: "POD",
        status: "APPROVED",
        customerVisible: true,
        customerRequested: false,
        updatedAt: new Date("2026-06-28T17:00:00.000Z"),
      },
    ],
    customerPortalActions: [],
  },
];

const shipments = demoJobs.map(buildCustomerPortalShipment);
const activeShipments = shipments.filter((shipment) => !["DELIVERED", "CANCELLED"].includes(shipment.status));
const completedShipments = shipments.filter((shipment) => shipment.status === "DELIVERED");
const inTransitShipments = shipments.filter((shipment) => ["IN_TRANSIT", "CUSTOMS"].includes(shipment.status));
const quoteActions = shipments.filter((shipment) => customerPortalCanRespondToQuote(shipment) && !shipment.latestQuoteResponse);
const documentActions = shipments.flatMap((shipment) => shipment.documentRequests
  .filter((document) => document.status === "NEEDED")
  .map((document) => ({ shipment, document })));
const shipmentHrefs = Object.fromEntries(shipments.map((shipment) => [
  shipment.id,
  `/customer?shipment=${encodeURIComponent(shipment.id)}`,
]));
const demoOpenRequests = [{
  id: "rfq-2608-031",
  reference: "RFQ-2608-031",
  subject: "Osaka to Dallas production parts",
  status: "QUALIFYING",
  origin: "Osaka, JP",
  destination: "Dallas, US",
}];

function fmtDate(value: Date | null | undefined) {
  if (!value) return "To be confirmed";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function fmtDateTime(value: Date) {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(value);
}

function quoteTotals(lines: Array<{ amount: number; cur: string }>) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isFinite(line.amount)) continue;
    totals.set(line.cur, (totals.get(line.cur) ?? 0) + line.amount);
  }
  return [...totals.entries()];
}

function equipmentLabel(shipment: CustomerPortalShipment) {
  if (shipment.containerCount && shipment.containerType) {
    return `${shipment.containerCount} x ${shipment.containerType}`;
  }
  if (shipment.packages) return `${shipment.packages.toLocaleString()} packages`;
  return shipment.mode ?? "To be confirmed";
}

function statusClass(status: string) {
  if (status === "DELIVERED") return portalStyles.statusDone;
  if (status === "QUOTED") return portalStyles.statusAlert;
  if (status === "CUSTOMS") return portalStyles.statusCustoms;
  return portalStyles.status;
}

function ShipmentProgress({ shipment, compact = false }: { shipment: CustomerPortalShipment; compact?: boolean }) {
  return (
    <div className={compact ? portalStyles.progressCompact : portalStyles.progress} aria-label={`Shipment progress: ${shipment.statusLabel}`}>
      <div className={portalStyles.progressTrack} aria-hidden="true">
        <span style={{ width: `${shipment.progressPercent}%` }} />
      </div>
      <div className={portalStyles.progressSteps}>
        {CUSTOMER_PORTAL_STATUS_ORDER.map((status, index) => (
          <div className={index <= shipment.progressIndex ? portalStyles.progressStepDone : portalStyles.progressStep} key={status}>
            <span className={portalStyles.progressDot} aria-hidden="true" />
            {!compact && <span>{CUSTOMER_PORTAL_STATUS_SHORT_LABEL[status]}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewHeader({ detail }: { detail: boolean }) {
  return (
    <header className={portalStyles.topbar}>
      <div className={portalStyles.topbarInner}>
        <a href="/customer" className={portalStyles.brand}>
          <LogoMark className={portalStyles.brandMark} />
          <div>
            <div className={portalStyles.brandTitle}>Derya</div>
            <div className={portalStyles.brandSub}>Shipment workspace</div>
          </div>
        </a>
        <nav className={portalStyles.portalNav} aria-label="Customer workspace preview">
          <a aria-current={detail ? undefined : "page"} className={detail ? portalStyles.portalNavLink : portalStyles.portalNavActive} href="/customer">Overview</a>
          <a aria-current={detail ? "page" : undefined} className={detail ? portalStyles.portalNavActive : portalStyles.portalNavLink} href="/customer?shipment=dry-2607-089">Shipment</a>
          <a className={portalStyles.portalNavLink} href="mailto:rfq@usederya.com">New request</a>
        </nav>
        <div className={portalStyles.userNav}>
          <span>Development preview</span>
          <a className={portalStyles.signOutButton} href="/portal">Customer sign-in</a>
        </div>
      </div>
    </header>
  );
}

function DevelopmentBanner({ detail }: { detail: boolean }) {
  return (
    <aside className={portalStyles.previewBanner} aria-label="Development preview">
      <div>
        <strong>Development preview with fictional data</strong>
        <span>This page never reads customer accounts, documents, or live shipment records.</span>
      </div>
      <a href={detail ? "/customer" : "/customer?shipment=dry-2607-089"}>{detail ? "Back to overview" : "Open sample shipment"}</a>
    </aside>
  );
}

function CustomerOverview() {
  return (
    <div className={portalStyles.shell}>
      <PreviewHeader detail={false} />
      <main className={portalStyles.main}>
        <DevelopmentBanner detail={false} />
        <CustomerOperationsOverview
          companyName="Northstar Components"
          now={PREVIEW_NOW}
          canAct
          activeShipments={activeShipments}
          completedShipments={completedShipments}
          inTransitShipments={inTransitShipments}
          quoteActions={quoteActions}
          documentActions={documentActions}
          openRequests={demoOpenRequests}
          operationsBrief={buildCustomerPortalOperationsBrief(shipments, PREVIEW_NOW)}
          shipmentHrefs={shipmentHrefs}
        />
      </main>
    </div>
  );
}

function CustomerShipment({ shipment }: { shipment: CustomerPortalShipment }) {
  const totals = quoteTotals(shipment.quoteLines);
  const currentMilestoneId = shipment.nextMilestone?.id ?? null;
  const visibleDocumentCount = shipment.documents.length + shipment.documentRequests.length;

  return (
    <div className={portalStyles.shell}>
      <PreviewHeader detail />
      <main className={portalStyles.main}>
        <DevelopmentBanner detail />
        <a className={portalStyles.backLink} href="/customer"><Icon name="arrow-left" size={14} /> All shipments</a>

        <section className={portalStyles.trackingHero}>
          <div className={portalStyles.trackingTopline}>
            <div><div className={portalStyles.eyebrow}>{shipment.reference}</div><h1 className={portalStyles.trackingTitle}>{shipment.title}</h1></div>
            <div className={portalStyles.trackingStatus}><span className={statusClass(shipment.status)}>{shipment.statusLabel}</span><span>Updated {fmtDateTime(shipment.updatedAt)}</span></div>
          </div>
          <div className={portalStyles.trackingRoute}>
            <div className={portalStyles.trackingLocation}><span>Origin</span><strong>{shipment.origin}</strong></div>
            <div className={portalStyles.trackingRouteLine}><span /><Icon name={shipment.mode === "AIR" ? "plane" : shipment.mode === "ROAD" ? "truck" : "ship"} size={20} /><span /></div>
            <div className={portalStyles.trackingLocationDestination}><span>Destination</span><strong>{shipment.destination}</strong></div>
          </div>
          <ShipmentProgress shipment={shipment} />
          <div className={portalStyles.trackingDates}>
            <div><span>Estimated departure</span><strong>{fmtDate(shipment.etd)}</strong></div>
            <div><span>Estimated arrival</span><strong>{fmtDate(shipment.eta)}</strong></div>
            <div><span>Next milestone</span><strong>{shipment.nextMilestone?.label ?? "No milestone pending"}</strong>{shipment.nextMilestone?.plannedAt && <small>{fmtDate(shipment.nextMilestone.plannedAt)}</small>}</div>
          </div>
          <p className={portalStyles.trackingNote}>Tracking is based on milestones recorded by Derya, not live GPS or vessel position.</p>
        </section>

        <div className={portalStyles.detailLayout}>
          <div className={portalStyles.detailMain}>
            <section className={portalStyles.card}>
              <div className={portalStyles.cardHeader}><div><h2 className={portalStyles.cardTitle}>Shipment timeline</h2><p className={portalStyles.cardCopy}>{shipment.completedMilestones} of {shipment.milestones.length} milestones confirmed.</p></div></div>
              <div className={portalStyles.milestoneTimeline}>
                {shipment.milestones.map((milestone, index) => {
                  const isCurrent = milestone.id === currentMilestoneId;
                  return (
                    <div className={portalStyles.milestoneRow} key={milestone.id}>
                      <div className={portalStyles.milestoneRail}><span className={milestone.actualAt ? portalStyles.milestoneDotDone : isCurrent ? portalStyles.milestoneDotCurrent : portalStyles.milestoneDot} />{index < shipment.milestones.length - 1 && <span className={milestone.actualAt ? portalStyles.milestoneLineDone : portalStyles.milestoneLine} />}</div>
                      <div className={portalStyles.milestoneCopy}><strong>{milestone.label}</strong><span>{milestone.actualAt ? "Confirmed" : isCurrent ? "Next milestone" : "Upcoming"}</span></div>
                      <time>{fmtDate(milestone.actualAt ?? milestone.plannedAt)}</time>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={portalStyles.card}>
              <div className={portalStyles.cardHeader}><div><h2 className={portalStyles.cardTitle}>Shipment details</h2><p className={portalStyles.cardCopy}>Cargo and handling details recorded for this shipment.</p></div></div>
              <div className={portalStyles.factGrid}>
                <div className={portalStyles.fact}><span>Mode</span><strong>{shipment.mode}</strong></div>
                <div className={portalStyles.fact}><span>Equipment</span><strong>{equipmentLabel(shipment)}</strong></div>
                <div className={portalStyles.fact}><span>Commodity</span><strong>{shipment.commodity}</strong></div>
                <div className={portalStyles.fact}><span>Incoterms</span><strong>{shipment.incoterms}</strong></div>
                <div className={portalStyles.fact}><span>Weight</span><strong>{shipment.weight?.toLocaleString()} kg</strong></div>
                <div className={portalStyles.fact}><span>Volume</span><strong>{shipment.volume?.toLocaleString()} cbm</strong></div>
              </div>
            </section>

            {shipment.quoteLines.length > 0 && (
              <section className={portalStyles.card} id="quote">
                <div className={portalStyles.cardHeader}>
                  <div><h2 className={portalStyles.cardTitle}>Customer quote</h2><p className={portalStyles.cardCopy}>Pricing currently attached to this shipment.</p></div>
                  {totals.length === 1 && <strong className={portalStyles.quoteTotal}>{totals[0][1].toLocaleString()} {totals[0][0]}</strong>}
                </div>
                <div className={portalStyles.quoteLines}>
                  {shipment.quoteLines.map((line, index) => <div className={portalStyles.quoteLine} key={`${line.desc}-${index}`}><span>{line.desc}</span><strong>{line.amount.toLocaleString()} {line.cur}</strong></div>)}
                </div>
              </section>
            )}
          </div>

          <aside className={portalStyles.detailAside}>
            {customerPortalCanRespondToQuote(shipment) && (
              <section className={portalStyles.actionCard}>
                <h2>Quote decision</h2>
                <div className={portalStyles.quoteActions}>
                  <button className={portalStyles.buttonWide} type="button" disabled>Approve quote</button>
                  <div className={portalStyles.form}>
                    <label className={portalStyles.label}>Request a change<textarea className={portalStyles.textarea} disabled placeholder="Describe the pricing, scope, or timing change." /></label>
                    <button className={portalStyles.secondaryButtonWide} type="button" disabled>Send change request</button>
                  </div>
                  <p className={portalStyles.actionFootnote}>Controls are disabled because this page uses fictional development data.</p>
                </div>
              </section>
            )}

            <section className={portalStyles.card} id="documents">
              <div className={portalStyles.cardHeader}><div><h2 className={portalStyles.cardTitle}>Documents</h2><p className={portalStyles.cardCopy}>Requested uploads and approved files.</p></div><span className={portalStyles.count}>{visibleDocumentCount}</span></div>
              <div className={portalStyles.documentList}>
                {shipment.documentRequests.length > 0 && (
                  <div className={portalStyles.documentGroup}>
                    <div className={portalStyles.documentGroupLabel}>Requested from you</div>
                    {shipment.documentRequests.map((document) => (
                      <div className={portalStyles.documentRequest} key={document.id}>
                        <div className={portalStyles.documentName}><span><Icon name="file" size={15} /></span><div><strong>{document.name}</strong><small>{document.status === "UNDER_REVIEW" ? "Uploaded, under review" : "Upload needed"}</small></div></div>
                        {document.status === "NEEDED" && <div className={portalStyles.uploadForm}><input className={portalStyles.fileInput} type="file" disabled /><button className={portalStyles.secondaryButtonWide} type="button" disabled>Upload document</button></div>}
                      </div>
                    ))}
                  </div>
                )}
                <div className={portalStyles.documentGroup}>
                  <div className={portalStyles.documentGroupLabel}>Approved files</div>
                  {shipment.documents.map((document) => (
                    <div className={`${portalStyles.documentLink} ${previewStyles.staticDocument}`} key={document.id}>
                      <div className={portalStyles.documentName}><span><Icon name="file-check" size={15} /></span><div><strong>{document.name}</strong><small>{document.docType} · {fmtDate(document.updatedAt)}</small></div></div>
                      <span className={previewStyles.previewOnly}>Preview only</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className={portalStyles.supportCard}>
              <div><strong>Need help with this shipment?</strong><span>Reply to your latest Derya email and include the shipment reference.</span></div>
              <a href="mailto:rfq@usederya.com">Email Derya</a>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default async function CustomerDevelopmentPreviewPage({
  searchParams,
}: {
  searchParams: Promise<CustomerPreviewParams>;
}) {
  const query = await searchParams;
  const shipment = shipments.find((item) => item.id === query.shipment);
  return shipment ? <CustomerShipment shipment={shipment} /> : <CustomerOverview />;
}
