import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { getFocusedJobId } from "@/lib/job-focus";
import { Icon } from "@/components/icon";
import { JobsBoard } from "@/components/jobs-board";
import { JobsTable } from "@/components/jobs-table";
import { cleanNotes } from "@/lib/quote-lines";

const STATUSES = [
  { key: "PROPOSED",   label: "Proposed"   },
  { key: "INQUIRY",    label: "RFQ"        },
  { key: "QUOTED",     label: "Pricing"    },
  { key: "BOOKED",     label: "Booked / Waiting Cargo" },
  { key: "IN_TRANSIT", label: "En Route"   },
  { key: "DELIVERED",  label: "Delivered"  },
] as const;

type StatusKey = typeof STATUSES[number]["key"];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await requireSession();
  const { view } = await searchParams;
  const focusedId = await getFocusedJobId();
  const isTable = view === "table";

  const jobs = await prisma.job.findMany({
    where: {
      officeId: session.officeId,
    },
    include: {
      company: { select: { id: true, name: true } },
      inquiry: {
        select: {
          fromEmail: true,
          fromCompany: true,
          carrierQuotes: {
            select: {
              status: true,
              total20: true,
              total40: true,
              total40HC: true,
              transitDays: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const labels: Record<string, string> = {};
  for (const s of STATUSES) labels[s.key] = s.label;

  const byStatus: Record<StatusKey, number> = {
    PROPOSED: 0, INQUIRY: 0, QUOTED: 0, BOOKED: 0, IN_TRANSIT: 0, DELIVERED: 0,
  };
  for (const j of jobs) {
    const statusKey = j.status === "CUSTOMS" ? "IN_TRANSIT" : j.status;
    if (statusKey in byStatus) byStatus[statusKey as StatusKey]++;
  }

  const activeCount = jobs.filter(
    (j) => !["DELIVERED", "CANCELLED"].includes(j.status)
  ).length;

  const serialized = jobs.map((j) => ({
    id: j.id,
    reference: j.reference,
    title: j.title,
    cadence: j.cadence,
    quantity: j.quantity,
    quantityUnit: j.quantityUnit,
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
    stackable: j.stackable,
    topLoad: j.topLoad,
    dangerousGoods: j.dangerousGoods,
    customsBy: j.customsBy,
    targetPrice: j.targetPrice,
    targetCurrency: j.targetCurrency,
    targetPriceStatus: j.targetPriceStatus,
    targetPriceSource: j.targetPriceSource,
    fromEmail: j.inquiry?.fromEmail ?? null,
    fromCompany: j.inquiry?.fromCompany ?? null,
    carrierQuotes: j.inquiry?.carrierQuotes ?? [],
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
    if (v) parts.push(`view=${v}`);
    return parts.length ? `?${parts.join("&")}` : "";
  };

  return (
    <div className="jobs-page">
      <div className="page-header page-header-roomy">
        <div>
          <h1 className="page-title page-title-row">
            Deal Pipeline
            <span className="live-dot" aria-hidden />
          </h1>
          <p className="page-subtitle">{activeCount} active loads · RFQ, pricing, booked cargo, en route, delivered</p>
        </div>
        <div className="page-actions">
          <div className="mode-tabs">
            <Link href={`/dashboard/jobs${qs()}` as "/dashboard/jobs"} className={`mode-tab${!isTable ? " active" : ""}`}>
              <Icon name="box" size={13} />
              Board
            </Link>
            <Link href={`/dashboard/jobs${qs("table")}` as "/dashboard/jobs"} className={`mode-tab${isTable ? " active" : ""}`}>
              <Icon name="grid" size={13} />
              Table
            </Link>
          </div>
          <Link href="/dashboard/inbox?view=rfqs" className="btn btn-secondary">
            From RFQ
          </Link>
          <a href="/dashboard/jobs/new" className="btn">
            <Icon name="plus" size={13} strokeWidth={2.5} /> New Job
          </a>
        </div>
      </div>

      {/* Stats strip */}
      <div className="metric-strip metric-strip-roomy">
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
        <div className="card empty-state-card">
          <Icon name="box" size={36} className="empty-state-graphic" />
          <div className="empty-state-title">No jobs yet</div>
          <p className="empty-state-copy">
            Jobs are created when an RFQ is converted, or manually added.
          </p>
          <Link href="/dashboard/inbox?view=rfqs" className="btn">
            Go to RFQ Inbox
          </Link>
        </div>
      )}
    </div>
  );
}
