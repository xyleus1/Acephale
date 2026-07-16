import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { updateInquiryField, updateInquiryStatus, parseRFQWithAI } from "./actions";
import { Icon } from "@/components/icon";
import { SourcingOffersTable } from "@/components/sourcing-offers-table";
import { OpportunityScoreCard, OpportunityScorePill } from "@/components/opportunity-score-card";
import { assessInquiryStrategy } from "@/lib/commercial-strategy-persistence";
import { qualifyRfq } from "@/lib/rfq-qualification";
import { MissingInfoDraftButton } from "@/components/missing-info-draft-button";
import { RfqLoadReviewButton } from "@/components/rfq-load-review-button";
import { DomesticTruckingRatePanel } from "@/components/domestic-trucking-rate-panel";
import { assessDomesticTruckingPricing } from "@/lib/domestic-trucking-pricing";
import { CarrierBidPanel } from "@/components/carrier-bid-panel";
import { toCarrierBidRow } from "@/lib/truckload-quote-fields";
import { getBrainBridgeContext } from "@/lib/brain-bridge";
import { BrainBridgePanel } from "@/components/brain-bridge-panel";
import { deriveInquirySource } from "@/lib/inquiry-source";
import { displayParty } from "@/lib/whatsapp-display";
import { buildWhatsAppInquiry } from "@/lib/rfq-whatsapp";
import { whatsAppSendConfigured } from "@/lib/whatsapp";
import { WhatsAppPreviewCard } from "@/components/whatsapp-preview-card";
import { sendWhatsAppInquiryAction } from "@/app/dashboard/rfq/actions";
import {
  canonicalInquiryStatus,
  CLOSED_INQUIRY_STATUSES,
  inquiryStatusBadgeCls,
  inquiryStatusLabel,
} from "@/lib/inquiry-status";

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
        include: {
          messages: {
            orderBy: { sentAt: "asc" },
            include: { account: { select: { email: true, provider: true } } },
          },
        },
      },
      targetPriceHistory: { orderBy: { createdAt: "desc" }, take: 8 },
    },
  });

  if (!inquiry) notFound();

  // Truckload desk data: buy-side bids, recorded flywheel quotes, bench names.
  const [carrierBids, truckloadQuotes, benchCarriers] = await Promise.all([
    prisma.carrierBid.findMany({
      where: { officeId: session.officeId, inquiryId: inquiry.id },
      select: {
        id: true, carrierId: true, carrierName: true, equipmentType: true, totalAmount: true,
        ratePerMile: true, transitDays: true, source: true, status: true, notes: true, createdAt: true,
        carrier: { select: { vettingStatus: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.truckloadQuote.findMany({
      where: { officeId: session.officeId, inquiryId: inquiry.id },
      select: {
        id: true, createdAt: true, sellAmount: true, buyAmount: true, grossProfit: true,
        marginPct: true, outcome: true, outcomeReason: true, sentVia: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.carrier.findMany({
      where: { officeId: session.officeId, active: true },
      select: { name: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);

  const sm = { label: inquiryStatusLabel(inquiry.status), cls: inquiryStatusBadgeCls(inquiry.status) };
  const canConvert = (!inquiry.job || inquiry.job.status === "PROPOSED") && !CLOSED_INQUIRY_STATUSES.includes(inquiry.status);

  // Keyed by canonical status so legacy values (INGESTED/PARSED/PRICED/QUOTED) hit too.
  const FLOW_HINTS: Record<string, { msg: string; action: string }> = {
    RECEIVED: { msg: "This RFQ is waiting on pricing.", action: "Parse with AI or fill the fields below, then move it to Pricing." },
    PRICING:  { msg: "RFQ is in pricing.", action: "Prepare the customer quote or convert to a load. Mark it Booked or Missed when the outcome is known." },
  };
  const flowHint = !inquiry.job ? FLOW_HINTS[canonicalInquiryStatus(inquiry.status)] : null;
  const strategyRun = await assessInquiryStrategy(session.officeId, inquiry.id);
  const opportunity = strategyRun?.strategy;
  const maturity = qualifyRfq(inquiry);
  const referenceSource = parseReferenceDealSource(inquiry.parsedData);
  const maturityMissing = [
    ...maturity.missing,
    ...(maturity.targetPriceQuestion ? ["target price or no-target confirmation"] : []),
  ];
  const domesticPricing = assessDomesticTruckingPricing(inquiry);
  const source = deriveInquirySource(inquiry);
  const waThreads = inquiry.emailThreads.filter((t) =>
    t.messages.some((m) => m.account?.provider === "WHATSAPP"),
  );
  // deriveInquirySource samples the first thread, whose DB order is
  // unspecified — any attached WhatsApp thread makes this a WhatsApp deal.
  const isWaSource = source.kind === "whatsapp" || waThreads.length > 0;
  const mailThreads = inquiry.emailThreads.filter((t) => !waThreads.includes(t));
  let parsedJson: Record<string, unknown> = {};
  if (inquiry.parsedData) {
    try {
      const value = JSON.parse(inquiry.parsedData);
      if (value && typeof value === "object" && !Array.isArray(value)) parsedJson = value;
    } catch {
      parsedJson = {};
    }
  }
  const waSentLabel = typeof parsedJson.whatsappSentAt === "string" && !Number.isNaN(new Date(parsedJson.whatsappSentAt).getTime())
    ? new Date(parsedJson.whatsappSentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : null;
  const waPreview = {
    ...buildWhatsAppInquiry(inquiry),
    sentAtLabel: waSentLabel,
    configured: whatsAppSendConfigured(),
  };
  const brainBridgeContext = await getBrainBridgeContext({
    officeId: session.officeId,
    rfqId: inquiry.id,
    customerName: inquiry.company?.name ?? inquiry.fromCompany ?? undefined,
    fromEmail: inquiry.fromEmail ?? undefined,
    origin: inquiry.origin ?? undefined,
    destination: inquiry.destination ?? undefined,
    mode: inquiry.mode ?? undefined,
    equipmentType: inquiry.containerType ?? undefined,
    commodity: inquiry.commodity ?? undefined,
  });

  return (
    <div>
      {/* Back */}
      <div className="record-back-row">
        <a href="/dashboard/rfq" className="back-link">
          <Icon name="chevron-left" size={14} />
          Incoming RFQs
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
          {canonicalInquiryStatus(inquiry.status) === "RECEIVED" && inquiry.rawEmailBody && (
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
              {inquiry.reference && <span className="record-chip data-cell-mono">{inquiry.reference}</span>}
              <span className={`badge ${sm.cls}`}>{sm.label}</span>
              {opportunity && <OpportunityScorePill score={opportunity} />}
              {isWaSource && (
                <span
                  className="record-chip"
                  style={{ color: "var(--whatsapp)", background: "var(--whatsapp-bg)", borderColor: "var(--whatsapp-border)", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Icon name="whatsapp" size={11} strokeWidth={2} /> WhatsApp
                </span>
              )}
              <span className="record-chip">{fmt(inquiry.receivedAt)}</span>
            </div>
            <h1 className="record-title">{inquiry.subject}</h1>
            <p className="record-subtitle">
              {displayParty(inquiry.fromEmail) || inquiry.fromCompany || "Unknown sender"}
              {inquiry.company && ` · ${inquiry.company.name}`}
            </p>
          </div>
          <div className="record-actions">
            {inquiry.job ? (
              <a href={`/dashboard/jobs/${inquiry.job.id}`} className="btn btn-sm">
                Load {inquiry.job.reference} <Icon name="arrow-right" size={13} />
              </a>
            ) : (
              <>
                <form action={updateInquiryStatus.bind(null, inquiryId, "MISSED")}>
                  <button className="btn btn-secondary btn-sm" type="submit">Mark Missed</button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="record-two-pane record-two-pane-sidebar">
        {/* Left: email body + parsed fields */}
        <div className="record-side-stack">

          {/* Raw source message(s) — a WhatsApp transcript is not an email.
              Hidden when the live conversation renders below (same content). */}
          {inquiry.rawEmailBody && !(isWaSource && waThreads.length > 0) && (
            <div className="record-panel">
              <div className="record-card-header">
                <div className="record-card-title">
                  <Icon name={isWaSource ? "whatsapp" : "mail"} size={13} /> {isWaSource ? "Original Messages" : "Email Content"}
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

          {/* WhatsApp conversations — chat rendering, not email chrome */}
          {waThreads.map((thread) => (
            <div key={thread.id} className="record-panel">
              <div className="record-card-header">
                <div className="record-card-title">
                  <Icon name="whatsapp" size={13} /> WhatsApp Conversation
                </div>
                <a href={`/dashboard/inbox?inquiry=${inquiry.id}`} className="data-link" style={{ fontSize: 12 }}>
                  Open in inbox →
                </a>
              </div>
              <div className="wa-thread">
                {thread.messages.map((msg, i) => {
                  const isOutbound = msg.direction === "OUTBOUND";
                  const day = (d: Date) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                  const prev = thread.messages[i - 1];
                  const showDay = !prev || day(prev.sentAt) !== day(msg.sentAt);
                  const isMediaNote = Boolean(msg.bodyText?.startsWith("[Unsupported WhatsApp"));
                  return (
                    <div key={msg.id} style={{ display: "contents" }}>
                      {showDay && <div className="wa-day-sep">{day(msg.sentAt)}</div>}
                      <div className={`wa-bubble ${isOutbound ? "outbound" : "inbound"}`}>
                        {!isOutbound && (
                          <div className="wa-bubble-sender">{displayParty(msg.fromEmail, msg.fromName)}</div>
                        )}
                        <span className={isMediaNote ? "wa-media-note" : undefined}>
                          {msg.bodyText ?? "—"}
                        </span>
                        <span className="wa-bubble-meta">
                          {new Date(msg.sentAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                          {isOutbound && <span className="wa-tick">✓</span>}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* WhatsApp inquiry draft + send — same card as the RFQ sheet */}
          {isWaSource && (
            <div className="record-panel">
              <div className="card-body">
                <WhatsAppPreviewCard preview={waPreview} onSend={sendWhatsAppInquiryAction.bind(null, inquiry.id)} />
              </div>
            </div>
          )}

          {/* Email threads */}
          {mailThreads.length > 0 && (
            <div className="email-thread">
              {mailThreads.map((thread) =>
                thread.messages.map((msg) => {
                  let attachments: { filename: string; mimeType: string; size: number; attachmentId: string }[] = [];
                  if (msg.attachments) {
                    try { attachments = JSON.parse(msg.attachments); } catch { attachments = []; }
                  }
                  return (
                    <div key={msg.id} className={`email-bubble ${msg.direction === "INBOUND" ? "email-inbound" : ""}`}>
                      <div className="email-bubble-header">
                        <div>
                          <div className="email-bubble-from">{displayParty(msg.fromEmail, msg.fromName)}</div>
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

          <BrainBridgePanel result={brainBridgeContext} />

          {opportunity && (
            <details className="strategy-audit-details">
              <summary>
                <span>Strategy audit details</span>
                <strong>Score, ladder, evidence, and risks</strong>
              </summary>
              <OpportunityScoreCard score={opportunity} />
            </details>
          )}

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

          <DomesticTruckingRatePanel assessment={domesticPricing} compact />

          <CarrierBidPanel
            inquiryId={inquiry.id}
            initialBids={carrierBids.map(toCarrierBidRow)}
            initialQuotes={truckloadQuotes.map((quote) => ({ ...quote, createdAt: quote.createdAt.toISOString() }))}
            benchCarrierNames={benchCarriers.map((c) => c.name)}
          />

          {/* Convert to Load */}
          {canConvert ? (
            <div className="record-panel record-primary-panel">
              <div className="card-body">
                <div className="record-primary-header">
                  <span className="record-primary-icon">
                    <Icon name="check" size={15} strokeWidth={2.5} />
                  </span>
                  <div className="record-card-title">Create Load</div>
                </div>
                <div className="record-helper-text form-row-gap">
                  Review current RFQ fields and any carried-forward customer history before this becomes an active load.
                </div>
                <RfqLoadReviewButton
                  inquiryId={inquiryId}
                  label={inquiry.job?.status === "PROPOSED" ? "Review proposed load" : "Create load from RFQ"}
                  className="btn record-wide-action"
                />
                {!maturity.isMature && (
                  <div className="record-helper-text">
                    The load can be created for tracking, but forwarder handoff and quoting stay blocked until missing RFQ facts are explicit.
                  </div>
                )}
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
                  { label: "From",        value: displayParty(inquiry.fromEmail) || inquiry.fromCompany || "—" },
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
