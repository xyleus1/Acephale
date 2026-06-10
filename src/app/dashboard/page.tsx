import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Icon } from "@/components/icon";
import { getFocusedJobId } from "@/lib/job-focus";
import { JobConversationPanel, type FeedItem } from "@/components/job-conversation-panel";
import { CustomerPopover } from "@/components/customer-popover";
import { JobEditPanel } from "@/components/job-edit-panel";
import { CollapsibleCard } from "@/components/collapsible-card";
import { MilestoneEdit } from "@/components/milestone-edit";
import { StageEmailPanel, type ThreadView } from "@/components/stage-email-panel";
import { templatesForStatus } from "@/lib/job-email-types";
import { CopyPortalLink } from "@/components/copy-portal-link";
import { CounterOfferButton } from "@/components/counter-offer-button";
import { DocumentViewer } from "@/components/document-viewer";
import React from "react";
import {
  initJobDocuments, initJobMilestones, updateDocStatus,
  markMilestoneActual, updateMilestonePlanned,
  addCarrierQuote, selectCarrierQuote, updateJobStatus,
  addQuoteLine,
} from "./jobs/[jobId]/actions";

const STATUS_ORDER = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"] as const;
const STATUS_LABEL: Record<string, string> = {
  INQUIRY: "Inquiry", QUOTED: "Quoted", BOOKED: "Booked",
  IN_TRANSIT: "In Transit", CUSTOMS: "Customs", DELIVERED: "Delivered",
};
const MILESTONE_LABEL: Record<string, string> = {
  BOOKING: "Booking", CARGO_READY: "Cargo Ready", ETD: "ETD",
  ETA: "ETA", CUSTOMS_ENTRY: "Customs Entry", CUSTOMS_RELEASE: "Customs Release", DELIVERY: "Delivery",
};
const DOC_TYPE_LABEL: Record<string, string> = {
  BOOKING: "Booking Conf.", INVOICE: "Commercial Invoice", PACKING_LIST: "Packing List",
  BL: "Bill of Lading", COO: "Cert. of Origin", CUSTOMS: "Customs Declaration", OTHER: "Other",
};
const MODE_LABEL: Record<string, string> = {
  "SEA-FCL": "Sea FCL", "SEA-LCL": "Sea LCL", AIR: "Air", ROAD: "Road", COURIER: "Courier",
};

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function fmtInput(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().split("T")[0] : "";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ stage?: string }>;
}) {
  const sp = searchParams ? await searchParams : {};
  const stageOverride = sp.stage && ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"].includes(sp.stage)
    ? sp.stage
    : null;
  return _DashboardPageImpl(stageOverride);
}

async function _DashboardPageImpl(stageOverride: string | null) {
  const session = await requireSession();
  const focusedId = await getFocusedJobId();

  // Pick a job: focused if any, else most recently updated active job, else latest job
  let jobId: string | null = focusedId;
  if (!jobId) {
    const fallback = await prisma.job.findFirst({
      where: { officeId: session.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    jobId = fallback?.id ?? null;
  }
  if (!jobId) {
    const anyJob = await prisma.job.findFirst({
      where: { officeId: session.officeId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    jobId = anyJob?.id ?? null;
  }

  // Empty state
  if (!jobId) {
    return (
      <div className="card" style={{ padding: 40, textAlign: "center", maxWidth: 560, margin: "60px auto" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
          No jobs yet
        </div>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: "0 auto 20px", maxWidth: 360 }}>
          Add a manual job or RFQ to start. Once you have one, this page becomes your agent conversation focused on that load.
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          <a href="/dashboard/rfq/new" className="btn btn-secondary" style={{ fontSize: 13, textDecoration: "none" }}>Manual RFQ</a>
          <a href="/dashboard/jobs/new" className="btn" style={{ fontSize: 13, textDecoration: "none" }}>New Job</a>
        </div>
      </div>
    );
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    include: {
      company: { select: { id: true, name: true } },
      inquiry: {
        include: {
          carrierQuotes: { orderBy: { createdAt: "asc" } },
          // Inquiry-linked threads — these are the supplier replies attached
          // when the inquiry was the only attachment point.
          emailThreads: { include: { messages: { orderBy: { sentAt: "asc" } } } },
        },
      },
      documents: { orderBy: { createdAt: "asc" } },
      milestones: { orderBy: { createdAt: "asc" } },
      emailThreads: { include: { messages: { orderBy: { sentAt: "asc" } } } },
    },
  });

  if (!job) {
    return <div style={{ padding: 24 }}>Job not found.</div>;
  }

  // Combine Job-linked + Inquiry-linked threads, dedup by id, sort by lastMessageAt desc.
  const inquiryThreads = job.inquiry?.emailThreads ?? [];
  const seen = new Set<string>();
  const combinedThreads = [...job.emailThreads, ...inquiryThreads].filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  }).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  // Inject combined view back onto job.emailThreads so downstream code that
  // consumes job.emailThreads sees the full set.
  (job as { emailThreads: typeof combinedThreads }).emailThreads = combinedThreads;

  await Promise.all([
    initJobDocuments(jobId, session.officeId),
    initJobMilestones(jobId),
  ]);

  const docs = job.documents.length > 0
    ? job.documents
    : await prisma.jobDocument.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } });
  const milestones = job.milestones.length > 0
    ? job.milestones
    : await prisma.jobMilestone.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } });

  const currentIdx = (STATUS_ORDER as readonly string[]).indexOf(job.status);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isOverdue = job.eta && new Date(job.eta) < today && job.status !== "DELIVERED";

  // Build chronological feed
  const feed: FeedItem[] = [];
  if (job.inquiry) {
    feed.push({
      kind: "event",
      id: `inq-recv-${job.inquiry.id}`,
      at: new Date(job.inquiry.receivedAt).toISOString(),
      iconName: "inbox", who: "auto",
      title: "RFQ captured from inbox",
      sub: `"${job.inquiry.subject}" — ${job.inquiry.fromEmail ?? job.inquiry.fromCompany ?? "Unknown sender"}`,
    });
    if (job.inquiry.parsedData) {
      feed.push({
        kind: "event",
        id: `inq-parsed-${job.inquiry.id}`,
        at: new Date(job.inquiry.updatedAt).toISOString(),
        iconName: "sparkles", who: "auto",
        title: "AI parsed shipment fields",
        sub: `${job.inquiry.origin ?? "?"} → ${job.inquiry.destination ?? "?"} · ${job.inquiry.mode ?? "—"}${job.inquiry.weight ? ` · ${job.inquiry.weight.toLocaleString()}kg` : ""}`,
      });
    }
    for (const cq of job.inquiry.carrierQuotes) {
      const total = cq.total40HC ?? cq.total40 ?? cq.total20;
      feed.push({
        kind: "event",
        id: `cq-${cq.id}`,
        at: new Date(cq.createdAt).toISOString(),
        iconName: cq.status === "PENDING" ? "mail-out" : "ship",
        who: "auto",
        title: cq.status === "PENDING"
          ? `Rate request sent to ${cq.carrier}`
          : `${cq.carrier} replied with rate`,
        sub: cq.status === "PENDING"
          ? "Awaiting reply"
          : (total ? `$${total.toLocaleString()}${cq.transitDays ? ` · ${cq.transitDays}d transit` : ""}` : (cq.service ?? "")),
      });
    }
  }
  feed.push({
    kind: "event",
    id: `job-${job.id}`,
    at: new Date(job.createdAt).toISOString(),
    iconName: "box",
    who: job.inquiry ? "auto" : "manual",
    title: job.inquiry ? `Converted to ${job.reference}` : `Job ${job.reference} created manually`,
    sub: `Status set to ${STATUS_LABEL[job.status]}`,
  });
  for (const m of milestones) {
    if (m.actualAt) {
      feed.push({
        kind: "event",
        id: `ms-${m.id}`,
        at: new Date(m.actualAt).toISOString(),
        iconName: "check", who: "manual",
        title: `${MILESTONE_LABEL[m.type] ?? m.type} confirmed`,
        sub: fmt(m.actualAt),
      });
    }
  }
  for (const d of docs) {
    if (d.status === "APPROVED" || d.status === "UPLOADED") {
      feed.push({
        kind: "event",
        id: `doc-${d.id}`,
        at: new Date(d.updatedAt).toISOString(),
        iconName: d.status === "APPROVED" ? "file-check" : "file",
        who: "manual",
        title: `${d.name} ${d.status.toLowerCase()}`,
        sub: DOC_TYPE_LABEL[d.docType] ?? d.docType,
      });
    }
  }
  for (const thread of job.emailThreads) {
    for (const msg of thread.messages) {
      feed.push({
        kind: "event",
        id: `em-${msg.id}`,
        at: new Date(msg.sentAt).toISOString(),
        iconName: msg.direction === "INBOUND" ? "mail-in" : "mail-out",
        who: msg.direction === "INBOUND" ? "auto" : "manual",
        title: msg.direction === "INBOUND" ? "Inbound email" : "Outbound email",
        sub: msg.fromEmail ?? thread.subject,
      });
    }
  }
  feed.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const NEXT_AUTO: Record<string, string> = {
    INQUIRY: "Awaiting carrier rates",
    QUOTED: "Awaiting customer reply",
    BOOKED: "Tracking carrier milestones",
    IN_TRANSIT: "Watching for ETA / customs handoff",
    CUSTOMS: "Watching for customs release",
    DELIVERED: "Job complete",
  };

  // Quote lines
  const quoteLines = (job.notes ?? "")
    .split("\n").filter((l) => l.includes("|"))
    .map((l) => { const [desc, amt, cur] = l.split("|"); return { desc, amount: Number(amt), cur }; });

  const carrierQuotes = job.inquiry?.carrierQuotes ?? [];
  const receivedQuotes = carrierQuotes.filter((q) => q.status === "RECEIVED");

  // Build thread view for the StageEmailPanel
  const threadsView: ThreadView[] = job.emailThreads.map((t) => ({
    id: t.id,
    subject: t.subject,
    lastMessageAt: t.lastMessageAt.toISOString(),
    messages: t.messages.map((m) => ({
      id: m.id,
      direction: m.direction,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      subject: m.subject,
      bodyText: m.bodyText,
      sentAt: m.sentAt.toISOString(),
    })),
  }));

  const defaultEmailRecipient = job.inquiry?.fromEmail
    ? { email: job.inquiry.fromEmail, label: job.company?.name ?? "Customer" }
    : (job.company ? { email: "", label: job.company.name } : null);

  const companies = await prisma.company.findMany({
    where: { officeId: session.officeId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  // Matching lane rates for the workbench (only relevant for INQUIRY/QUOTED stages)
  const laneRates = (job.origin && job.destination)
    ? await prisma.laneRate.findMany({
        where: {
          officeId: session.officeId,
          origin: { contains: job.origin.split(",")[0].trim() },
          destination: { contains: job.destination.split(",")[0].trim() },
        },
        orderBy: { validFrom: "desc" },
        take: 6,
      })
    : [];

  const suggestions = [
    "What's blocking this job right now?",
    "What's the margin and how does it compare?",
    "What should I do next?",
  ];

  return (
    <div className="workbench-grid">
      {/* LEFT: main workspace stack */}
      <div className="workbench-main">

      {/* Compact header */}
      <div className="card" style={{ marginBottom: 12, padding: "12px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-2)", fontFamily: "ui-monospace, Menlo, monospace" }}>
              {job.reference}
            </span>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>·</span>
            {job.company ? (
              <CustomerPopover companyId={job.company.id} name={job.company.name} />
            ) : (
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Unknown Customer</span>
            )}
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>·</span>
            <span style={{ fontSize: 13, color: "var(--text-2)" }}>
              {job.origin && job.destination ? `${job.origin} → ${job.destination}` : "Route TBD"}
            </span>
            {job.mode && (
              <>
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>·</span>
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>{MODE_LABEL[job.mode] ?? job.mode}</span>
              </>
            )}
            {isOverdue && (
              <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--danger)", border: "1px solid var(--danger-border)", borderRadius: 3, padding: "1px 5px", letterSpacing: "0.06em" }}>
                ETA OVERDUE
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <CopyPortalLink jobId={job.id} />
            <JobEditPanel
              job={{
                id: job.id, reference: job.reference, status: job.status,
                title: job.title, cadence: job.cadence,
                quantity: job.quantity, quantityUnit: job.quantityUnit,
                companyId: job.companyId,
                mode: job.mode, origin: job.origin, destination: job.destination,
                commodity: job.commodity, incoterms: job.incoterms,
                weight: job.weight, volume: job.volume, packages: job.packages,
                dimensions: job.dimensions, containerCount: job.containerCount, containerType: job.containerType,
                etd: job.etd, eta: job.eta,
                revenue: job.revenue, cost: job.cost, currency: job.currency,
                notes: job.notes,
              }}
              companies={companies}
            />
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              <kbd style={{ fontFamily: "ui-monospace,Menlo,monospace", fontSize: 10, fontWeight: 700, background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px", color: "var(--text-2)" }}>⌘K</kbd>
              {" "}switch
            </span>
          </div>
        </div>

        <div className="status-pipeline" style={{ marginTop: 12 }}>
          {STATUS_ORDER.map((s, i) => (
            <div key={s} className={`status-step ${i < currentIdx ? "done" : i === currentIdx ? "current" : ""}`}>
              <span className="status-step-label">{STATUS_LABEL[s]}</span>
              {i < STATUS_ORDER.length - 1 && <div className="status-step-line" />}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border)", display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span className="live-dot" aria-hidden />
          <span style={{ fontWeight: 600, color: "var(--text-2)" }}>Pipeline:</span>
          <span style={{ color: "var(--text-3)" }}>{NEXT_AUTO[job.status]}</span>
        </div>
      </div>

      {/* Horizontal milestone timeline (full width, freight-tracker style) */}
      <div className="card" style={{ padding: "16px 20px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-2)" }}>
            Shipment Timeline
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            {milestones.filter((m) => m.actualAt).length} of {milestones.length} confirmed
          </div>
        </div>
        <div className="ms-track">
          {milestones.map((m, i) => {
            const isDone = !!m.actualAt;
            const isLate = m.plannedAt && !isDone && new Date(m.plannedAt) < today;
            const dateLabel = isDone ? fmt(m.actualAt) : (m.plannedAt ? fmt(m.plannedAt) : "—");
            return (
              <div key={m.id} className={`ms-step ${isDone ? "done" : ""} ${isLate ? "late" : ""}`}>
                <div className="ms-line" />
                <div className="ms-dot">
                  {isDone && <Icon name="check" size={11} strokeWidth={3} />}
                </div>
                <div className="ms-label">{MILESTONE_LABEL[m.type] ?? m.type}</div>
                <div className="ms-date">{dateLabel}</div>
                {!isDone && (
                  <MilestoneEdit milestoneId={m.id} plannedAt={fmtInput(m.plannedAt)} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Stage workbench (NOW positioned right under stages/timeline) ── */}
      <StageWorkbench
        job={job}
        carrierQuotes={carrierQuotes}
        receivedQuotes={receivedQuotes}
        docs={docs}
        quoteLines={quoteLines}
        laneRates={laneRates}
        emailThreads={threadsView}
        stageOverride={stageOverride}
      />

      {/* Stage-specific email panel */}
      <div style={{ marginBottom: 12 }}>
        <StageEmailPanel
          jobId={job.id}
          status={job.status}
          hints={templatesForStatus(job.status)}
          threads={threadsView}
          defaultRecipient={defaultEmailRecipient}
        />
      </div>

      {/* Worktable cards — STAGNANT context, collapsible, below the stage area */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Carrier */}
          <CollapsibleCard
            title="Carrier"
            defaultOpen={false}
            meta={receivedQuotes.length > 0
              ? <span>· {receivedQuotes.length} of {carrierQuotes.length} replied</span>
              : null
            }
          >
            <div style={{ padding: "10px 16px" }}>
              {!job.inquiry ? (
                <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>No source RFQ — rates tracked manually.</div>
              ) : carrierQuotes.length === 0 ? (
                <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>No rate requests sent yet.</div>
              ) : (
                <div>
                  {carrierQuotes.map((q) => {
                    const total = q.total40HC ?? q.total40 ?? q.total20;
                    const isSelected = job.cost && total === job.cost;
                    return (
                      <div key={q.id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "7px 0", borderBottom: "1px solid var(--border)",
                      }}>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{q.carrier}</div>
                          <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                            {q.status === "PENDING" ? "Awaiting reply" : `${q.transitDays ? `${q.transitDays}d transit` : "—"}${q.service ? ` · ${q.service}` : ""}`}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {q.status === "RECEIVED" && total ? (
                            <span style={{ fontSize: 12.5, fontWeight: 700 }}>${total.toLocaleString()}</span>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--text-3)", fontStyle: "italic" }}>pending</span>
                          )}
                          {isSelected && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "var(--brand)", color: "#fff", letterSpacing: "0.06em" }}>SELECTED</span>
                          )}
                          {!isSelected && q.status === "RECEIVED" && (
                            <form action={selectCarrierQuote.bind(null, job.id, q.id)}>
                              <button type="submit" className="btn btn-secondary btn-sm" style={{ fontSize: 10.5 }}>Select</button>
                            </form>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CollapsibleCard>

          {/* Documents */}
          <CollapsibleCard
            title="Documents"
            defaultOpen={false}
            meta={<span>· {docs.filter((d) => d.status === "APPROVED").length}/{docs.length} approved</span>}
          >
            <div style={{ padding: "8px 16px 12px" }}>
              {docs.map((d) => (
                <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 4, flexShrink: 0,
                    background: d.status === "APPROVED" ? "var(--brand)" : "var(--surface-3)",
                    border: `1px solid ${d.status === "APPROVED" ? "var(--brand)" : "var(--border)"}`,
                    color: d.status === "APPROVED" ? "#fff" : "var(--text-3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {d.status === "APPROVED" ? <Icon name="check" size={11} strokeWidth={2.5} />
                      : d.status === "UPLOADED" ? <Icon name="chevron-up" size={11} strokeWidth={2.5} />
                      : <Icon name="circle" size={9} strokeWidth={1.5} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{d.name}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{DOC_TYPE_LABEL[d.docType] ?? d.docType} · {d.status.toLowerCase()}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {d.status === "PENDING" && (
                      <form action={updateDocStatus.bind(null, d.id, "UPLOADED")}>
                        <button type="submit" className="btn btn-secondary btn-sm" style={{ fontSize: 10.5 }}>Mark uploaded</button>
                      </form>
                    )}
                    {d.status === "UPLOADED" && (
                      <form action={updateDocStatus.bind(null, d.id, "APPROVED")}>
                        <button type="submit" className="btn btn-sm" style={{ fontSize: 10.5 }}>Approve</button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleCard>

          {/* Financials */}
          <CollapsibleCard
            title="Financials"
            defaultOpen={false}
            meta={
              <a href={`/api/jobs/${job.id}/quote-pdf`} target="_blank" style={{ fontSize: 10.5, color: "var(--brand)", fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8 }}>
                <Icon name="external" size={10} /> Quote PDF
              </a>
            }
          >
            <div style={{ padding: "12px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Revenue</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{job.revenue ? `$${job.revenue.toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Cost</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>{job.cost ? `$${job.cost.toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Margin</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>
                  {job.revenue && job.cost ? `${(((job.revenue - job.cost) / job.revenue) * 100).toFixed(1)}%` : "—"}
                </div>
              </div>
            </div>
          </CollapsibleCard>
        </div>
      </div>

      {/* RIGHT: agent panel — full right side, sticky */}
      <aside className="workbench-agent">
        <JobConversationPanel
          scopeJobId={job.id}
          scopeJobReference={job.reference}
          feed={feed}
          suggestions={suggestions}
        />
      </aside>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage-specific deep work surface (the "open the relevant page underneath")
// ─────────────────────────────────────────────────────────────────────────────

type AnyJob = Awaited<ReturnType<typeof prisma.job.findFirst>>;
type AnyCarrierQuote = NonNullable<NonNullable<AnyJob>>;

function StageWorkbench({
  job, carrierQuotes, receivedQuotes, docs, quoteLines, laneRates, emailThreads, stageOverride,
}: {
  job: NonNullable<Awaited<ReturnType<typeof prisma.job.findFirst<{
    include: {
      company: { select: { id: true, name: true } };
      inquiry: { include: { carrierQuotes: true } };
      documents: true;
      milestones: true;
      emailThreads: { include: { messages: true } };
    };
  }>>>>;
  carrierQuotes: NonNullable<typeof job.inquiry>["carrierQuotes"];
  receivedQuotes: NonNullable<typeof job.inquiry>["carrierQuotes"];
  docs: typeof job.documents;
  quoteLines: { desc: string; amount: number; cur: string }[];
  laneRates: { id: string; origin: string; destination: string; mode: string; baseAmount: number; currency: string; validFrom: Date; validTo: Date | null; notes: string | null }[];
  emailThreads: ThreadView[];
  stageOverride: string | null;
}) {
  // Use the URL-overridden stage if set; otherwise the job's actual status.
  // This lets the operator preview any stage's workbench (carrier rates,
  // documents, etc) without changing the job's lifecycle.
  const actualStatus = job.status;
  const status = stageOverride ?? job.status;
  const isPreview = !!stageOverride && stageOverride !== actualStatus;

  // Header strip + stage-specific content
  const STAGE_TITLES: Record<string, { title: string; sub: string }> = {
    INQUIRY:    { title: "Source RFQ & rate procurement",   sub: "What an inquiry needs: parsed fields, then carrier rate sourcing." },
    QUOTED:     { title: "Sellside quote builder",           sub: "Build the customer-facing quote. Send when ready." },
    BOOKED:     { title: "Booking & document checklist",     sub: "Confirm with carrier, prepare shipping documents." },
    IN_TRANSIT: { title: "In-transit tracking",              sub: "Watch milestones, address exceptions." },
    CUSTOMS:    { title: "Customs clearance",                sub: "Customs declaration, BL, COO. Release the cargo." },
    DELIVERED:  { title: "Settlement",                       sub: "Final invoice, margin reconciliation." },
  };
  const stage = STAGE_TITLES[status] ?? { title: "Workbench", sub: "" };

  const STAGE_KEYS = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"] as const;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="workbench-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 4 }}>
            Stage workbench · {STATUS_LABEL[status]}
            {isPreview && (
              <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 3, background: "var(--brand-light)", color: "var(--brand)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em" }}>
                PREVIEW · job is {STATUS_LABEL[actualStatus]}
              </span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{stage.title}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{stage.sub}</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: 3, borderRadius: 4, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
          {STAGE_KEYS.map((s) => {
            const isActive = s === status;
            const isReal = s === actualStatus;
            const href = s === actualStatus ? "/dashboard" : `/dashboard?stage=${s}`;
            return (
              <a
                key={s}
                href={href}
                title={isReal ? "Job is at this stage" : `Preview ${STATUS_LABEL[s]} workbench (doesn't change status)`}
                style={{
                  fontSize: 10.5, fontWeight: 600, padding: "5px 9px", borderRadius: 3,
                  background: isActive ? "var(--surface)" : "transparent",
                  color: isActive ? "var(--text)" : "var(--text-3)",
                  border: isActive ? "1px solid var(--border)" : "1px solid transparent",
                  textDecoration: "none", letterSpacing: "0.04em", textTransform: "uppercase",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}
              >
                {isReal && (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand)", display: "inline-block" }} aria-hidden />
                )}
                {STATUS_LABEL[s]}
              </a>
            );
          })}
        </div>
      </div>

      {/* Stage-specific content */}
      {status === "INQUIRY" && (
        <InquiryStage job={job} carrierQuotes={carrierQuotes} receivedQuotes={receivedQuotes} laneRates={laneRates} />
      )}
      {status === "QUOTED" && (
        <QuotedStage job={job} quoteLines={quoteLines} laneRates={laneRates} carrierQuotes={carrierQuotes} />
      )}
      {(status === "BOOKED" || status === "CUSTOMS") && (
        <DocumentsStage job={job} docs={docs} />
      )}
      {status === "IN_TRANSIT" && (
        <InTransitStage job={job} docs={docs} carrierQuotes={carrierQuotes} />
      )}
      {status === "DELIVERED" && (
        <DeliveredStage job={job} quoteLines={quoteLines} />
      )}
    </div>
  );
}

function InquiryStage({ job, carrierQuotes, receivedQuotes, laneRates }: { job: any; carrierQuotes: any[]; receivedQuotes: any[]; laneRates: any[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {laneRates.length > 0 && <LaneRatesPanel laneRates={laneRates} />}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {/* Source RFQ */}
      <div className="card">
        <div className="worktable-section-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Source RFQ</span>
          {job.inquiry && (
            <a href={`/dashboard/rfq/${job.inquiry.id}`} style={{ fontSize: 11, color: "var(--brand)", fontWeight: 500, textDecoration: "none" }}>
              Open RFQ →
            </a>
          )}
        </div>
        <div style={{ padding: 16 }}>
          {job.inquiry ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{job.inquiry.subject}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginBottom: 12 }}>
                From {job.inquiry.fromEmail ?? job.inquiry.fromCompany ?? "Unknown"} · {new Date(job.inquiry.receivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </div>
              {job.inquiry.rawEmailBody && (
                <div style={{
                  fontSize: 12, lineHeight: 1.55, color: "var(--text-2)",
                  background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 6,
                  padding: 12, maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap",
                  fontFamily: "ui-monospace, Menlo, monospace",
                }}>
                  {job.inquiry.rawEmailBody}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>No source RFQ — this job was created manually.</div>
          )}
        </div>
      </div>

      {/* Carrier rate procurement */}
      <div className="card">
        <div className="worktable-section-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Carrier Rates ({receivedQuotes.length}/{carrierQuotes.length})</span>
          {receivedQuotes.length > 0 && (
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              Best: ${Math.min(...receivedQuotes.map((q: any) => q.total40HC ?? q.total40 ?? q.total20 ?? Infinity)).toLocaleString()}
            </span>
          )}
        </div>
        <div style={{ padding: 4 }}>
          {carrierQuotes.length === 0 ? (
            <div style={{ padding: 16, fontSize: 12.5, color: "var(--text-3)" }}>
              No rate requests sent yet. Use the agent to send rate requests to carriers.
            </div>
          ) : (
            <table style={{ marginBottom: 0 }}>
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th style={{ textAlign: "right" }}>20'</th>
                  <th style={{ textAlign: "right" }}>40'</th>
                  <th style={{ textAlign: "right" }}>40HC</th>
                  <th style={{ textAlign: "right" }}>Transit</th>
                  <th style={{ textAlign: "right" }}>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const cheapestId = (() => {
                    const r = receivedQuotes
                      .map((q: any) => ({ id: q.id, total: q.total40HC ?? q.total40 ?? q.total20 ?? Infinity }))
                      .sort((a, b) => a.total - b.total);
                    return r[0]?.total !== Infinity ? r[0]?.id : null;
                  })();
                  return carrierQuotes.map((q: any) => {
                    const isCheapest = cheapestId === q.id;
                    return (
                      <tr key={q.id} style={isCheapest ? { background: "var(--brand-light)" } : undefined}>
                        <td style={{ fontWeight: 600 }}>
                          {q.carrier}
                          {isCheapest && (
                            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "var(--brand)", color: "#fff", letterSpacing: "0.06em" }}>
                              BEST
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>{q.total20 ? `$${q.total20.toLocaleString()}` : "—"}</td>
                        <td style={{ textAlign: "right" }}>{q.total40 ? `$${q.total40.toLocaleString()}` : "—"}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{q.total40HC ? `$${q.total40HC.toLocaleString()}` : "—"}</td>
                        <td style={{ textAlign: "right", color: "var(--text-3)" }}>{q.transitDays ? `${q.transitDays}d` : "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                            background: q.status === "RECEIVED" ? "var(--brand-light)" : "var(--surface-3)",
                            color: q.status === "RECEIVED" ? "var(--brand)" : "var(--text-3)",
                            border: "1px solid",
                            borderColor: q.status === "RECEIVED" ? "var(--brand-border)" : "var(--border)",
                          }}>{q.status === "RECEIVED" ? "REPLIED" : "PENDING"}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          {q.status === "RECEIVED" && (
                            <CounterOfferButton jobId={job.id} carrierQuoteId={q.id} carrierName={q.carrier} />
                          )}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

function QuotedStage({ job, quoteLines, laneRates, carrierQuotes }: {
  job: any;
  quoteLines: { desc: string; amount: number; cur: string }[];
  laneRates: any[];
  carrierQuotes: any[];
}) {
  const total = quoteLines.reduce((s, l) => s + l.amount, 0);

  // Aggregate carrier rates the same way the Lane Prices page does it.
  const received = carrierQuotes.filter((q: any) => q.status === "RECEIVED");
  const pending  = carrierQuotes.filter((q: any) => q.status !== "RECEIVED");
  const ranked = [...received].sort((a: any, b: any) => {
    const ap = a.total40HC ?? a.total40 ?? a.total20 ?? Infinity;
    const bp = b.total40HC ?? b.total40 ?? b.total20 ?? Infinity;
    return ap - bp;
  });
  const recommended = ranked[0] ?? null;
  const initials = (name: string) => {
    const w = name.trim().split(/\s+/);
    return w.length >= 2 ? (w[0][0] + w[w.length - 1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Carrier rate aggregation table (same shape as the Lane Prices page) */}
      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Carrier rates received</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
              Aggregated quotes for this load. Cheapest 40HC flagged. Click Use this rate to seed the customer-facing quote.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 9px", borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-3)" }}>Pending: {pending.length}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, padding: "3px 9px", borderRadius: 12, background: "var(--brand-light)", color: "var(--brand)", border: "1px solid var(--brand-border)" }}>Received: {received.length}</span>
          </div>
        </div>
        {received.length === 0 ? (
          <div style={{ padding: 24, fontSize: 12.5, color: "var(--text-3)", textAlign: "center" }}>
            No carrier rate replies on this load yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", textAlign: "left" }}>
                  <th style={qThStyle}>Carrier</th>
                  <th style={qThStyle}>Service</th>
                  <th style={{ ...qThStyle, textAlign: "right" }}>20DRY</th>
                  <th style={{ ...qThStyle, textAlign: "right" }}>40DRY</th>
                  <th style={{ ...qThStyle, textAlign: "right" }}>40HC</th>
                  <th style={{ ...qThStyle, textAlign: "center" }}>Transit</th>
                  <th style={qThStyle}>Validity</th>
                  <th style={qThStyle}> </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((q: any) => {
                  const isRec = recommended?.id === q.id;
                  const seedDescription = `Ocean Freight — ${q.carrier}${q.service ? ` (${q.service})` : ""}`;
                  const seedAmount = q.total40HC ?? q.total40 ?? q.total20 ?? 0;
                  return (
                    <tr key={q.id} style={{
                      borderTop: "1px solid var(--border)",
                      background: isRec ? "var(--brand-light)" : "transparent",
                      borderLeft: isRec ? "3px solid var(--brand)" : "3px solid transparent",
                    }}>
                      <td style={qTdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--surface-3)", color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}>
                            {initials(q.carrier)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600 }}>{q.carrier}</div>
                            {isRec && <div style={{ fontSize: 10, color: "var(--brand)", fontWeight: 700, marginTop: 1 }}>● BEST 40HC</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ ...qTdStyle, color: "var(--text-3)" }}>{q.service ?? "—"}</td>
                      <td style={{ ...qTdStyle, textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600 }}>{q.total20 ? `$${q.total20.toLocaleString()}` : "—"}</td>
                      <td style={{ ...qTdStyle, textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600 }}>{q.total40 ? `$${q.total40.toLocaleString()}` : "—"}</td>
                      <td style={{ ...qTdStyle, textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700, color: isRec ? "var(--brand)" : "var(--text)" }}>{q.total40HC ? `$${q.total40HC.toLocaleString()}` : "—"}</td>
                      <td style={{ ...qTdStyle, textAlign: "center", color: "var(--text-3)" }}>{q.transitDays ? `${q.transitDays}d` : "—"}</td>
                      <td style={{ ...qTdStyle, color: "var(--text-3)" }}>{q.validity ?? "—"}</td>
                      <td style={qTdStyle}>
                        <form action={addQuoteLine.bind(null, job.id)}>
                          <input type="hidden" name="description" value={seedDescription} />
                          <input type="hidden" name="amount" value={seedAmount} />
                          <input type="hidden" name="currency" value="USD" />
                          <button type="submit" className="btn btn-secondary btn-sm" style={{ fontSize: 10.5, whiteSpace: "nowrap" }}>
                            Use this rate
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {laneRates.length > 0 && <LaneRatesPanel laneRates={laneRates} />}

      {/* Customer-facing quote builder */}
      <div className="card">
        <div className="worktable-section-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span>Customer quote — {job.reference}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <a href={`/api/jobs/${job.id}/quote-pdf`} target="_blank" className="btn btn-secondary btn-sm" style={{ fontSize: 11.5, textDecoration: "none" }}>
              Preview PDF
            </a>
            <button className="btn btn-sm" type="button" disabled style={{ fontSize: 11.5 }} title="Coming soon">Send to customer</button>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          {quoteLines.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--text-3)", marginBottom: 14 }}>
              No line items yet. Click <strong>Use this rate</strong> on a carrier above, or add a line manually below.
            </div>
          ) : (
            <table style={{ marginBottom: 14, width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--surface-2)", color: "var(--text-3)", textAlign: "left" }}>
                  <th style={qThStyle}>Description</th>
                  <th style={{ ...qThStyle, textAlign: "right" }}>Amount</th>
                  <th style={qThStyle}>Cur</th>
                </tr>
              </thead>
              <tbody>
                {quoteLines.map((l, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={qTdStyle}>{l.desc}</td>
                    <td style={{ ...qTdStyle, textAlign: "right", fontWeight: 600 }}>{l.amount.toLocaleString()}</td>
                    <td style={{ ...qTdStyle, color: "var(--text-3)" }}>{l.cur}</td>
                  </tr>
                ))}
                <tr style={{ background: "var(--surface-2)", borderTop: "1px solid var(--border-strong)" }}>
                  <td style={{ ...qTdStyle, fontWeight: 700 }}>Total</td>
                  <td style={{ ...qTdStyle, textAlign: "right", fontWeight: 800 }}>{total.toLocaleString()}</td>
                  <td style={{ ...qTdStyle, color: "var(--text-3)" }}>{quoteLines[0]?.cur ?? "USD"}</td>
                </tr>
              </tbody>
            </table>
          )}
          <form action={addQuoteLine.bind(null, job.id)} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8 }}>
            <input name="description" placeholder="Description (e.g. Documentation, customs clearance)" required />
            <input name="amount" type="number" placeholder="Amount" required />
            <select name="currency" defaultValue="USD"><option>USD</option><option>EUR</option><option>TRY</option><option>GBP</option></select>
            <button className="btn btn-secondary btn-sm" type="submit" style={{ fontSize: 12 }}>Add line</button>
          </form>
        </div>
      </div>
    </div>
  );
}

const qThStyle: React.CSSProperties = { padding: "10px 14px", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" };
const qTdStyle: React.CSSProperties = { padding: "12px 14px", verticalAlign: "middle" };

function LaneRatesPanel({ laneRates }: { laneRates: any[] }) {
  return (
    <div className="card">
      <div className="worktable-section-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Standard Lane Rates · {laneRates.length} match{laneRates.length === 1 ? "" : "es"} for this lane</span>
        <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>From your rate library</span>
      </div>
      <div style={{ padding: 4 }}>
        <table style={{ marginBottom: 0 }}>
          <thead>
            <tr>
              <th>Lane</th>
              <th>Mode</th>
              <th style={{ textAlign: "right" }}>Base rate</th>
              <th style={{ textAlign: "right" }}>Valid</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {laneRates.map((r) => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.origin} → {r.destination}</td>
                <td style={{ color: "var(--text-3)" }}>{r.mode}</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{r.currency} {r.baseAmount.toLocaleString()}</td>
                <td style={{ textAlign: "right", color: "var(--text-3)", fontSize: 11 }}>
                  {new Date(r.validFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                  {r.validTo ? ` – ${new Date(r.validTo).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}` : ""}
                </td>
                <td style={{ color: "var(--text-3)", fontSize: 11 }}>{r.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocumentsStage({ job, docs }: { job: any; docs: any[] }) {
  const approved = docs.filter((d) => d.status === "APPROVED").length;
  return (
    <div className="card">
      <div className="worktable-section-header">
        Documents · {approved}/{docs.length} approved
      </div>
      <div>
        {docs.map((d) => {
          let flags: string[] = [];
          let keyFields: Record<string, unknown> = {};
          if (d.aiFlags) { try { const x = JSON.parse(d.aiFlags); if (Array.isArray(x)) flags = x.filter((y: unknown) => typeof y === "string") as string[]; } catch {} }
          if (d.aiKeyFields) { try { const x = JSON.parse(d.aiKeyFields); if (x && typeof x === "object") keyFields = x; } catch {} }
          return (
          <div key={d.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 4, flexShrink: 0,
                  background: d.status === "APPROVED" ? "var(--brand)" : "var(--surface-3)",
                  border: `1px solid ${d.status === "APPROVED" ? "var(--brand)" : "var(--border)"}`,
                  color: d.status === "APPROVED" ? "#fff" : "var(--text-3)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {d.status === "APPROVED" ? <Icon name="check" size={14} strokeWidth={2.5} />
                    : d.status === "UPLOADED" ? <Icon name="chevron-up" size={13} strokeWidth={2.5} />
                    : <Icon name="circle" size={11} strokeWidth={1.5} />}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                    {DOC_TYPE_LABEL[d.docType] ?? d.docType} · {d.status.toLowerCase()}
                    {d.aiAnalyzedAt && <span style={{ marginLeft: 6, color: "var(--brand)" }}>· AI commented</span>}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {d.url && d.status !== "PENDING" && (
                  <DocumentViewer documentId={d.id} name={d.name} status={d.status} />
                )}
                {d.status === "PENDING" && (
                  <form action={updateDocStatus.bind(null, d.id, "UPLOADED")}>
                    <button type="submit" className="btn btn-secondary btn-sm" style={{ fontSize: 11.5 }}>Mark uploaded</button>
                  </form>
                )}
                {d.status === "UPLOADED" && (
                  <form action={updateDocStatus.bind(null, d.id, "APPROVED")}>
                    <button type="submit" className="btn btn-sm" style={{ fontSize: 11.5 }}>Approve</button>
                  </form>
                )}
              </div>
            </div>
            {(d.aiSummary || flags.length > 0) && (
              <div style={{ marginTop: 8, marginLeft: 40, padding: "8px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
                {d.aiSummary && (
                  <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>
                    <span style={{ fontWeight: 700, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9.5, marginRight: 6 }}>AI</span>
                    {d.aiSummary}
                  </div>
                )}
                {flags.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                    {flags.map((f: string, i: number) => (
                      <div key={i} style={{ fontSize: 11, color: "var(--danger)", display: "flex", gap: 6 }}>
                        <Icon name="alert" size={11} /><span>{f}</span>
                      </div>
                    ))}
                  </div>
                )}
                {Object.keys(keyFields).length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ fontSize: 10.5, color: "var(--text-3)", cursor: "pointer", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                      Extracted fields ({Object.keys(keyFields).length})
                    </summary>
                    <div style={{ marginTop: 4, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "2px 10px", fontSize: 11 }}>
                      {Object.entries(keyFields).map(([k, v]) => (
                        <React.Fragment key={k}>
                          <span style={{ color: "var(--text-3)" }}>{k}</span>
                          <span style={{ color: "var(--text)" }}>{Array.isArray(v) ? v.join(", ") : String(v)}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}

function InTransitStage({ job, docs, carrierQuotes }: { job: any; docs: any[]; carrierQuotes: any[] }) {
  const selected = carrierQuotes.find((q: any) => q.status === "RECEIVED" && (q.total40HC === job.cost || q.total40 === job.cost || q.total20 === job.cost)) ?? carrierQuotes.find((q: any) => q.status === "RECEIVED");
  const received = carrierQuotes.filter((q: any) => q.status === "RECEIVED");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="card">
          <div className="worktable-section-header">Transit details</div>
          <div style={{ padding: 16, display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 8, columnGap: 16, fontSize: 12.5 }}>
            <span style={{ color: "var(--text-3)" }}>ETD</span>
            <span style={{ fontWeight: 600 }}>{job.etd ? new Date(job.etd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
            <span style={{ color: "var(--text-3)" }}>ETA</span>
            <span style={{ fontWeight: 600 }}>{job.eta ? new Date(job.eta).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}</span>
            <span style={{ color: "var(--text-3)" }}>Carrier</span>
            <span style={{ fontWeight: 600 }}>{selected?.carrier ?? "—"}</span>
            <span style={{ color: "var(--text-3)" }}>Service</span>
            <span style={{ fontWeight: 600 }}>{selected?.service ?? "—"}</span>
            <span style={{ color: "var(--text-3)" }}>Transit</span>
            <span style={{ fontWeight: 600 }}>{selected?.transitDays ? `${selected.transitDays} days` : "—"}</span>
          </div>
        </div>
        <div className="card">
          <div className="worktable-section-header">Carrier rates received <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>· {received.length} of {carrierQuotes.length}</span></div>
          <div style={{ padding: "10px 16px 14px" }}>
            {received.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>No carrier replies on this load yet.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {received.map((q: any) => {
                  const total = q.total40HC ?? q.total40 ?? q.total20;
                  const isSelected = total === job.cost;
                  return (
                    <div key={q.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                      <div>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{q.carrier}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>{q.service ?? "—"}{q.transitDays ? ` · ${q.transitDays}d` : ""}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{total ? `$${total.toLocaleString()}` : "—"}</span>
                        {isSelected && (
                          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "var(--brand)", color: "#fff", letterSpacing: "0.06em" }}>SELECTED</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <DocumentsStage job={job} docs={docs} />
    </div>
  );
}

function DeliveredStage({ job, quoteLines }: { job: any; quoteLines: { desc: string; amount: number; cur: string }[] }) {
  const totalRev = quoteLines.reduce((s, l) => s + l.amount, 0) || job.revenue || 0;
  const margin = job.revenue && job.cost ? job.revenue - job.cost : null;
  const marginPct = job.revenue && job.cost ? ((job.revenue - job.cost) / job.revenue) * 100 : null;
  return (
    <div className="card">
      <div className="worktable-section-header">Final settlement</div>
      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Revenue billed</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>${totalRev.toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Carrier cost</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>${(job.cost ?? 0).toLocaleString()}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Gross margin</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{margin != null ? `$${margin.toLocaleString()}` : "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Margin %</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{marginPct != null ? `${marginPct.toFixed(1)}%` : "—"}</div>
        </div>
      </div>
    </div>
  );
}
