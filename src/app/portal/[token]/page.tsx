import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPlausiblePortalToken } from "@/lib/portal-token";

const STATUS_ORDER = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "DELIVERED"] as const;

const STATUS_LABEL: Record<string, string> = {
  INQUIRY: "RFQ",
  QUOTED: "Pricing",
  BOOKED: "Booked",
  IN_TRANSIT: "In transit",
  CUSTOMS: "In transit",
  DELIVERED: "Delivered",
};

const MILESTONE_LABEL: Record<string, string> = {
  BOOKING: "Booking",
  CARGO_READY: "Cargo ready",
  ETD: "ETD",
  ETA: "ETA",
  CUSTOMS_ENTRY: "Customs entry",
  CUSTOMS_RELEASE: "Customs release",
  DELIVERY: "Delivery",
};

const MODE_LABEL: Record<string, string> = {
  "SEA-FCL": "Sea FCL",
  "SEA-LCL": "Sea LCL",
  AIR: "Air",
  ROAD: "Road",
  COURIER: "Courier",
};

const jobPortalInclude = {
  company: { select: { name: true } },
  milestones: { orderBy: { createdAt: "asc" } },
  documents: {
    where: { status: "APPROVED", customerVisible: true },
    orderBy: { createdAt: "asc" },
  },
  office: { select: { name: true } },
} satisfies Prisma.JobInclude;

function fmt(d: Date | null | undefined) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isPlausiblePortalToken(token)) notFound();

  const job = await prisma.job.findUnique({
    where: { portalToken: token },
    include: jobPortalInclude,
  });

  if (!job) notFound();

  const visibleStatus = job.status === "CUSTOMS" ? "IN_TRANSIT" : job.status;
  const currentIdx = (STATUS_ORDER as readonly string[]).indexOf(visibleStatus);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const workflowMilestones = job.milestones.filter((milestone) =>
    Object.prototype.hasOwnProperty.call(MILESTONE_LABEL, milestone.type)
  );
  const totalMs = workflowMilestones.length;
  const doneMs = workflowMilestones.filter((m) => m.actualAt).length;
  const routeLabel = job.origin && job.destination ? `${job.origin} to ${job.destination}` : "Route TBD";
  const routeDetails = [
    routeLabel,
    job.mode ? MODE_LABEL[job.mode] ?? job.mode : null,
    job.commodity,
  ].filter(Boolean);
  const currentStatusLabel = STATUS_LABEL[visibleStatus] ?? visibleStatus;

  return (
    <div className="portal-shell">
      <header className="portal-topbar">
        <div className="portal-topbar-inner">
          <div className="portal-brand">
            <span className="portal-mark" aria-hidden>
              D
            </span>
            <div className="portal-brand-copy">
              <div className="portal-office">{job.office?.name ?? "Derya"}</div>
              <div className="portal-subtitle">Shipment portal</div>
            </div>
          </div>
          <div className="portal-system-note">Read-only status feed</div>
        </div>
      </header>

      <main className="portal-main">
        <section className="portal-hero" aria-labelledby="portal-title">
          <div className="portal-reference">{job.reference}</div>
          <h1 id="portal-title" className="portal-title">
            {job.company?.name ?? "Your shipment"}
          </h1>
          <div className="portal-route">{routeDetails.join(" - ")}</div>
          <div className="portal-hero-meta">
            <span>{currentStatusLabel}</span>
            <span>{doneMs} of {totalMs || 1} milestones complete</span>
          </div>
        </section>

        <section className="portal-card portal-card-status" aria-labelledby="portal-status-title">
          <div className="portal-card-header">
            <div>
              <div id="portal-status-title" className="portal-section-title">
                Current status
              </div>
              <div className="portal-section-copy">Current shipment status published by the Derya operations desk.</div>
            </div>
            <div className="portal-status-chip">{currentStatusLabel}</div>
          </div>
          <div className="portal-status-grid">
            {STATUS_ORDER.map((status, i) => {
              const isDone = currentIdx >= 0 && i <= currentIdx;
              const isCurrent = i === currentIdx;
              return (
                <div
                  key={status}
                  className={["portal-step", isDone ? "done" : "", isCurrent ? "current" : ""].filter(Boolean).join(" ")}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  <span className="portal-step-line" aria-hidden />
                  <span className="portal-step-dot" aria-hidden />
                  <span className="portal-step-label">{STATUS_LABEL[status]}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="portal-metric-grid" aria-label="Shipment summary">
          {[
            { label: "Status", value: currentStatusLabel },
            { label: "Reference", value: job.reference },
            { label: "Progress", value: totalMs > 0 ? `${doneMs} / ${totalMs}` : "Pending" },
            { label: "ETD", value: fmt(job.etd) },
            { label: "ETA", value: fmt(job.eta) },
          ].map((metric) => (
            <div key={metric.label} className="portal-metric-card">
              <div className="portal-metric-label">{metric.label}</div>
              <div className="portal-metric-value">{metric.value}</div>
            </div>
          ))}
        </section>

        <section className="portal-card" aria-labelledby="portal-milestones-title">
          <div className="portal-card-header">
            <div>
              <div id="portal-milestones-title" className="portal-section-title">
                Shipment milestones
              </div>
              <div className="portal-section-copy">Only operational milestones that matter to the customer are shown.</div>
            </div>
          </div>
          <div className="portal-row-list">
            {workflowMilestones.length > 0 ? (
              workflowMilestones.map((milestone) => {
                const isDone = !!milestone.actualAt;
                const isLate = !!milestone.plannedAt && !isDone && new Date(milestone.plannedAt) < today;
                return (
                  <div key={milestone.id} className="portal-row">
                    <div className="portal-row-main">
                      <span
                        className={["portal-row-dot", isDone ? "done" : "", isLate ? "late" : ""].filter(Boolean).join(" ")}
                        aria-hidden
                      />
                      <div>
                        <div className="portal-row-title">{MILESTONE_LABEL[milestone.type] ?? milestone.type}</div>
                        <div className="portal-row-sub">
                          {isDone ? "Confirmed" : isLate ? "Needs attention" : "Scheduled"}
                        </div>
                      </div>
                    </div>
                    <div className={["portal-row-side", isLate ? "late" : ""].filter(Boolean).join(" ")}>
                      {isDone
                        ? `Done ${fmt(milestone.actualAt)}`
                        : milestone.plannedAt
                          ? `Planned ${fmt(milestone.plannedAt)}`
                          : "-"}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="portal-empty-row">Milestones will appear here once the shipment is booked.</div>
            )}
          </div>
        </section>

        {job.documents.length > 0 && (
          <section className="portal-card" aria-labelledby="portal-documents-title">
            <div className="portal-card-header">
              <div>
                <div id="portal-documents-title" className="portal-section-title">
                  Approved documents
                </div>
                <div className="portal-section-copy">Customer-visible files only.</div>
              </div>
            </div>
            <div className="portal-row-list">
              {job.documents.map((document) => (
                <div key={document.id} className="portal-row">
                  <div className="portal-row-main document">
                    <span className="portal-doc-icon" aria-hidden />
                    <div>
                      <div className="portal-row-title">{document.name}</div>
                      <div className="portal-row-sub">
                        Approved - {fmt(document.updatedAt)}
                      </div>
                    </div>
                  </div>
                  {document.url && !document.url.includes("placeholder") ? (
                    <a
                      className="portal-document-link"
                      href={`/api/portal/documents/${document.id}?token=${encodeURIComponent(token)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open
                    </a>
                  ) : (
                    <span className="portal-muted">File pending</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="portal-footer">
          Questions? Reply to your forwarder's latest email. For all company shipments and quote actions, <a href="/portal">sign in to the customer workspace</a>.
        </footer>
      </main>
    </div>
  );
}
