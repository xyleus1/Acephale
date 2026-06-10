import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getFocusedJobId } from "@/lib/job-focus";
import { Icon } from "@/components/icon";
import { SeedDemoButton } from "@/components/seed-demo-button";
import { JobsBoard } from "@/components/jobs-board";
import { JobsTable } from "@/components/jobs-table";
import { cleanNotes } from "@/lib/quote-lines";

const STATUSES = [
  { key: "PROPOSED",   label: "Proposed"   },
  { key: "INQUIRY",    label: "Inquiry"    },
  { key: "QUOTED",     label: "Quoted"     },
  { key: "BOOKED",     label: "Booked"     },
  { key: "IN_TRANSIT", label: "In Transit" },
  { key: "CUSTOMS",    label: "Customs"    },
  { key: "DELIVERED",  label: "Delivered"  },
] as const;

// Same underlying statuses, but labels reframed for procurement (SOURCING).
const PROCUREMENT_LABELS: Record<string, string> = {
  PROPOSED:   "Proposed",
  INQUIRY:    "Negotiating",
  QUOTED:     "Award pending",
  BOOKED:     "Awarded",
  IN_TRANSIT: "Shipping",
  CUSTOMS:    "In transit",
  DELIVERED:  "Received",
};

type StatusKey = typeof STATUSES[number]["key"];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; view?: string }>;
}) {
  const session = await requireSession();
  const { mode, view } = await searchParams;
  const focusedId = await getFocusedJobId();
  const isTable = view === "table";

  const typeFilter =
    mode === "procurement" ? "SOURCING" :
    mode === "operations"  ? "FORWARDING" : null;

  const jobs = await prisma.job.findMany({
    where: {
      officeId: session.officeId,
      ...(typeFilter ? { type: typeFilter } : {}),
    },
    include: {
      company: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const isProcurement = mode === "procurement";
  const labels: Record<string, string> = {};
  for (const s of STATUSES) labels[s.key] = isProcurement ? (PROCUREMENT_LABELS[s.key] ?? s.label) : s.label;

  const byStatus: Record<StatusKey, number> = {
    PROPOSED: 0, INQUIRY: 0, QUOTED: 0, BOOKED: 0, IN_TRANSIT: 0, CUSTOMS: 0, DELIVERED: 0,
  };
  for (const j of jobs) {
    if (j.status in byStatus) byStatus[j.status as StatusKey]++;
  }

  const activeCount = jobs.filter(
    (j) => !["DELIVERED", "CANCELLED"].includes(j.status)
  ).length;

  const serialized = jobs.map((j) => ({
    id: j.id,
    reference: j.reference,
    status: j.status,
    type: j.type,
    companyName: j.company?.name ?? null,
    origin: j.origin,
    destination: j.destination,
    mode: j.mode,
    commodity: j.commodity,
    incoterms: j.incoterms,
    weight: j.weight,
    volume: j.volume,
    packages: j.packages,
    dimensions: j.dimensions,
    containerCount: j.containerCount,
    containerType: j.containerType,
    etd: j.etd ? j.etd.toISOString() : null,
    eta: j.eta ? j.eta.toISOString() : null,
    revenue: j.revenue,
    cost: j.cost,
    currency: j.currency,
    notes: cleanNotes(j.notes) || null,
    createdAt: j.createdAt.toISOString(),
  }));

  const qs = (v?: string) => {
    const parts: string[] = [];
    if (mode) parts.push(`mode=${mode}`);
    if (v) parts.push(`view=${v}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Pipeline
            <span className="live-dot" aria-hidden />
          </h1>
          <p className="page-subtitle">{activeCount} active jobs flowing · {jobs.length} total</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="mode-tabs">
            <Link href={`/dashboard/jobs${qs(view)}` as "/dashboard/jobs"} className={`mode-tab${!mode ? " active" : ""}`}>All</Link>
            <Link href={`/dashboard/jobs?mode=procurement${isTable ? "&view=table" : ""}` as "/dashboard/jobs"} className={`mode-tab${mode === "procurement" ? " active" : ""}`}>
              <Icon name="box" size={13} />
              Procurement
            </Link>
            <Link href={`/dashboard/jobs?mode=operations${isTable ? "&view=table" : ""}` as "/dashboard/jobs"} className={`mode-tab${mode === "operations" ? " active" : ""}`}>
              <Icon name="truck" size={13} />
              Operations
            </Link>
          </div>
          <div className="mode-tabs">
            <Link href={`/dashboard/jobs${qs()}` as "/dashboard/jobs"} className={`mode-tab${!isTable ? " active" : ""}`}>
              <Icon name="box" size={13} />
              Board
            </Link>
            <Link href={`/dashboard/jobs${qs("table")}` as "/dashboard/jobs"} className={`mode-tab${isTable ? " active" : ""}`}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>
              Table
            </Link>
          </div>
          <SeedDemoButton />
          <Link href="/dashboard/inbox?view=rfqs" className="btn btn-secondary" style={{ fontSize: 13, textDecoration: "none" }}>
            From RFQ
          </Link>
          <a href="/dashboard/jobs/new" className="btn" style={{ fontSize: 13, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="plus" size={13} strokeWidth={2.5} /> New Job
          </a>
        </div>
      </div>

      {/* Stats strip */}
      <div className="metric-strip" style={{ marginBottom: 16 }}>
        {STATUSES.filter((s) => s.key !== "DELIVERED").map((s) => (
          <div key={s.key} className="metric-item">
            <div className="metric-label">{labels[s.key]}</div>
            <div className="metric-value">{byStatus[s.key]}</div>
          </div>
        ))}
      </div>

      {isTable ? (
        <JobsTable jobs={serialized} />
      ) : (
        <JobsBoard jobs={serialized} labels={labels} focusedId={focusedId} />
      )}

      {jobs.length === 0 && (
        <div className="card" style={{ textAlign: "center", padding: "60px 24px", marginTop: 8 }}>
          <Icon name="box" size={36} style={{ opacity: 0.2 }} />
          <div style={{ fontWeight: 600, color: "var(--text)", marginTop: 12, marginBottom: 6 }}>No jobs yet</div>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 20 }}>
            Jobs are created when an RFQ is converted, or manually added.
          </p>
          <Link href="/dashboard/rfq" className="btn" style={{ display: "inline-flex" }}>
            Go to RFQ Inbox
          </Link>
        </div>
      )}
    </div>
  );
}
