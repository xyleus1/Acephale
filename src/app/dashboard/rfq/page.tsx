import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { deriveInquirySource } from "@/lib/inquiry-source";
import { Icon } from "@/components/icon";
import { RfqSheet, type RfqRowData, type SheetOption } from "@/components/rfq-expandable-rows";
import { RfqSendAllButton } from "@/components/rfq-send-all-button";
import { SyncGoogleSheetButton } from "@/components/sync-google-sheet-button";
import {
  INQUIRY_MODES,
  INQUIRY_MODE_VALUES,
  INQUIRY_STATUSES,
  INQUIRY_STATUS_VALUES,
  canonicalInquiryStatus,
  inquiryStatusValuesFor,
  openInquiryStatusFilter,
} from "@/lib/inquiry-status";
import {
  buildDeskForwardEmail,
  buildLeadCustomerEmail,
  countPendingDeskForwards,
  isSingleEmailAddress,
  rfqMailConfigured,
} from "@/lib/rfq-mail";
import { buildWhatsAppInquiry } from "@/lib/rfq-whatsapp";
import { whatsAppSendConfigured } from "@/lib/whatsapp";
import { metaLeadsSource, metaLeadsSheetUrl, US_LEAD_PARSED_MARKER } from "@/lib/meta-leads";
import { assessLeadQuality, leadQualitySummary, type LeadQualityTier } from "@/lib/lead-quality";

// Send-all pushes up to 60 sequential SMTP sends through a server action on
// this segment; the default function timeout would cut the batch short.
export const maxDuration = 300;

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
  searchParams: Promise<{ status?: string; q?: string; view?: string; quality?: string }>;
}) {
  const session = await requireSession();
  const { status, q: rawQuery, view, quality } = await searchParams;
  // Next delivers repeated params as arrays despite the annotation - degrade
  // to no filter rather than crashing on a hand-crafted ?q=a&q=b URL.
  const searchQuery = (typeof rawQuery === "string" ? rawQuery : "").trim().slice(0, 120);
  // ?view=us swaps the sheet to US-market Meta leads; the default view is
  // everything else. Status tabs and search apply within either view.
  const usView = view === "us";
  // In the US view, leads are triaged by quality and only Good ones show by
  // default; ?quality=review / ?quality=all widen the lens.
  const qualityFilter: "good" | "review" | "all" =
    usView && (quality === "review" || quality === "all") ? quality : usView ? "good" : "all";

  // Custom statuses/modes added on the fly live as plain strings on rows -
  // whatever is in use in this office becomes a tab and a dropdown option.
  const [statusGroups, modeGroups] = await Promise.all([
    prisma.inquiry.groupBy({ by: ["status"], where: { officeId: session.officeId } }),
    prisma.inquiry.groupBy({ by: ["mode"], where: { officeId: session.officeId, mode: { not: null } } }),
  ]);
  const customStatuses = [...new Set(
    statusGroups
      .map((g) => g.status)
      .filter((s) => !INQUIRY_STATUS_VALUES.includes(canonicalInquiryStatus(s)))
      // Would collide with the built-in tab keys.
      .filter((s) => !["all", "open"].includes(s.toLowerCase()))
  )].sort();
  const customModes = [...new Set(
    modeGroups
      .map((g) => g.mode as string)
      .filter((m) => !INQUIRY_MODE_VALUES.includes(m.toUpperCase()))
  )].sort();

  const statusOptions: SheetOption[] = [
    ...INQUIRY_STATUSES,
    ...customStatuses.map((s) => [s, s] as const),
  ];
  const modeOptions: SheetOption[] = [
    ...INQUIRY_MODES,
    ...customModes.map((m) => [m, m] as const),
  ];

  const filterTabs: Array<{ key: string; label: string }> = [
    { key: "", label: "Open" },
    { key: "all", label: "All" },
    ...INQUIRY_STATUSES.map(([value, label]) => ({ key: value, label })),
    ...customStatuses.map((s) => ({ key: s, label: s })),
  ];

  // Canonicalize the incoming param so pre-promotion links (?status=Trash from
  // when Trash was a custom status) still land on the right tab.
  const statusParam = typeof status === "string" ? canonicalInquiryStatus(status) : "";
  const filter = filterTabs.some((t) => t.key === statusParam) ? statusParam : "";

  const contains = { contains: searchQuery, mode: "insensitive" as const };
  const whereBase = {
    officeId: session.officeId,
    ...(filter === ""
      ? { status: openInquiryStatusFilter() }
      : filter === "all"
        ? {}
        : INQUIRY_STATUS_VALUES.includes(filter)
          ? { status: { in: inquiryStatusValuesFor(filter) } }
          : { status: filter }),
    ...(searchQuery
      ? {
          OR: [
            { reference: contains },
            { subject: contains },
            { fromCompany: contains },
            { fromEmail: contains },
            { origin: contains },
            { destination: contains },
            { commodity: contains },
          ],
        }
      : {}),
  };
  const includeRelations = {
    company: { select: { id: true, name: true } },
    job: { select: { id: true, reference: true } },
    emailThreads: {
      take: 1,
      select: {
        messages: {
          take: 1,
          select: { account: { select: { email: true, provider: true } } },
        },
      },
    },
  } as const;

  // The default view is everything except US-market leads; ?view=us shows
  // only those. NOT-contains alone would also drop rows with NULL parsedData
  // (SQL LIKE on NULL is unknown) - manual RFQs must stay visible.
  const usLeadsFilter = { parsedData: { contains: US_LEAD_PARSED_MARKER } };
  const mainFilter = {
    AND: [{ OR: [
      { parsedData: null },
      { NOT: { parsedData: { contains: US_LEAD_PARSED_MARKER } } },
    ] }],
  };

  // officeId is already in whereBase; restated so the scope survives
  // refactors (and the tenant-scope audit can see it). The other view's
  // count feeds the view-switcher badge.
  const [inquiriesRaw, usTabCount] = await Promise.all([
    prisma.inquiry.findMany({
      where: { ...whereBase, ...(usView ? usLeadsFilter : mainFilter), officeId: session.officeId },
      include: includeRelations,
      orderBy: { receivedAt: "desc" },
      take: 200,
    }),
    usView
      ? Promise.resolve(0)
      : prisma.inquiry.count({
          where: { ...whereBase, ...usLeadsFilter, officeId: session.officeId },
        }),
  ]);

  const mailConfigured = rfqMailConfigured();
  const waConfigured = whatsAppSendConfigured();

  const toRow = (inq: (typeof inquiriesRaw)[number]): RfqRowData => {
    const source = deriveInquirySource(inq);
    const parsed = safeParse(inq.parsedData);
    const isLead = parsed.source === "meta-leads";
    const answers = isLead ? safeParse(JSON.stringify(parsed.answers ?? {})) : {};

    const forwardEmail = buildDeskForwardEmail(inq);
    const confirmationEmail = buildLeadCustomerEmail(inq);
    const leadQuality = isLead ? assessLeadQuality(inq) : null;
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
          { label: "Lead quality", value: leadQuality ? leadQualitySummary(leadQuality) : null },
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
      reference: inq.reference,
      jobId: inq.job?.id ?? null,
      jobReference: inq.job?.reference ?? null,
      receivedAgo: timeAgo(inq.receivedAt),
      receivedFull: new Date(inq.receivedAt).toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      }),
      subject: inq.subject,
      from: inq.fromCompany ?? inq.company?.name ?? inq.fromEmail ?? "-",
      fromCompany: inq.fromCompany,
      fromEmail: inq.fromEmail,
      phone: str(parsed.phone),
      contactName: str(parsed.fullName),
      companyId: inq.company?.id ?? null,
      companyName: inq.company?.name ?? inq.fromCompany,
      sourceLabel: source.label,
      // The whatsapp detail is the receiving account address ("whatsapp:<id>")
      // - machine noise next to a label that already says WhatsApp.
      sourceDetail: source.kind === "whatsapp" ? null : source.detail,
      sourceKind: source.kind,
      origin: inq.origin,
      destination: inq.destination,
      mode: inq.mode,
      // Canonicalized so legacy rows (INGESTED, WON, …) read and edit as
      // their canonical status; a re-pick writes the canonical value.
      status: canonicalInquiryStatus(inq.status),
      securityTier: inq.securityTier,
      declaredValueInput: inq.declaredValue != null ? String(inq.declaredValue) : "",
      target,
      targetInput: inq.targetPrice != null
        ? `${inq.targetCurrency ?? "USD"} ${inq.targetPrice}`
        : inq.targetPriceStatus === "NO_TARGET" ? "no target" : "",
      targetPlaceholder: "Ask",
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
      confirmationKind: confirmationEmail.kind,
      leadQuality,
      confirmation: {
        // A non-single address (or a comma-smuggled list) must never become
        // an SMTP recipient - surface it as unsendable instead.
        to: isSingleEmailAddress(inq.fromEmail) ? confirmationEmail.to : null,
        cc: confirmationEmail.cc,
        replyTo: confirmationEmail.replyTo,
        subject: confirmationEmail.subject,
        text: confirmationEmail.text,
        // Each kind has its own stamp - sending the info-request must not
        // show the (future) confirmation as already sent.
        sentAtLabel: sentLabel(confirmationEmail.kind === "info-request"
          ? parsed.infoRequestSentAt
          : parsed.confirmationSentAt),
      },
      whatsapp: {
        ...buildWhatsAppInquiry(inq),
        sentAtLabel: sentLabel(parsed.whatsappSentAt),
        configured: waConfigured,
      },
    };
  };

  const allRows = inquiriesRaw.map(toRow);
  const usCount = usView ? allRows.length : usTabCount;

  // Quality triage only makes sense over leads, i.e. in the US view; the
  // counts drive the Good/Review/All chips.
  const tierCount = (tier: LeadQualityTier) =>
    allRows.filter((r) => r.leadQuality?.tier === tier).length;
  const qualityCounts = usView
    ? { good: tierCount("GOOD"), review: tierCount("REVIEW"), all: allRows.length }
    : null;
  const rows = !usView || qualityFilter === "all"
    ? allRows
    : allRows.filter((r) => r.leadQuality?.tier === (qualityFilter === "good" ? "GOOD" : "REVIEW"));

  const usSheetUrl = metaLeadsSheetUrl(metaLeadsSource("US"));

  // Office-wide count with the same predicate the Send-all action uses -
  // never the filtered view's count, or the confirm dialog lies.
  const pendingForwards = mailConfigured ? await countPendingDeskForwards(session.officeId) : 0;

  return (
    <div>
      <div className="page-header page-header-roomy">
        <div>
          <h1 className="page-title">Incoming RFQs</h1>
          <p className="page-subtitle">
            {rows.length} {filter === "" ? "open " : ""}{usView ? "US lead" : "RFQ"}{rows.length === 1 ? "" : "s"} shown{usView && qualityFilter !== "all" ? ` · ${qualityFilter === "good" ? "Good" : "Review"} quality only` : ""}{searchQuery ? ` · matching “${searchQuery}”` : ""}{usView ? " · synced hourly from the California lead sheet" : ""} · newest first · click a cell to edit, changes save automatically · the arrow opens load details · tick rows to change status in bulk · drag headers to rearrange columns
          </p>
        </div>
        <div className="page-actions">
          {usView && (
            <a href={usSheetUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">
              <Icon name="external" size={13} />
              Lead sheet
            </a>
          )}
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

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div className="mode-tabs">
          {filterTabs.map((t) => {
            // Tabs keep the search query, the view and the quality lens so
            // everything composes.
            const params = new URLSearchParams();
            if (t.key) params.set("status", t.key);
            if (searchQuery) params.set("q", searchQuery);
            if (usView) params.set("view", "us");
            if (usView && qualityFilter !== "good") params.set("quality", qualityFilter);
            const qs = params.toString();
            return (
              <Link
                key={t.key || "open"}
                href={`/dashboard/rfq${qs ? `?${qs}` : ""}` as "/dashboard/rfq"}
                className={`mode-tab${filter === t.key ? " active" : ""}`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
        {usView && qualityCounts && (
          <div className="view-switcher" style={{ marginLeft: 0 }}>
            {([
              ["good", `Good (${qualityCounts.good})`],
              ["review", `Review (${qualityCounts.review})`],
              ["all", `All (${qualityCounts.all})`],
            ] as const).map(([key, label]) => {
              const params = new URLSearchParams();
              if (filter) params.set("status", filter);
              if (searchQuery) params.set("q", searchQuery);
              params.set("view", "us");
              if (key !== "good") params.set("quality", key);
              return (
                <Link
                  key={key}
                  href={`/dashboard/rfq?${params.toString()}` as "/dashboard/rfq"}
                  className={`view-switcher-tab${qualityFilter === key ? " active" : ""}`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        )}
        <div className="view-switcher">
          {[
            { key: "", label: "🇹🇷 Türkiye" },
            { key: "us", label: `🇺🇸 US${!usView && usCount > 0 ? ` (${usCount})` : ""}` },
          ].map((v) => {
            const params = new URLSearchParams();
            if (filter) params.set("status", filter);
            if (searchQuery) params.set("q", searchQuery);
            if (v.key) params.set("view", v.key);
            const qs = params.toString();
            return (
              <Link
                key={v.key || "all"}
                href={`/dashboard/rfq${qs ? `?${qs}` : ""}` as "/dashboard/rfq"}
                className={`view-switcher-tab${usView === (v.key === "us") ? " active" : ""}`}
              >
                {v.label}
              </Link>
            );
          })}
        </div>
      </div>

      <RfqSheet
        rows={rows}
        statusOptions={statusOptions}
        modeOptions={modeOptions}
        userId={session.userId}
        searchQuery={searchQuery}
        emptyHint={usView
          ? qualityFilter !== "all" && (qualityCounts?.all ?? 0) > 0
            ? `No ${qualityFilter === "good" ? "Good" : "Review"}-quality US leads in this view - ${qualityCounts!.all} lead${qualityCounts!.all === 1 ? "" : "s"} total under “All”.`
            : "US leads sync in hourly from the California lead sheet - press “Sync Google Sheet” to pull now, or try another status filter."
          : undefined}
      />
    </div>
  );
}
