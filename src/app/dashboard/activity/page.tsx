import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { Icon } from "@/components/icon";

const STATUS_LABEL: Record<string, string> = {
  INQUIRY: "RFQ",
  QUOTED: "Pricing",
  BOOKED: "Booked",
  IN_TRANSIT: "En Route",
  CUSTOMS: "En Route",
  DELIVERED: "Delivered",
};

const RFQ_NEXT: Record<string, string> = {
  INGESTED: "Parse with AI",
  PARSED: "Request carrier rates",
  RECEIVED: "Request carrier rates",
  PRICED: "Convert to Job",
  PRICING: "Convert to Job",
  QUOTED: "Awaiting reply",
};

const MILESTONE_LABEL: Record<string, string> = {
  BOOKING: "Booking",
  CARGO_READY: "Cargo Ready",
  ETD: "ETD",
  ETA: "ETA",
  CUSTOMS_ENTRY: "Customs",
  CUSTOMS_RELEASE: "Cleared",
  DELIVERY: "Delivery",
};

function fmtDate(d: Date) {
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function relDays(d: Date) {
  const ms = new Date(d).getTime() - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (days < -1) return `${Math.abs(days)}d ago`;
  if (days === -1) return "yesterday";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days}d`;
}

function StatusPill({ s }: { s: string }) {
  return <span className="control-status-pill">{STATUS_LABEL[s] ?? s}</span>;
}

function SectionCard({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card control-card">
      <header className="control-card-header">
        <div className="control-card-title-row">
          <h2 className="control-card-title">{title}</h2>
          {count != null && <span className="control-card-count">{count}</span>}
        </div>
        {action}
      </header>
      <div>{children}</div>
    </section>
  );
}

export default async function ActivityPage() {
  const session = await requireSession();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in7 = new Date(today.getTime() + 7 * 86_400_000);
  const in3 = new Date(today.getTime() + 3 * 86_400_000);

  const [
    rfqsToParse,
    rfqsToPrice,
    rfqsToConvert,
    jobsMissingRates,
    upcomingMilestones,
    pendingDocs,
    activeJobsCount,
    inTransitValue,
  ] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId: session.officeId, status: "INGESTED" },
      include: { company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 5,
    }),
    prisma.inquiry.findMany({
      // RECEIVED is the canonical successor of the legacy PARSED stage.
      where: { officeId: session.officeId, status: { in: ["PARSED", "RECEIVED"] } },
      include: { company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 5,
    }),
    prisma.inquiry.findMany({
      // PRICING is the canonical successor of the legacy PRICED stage.
      where: { officeId: session.officeId, status: { in: ["PRICED", "PRICING"] }, job: null },
      include: { company: { select: { name: true } } },
      orderBy: { receivedAt: "desc" },
      take: 5,
    }),
    prisma.job.findMany({
      where: {
        officeId: session.officeId,
        status: { in: ["INQUIRY", "QUOTED"] },
        cost: null,
      },
      include: { company: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.jobMilestone.findMany({
      where: {
        type: { in: ["BOOKING", "CARGO_READY", "DELIVERY"] },
        actualAt: null,
        plannedAt: { gte: today, lte: in7 },
        job: { officeId: session.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      },
      include: { job: { include: { company: { select: { name: true } } } } },
      orderBy: { plannedAt: "asc" },
      take: 10,
    }),
    prisma.jobDocument.findMany({
      where: {
        officeId: session.officeId,
        status: "PENDING",
        job: { status: { in: ["BOOKED", "IN_TRANSIT", "CUSTOMS"] } },
      },
      include: { job: { select: { id: true, reference: true, status: true } } },
      take: 10,
    }),
    prisma.job.count({
      where: { officeId: session.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
    }),
    prisma.job.aggregate({
      where: { officeId: session.officeId, status: { in: ["IN_TRANSIT", "CUSTOMS"] } },
      _sum: { revenue: true },
    }),
  ]);

  const totalAttention =
    rfqsToParse.length +
    rfqsToPrice.length +
    rfqsToConvert.length +
    jobsMissingRates.length +
    upcomingMilestones.length;

  const metrics = [
    { label: "Active Jobs", value: activeJobsCount },
    { label: "In-Transit Value", value: `$${(inTransitValue._sum.revenue ?? 0).toLocaleString()}` },
    {
      label: "RFQs to Process",
      value: rfqsToParse.length + rfqsToPrice.length + rfqsToConvert.length,
      tone: "brand",
    },
    {
      label: "Rates Missing",
      value: jobsMissingRates.length,
      tone: jobsMissingRates.length > 0 ? "danger" : "muted",
    },
  ];

  return (
    <div className="control-page">
      <div className="page-header control-page-header">
        <div>
          <h1 className="page-title">Control Center</h1>
          <p className="page-subtitle">
            {totalAttention === 0
              ? "Everything is on track. No items need your attention."
              : `${totalAttention} items need attention across RFQs, pricing, and jobs`}
          </p>
        </div>
      </div>

      <div className="control-metric-grid">
        {metrics.map((k) => (
          <div key={k.label} className="card control-metric">
            <div className="control-metric-label">{k.label}</div>
            <div className={["control-metric-value", k.tone].filter(Boolean).join(" ")}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {rfqsToParse.length + rfqsToPrice.length + rfqsToConvert.length > 0 && (
        <SectionCard
          title="RFQ Pipeline"
          count={rfqsToParse.length + rfqsToPrice.length + rfqsToConvert.length}
          action={
            <a href="/dashboard/rfq" className="control-card-action">
              Open RFQs <Icon name="arrow-right" size={13} />
            </a>
          }
        >
          <div className="control-flow-grid">
            {[
              { title: "01 · To Parse", items: rfqsToParse, stage: "INGESTED" },
              { title: "02 · To Price", items: rfqsToPrice, stage: "PARSED" },
              { title: "03 · To Convert", items: rfqsToConvert, stage: "PRICED" },
            ].map((col) => (
              <div key={col.title} className="control-flow-col">
                <div className="control-flow-head">
                  <span className="control-flow-title">{col.title}</span>
                  <span className="control-flow-count">{col.items.length}</span>
                </div>
                {col.items.length === 0 ? (
                  <div className="control-empty-inline">None pending</div>
                ) : (
                  <div className="control-list">
                    {col.items.map((inq) => (
                      <a key={inq.id} href={`/dashboard/rfq/${inq.id}`} className="control-mini-card">
                        <div className="control-mini-title">{inq.subject}</div>
                        <div className="control-mini-meta">
                          {inq.company?.name ?? inq.fromCompany ?? "Unknown"}
                          {inq.origin && inq.destination ? ` · ${inq.origin} → ${inq.destination}` : ""}
                        </div>
                        <div className="control-mini-action">{RFQ_NEXT[col.stage]} →</div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <div className="control-work-grid">
        <div className="control-stack">
          <SectionCard title="Upcoming Workflow Steps (7 days)" count={upcomingMilestones.length}>
            {upcomingMilestones.length === 0 ? (
              <div className="control-empty">No milestones in the next 7 days.</div>
            ) : (
              upcomingMilestones.map((m) => {
                const plannedAt = m.plannedAt!;
                const isClose = plannedAt <= in3;
                return (
                  <a key={m.id} href={`/dashboard/jobs/${m.job.id}?tab=milestones`} className="control-row">
                    <div className="control-row-main">
                      <div className="control-row-kicker">{m.job.reference}</div>
                      <div className="control-row-title">
                        {MILESTONE_LABEL[m.type] ?? m.type} · {m.job.company?.name ?? "—"}
                      </div>
                    </div>
                    <div className={["control-row-side", isClose ? "urgent" : ""].filter(Boolean).join(" ")}>
                      <strong>{fmtDate(plannedAt)}</strong>
                      {relDays(plannedAt)}
                    </div>
                  </a>
                );
              })
            )}
          </SectionCard>

          {pendingDocs.length > 0 && (
            <SectionCard title="Pending Documents" count={pendingDocs.length}>
              {pendingDocs.map((d) => (
                <a key={d.id} href={`/dashboard/jobs/${d.job.id}?tab=documents`} className="control-row">
                  <div className="control-row-with-icon">
                    <Icon name="file" size={14} className="control-row-icon" />
                    <div className="control-row-main">
                      <div className="control-row-kicker">{d.job.reference}</div>
                      <div className="control-row-title">{d.name}</div>
                    </div>
                  </div>
                  <StatusPill s={d.job.status} />
                </a>
              ))}
            </SectionCard>
          )}
        </div>

        <div className="control-stack">
          {jobsMissingRates.length > 0 && (
            <SectionCard
              title="Jobs Awaiting Carrier Rates"
              count={jobsMissingRates.length}
              action={<span className="control-card-note">No cost set yet</span>}
            >
              {jobsMissingRates.map((job) => (
                <a key={job.id} href={`/dashboard/jobs/${job.id}?tab=procurement`} className="control-row">
                  <div className="control-row-main">
                    <div className="control-row-kicker">{job.reference}</div>
                    <div className="control-row-title">
                      {job.company?.name ?? "—"} ·{" "}
                      {job.origin && job.destination ? `${job.origin} → ${job.destination}` : "Route TBD"}
                    </div>
                  </div>
                  <span className="control-row-action">
                    Source rates <Icon name="arrow-right" size={13} />
                  </span>
                </a>
              ))}
            </SectionCard>
          )}

          <SectionCard title="Quick Actions">
            <div className="control-quick-list">
              {[
                { href: "/dashboard/rfq/new", label: "Manual RFQ entry", sub: "Add a request received off-channel", icon: "inbox" as const },
                { href: "/dashboard/jobs/new", label: "New Job", sub: "Create a shipment job manually", icon: "truck" as const },
                { href: "/dashboard/settings/email", label: "Connect inbox", sub: "Auto-capture inbound RFQs", icon: "mail" as const },
              ].map((a) => (
                <a key={a.href} href={a.href} className="control-quick-link">
                  <Icon name={a.icon} size={15} className="control-quick-icon" />
                  <div className="control-quick-body">
                    <div className="control-quick-title">{a.label}</div>
                    <div className="control-quick-subtitle">{a.sub}</div>
                  </div>
                  <Icon name="chevron-right" size={14} className="control-quick-arrow" />
                </a>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
