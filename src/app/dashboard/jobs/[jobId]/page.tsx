import React from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  initJobDocuments, initJobMilestones, updateDocStatus,
  markMilestoneActual, updateMilestonePlanned,
  addCarrierQuote, selectCarrierQuote, updateJobStatus,
  addQuoteLine,
} from "./actions";
import { Icon } from "@/components/icon";
import { PopulateJobButton } from "@/components/populate-job-button";
import { SourcingOffersTable } from "@/components/sourcing-offers-table";
import { PortalLinkButton } from "@/components/portal-link-button";
import { DocumentViewer } from "@/components/document-viewer";
import { SubmitButton } from "@/components/submit-button";
import { JobNote } from "@/components/job-note";
import { parseQuoteLines, cleanNotes } from "@/lib/quote-lines";
import { CONTAINER_TYPE_LABEL, dimensionsSummary } from "@/lib/cargo";

const STATUS_ORDER = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED"] as const;
const STATUS_SELECT = ["PROPOSED", "INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "CUSTOMS", "DELIVERED", "CANCELLED"] as const;
const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Proposed", INQUIRY: "Inquiry", QUOTED: "Quoted", BOOKED: "Booked",
  IN_TRANSIT: "In Transit", CUSTOMS: "Customs", DELIVERED: "Delivered", CANCELLED: "Cancelled",
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
  if (!d) return "";
  return new Date(d).toISOString().split("T")[0];
}
function relTime(d: Date) {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type AutoEvent = {
  at: Date;
  iconName: "inbox" | "sparkles" | "ship" | "box" | "check" | "file" | "file-check" | "mail-in" | "mail-out" | "user";
  kind: "auto" | "manual";
  title: string;
  sub?: string;
};

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const session = await requireSession();
  const { jobId } = await params;

  const job = await prisma.job.findFirst({
    where: { id: jobId, officeId: session.officeId },
    include: {
      company: { select: { id: true, name: true } },
      inquiry: { include: { carrierQuotes: { orderBy: { createdAt: "asc" } } } },
      documents: { orderBy: { createdAt: "asc" } },
      milestones: { orderBy: { createdAt: "asc" } },
      parent:   { select: { id: true, reference: true, type: true } },
      children: { select: { id: true, reference: true, type: true, status: true } },
      emailThreads: {
        include: { messages: { orderBy: { sentAt: "asc" } } },
      },
    },
  });
  if (!job) notFound();

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

  // ── Build chronological activity feed ───────────────────────────────────
  const events: AutoEvent[] = [];
  if (job.inquiry) {
    events.push({
      at: new Date(job.inquiry.receivedAt),
      iconName: "inbox", kind: "auto",
      title: "RFQ captured from inbox",
      sub: `"${job.inquiry.subject}" — ${job.inquiry.fromEmail ?? job.inquiry.fromCompany ?? "Unknown sender"}`,
    });
    if (job.inquiry.parsedData) {
      events.push({
        at: new Date(job.inquiry.updatedAt),
        iconName: "sparkles", kind: "auto",
        title: "AI parsed shipment fields",
        sub: `${job.inquiry.origin ?? "?"} → ${job.inquiry.destination ?? "?"} · ${job.inquiry.mode ?? "—"}${job.inquiry.weight ? ` · ${job.inquiry.weight.toLocaleString()}kg` : ""}`,
      });
    }
    for (const cq of job.inquiry.carrierQuotes) {
      const total = cq.total40HC ?? cq.total40 ?? cq.total20;
      if (cq.status === "PENDING") {
        events.push({
          at: new Date(cq.createdAt),
          iconName: "mail-out", kind: "auto",
          title: `Rate request sent to ${cq.carrier}`,
          sub: "Awaiting reply",
        });
      } else {
        events.push({
          at: new Date(cq.createdAt),
          iconName: "ship", kind: "auto",
          title: `${cq.carrier} replied with rate`,
          sub: total ? `$${total.toLocaleString()}${cq.transitDays ? ` · ${cq.transitDays}d transit` : ""}` : (cq.service ?? ""),
        });
      }
    }
  }
  events.push({
    at: new Date(job.createdAt),
    iconName: "box",
    kind: job.inquiry ? "auto" : "manual",
    title: job.inquiry ? `Converted to ${job.reference}` : `Job ${job.reference} created manually`,
    sub: `Status set to ${STATUS_LABEL[job.status]}`,
  });
  for (const m of milestones) {
    if (m.actualAt) {
      events.push({
        at: new Date(m.actualAt),
        iconName: "check", kind: "manual",
        title: `${MILESTONE_LABEL[m.type] ?? m.type} confirmed`,
        sub: fmt(m.actualAt),
      });
    }
  }
  for (const d of docs) {
    if (d.status === "APPROVED" || d.status === "UPLOADED") {
      events.push({
        at: new Date(d.updatedAt),
        iconName: d.status === "APPROVED" ? "file-check" : "file",
        kind: "manual",
        title: `${d.name} ${d.status.toLowerCase()}`,
        sub: DOC_TYPE_LABEL[d.docType] ?? d.docType,
      });
    }
  }
  for (const thread of job.emailThreads) {
    for (const msg of thread.messages) {
      events.push({
        at: new Date(msg.sentAt),
        iconName: msg.direction === "INBOUND" ? "mail-in" : "mail-out",
        kind: msg.direction === "INBOUND" ? "auto" : "manual",
        title: msg.direction === "INBOUND" ? "Inbound email" : "Outbound email",
        sub: `${msg.fromEmail ?? thread.subject}`,
      });
    }
  }
  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  const NEXT_AUTO: Record<string, string> = {
    INQUIRY: "Awaiting carrier rates",
    QUOTED: "Awaiting customer reply",
    BOOKED: "Tracking carrier milestones",
    IN_TRANSIT: "Watching for ETA / customs handoff",
    CUSTOMS: "Watching for customs release",
    DELIVERED: "Job complete",
  };

  const quoteLines = parseQuoteLines(job);

  const equipment =
    job.mode === "SEA-FCL" && job.containerCount
      ? `${job.containerCount} × ${job.containerType ? (CONTAINER_TYPE_LABEL[job.containerType] ?? job.containerType) : "container"}`
      : dimensionsSummary(job.dimensions);

  const carrierQuotes = job.inquiry?.carrierQuotes ?? [];
  const receivedQuotes = carrierQuotes.filter((q) => q.status === "RECEIVED");
  const pendingQuotes = carrierQuotes.filter((q) => q.status === "PENDING");

  return (
    <div>
      {/* Back */}
      <div style={{ marginBottom: 14 }}>
        <a href="/dashboard/jobs" className="back-link">
          <Icon name="chevron-left" size={14} strokeWidth={2} /> Pipeline
        </a>
      </div>

      {/* Header strip */}
      <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-2)", fontFamily: "ui-monospace, Menlo, monospace" }}>
                {job.reference}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>·</span>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                {job.mode ? (MODE_LABEL[job.mode] ?? job.mode) : "Mode TBD"}
              </span>
              {job.incoterms && (
                <>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>·</span>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>{job.incoterms}</span>
                </>
              )}
              {equipment && (
                <>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>·</span>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>{equipment}</span>
                </>
              )}
              {job.volume != null && job.mode !== "SEA-FCL" && (
                <>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>·</span>
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>{job.volume.toLocaleString()} cbm</span>
                </>
              )}
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>
              {job.title ?? job.company?.name ?? "Unknown Customer"}
            </h1>
            <p style={{ fontSize: 14, color: "var(--text-2)" }}>
              {job.title && job.company?.name ? `${job.company.name} · ` : ""}
              {job.origin && job.destination ? `${job.origin} → ${job.destination}` : job.origin ?? job.destination ?? "Route not set"}
              {job.commodity ? ` · ${job.commodity}` : ""}
              {job.quantity != null ? ` · ${job.quantity.toLocaleString()} ${job.quantityUnit ?? ""}`.trimEnd() : ""}
              {job.cadence ? ` · ${job.cadence === "MONTHLY" ? "Monthly" : "One-off"}` : ""}
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <a
              href={`/dashboard/inbox?job=${jobId}`}
              className="btn btn-secondary btn-sm"
              style={{ fontSize: 12, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
              title="Show every email thread attached to this load"
            >
              <Icon name="inbox" size={11} /> Inbox
            </a>
            <PortalLinkButton jobId={jobId} hasToken={!!job.portalToken} notifyCustomer={job.notifyCustomer} />
            <PopulateJobButton jobId={jobId} />
            <form action={async (fd: FormData) => {
              "use server";
              await updateJobStatus(jobId, String(fd.get("status")));
            }} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select name="status" defaultValue={job.status} style={{ fontSize: 13, fontWeight: 600, padding: "6px 10px" }}>
                {STATUS_SELECT.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Updating…">Update</SubmitButton>
            </form>
          </div>
        </div>

        {/* Status pipeline */}
        <div className="status-pipeline" style={{ marginTop: 14 }}>
          {STATUS_ORDER.map((s, i) => (
            <div key={s} className={`status-step ${i < currentIdx ? "done" : i === currentIdx ? "current" : ""}`}>
              <span className="status-step-label">{STATUS_LABEL[s]}</span>
              {i < STATUS_ORDER.length - 1 && <div className="status-step-line" />}
            </div>
          ))}
        </div>

        {/* Pipeline / next auto step indicator */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border)", display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
          <span className="live-dot" aria-hidden />
          <span style={{ fontWeight: 600, color: "var(--text-2)" }}>Pipeline:</span>
          <span style={{ color: "var(--text-3)" }}>{NEXT_AUTO[job.status]}</span>
          {isOverdue && (
            <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--danger)", border: "1px solid var(--danger-border)", borderRadius: 3, padding: "0 6px", letterSpacing: "0.06em" }}>
              ETA OVERDUE
            </span>
          )}
        </div>
      </div>

      {/* Two-pane: activity feed | worktable */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* ── LEFT: Activity feed ────────────────────────────────────────── */}
        <div className="card" style={{ overflow: "hidden", alignSelf: "flex-start" }}>
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--surface-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="live-dot" aria-hidden />
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-2)" }}>
                Job Activity
              </span>
            </div>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              {events.length} event{events.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div style={{ maxHeight: "calc(100vh - 360px)", overflowY: "auto" }}>
            {events.length === 0 ? (
              <div style={{ padding: "32px 20px", fontSize: 13, color: "var(--text-3)", textAlign: "center" }}>
                No activity yet.
              </div>
            ) : (
              events.map((e, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 12,
                  padding: "12px 18px",
                  borderBottom: i === events.length - 1 ? "none" : "1px solid var(--border)",
                }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: 4, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: e.kind === "auto" ? "var(--brand-light)" : "var(--surface-3)",
                    color: e.kind === "auto" ? "var(--brand)" : "var(--text-2)",
                    border: "1px solid",
                    borderColor: e.kind === "auto" ? "var(--brand-border)" : "var(--border)",
                  }}>
                    <Icon name={e.iconName} size={13} strokeWidth={2} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{e.title}</span>
                      {e.kind === "auto" && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                          padding: "1px 5px", borderRadius: 3,
                          background: "var(--brand-light)", color: "var(--brand)",
                          border: "1px solid var(--brand-border)",
                        }}>AUTO</span>
                      )}
                    </div>
                    {e.sub && <div style={{ fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.45 }}>{e.sub}</div>}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>
                    {relTime(e.at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT: Worktable ──────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Parent / child links */}
          {(job.parent || job.children.length > 0) && (
            <div className="card">
              <div className="worktable-section-header">Linked jobs</div>
              <div style={{ padding: "10px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
                {job.parent && (
                  <a href={`/dashboard/jobs/${job.parent.id}`} style={{ fontSize: 12, color: "var(--brand)", textDecoration: "none" }}>
                    ↑ Source: {job.parent.reference} <span style={{ fontSize: 10, color: "var(--text-3)" }}>{job.parent.type === "SOURCING" ? "Procurement" : "Forwarding"}</span>
                  </a>
                )}
                {job.children.map((c) => (
                  <a key={c.id} href={`/dashboard/jobs/${c.id}`} style={{ fontSize: 12, color: "var(--brand)", textDecoration: "none" }}>
                    ↓ Spinoff: {c.reference} <span style={{ fontSize: 10, color: "var(--text-3)" }}>{c.type === "SOURCING" ? "Procurement" : "Forwarding"} · {c.status}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Personal note */}
          <div className="card">
            <div className="worktable-section-header">Note</div>
            <JobNote jobId={jobId} initial={cleanNotes(job.notes)} />
          </div>

          {/* Customer */}
          <div className="card">
            <div className="worktable-section-header">Customer</div>
            <div style={{ padding: "12px 18px" }}>
              {job.company ? (
                <a href={`/dashboard/customers/${job.company.id}`} style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>
                  {job.company.name}
                </a>
              ) : (
                <span style={{ fontSize: 13, color: "var(--text-3)" }}>No customer linked</span>
              )}
              {job.inquiry?.fromEmail && (
                <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>{job.inquiry.fromEmail}</div>
              )}
            </div>
          </div>

          {/* Procurement: supplier offers comparison */}
          {job.type === "SOURCING" && job.inquiry && (
            <SourcingOffersTable
              inquiryId={job.inquiry.id}
              rows={job.emailThreads.map((t) => {
                let offer: Record<string, unknown> | null = null;
                if (t.supplierOffer) { try { offer = JSON.parse(t.supplierOffer); } catch {} }
                const firstInbound = t.messages.find((m) => m.direction === "INBOUND");
                return {
                  threadId: t.id,
                  threadSubject: t.subject,
                  fromEmail: firstInbound?.fromEmail ?? null,
                  lastMessageAt: t.lastMessageAt.toISOString(),
                  awardedAt: t.awardedAt ? t.awardedAt.toISOString() : null,
                  offer: offer as never,
                };
              })}
            />
          )}

          {/* Forwarding: carrier rates */}
          {job.type === "FORWARDING" && (
          <div className="card">
            <div className="worktable-section-header">
              Carrier
              {receivedQuotes.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>
                  · {receivedQuotes.length} of {carrierQuotes.length} replied
                </span>
              )}
            </div>
            <div style={{ padding: "10px 18px" }}>
              {!job.inquiry ? (
                <div style={{ fontSize: 13, color: "var(--text-3)" }}>No source RFQ — carrier rates tracked manually.</div>
              ) : carrierQuotes.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-3)" }}>No rate requests sent yet.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {carrierQuotes.map((q) => {
                    const total = q.total40HC ?? q.total40 ?? q.total20;
                    const isSelected = job.cost && total === job.cost;
                    return (
                      <div key={q.id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "8px 0", borderBottom: "1px solid var(--border)",
                      }}>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{q.carrier}</div>
                          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                            {q.status === "PENDING" ? "Awaiting reply" : `${q.transitDays ? `${q.transitDays}d transit` : "—"}${q.service ? ` · ${q.service}` : ""}`}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          {q.status === "RECEIVED" && total ? (
                            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>${total.toLocaleString()}</span>
                          ) : (
                            <span style={{ fontSize: 11, color: "var(--text-3)", fontStyle: "italic" }}>pending</span>
                          )}
                          {isSelected && (
                            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: "var(--brand)", color: "#fff", letterSpacing: "0.06em" }}>SELECTED</span>
                          )}
                          {!isSelected && q.status === "RECEIVED" && (
                            <form action={selectCarrierQuote.bind(null, jobId, q.id)}>
                              <SubmitButton className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} pendingLabel="…">Select</SubmitButton>
                            </form>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {pendingQuotes.length > 0 && receivedQuotes.length > 0 && (
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6, fontStyle: "italic" }}>
                      {pendingQuotes.length} more pending — agent is watching for replies.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick add carrier rate (manual) */}
            {job.inquiry && (
              <details style={{ borderTop: "1px solid var(--border)" }}>
                <summary style={{ padding: "10px 18px", fontSize: 12, color: "var(--text-2)", cursor: "pointer", listStyle: "none" }}>
                  + Add carrier rate manually
                </summary>
                <form action={addCarrierQuote.bind(null, job.inquiry.id)} style={{ padding: "0 18px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input name="carrier" placeholder="Carrier name" required />
                  <input name="service" placeholder="Service" />
                  <input name="total40HC" type="number" placeholder="Total 40HC ($)" />
                  <input name="transitDays" type="number" placeholder="Transit days" />
                  <SubmitButton className="btn btn-secondary btn-sm" style={{ gridColumn: "1 / -1", fontSize: 12 }} pendingLabel="Adding…">
                    Add rate
                  </SubmitButton>
                </form>
              </details>
            )}
          </div>
          )}

          {/* Milestones */}
          <div className="card">
            <div className="worktable-section-header">Milestones</div>
            <div style={{ padding: "8px 18px 14px" }}>
              {milestones.map((m) => {
                const isDone = !!m.actualAt;
                const isLate = m.plannedAt && !isDone && new Date(m.plannedAt) < today;
                return (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                      background: isDone ? "var(--brand)" : "var(--surface-3)",
                      border: `1.5px solid ${isDone ? "var(--brand)" : isLate ? "var(--danger)" : "var(--border-strong)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "#fff",
                    }}>
                      {isDone && <Icon name="check" size={10} strokeWidth={3} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text)" }}>
                        {MILESTONE_LABEL[m.type] ?? m.type}
                      </div>
                      <div style={{ fontSize: 11, color: isLate ? "var(--danger)" : "var(--text-3)" }}>
                        {isDone ? `Done ${fmt(m.actualAt)}` : m.plannedAt ? `Planned ${fmt(m.plannedAt)}` : "No date set"}
                      </div>
                    </div>
                    {!isDone && (
                      <div style={{ display: "flex", gap: 4 }}>
                        <form action={async (fd: FormData) => {
                          "use server";
                          const date = String(fd.get("plannedAt"));
                          if (date) await updateMilestonePlanned(m.id, date);
                        }} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input type="date" name="plannedAt" defaultValue={fmtInput(m.plannedAt)} style={{ fontSize: 11, padding: "3px 5px", width: 130 }} />
                          <SubmitButton className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: "3px 7px" }} pendingLabel="…">Set</SubmitButton>
                        </form>
                        <form action={markMilestoneActual.bind(null, m.id)}>
                          <SubmitButton className="btn btn-sm" style={{ fontSize: 11, padding: "3px 7px" }} pendingLabel="…">Mark done</SubmitButton>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Documents */}
          <div className="card">
            <div className="worktable-section-header">
              Documents
              <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-3)", fontWeight: 500 }}>
                · {docs.filter((d) => d.status === "APPROVED").length}/{docs.length} approved
              </span>
            </div>
            <div style={{ padding: "8px 18px 14px" }}>
              {docs.map((d) => {
                let flags: string[] = [];
                let keyFields: Record<string, unknown> = {};
                if (d.aiFlags) { try { const x = JSON.parse(d.aiFlags); if (Array.isArray(x)) flags = x.filter((y) => typeof y === "string"); } catch {} }
                if (d.aiKeyFields) { try { const x = JSON.parse(d.aiKeyFields); if (x && typeof x === "object") keyFields = x; } catch {} }
                return (
                <div key={d.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: 4, flexShrink: 0,
                      background: d.status === "APPROVED" ? "var(--brand)" : "var(--surface-3)",
                      border: `1px solid ${d.status === "APPROVED" ? "var(--brand)" : "var(--border)"}`,
                      color: d.status === "APPROVED" ? "#fff" : "var(--text-3)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {d.status === "APPROVED" ? <Icon name="check" size={13} strokeWidth={2.5} />
                        : d.status === "UPLOADED" ? <Icon name="chevron-up" size={12} strokeWidth={2.5} />
                        : <Icon name="circle" size={9} strokeWidth={1.5} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{d.name}</div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)" }}>
                        {DOC_TYPE_LABEL[d.docType] ?? d.docType} · {d.status.toLowerCase()}
                        {d.aiAnalyzedAt && <span style={{ marginLeft: 6, color: "var(--brand)" }}>· AI commented</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {d.url && d.status !== "PENDING" && (
                        <DocumentViewer documentId={d.id} name={d.name} status={d.status} />
                      )}
                      {d.status === "PENDING" && (
                        <form action={updateDocStatus.bind(null, d.id, "UPLOADED")}>
                          <SubmitButton className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} pendingLabel="…">Mark uploaded</SubmitButton>
                        </form>
                      )}
                      {d.status === "UPLOADED" && (
                        <form action={updateDocStatus.bind(null, d.id, "APPROVED")}>
                          <SubmitButton className="btn btn-sm" style={{ fontSize: 11 }} pendingLabel="…">Approve</SubmitButton>
                        </form>
                      )}
                    </div>
                  </div>
                  {(d.aiSummary || flags.length > 0) && (
                    <div style={{ marginTop: 6, marginLeft: 34, padding: "8px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
                      {d.aiSummary && (
                        <div style={{ fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.5 }}>
                          <span style={{ fontWeight: 700, color: "var(--brand)", textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9.5, marginRight: 6 }}>AI</span>
                          {d.aiSummary}
                        </div>
                      )}
                      {flags.length > 0 && (
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                          {flags.map((f, i) => (
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

          {/* Financials & Quote */}
          <div className="card">
            <div className="worktable-section-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>Financials & Quote</span>
              <a href={`/api/jobs/${jobId}/quote-pdf`} target="_blank" style={{ fontSize: 11, color: "var(--brand)", fontWeight: 500, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="external" size={11} /> Quote PDF
              </a>
            </div>
            <div style={{ padding: "12px 18px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Revenue</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)" }}>{job.revenue ? `$${job.revenue.toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Cost</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)" }}>{job.cost ? `$${job.cost.toLocaleString()}` : "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Margin</div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text)" }}>
                  {job.revenue && job.cost ? `${(((job.revenue - job.cost) / job.revenue) * 100).toFixed(1)}%` : "—"}
                </div>
              </div>
            </div>

            {quoteLines.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border)", padding: "10px 18px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Line items
                </div>
                {quoteLines.map((l, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "4px 0" }}>
                    <span style={{ color: "var(--text-2)" }}>{l.desc}</span>
                    <span style={{ fontWeight: 600 }}>{l.amount.toLocaleString()} {l.cur}</span>
                  </div>
                ))}
              </div>
            )}

            <details style={{ borderTop: "1px solid var(--border)" }}>
              <summary style={{ padding: "10px 18px", fontSize: 12, color: "var(--text-2)", cursor: "pointer", listStyle: "none" }}>
                + Add line item
              </summary>
              <form action={addQuoteLine.bind(null, jobId)} style={{ padding: "0 18px 14px", display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                <input name="description" placeholder="Description" required />
                <input name="amount" type="number" placeholder="Amount" required />
                <select name="currency" defaultValue="USD"><option>USD</option><option>EUR</option><option>TRY</option><option>GBP</option></select>
                <SubmitButton className="btn btn-secondary btn-sm" style={{ gridColumn: "1 / -1", fontSize: 12 }} pendingLabel="Adding…">Add line</SubmitButton>
              </form>
            </details>
          </div>

        </div>
      </div>
    </div>
  );
}
