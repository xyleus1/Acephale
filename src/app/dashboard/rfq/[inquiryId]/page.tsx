import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { convertToJob, updateInquiryField, updateInquiryStatus, parseRFQWithAI } from "./actions";
import { Icon } from "@/components/icon";
import { SourcingOffersTable } from "@/components/sourcing-offers-table";
import { OpportunityScoreCard, OpportunityScorePill } from "@/components/opportunity-score-card";
import { assessInquiryStrategy } from "@/lib/commercial-strategy-persistence";
import { qualifyRfq } from "@/lib/rfq-qualification";
import { MissingInfoDraftButton } from "@/components/missing-info-draft-button";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  INGESTED: { label: "RFQ",        cls: "badge-info" },
  PARSED:   { label: "Mature RFQ", cls: "badge-neutral" },
  PRICED:   { label: "Pricing",    cls: "badge-warn" },
  QUOTED:   { label: "Quoted", cls: "badge-good" },
  WON:      { label: "Won",    cls: "badge-good" },
  LOST:     { label: "Lost",   cls: "badge-danger" },
};

function fmt(d: Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function labelChoice(value: string | null | undefined, labels: Record<string, string>) {
  return value ? (labels[value] ?? value) : "Unknown";
}

type ReferenceDealSource = {
  source: "reference-deal";
  sourceKey?: string;
  referenceDealId?: string;
  sheet: {
    contact?: string | null;
    type?: string | null;
    contract?: string | null;
    status?: string | null;
    cadence?: string | null;
    contractValue?: number | null;
    contractCurrency?: string | null;
    profit?: number | null;
    profitCurrency?: string | null;
    quantity?: string | null;
    unit?: string | null;
  };
};

function parseReferenceDealSource(parsedData: string | null | undefined): ReferenceDealSource | null {
  if (!parsedData) return null;
  try {
    const parsed = JSON.parse(parsedData) as ReferenceDealSource;
    if (parsed?.source !== "reference-deal" || !parsed.sheet) return null;
    return parsed;
  } catch {
    return null;
  }
}

function money(value: number | null | undefined, currency: string | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${currency ?? "USD"} ${Math.round(value).toLocaleString()}`;
}

function ReferenceDealSourcePanel({ source }: { source: ReferenceDealSource }) {
  const sheet = source.sheet;
  return (
    <div className="record-panel reference-source-panel">
      <div className="record-card-header">
        <div className="record-card-title">
          <Icon name="file" size={13} /> Sheet Source
        </div>
      </div>
      <div className="card-body">
        <div className="reference-source-title">
          <strong>{sheet.contract ?? "Control-sheet lead"}</strong>
          <span>{[sheet.contact, sheet.type, sheet.status].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="reference-source-grid">
          <div>
            <span>Contract context</span>
            <strong>{money(sheet.contractValue, sheet.contractCurrency)}</strong>
          </div>
          <div>
            <span>Expected profit</span>
            <strong>{money(sheet.profit, sheet.profitCurrency)}</strong>
          </div>
          <div>
            <span>Cadence</span>
            <strong>{sheet.cadence || "—"}</strong>
          </div>
          <div>
            <span>Quantity</span>
            <strong>{[sheet.quantity, sheet.unit].filter(Boolean).join(" ") || "—"}</strong>
          </div>
        </div>
        <div className="reference-source-warning">
          Sheet economics are decision context only. Confirm target price with the customer before pricing or forwarding.
        </div>
      </div>
    </div>
  );
}

export default async function RFQDetailPage({
  params,
}: {
  params: Promise<{ inquiryId: string }>;
}) {
  const session = await requireSession();
  const { inquiryId } = await params;

  const inquiry = await prisma.inquiry.findFirst({
    where: { id: inquiryId, officeId: session.officeId },
    include: {
      company: { select: { id: true, name: true } },
      carrierQuotes: { orderBy: { createdAt: "asc" } },
      job: { select: { id: true, reference: true, status: true } },
      emailThreads: {
        include: { messages: { orderBy: { sentAt: "asc" } } },
      },
      targetPriceHistory: { orderBy: { createdAt: "desc" }, take: 8 },
    },
  });

  if (!inquiry) notFound();

  const companies = await prisma.company.findMany({
    where: { officeId: session.officeId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const sm = STATUS_META[inquiry.status] ?? { label: inquiry.status, cls: "badge-neutral" };
  const canConvert = !inquiry.job && !["WON", "LOST"].includes(inquiry.status);

  const FLOW_HINTS: Record<string, { msg: string; action: string }> = {
    INGESTED: { msg: "This RFQ hasn't been parsed yet.", action: "Parse with AI to extract origin, destination, mode and cargo details." },
    PARSED:   { msg: "RFQ is mature.", action: "Move it into pricing only when the fields below are complete." },
    PRICED:   { msg: "Forwarder rates collected.", action: "Prepare the customer quote or convert to a job after approval." },
    QUOTED:   { msg: "Quote has been sent to the customer.", action: "Waiting for customer reply. Mark as Won or Lost when outcome is known." },
  };
  const flowHint = !inquiry.job ? FLOW_HINTS[inquiry.status] : null;
  const strategyRun = await assessInquiryStrategy(session.officeId, inquiry.id);
  const opportunity = strategyRun?.strategy;
  const maturity = qualifyRfq(inquiry);
  const referenceSource = parseReferenceDealSource(inquiry.parsedData);
  const maturityMissing = [
    ...maturity.missing,
    ...(maturity.targetPriceQuestion ? ["target price or no-target confirmation"] : []),
  ];

  return (
    <div>
      {/* Back */}
      <div className="record-back-row">
        <a href="/dashboard/rfq" className="back-link">
          <Icon name="chevron-left" size={14} />
          RFQ Inbox
        </a>
      </div>

      {/* Flow hint banner */}
      {flowHint && (
        <div className="record-notice">
          <div className="record-notice-body">
            <span className="record-notice-icon">
              <Icon name="info" size={14} />
            </span>
            <div>
              <div className="record-notice-title">{flowHint.msg}</div>
              <div className="record-notice-text">{flowHint.action}</div>
            </div>
          </div>
          {inquiry.status === "INGESTED" && inquiry.rawEmailBody && (
            <form action={parseRFQWithAI.bind(null, inquiry.id)} className="record-notice-action">
              <button className="btn btn-sm" type="submit">
                <Icon name="sparkles" size={12} strokeWidth={2} /> Parse with AI
              </button>
            </form>
          )}
        </div>
      )}

      {/* Header */}
      <div className="record-hero">
        <div className="record-hero-top">
          <div className="record-hero-main">
            <div className="record-eyebrow">
              <span className={`badge ${sm.cls}`}>{sm.label}</span>
              {opportunity && <OpportunityScorePill score={opportunity} />}
              <span className="record-chip">{fmt(inquiry.receivedAt)}</span>
            </div>
            <h1 className="record-title">{inquiry.subject}</h1>
            <p className="record-subtitle">
              {inquiry.fromEmail ?? inquiry.fromCompany ?? "Unknown sender"}
              {inquiry.company && ` · ${inquiry.company.name}`}
            </p>
          </div>
          <div className="record-actions">
            {inquiry.job ? (
              <a href={`/dashboard/jobs/${inquiry.job.id}`} className="btn btn-sm">
                Job {inquiry.job.reference} <Icon name="arrow-right" size={13} />
              </a>
            ) : (
              <>
                <form action={updateInquiryStatus.bind(null, inquiryId, "LOST")}>
                  <button className="btn btn-secondary btn-sm" type="submit">Mark Lost</button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="record-two-pane record-two-pane-sidebar">
        {/* Left: email body + parsed fields */}
        <div className="record-side-stack">

          {/* Raw email */}
          {inquiry.rawEmailBody && (
            <div className="record-panel">
              <div className="record-card-header">
                <div className="record-card-title">
                  <Icon name="mail" size={13} /> Email Content
                </div>
              </div>
              <div className="card-body">
                <div className="record-mono-block">
                  {inquiry.rawEmailBody}
                </div>
              </div>
            </div>
          )}

          {/* Sourcing comparison table — only for SOURCING inquiries */}
          {inquiry.type === "SOURCING" && (
            <SourcingOffersTable
              inquiryId={inquiry.id}
              rows={inquiry.emailThreads.map((t) => {
                let offer: Record<string, unknown> | null = null;
                if (t.supplierOffer) {
                  try { offer = JSON.parse(t.supplierOffer); } catch { offer = null; }
                }
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

          {/* Email threads */}
          {inquiry.emailThreads.length > 0 && (
            <div className="email-thread">
              {inquiry.emailThreads.map((thread) =>
                thread.messages.map((msg) => {
                  let attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];
                  if (msg.attachments) {
                    try { attachments = JSON.parse(msg.attachments); } catch { attachments = []; }
                  }
                  return (
                    <div key={msg.id} className={`email-bubble ${msg.direction === "INBOUND" ? "email-inbound" : ""}`}>
                      <div className="email-bubble-header">
                        <div>
                          <div className="email-bubble-from">{msg.fromName ?? msg.fromEmail}</div>
                          <div className="email-bubble-meta">{msg.fromEmail} · {msg.direction}</div>
                        </div>
                        <div className="record-message-time">
                          {new Date(msg.sentAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="email-bubble-body">{msg.bodyText ?? msg.bodyHtml ?? "—"}</div>
                      {attachments.length > 0 && (
                        <div className="record-attachment-row">
                          {attachments.map((a) => (
                            <a
                              key={a.attachmentId}
                              href={`/api/gmail/attachment?messageDbId=${msg.id}&attachmentId=${encodeURIComponent(a.attachmentId)}&filename=${encodeURIComponent(a.filename)}`}
                              download={a.filename}
                              className="record-attachment"
                            >
                              <Icon name="paperclip" size={11} />
                              <strong>{a.filename}</strong>
                              <span className="record-attachment-meta">
                                {a.size < 1024 * 1024 ? `${(a.size / 1024).toFixed(1)} KB` : `${(a.size / 1024 / 1024).toFixed(1)} MB`}
                              </span>
                              <Icon name="download" size={11} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Parsed / editable fields */}
          <div className="record-panel">
            <div className="record-card-header">
              <div className="record-card-title">
                <Icon name="file-check" size={13} /> Parsed Fields
              </div>
            </div>
            <div className="card-body">
              <form action={updateInquiryField.bind(null, inquiryId)}>
                <div className="form-grid-2 form-row-gap">
                  <label className="field"><span>Origin</span>
                    <input name="origin" defaultValue={inquiry.origin ?? ""} placeholder="e.g. Shanghai, CN" />
                  </label>
                  <label className="field"><span>Destination</span>
                    <input name="destination" defaultValue={inquiry.destination ?? ""} placeholder="e.g. Hamburg, DE" />
                  </label>
                </div>
                <div className="form-grid-3 form-row-gap">
                  <label className="field"><span>Mode</span>
                    <select name="mode" defaultValue={inquiry.mode ?? ""}>
                      <option value="">— Select —</option>
                      <option value="SEA-FCL">Sea FCL</option>
                      <option value="SEA-LCL">Sea LCL</option>
                      <option value="AIR">Air</option>
                      <option value="ROAD">Road</option>
                      <option value="COURIER">Courier</option>
                    </select>
                  </label>
                  <label className="field"><span>Container</span>
                    <select name="containerType" defaultValue={inquiry.containerType ?? ""}>
                      <option value="">— Select —</option>
                      <option value="20GP">20GP</option>
                      <option value="40GP">40GP</option>
                      <option value="40HC">40HC</option>
                      <option value="LCL">LCL</option>
                    </select>
                  </label>
                  <label className="field"><span>Incoterms</span>
                    <select name="incoterms" defaultValue={inquiry.incoterms ?? ""}>
                      <option value="">— Select —</option>
                      {["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="form-grid-3 form-row-gap">
                  <label className="field"><span>Commodity</span>
                    <input name="commodity" defaultValue={inquiry.commodity ?? ""} placeholder="e.g. Electronics" />
                  </label>
                  <label className="field"><span>Weight (kg)</span>
                    <input name="weight" type="number" defaultValue={inquiry.weight ?? ""} placeholder="0" />
                  </label>
                  <label className="field"><span>Volume (cbm)</span>
                    <input name="volume" type="number" defaultValue={inquiry.volume ?? ""} placeholder="0" />
                  </label>
                </div>
                <div className="form-grid-3 form-row-gap">
                  <label className="field"><span>Container count</span>
                    <input name="containerCount" type="number" min="1" defaultValue={inquiry.containerCount ?? ""} placeholder="e.g. 2" />
                  </label>
                  <label className="field">
                    <span>Stackable?</span>
                    <select name="stackable" defaultValue={inquiry.stackable ?? "UNKNOWN"}>
                      <option value="UNKNOWN">Unknown</option>
                      <option value="YES">Yes</option>
                      <option value="NO">No</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Top load?</span>
                    <select name="topLoad" defaultValue={inquiry.topLoad ?? "UNKNOWN"}>
                      <option value="UNKNOWN">Unknown</option>
                      <option value="YES">Requested</option>
                      <option value="NO">Not requested</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid-2 form-row-gap">
                  <label className="field">
                    <span>Dangerous goods?</span>
                    <select name="dangerousGoods" defaultValue={inquiry.dangerousGoods ?? "UNKNOWN"}>
                      <option value="UNKNOWN">Unknown</option>
                      <option value="NO">No</option>
                      <option value="YES">Yes</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Customs work by</span>
                    <select name="customsBy" defaultValue={inquiry.customsBy ?? "UNKNOWN"}>
                      <option value="UNKNOWN">Unknown</option>
                      <option value="US">Us</option>
                      <option value="CUSTOMER">Customer</option>
                      <option value="FORWARDER">Forwarder / agent</option>
                    </select>
                  </label>
                </div>
                <div className="form-grid-3 form-row-gap">
                  <label className="field">
                    <span>Target price status</span>
                    <select name="targetPriceStatus" defaultValue={inquiry.targetPriceStatus ?? "UNKNOWN"}>
                      <option value="UNKNOWN">Ask customer</option>
                      <option value="PROVIDED">Target provided</option>
                      <option value="NO_TARGET">No target given</option>
                    </select>
                  </label>
                  <label className="field"><span>Target price</span>
                    <input name="targetPrice" type="number" step="any" defaultValue={inquiry.targetPrice ?? ""} placeholder="e.g. 1550" />
                  </label>
                  <label className="field">
                    <span>Currency</span>
                    <select name="targetCurrency" defaultValue={inquiry.targetCurrency ?? "USD"}>
                      <option>USD</option><option>EUR</option><option>TRY</option><option>GBP</option>
                    </select>
                  </label>
                </div>
                <label className="field form-row-gap">
                  <span>Target price source / note</span>
                  <input name="targetPriceSource" defaultValue={inquiry.targetPriceSource ?? ""} placeholder="Where this target came from" />
                </label>
                <label className="field form-row-gap"><span>Notes</span>
                  <textarea name="notes" defaultValue={inquiry.notes ?? ""} rows={3} placeholder="Internal notes…" />
                </label>
                <button className="btn btn-secondary" type="submit">Save Fields</button>
              </form>
            </div>
          </div>
        </div>

        {/* Right: Convert to Job + carrier quotes */}
        <div className="record-side-stack">

          {referenceSource && <ReferenceDealSourcePanel source={referenceSource} />}

          {opportunity && <OpportunityScoreCard score={opportunity} />}

          <div className={`record-panel record-status-panel ${maturity.isMature ? "ready" : ""}`}>
            <div className="card-body">
              <div className="record-card-title">RFQ Maturity</div>
              <div className={`record-state-line ${maturity.isMature ? "ready" : ""}`}>
                {maturity.isMature ? "Mature enough to price" : "Blocked before forwarder handoff"}
              </div>
              {maturity.targetPriceQuestion && (
                <div className="record-helper-text">
                  Ask for target price when possible: “We can leverage our agencies better if you can provide a target price. If you don&apos;t have one, no problem.”
                </div>
              )}
              {maturityMissing.length > 0 ? (
                <div className="record-chip-row">
                  {maturityMissing.map((m) => (
                    <span key={m} className="record-chip">{m}</span>
                  ))}
                </div>
              ) : (
                <div className="record-helper-text">All required shipment facts are present.</div>
              )}
              <MissingInfoDraftButton inquiryId={inquiry.id} disabled={maturity.isMature} />
              <div className="record-fact-grid">
                {[
                  { label: "DG", value: labelChoice(inquiry.dangerousGoods, { YES: "Yes", NO: "No", UNKNOWN: "Unknown" }) },
                  { label: "Customs", value: labelChoice(inquiry.customsBy, { US: "Us", CUSTOMER: "Customer", FORWARDER: "Forwarder", UNKNOWN: "Unknown" }) },
                  { label: "Target", value: inquiry.targetPrice != null ? `${inquiry.targetCurrency ?? "USD"} ${inquiry.targetPrice.toLocaleString()}` : inquiry.targetPriceStatus === "NO_TARGET" ? "No target" : "Ask" },
                  { label: "Stackable", value: labelChoice(inquiry.stackable, { YES: "Yes", NO: "No", UNKNOWN: "Unknown" }) },
                ].map(({ label, value }) => (
                  <div key={label} className="record-fact">
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Convert to Job */}
          {canConvert ? (
            <div className="record-panel record-primary-panel">
              <div className="card-body">
                <div className="record-primary-header">
                  <span className="record-primary-icon">
                    <Icon name="check" size={15} strokeWidth={2.5} />
                  </span>
                  <div className="record-card-title">Convert to Job</div>
                </div>
                <form action={convertToJob.bind(null, inquiryId)}>
                  <label className="field form-row-gap">
                    <span>Customer</span>
                    <select name="companyId" defaultValue={inquiry.companyId ?? ""}>
                      <option value="">— Link to customer —</option>
                      {companies.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </label>
                  <div className="form-grid-2 form-row-gap">
                    <label className="field"><span>Origin</span>
                      <input name="origin" defaultValue={inquiry.origin ?? ""} required placeholder="City, CC" />
                    </label>
                    <label className="field"><span>Destination</span>
                      <input name="destination" defaultValue={inquiry.destination ?? ""} required placeholder="City, CC" />
                    </label>
                  </div>
                  <div className="form-grid-2 form-row-gap-lg">
                    <label className="field"><span>Mode</span>
                      <select name="mode" defaultValue={inquiry.mode ?? ""}>
                        <option value="">— Select —</option>
                        <option value="SEA-FCL">Sea FCL</option>
                        <option value="SEA-LCL">Sea LCL</option>
                        <option value="AIR">Air</option>
                        <option value="ROAD">Road</option>
                        <option value="COURIER">Courier</option>
                      </select>
                    </label>
                    <label className="field"><span>Incoterms</span>
                      <select name="incoterms" defaultValue={inquiry.incoterms ?? ""}>
                        <option value="">— Select —</option>
                        {["EXW","FCA","FOB","CFR","CIF","DAP","DDP"].map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button className="btn record-wide-action" type="submit" disabled={!maturity.isMature}>
                    {maturity.isMature ? "Create Job from RFQ" : "Complete RFQ before creating job"} <Icon name="arrow-right" size={13} />
                  </button>
                  {!maturity.isMature && (
                    <div className="record-helper-text">
                      Server gate is active: non-mature RFQs cannot become jobs or be sent to forwarders.
                    </div>
                  )}
                </form>
              </div>
            </div>
          ) : inquiry.job ? (
            <div className="record-panel record-status-panel ready">
              <div className="card-body">
                <div className="record-card-title">
                  <Icon name="check" size={14} strokeWidth={2.5} /> Converted to Job
                </div>
                <a href={`/dashboard/jobs/${inquiry.job.id}`} className="record-link-row offset">
                  {inquiry.job.reference} <Icon name="arrow-right" size={13} />
                </a>
              </div>
            </div>
          ) : null}

          {/* Carrier quotes summary */}
          {inquiry.carrierQuotes.length > 0 && (
            <div className="record-panel">
              <div className="record-card-header">
                <div className="record-card-title">
                  <Icon name="dollar" size={13} /> Carrier Rates Received
                </div>
              </div>
              <div className="card-body">
                <div className="record-row-list">
                  {inquiry.carrierQuotes.map((q) => (
                    <div key={q.id} className="record-row">
                      <div className="record-row-main">
                        <div className="record-row-title">{q.carrier}</div>
                        <div className="record-row-meta">{q.service ?? ""} {q.transitDays ? `· ${q.transitDays}d` : ""}</div>
                      </div>
                      <div className="record-row-value">
                        <strong>
                          {q.total40HC ? `$${q.total40HC.toLocaleString()}` : q.total40 ? `$${q.total40.toLocaleString()}` : q.total20 ? `$${q.total20.toLocaleString()}` : "—"}
                        </strong>
                        <span>40HC / 40 / 20</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Meta info */}
          <div className="record-panel">
            <div className="record-card-header">
              <div className="record-card-title">
                <Icon name="info" size={13} /> Details
              </div>
            </div>
            <div className="card-body">
              <div className="record-row-list">
                {[
                  { label: "From",        value: inquiry.fromEmail ?? inquiry.fromCompany ?? "—" },
                  { label: "Received",    value: fmt(inquiry.receivedAt) },
                  { label: "Cargo Ready", value: inquiry.cargoReadyDate ? fmt(inquiry.cargoReadyDate) : "—" },
                  { label: "Container",   value: inquiry.containerType ?? "—" },
                  { label: "Status",      value: sm.label },
                ].map(({ label, value }) => (
                  <div key={label} className="record-row">
                    <div className="record-row-main">
                      <div className="record-row-meta">{label}</div>
                    </div>
                    <div className="record-row-value">
                      <strong>{value}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {inquiry.targetPriceHistory.length > 0 && (
            <div className="record-panel">
              <div className="record-card-header">
                <div className="record-card-title">
                  <Icon name="dollar" size={13} /> Target Price History
                </div>
              </div>
              <div className="card-body">
                <div className="record-row-list">
                  {inquiry.targetPriceHistory.map((entry) => (
                    <div key={entry.id} className="record-row">
                      <div className="record-row-main">
                        <div className="record-row-title">
                          {entry.amount != null
                            ? `${entry.currency ?? "USD"} ${entry.amount.toLocaleString()}`
                            : entry.status === "NO_TARGET" ? "No target" : entry.status}
                        </div>
                        <div className="record-row-meta">
                          {[entry.source, entry.note].filter(Boolean).join(" · ") || "Internal update"}
                        </div>
                      </div>
                      <div className="record-row-value">
                        <strong>{fmt(entry.createdAt)}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
