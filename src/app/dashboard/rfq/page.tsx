import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { deriveInquirySource } from "@/lib/inquiry-source";
import { Icon } from "@/components/icon";
import { RfqExpandableRows, type RfqRowData } from "@/components/rfq-expandable-rows";
import { RfqSendAllButton } from "@/components/rfq-send-all-button";
import { SyncGoogleSheetButton } from "@/components/sync-google-sheet-button";
import {
  buildDeskForwardEmail,
  buildLeadConfirmationEmail,
  countPendingDeskForwards,
  isSingleEmailAddress,
  rfqMailConfigured,
} from "@/lib/rfq-mail";

// Send-all pushes up to 60 sequential SMTP sends through a server action on
// this segment; the default function timeout would cut the batch short.
export const maxDuration = 300;

const STATUS_META: Record<string, { label: string; cls: string }> = {
  INGESTED: { label: "RFQ",        cls: "badge-info" },
  PARSED:   { label: "Mature RFQ", cls: "badge-neutral" },
  PRICED:   { label: "Pricing",    cls: "badge-warn" },
  QUOTED:   { label: "Quoted",     cls: "badge-good" },
  WON:      { label: "Won",        cls: "badge-good" },
  LOST:     { label: "Lost",       cls: "badge-danger" },
};

const FILTER_TABS = [
  { key: "",         label: "Open" },
  { key: "all",      label: "All" },
  { key: "INGESTED", label: "RFQ" },
  { key: "PARSED",   label: "Mature RFQ" },
  { key: "PRICED",   label: "Pricing" },
  { key: "QUOTED",   label: "Quoted" },
  { key: "WON",      label: "Won" },
  { key: "LOST",     label: "Lost" },
] as const;

function timeAgo(d: Date) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function safeParse(json: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function prettyDimensions(json: string | null): string | null {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return arr
      .map((d) => `${d?.qty ?? 1}× ${d?.length ?? "?"}×${d?.width ?? "?"}×${d?.height ?? "?"} cm`)
      .join("; ");
  } catch {
    return null;
  }
}

function choice(value: string | null, map: Record<string, string>): string | null {
  if (!value || value === "UNKNOWN") return null;
  return map[value] ?? value;
}

export default async function RFQPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requireSession();
  const { status } = await searchParams;

  const filter = FILTER_TABS.some((t) => t.key === status) ? (status as string) : "";

  const inquiriesRaw = await prisma.inquiry.findMany({
    where: {
      officeId: session.officeId,
      ...(filter === ""
        ? { status: { notIn: ["WON", "LOST"] } }
        : filter === "all"
          ? {}
          : { status: filter }),
    },
    include: {
      company: { select: { id: true, name: true } },
      emailThreads: {
        take: 1,
        select: {
          messages: {
            take: 1,
            select: { account: { select: { email: true, provider: true } } },
          },
        },
      },
    },
    orderBy: { receivedAt: "desc" },
    take: 200,
  });

  const mailConfigured = rfqMailConfigured();

  const rows: RfqRowData[] = inquiriesRaw.map((inq) => {
    const sm = STATUS_META[inq.status] ?? { label: inq.status, cls: "badge-neutral" };
    const source = deriveInquirySource(inq);
    const parsed = safeParse(inq.parsedData);
    const isLead = parsed.source === "meta-leads";
    const answers = isLead ? safeParse(JSON.stringify(parsed.answers ?? {})) : {};

    const forwardEmail = buildDeskForwardEmail(inq);
    const confirmationEmail = buildLeadConfirmationEmail(inq);
    const sentLabel = (value: unknown) => {
      const date = typeof value === "string" ? new Date(value) : null;
      return date && !Number.isNaN(date.getTime())
        ? date.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        : null;
    };

    const target = inq.targetPrice != null
      ? `${inq.targetCurrency ?? "USD"} ${inq.targetPrice.toLocaleString("en-GB")}`
      : inq.targetPriceStatus === "NO_TARGET" ? "No target" : "Ask";

    const facts = [
      { label: "Commodity", value: inq.commodity },
      {
        label: "Equipment",
        value: inq.containerType ? `${inq.containerCount ?? 1} × ${inq.containerType}` : null,
      },
      { label: "Packages", value: inq.packages != null ? String(inq.packages) : null },
      { label: "Weight", value: inq.weight != null ? `${inq.weight.toLocaleString("en-GB")} kg` : null },
      { label: "Volume", value: inq.volume != null ? `${inq.volume.toLocaleString("en-GB")} cbm` : null },
      { label: "Dimensions", value: prettyDimensions(inq.dimensions) },
      { label: "Stackable", value: choice(inq.stackable, { YES: "Yes", NO: "No" }) },
      { label: "Top load", value: choice(inq.topLoad, { YES: "Yes", NO: "No" }) },
      { label: "Dangerous goods", value: choice(inq.dangerousGoods, { YES: "Yes", NO: "No" }) },
      { label: "Customs by", value: choice(inq.customsBy, { US: "Us", CUSTOMER: "Customer", FORWARDER: "Forwarder" }) },
      { label: "Incoterms", value: inq.incoterms },
      {
        label: "Cargo ready",
        value: inq.cargoReadyDate
          ? new Date(inq.cargoReadyDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
          : null,
      },
      { label: "Target price", value: target + (inq.targetPriceSource ? ` (${inq.targetPriceSource})` : "") },
      { label: "Deal type", value: inq.type === "SOURCING" ? "Sourcing" : "Forwarding" },
    ].filter((f): f is { label: string; value: string } => Boolean(f.value));

    const leadAnswers = isLead
      ? [
          { label: "Commercial shipment", value: str(answers.commercial) },
          { label: "Shipment type", value: str(answers.shipmentType) },
          { label: "Load info", value: str(answers.loadInfo) },
          { label: "Timing", value: str(answers.timing) },
          { label: "Transport preference", value: str(answers.transportPref) },
          { label: "Existing quote", value: str(answers.existingQuote) },
          { label: "Budget (as written)", value: str(parsed.budget) },
        ].filter((f): f is { label: string; value: string } => Boolean(f.value))
      : [];

    const notesRaw = isLead ? null : inq.notes ?? inq.rawEmailBody;
    const notesExcerpt = notesRaw
      ? notesRaw.trim().slice(0, 600) + (notesRaw.trim().length > 600 ? "…" : "")
      : null;

    return {
      id: inq.id,
      receivedAgo: timeAgo(inq.receivedAt),
      receivedFull: new Date(inq.receivedAt).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      }),
      subject: inq.subject,
      from: inq.fromCompany ?? inq.company?.name ?? inq.fromEmail ?? "—",
      fromEmail: inq.fromEmail,
      phone: str(parsed.phone),
      contactName: str(parsed.fullName),
      companyId: inq.company?.id ?? null,
      companyName: inq.company?.name ?? inq.fromCompany,
      sourceLabel: source.label,
      sourceDetail: source.detail,
      origin: inq.origin,
      destination: inq.destination,
      mode: inq.mode,
      statusLabel: sm.label,
      statusCls: sm.cls,
      target,
      facts,
      leadAnswers,
      notesExcerpt,
      mailConfigured,
      forward: {
        to: forwardEmail.to,
        cc: forwardEmail.cc,
        replyTo: null,
        subject: forwardEmail.subject,
        text: forwardEmail.text,
        sentAtLabel: sentLabel(parsed.deskForwardedAt),
      },
      confirmation: {
        // A non-single address (or a comma-smuggled list) must never become
        // an SMTP recipient — surface it as unsendable instead.
        to: isSingleEmailAddress(inq.fromEmail) ? confirmationEmail.to : null,
        cc: [],
        replyTo: confirmationEmail.replyTo,
        subject: confirmationEmail.subject,
        text: confirmationEmail.text,
        sentAtLabel: sentLabel(parsed.confirmationSentAt),
      },
    };
  });

  // Office-wide count with the same predicate the Send-all action uses —
  // never the filtered view's count, or the confirm dialog lies.
  const pendingForwards = mailConfigured ? await countPendingDeskForwards(session.officeId) : 0;

  return (
    <div>
      <div className="page-header page-header-roomy">
        <div>
          <h1 className="page-title">Incoming RFQs</h1>
          <p className="page-subtitle">
            {rows.length} {filter === "" ? "open " : ""}RFQ{rows.length === 1 ? "" : "s"} shown · newest first · click a row for load details
          </p>
        </div>
        <div className="page-actions">
          <RfqSendAllButton pending={pendingForwards} disabled={!mailConfigured} />
          <SyncGoogleSheetButton />
          <Link href="/dashboard/inbox?view=rfqs" className="btn btn-secondary">
            <Icon name="inbox" size={13} />
            Inbox triage
          </Link>
          <a href="/dashboard/rfq/new" className="btn">
            <Icon name="plus" size={13} strokeWidth={2.5} /> New RFQ
          </a>
        </div>
      </div>

      <div className="mode-tabs" style={{ marginBottom: 16 }}>
        {FILTER_TABS.map((t) => (
          <Link
            key={t.key || "open"}
            href={`/dashboard/rfq${t.key ? `?status=${t.key}` : ""}` as "/dashboard/rfq"}
            className={`mode-tab${filter === t.key ? " active" : ""}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="card empty-state-card">
          <Icon name="inbox" size={36} className="empty-state-graphic" />
          <div className="empty-state-title">No RFQs match</div>
          <p className="empty-state-copy">
            RFQs arrive from linked email threads or manual entry. Try another status filter, or add one manually.
          </p>
          <a href="/dashboard/rfq/new" className="btn">
            New RFQ
          </a>
        </div>
      ) : (
        <div className="card table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ cursor: "default" }}>Received</th>
                <th style={{ cursor: "default" }}>Subject</th>
                <th style={{ cursor: "default" }}>From</th>
                <th style={{ cursor: "default" }}>Source</th>
                <th style={{ cursor: "default" }}>Lane</th>
                <th style={{ cursor: "default" }}>Mode</th>
                <th style={{ cursor: "default" }}>Status</th>
                <th style={{ cursor: "default" }} className="numeric">Target Price</th>
                <th style={{ cursor: "default" }} className="numeric">Send</th>
              </tr>
            </thead>
            <RfqExpandableRows rows={rows} colSpan={9} />
          </table>
        </div>
      )}
    </div>
  );
}
