import React from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import {
  initJobDocuments, initJobMilestones, updateDocStatus,
  markMilestoneActual, updateMilestonePlanned,
  addCarrierQuote, selectCarrierQuote, updateJobStatus,
  addQuoteLine, uploadJobDocument,
  applyAgentProposalAction, discardAgentProposalAction,
} from "./actions";
import { Icon } from "@/components/icon";
import { PopulateJobButton } from "@/components/populate-job-button";
import { SourcingOffersTable } from "@/components/sourcing-offers-table";
import { PortalLinkButton } from "@/components/portal-link-button";
import { DocumentViewer } from "@/components/document-viewer";
import { DocumentReadinessBoard } from "@/components/document-readiness-board";
import { SubmitButton } from "@/components/submit-button";
import { JobNote } from "@/components/job-note";
import { CustomerQuoteDraftButton } from "@/components/customer-quote-draft-button";
import { CommercialDecisionCockpit } from "@/components/commercial-decision-cockpit";
import { AgentPagePresenceLayer } from "@/components/agent-page-presence";
import { AgentAuditRerunButton } from "@/components/agent-audit-rerun-button";
import { parseQuoteLines, cleanNotes } from "@/lib/quote-lines";
import { CONTAINER_TYPE_LABEL, dimensionsSummary } from "@/lib/cargo";
import { OpportunityScoreCard } from "@/components/opportunity-score-card";
import { assessJobStrategy } from "@/lib/commercial-strategy-persistence";
import { draftFreshnessKey, type DraftFreshnessScope } from "@/lib/draft-freshness";
import { reviewedFieldTokenLabel } from "@/lib/agent-proposal-review";

const STATUS_ORDER = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "DELIVERED"] as const;
const STATUS_SELECT = ["PROPOSED", "INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "DELIVERED", "CANCELLED"] as const;
const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Proposed", INQUIRY: "RFQ", QUOTED: "Pricing", BOOKED: "Booked / Waiting Cargo",
  IN_TRANSIT: "En Route", CUSTOMS: "En Route", DELIVERED: "Delivered", CANCELLED: "Cancelled",
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

type ProposalPayload = {
  update?: unknown;
  inquiryUpdate?: unknown;
  fieldLabels?: unknown;
  appliedLabels?: unknown;
  skippedLabels?: unknown;
  conflictDetails?: unknown;
  decisionImpact?: unknown;
  sourceText?: unknown;
  actionLabel?: unknown;
  actionDetails?: unknown;
  qualification?: {
    isMature?: unknown;
    followUpQuestions?: unknown;
  };
};

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length > 0) : [];
}

const DRAFT_EVENT_TYPES = [
  "missing_info_draft.created",
  "missing_info_draft.blocked",
  "forwarder_drafts.created",
  "forwarder_drafts.blocked",
  "customer_quote_draft.created",
  "customer_quote_draft.blocked",
  "customer_quote_draft.applied",
  "negotiation_plan_draft.created",
  "negotiation_plan_draft.blocked",
] as const;

const DRAFT_EVENTS_BY_TOOL: Record<string, readonly string[]> = {
  draft_missing_info_request: ["missing_info_draft.created", "missing_info_draft.blocked"],
  create_forwarder_drafts: ["forwarder_drafts.created", "forwarder_drafts.blocked"],
  draft_customer_quote: ["customer_quote_draft.created", "customer_quote_draft.blocked", "customer_quote_draft.applied"],
  draft_negotiation_plan: ["negotiation_plan_draft.created", "negotiation_plan_draft.blocked"],
};

function draftEventTitle(type: string) {
  return type === "missing_info_draft.created" ? "Missing-info draft created" :
    type === "missing_info_draft.blocked" ? "Missing-info draft skipped" :
    type === "forwarder_drafts.created" ? "Forwarder drafts created" :
    type === "forwarder_drafts.blocked" ? "Forwarder drafts blocked" :
    type === "customer_quote_draft.created" ? "Customer quote draft created" :
    type === "customer_quote_draft.blocked" ? "Customer quote draft blocked" :
    type === "customer_quote_draft.applied" ? "Customer quote line applied" :
    type === "negotiation_plan_draft.created" ? "Negotiation plan draft created" :
    type === "negotiation_plan_draft.blocked" ? "Negotiation plan draft blocked" :
    "Draft event";
}

function draftEventTone(status: string) {
  const normalized = status.toUpperCase();
  if (["CREATED", "READY", "APPLIED"].includes(normalized)) return "ready" as const;
  if (["BLOCKED", "NOT_FOUND", "ERROR", "FAILED"].includes(normalized)) return "blocked" as const;
  return "review" as const;
}

function latestDate(items: Array<Date | null | undefined>) {
  const times = items
    .filter((item): item is Date => item instanceof Date)
    .map((item) => item.getTime());
  if (times.length === 0) return null;
  return new Date(Math.max(...times));
}

function isAfterByMoreThan(a: Date | null, b: Date, ms = 1000) {
  return a ? a.getTime() - b.getTime() > ms : false;
}

function asDraftFreshnessScope(value: unknown): DraftFreshnessScope | null {
  return value === "rfq" || value === "pricing" || value === "customer_quote" ? value : null;
}

function defaultDraftFreshnessScopeForEvent(type: string): DraftFreshnessScope {
  if (type.startsWith("customer_quote_draft")) return "customer_quote";
  if (type.startsWith("negotiation_plan_draft")) return "pricing";
  return "rfq";
}

const PROPOSAL_FIELD_LABELS: Record<string, string> = {
  origin: "Origin",
  destination: "Destination",
  mode: "Mode",
  containerCount: "Containers",
  containerType: "Container type",
  stackable: "Stackable",
  topLoad: "Top load",
  dangerousGoods: "Dangerous goods",
  customsBy: "Customs by",
  incoterms: "Incoterms",
  commodity: "Commodity",
  weight: "Weight kg",
  volume: "Volume cbm",
  packages: "Packages",
  dimensions: "Dimensions",
  targetPrice: "Target price",
  targetCurrency: "Target currency",
  targetPriceStatus: "Target status",
  targetPriceSource: "Target source",
  revenue: "Revenue",
  cost: "Cost",
  currency: "Currency",
  quoteLines: "Quote lines",
  status: "Status",
  subject: "Deal title",
  fromEmail: "RFQ sender email",
  fromCompany: "RFQ sender company",
};

function formatDimensionValue(value: unknown) {
  const raw = typeof value === "string"
    ? value
    : Array.isArray(value) ? JSON.stringify(value) : null;
  if (!raw) return null;
  const summary = dimensionsSummary(raw);
  return summary || null;
}

function formatEnumLikeValue(value: unknown) {
  if (value === "YES") return "Yes";
  if (value === "NO") return "No";
  if (value === "UNKNOWN") return "Unknown";
  return null;
}

function formatProposalValue(value: unknown, field?: string) {
  if (value == null || value === "") return "—";
  if (field === "dimensions") return formatDimensionValue(value) ?? "—";
  if (field === "weight" && typeof value === "number") return `${value.toLocaleString()} kg`;
  if (field === "volume" && typeof value === "number") return `${value.toLocaleString()} cbm`;
  if (field === "packages" && typeof value === "number") return `${value.toLocaleString()} package${value === 1 ? "" : "s"}`;
  if ((field === "cargoReadyDate" || field === "etd" || field === "eta") && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
  }
  if (["stackable", "topLoad", "dangerousGoods"].includes(field ?? "")) {
    const formatted = formatEnumLikeValue(value);
    if (formatted) return formatted;
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function auditInputPreview(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2).slice(0, 900);
  } catch {
    return String(value).slice(0, 900);
  }
}

function formatProposalCbm(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(3)} CBM` : "—";
}

function formatProposalFieldList(fields: string[]) {
  if (fields.length === 0) return "none";
  return fields.map((field) => PROPOSAL_FIELD_LABELS[field] ?? field).join(", ");
}

function reviewFieldRowsFromAudit(args: {
  reviewedFieldChanges: Record<string, unknown>[];
  changedJobFields: string[];
  changedInquiryFields: string[];
}) {
  if (args.reviewedFieldChanges.length > 0) {
    return args.reviewedFieldChanges.flatMap((change) => {
      const field = typeof change.field === "string" ? change.field : "";
      if (!field) return [];
      const scope = change.scope === "rfq" ? "rfq" : "job";
      const label = typeof change.label === "string" && change.label.trim()
        ? change.label.trim()
        : reviewedFieldTokenLabel(`${scope}:${field}`, PROPOSAL_FIELD_LABELS).replace(/^(Job|RFQ)\s+/, "");
      return [{
        scope,
        field,
        label,
        before: change.before,
        after: change.after,
        hasValues: true,
      }];
    });
  }
  return [
    ...args.changedJobFields.map((field) => ({
      scope: "job",
      field,
      label: reviewedFieldTokenLabel(`job:${field}`, PROPOSAL_FIELD_LABELS).replace(/^Job\s+/, ""),
      before: null,
      after: "Applied",
      hasValues: false,
    })),
    ...args.changedInquiryFields.map((field) => ({
      scope: "rfq",
      field,
      label: reviewedFieldTokenLabel(`rfq:${field}`, PROPOSAL_FIELD_LABELS).replace(/^RFQ\s+/, ""),
      before: null,
      after: "Applied",
      hasValues: false,
    })),
  ];
}

function proposalToneFromGate(status: unknown) {
  if (status === "READY_TO_QUOTE") return "ready";
  if (status === "REVIEW_REQUIRED" || status === "NEEDS_RATES") return "review";
  if (status === "BLOCKED") return "blocked";
  return "info";
}

function proposalToneFromStop(tone: unknown) {
  return typeof tone === "string" && ["ready", "review", "blocked", "rates", "info"].includes(tone)
    ? tone
    : "info";
}

function ProposalDecisionDossier({
  impact,
  mode = "pending",
}: {
  impact: Record<string, unknown>;
  mode?: "pending" | "reviewed";
}) {
  const before = asRecord(impact.before);
  const after = asRecord(impact.after);
  const target = asRecord(impact.target);
  const docs = asRecord(impact.documents);
  const strategy = asRecord(impact.strategy);
  const strategyBefore = asRecord(strategy.before);
  const strategyAfter = asRecord(strategy.after);
  const delta = asRecord(strategy.delta);
  const beforeGate = asRecord(strategyBefore.quoteGate);
  const afterGate = asRecord(strategyAfter.quoteGate);
  const afterGuardrail = asRecord(strategyAfter.guardrail);
  const cargo = asRecord(strategyAfter.cargo);
  const nextMove = asRecord(strategyAfter.nextMove);
  const firstStop = asRecord(strategyAfter.firstStop);
  const groups = asRecord(impact.proposedGroups ?? impact.fieldGroups);
  const routeFields = asStringList(groups.route);
  const cargoFields = asStringList(groups.cargo);
  const commercialFields = asStringList(groups.commercial);
  const missingAfter = asStringList(after.missing);
  const phaseNoun = mode === "reviewed" ? "review" : "apply";
  const missingDelta = typeof delta.missingCount === "number" && delta.missingCount !== 0
    ? delta.missingCount < 0
      ? `${Math.abs(delta.missingCount)} blocker${Math.abs(delta.missingCount) === 1 ? "" : "s"} cleared`
      : `${delta.missingCount} blocker${delta.missingCount === 1 ? "" : "s"} added`
    : "blockers unchanged";
  const gradeDelta = delta.bandChanged === true || delta.confidenceChanged === true
    ? `${formatProposalValue(strategyBefore.band)}/${formatProposalValue(strategyBefore.confidence)} -> ${formatProposalValue(strategyAfter.band)}/${formatProposalValue(strategyAfter.confidence)}`
    : `${formatProposalValue(strategyAfter.band)}/${formatProposalValue(strategyAfter.confidence)}`;
  const proposedTarget = target.proposedAmount != null
    ? `${formatProposalValue(target.proposedAmount)} ${formatProposalValue(target.currency)}`
    : formatProposalValue(target.proposedStatus);
  const cargoTone = cargo.dimensionsPartial === true ? "blocked" : cargo.chargeableCbm != null ? "ready" : "review";
  const cargoValue = cargo.chargeableCbm != null
    ? `${formatProposalCbm(cargo.chargeableCbm)} chargeable`
    : cargo.dimensionsPartial === true ? "Partial dimensions" : "No cargo math";
  const dossierRows = [
    {
      key: "gate",
      tone: proposalToneFromGate(afterGate.status),
      label: `Gate after ${phaseNoun}`,
      value: `${formatProposalValue(beforeGate.label)} -> ${formatProposalValue(afterGate.label)}`,
      detail: delta.gateChanged === true
        ? mode === "reviewed" ? "Commercial gate changed during review." : "Commercial gate changes if this is accepted."
        : mode === "reviewed" ? "Commercial gate stayed the same." : "Commercial gate stays the same.",
    },
    {
      key: "brain",
      tone: proposalToneFromStop(firstStop.tone),
      label: "Decision brain",
      value: `Grade ${gradeDelta}`,
      detail: `${missingDelta}. Next stop: ${formatProposalValue(firstStop.label)}.`,
    },
    {
      key: "data",
      tone: proposalToneFromStop(docs.tone),
      label: "Data and target",
      value: `${formatProposalValue(docs.metric)} · ${proposedTarget}`,
      detail: `Route: ${formatProposalFieldList(routeFields)}. Commercial: ${formatProposalFieldList(commercialFields)}.`,
    },
    {
      key: "cargo",
      tone: cargoTone,
      label: "Cargo math",
      value: cargoValue,
      detail: `Fields: ${formatProposalFieldList(cargoFields)}. Physical ${formatProposalCbm(cargo.physicalCbm)} · stackable ${formatProposalValue(cargo.stackable)} · top-load ${formatProposalValue(cargo.topLoad)}.`,
    },
    {
      key: "boundary",
      tone: nextMove.canRunNow === true ? "ready" : "blocked",
      label: "Agent boundary",
      value: formatProposalValue(nextMove.phase),
      detail: nextMove.canRunNow === true
        ? `${formatProposalValue(nextMove.toolHint)} is review-only; sending still needs approval.`
        : formatProposalValue(firstStop.stopRule),
    },
  ];

  return (
    <div className={`agent-proposal-dossier ${mode}`} data-agent-target="proposal-dossier" aria-label="Proposal decision dossier">
      <div className="agent-proposal-dossier-head">
        <div>
          <span>{mode === "reviewed" ? "Reviewed decision dossier" : "Apply preview dossier"}</span>
          <strong>
            {after.mature === true
              ? `RFQ mature after ${phaseNoun}`
              : `${formatProposalValue(after.missingCount)} blocker${after.missingCount === 1 ? "" : "s"} after ${phaseNoun}`}
          </strong>
        </div>
        <em>{formatProposalValue(impact.safeAction)}</em>
      </div>
      <div className="agent-proposal-dossier-grid">
        {dossierRows.map((row) => (
          <div key={row.key} className={`agent-proposal-dossier-row ${row.tone}`}>
            <span>{row.label}</span>
            <strong>{row.value}</strong>
            <em>{row.detail}</em>
          </div>
        ))}
      </div>
      {missingAfter.length > 0 && (
        <div className="agent-proposal-dossier-missing">
          <span>Still missing</span>
          <strong>{missingAfter.slice(0, 6).join(" ")}</strong>
        </div>
      )}
    </div>
  );
}

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
      targetPriceHistory: { orderBy: { createdAt: "desc" }, take: 8 },
      agentProposals: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 5,
      },
      emailThreads: {
        include: { messages: { orderBy: { sentAt: "asc" } } },
      },
    },
  });
  if (!job) notFound();

  const agentRunEvents = await prisma.event.findMany({
    where: {
      officeId: session.officeId,
      type: {
        in: [
          "agent.run",
          "agent.proposal_reviewed",
          ...DRAFT_EVENT_TYPES,
        ],
      },
      entityType: "job",
      entityId: job.id,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const draftEvents = await prisma.event.findMany({
    where: {
      officeId: session.officeId,
      type: { in: [...DRAFT_EVENT_TYPES] },
      entityType: "job",
      entityId: job.id,
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  await Promise.all([
    initJobDocuments(jobId, session.officeId),
    initJobMilestones(jobId),
  ]);

  const docs = job.documents.length > 0
    ? job.documents
    : await prisma.jobDocument.findMany({ where: { jobId, officeId: session.officeId }, orderBy: { createdAt: "asc" } });
  const milestones = job.milestones.length > 0
    ? job.milestones
    : await prisma.jobMilestone.findMany({ where: { jobId, job: { officeId: session.officeId } }, orderBy: { createdAt: "asc" } });

  const visibleStatus = job.status === "CUSTOMS" ? "IN_TRANSIT" : job.status;
  const currentIdx = (STATUS_ORDER as readonly string[]).indexOf(visibleStatus);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const timelineMilestones = milestones.filter((m) => !["ETD", "ETA", "CUSTOMS_ENTRY", "CUSTOMS_RELEASE"].includes(m.type));

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
  for (const m of timelineMilestones) {
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
    INQUIRY: "Qualify missing RFQ facts before forwarder handoff",
    QUOTED: "Prepare customer price and protect margin",
    BOOKED: "Booked; waiting for cargo readiness",
    IN_TRANSIT: "Track customer-visible updates by email",
    CUSTOMS: "Track customer-visible updates by email",
    DELIVERED: "Closed for margin review",
  };

  const quoteLines = parseQuoteLines(job);
  const strategyRun = await assessJobStrategy(session.officeId, job.id);
  const strategy = strategyRun?.strategy;
  const relevantDraftTypes = strategy ? DRAFT_EVENTS_BY_TOOL[strategy.operatorDecision.toolHint] ?? [] : [];
  const relevantDraftEvent = draftEvents.find((event) => relevantDraftTypes.includes(event.type)) ?? null;
  const relevantDraftPayload = relevantDraftEvent ? asRecord(relevantDraftEvent.payload) : {};
  const relevantDraftStatus = typeof relevantDraftPayload.status === "string"
    ? relevantDraftPayload.status
    : typeof relevantDraftPayload.decision === "string" ? relevantDraftPayload.decision : "";
  const relevantDraftMissing = asStringList(relevantDraftPayload.missing);
  const relevantDraftBlockers = asStringList(relevantDraftPayload.blockers);
  const relevantCreatedDrafts = asRecordList(relevantDraftPayload.createdDrafts);
  const relevantExistingDrafts = asRecordList(relevantDraftPayload.existingDrafts);
  const draftFreshnessInput = {
    ...job,
    subject: job.title ?? job.inquiry?.subject ?? job.reference,
    carrierQuotes: job.inquiry?.carrierQuotes ?? [],
  };
  const currentDraftFreshnessKeys: Record<DraftFreshnessScope, string> = {
    rfq: draftFreshnessKey(draftFreshnessInput, "rfq"),
    pricing: draftFreshnessKey(draftFreshnessInput, "pricing"),
    customer_quote: draftFreshnessKey(draftFreshnessInput, "customer_quote"),
  };
  const latestBaseDraftInputChange = latestDate([
    job.updatedAt,
    job.inquiry?.updatedAt ?? null,
    job.targetPriceHistory[0]?.createdAt ?? null,
  ]);
  const latestPricingDraftInputChange = latestDate([
    latestBaseDraftInputChange,
    ...(job.inquiry?.carrierQuotes ?? []).map((quote) => quote.updatedAt ?? quote.createdAt),
  ]);
  const latestRelevantDraftInputChange =
    strategy?.operatorDecision.toolHint === "create_forwarder_drafts" ||
    strategy?.operatorDecision.toolHint === "draft_customer_quote" ||
    strategy?.operatorDecision.toolHint === "draft_negotiation_plan"
      ? latestPricingDraftInputChange
      : latestBaseDraftInputChange;
  const payloadFreshnessKey = typeof relevantDraftPayload.freshnessKey === "string" ? relevantDraftPayload.freshnessKey : null;
  const payloadFreshnessScope = asDraftFreshnessScope(relevantDraftPayload.freshnessScope);
  const defaultFreshnessScope: DraftFreshnessScope =
    strategy?.operatorDecision.toolHint === "draft_customer_quote" ? "customer_quote" :
    strategy?.operatorDecision.toolHint === "draft_negotiation_plan" ? "pricing" :
    "rfq";
  const currentFreshnessScope = payloadFreshnessScope ?? defaultFreshnessScope;
  const currentFreshnessKey = currentDraftFreshnessKeys[currentFreshnessScope];
  const draftIsStale = relevantDraftEvent
    ? payloadFreshnessKey
      ? payloadFreshnessKey !== currentFreshnessKey
      : isAfterByMoreThan(latestRelevantDraftInputChange, relevantDraftEvent.createdAt)
    : false;
  const draftStaleReason =
    draftIsStale && payloadFreshnessKey
      ? "RFQ, pricing, target, or quote inputs changed after this draft. Rerun before using it."
      : draftIsStale && latestRelevantDraftInputChange
      ? `Job, RFQ, target, or pricing evidence changed ${relTime(latestRelevantDraftInputChange)}. Rerun before using this draft.`
      : null;

  const draftAuditStateForEvent = (event: (typeof agentRunEvents)[number]) => {
    const isDraftEvent = event.type.includes("_draft") || event.type.includes("_drafts");
    if (!isDraftEvent) return null;
    const payload = asRecord(event.payload);
    const freshnessScope = asDraftFreshnessScope(payload.freshnessScope) ?? defaultDraftFreshnessScopeForEvent(event.type);
    const freshnessKeyFromEvent = typeof payload.freshnessKey === "string" ? payload.freshnessKey : null;
    const latestInputForScope = freshnessScope === "rfq" ? latestBaseDraftInputChange : latestPricingDraftInputChange;
    const isStale = freshnessKeyFromEvent
      ? freshnessKeyFromEvent !== currentDraftFreshnessKeys[freshnessScope]
      : isAfterByMoreThan(latestInputForScope, event.createdAt);
    const className = isStale ? "stale" : freshnessKeyFromEvent ? "fresh" : "legacy";
    const label = isStale ? "stale inputs" : freshnessKeyFromEvent ? "inputs current" : "legacy check";
    const note = isStale && freshnessKeyFromEvent
      ? "RFQ, pricing, target, or quote inputs changed after this draft."
      : isStale
        ? "Job/RFQ timestamps changed after this legacy draft."
        : freshnessKeyFromEvent
          ? `Fingerprint scope: ${freshnessScope}.`
          : "Older event without a fingerprint; freshness inferred from timestamps.";
    return { className, isStale, label, note };
  };

  const auditDraftStates = agentRunEvents
    .map(draftAuditStateForEvent)
    .filter((state): state is NonNullable<typeof state> => state != null);
  const auditDraftCounts = auditDraftStates.reduce((counts, state) => ({
    fresh: counts.fresh + (state.className === "fresh" ? 1 : 0),
    stale: counts.stale + (state.className === "stale" ? 1 : 0),
    legacy: counts.legacy + (state.className === "legacy" ? 1 : 0),
  }), { fresh: 0, stale: 0, legacy: 0 });

  const recentDraft = relevantDraftEvent ? {
    label: draftEventTitle(relevantDraftEvent.type),
    status: relevantDraftStatus || "RECORDED",
    occurredAt: relTime(relevantDraftEvent.createdAt),
    summary:
      typeof relevantDraftPayload.subject === "string" ? relevantDraftPayload.subject :
      typeof relevantDraftPayload.error === "string" ? relevantDraftPayload.error :
      typeof relevantDraftPayload.safety === "string" ? relevantDraftPayload.safety :
      "Recorded in the job audit trail",
    detail:
      relevantDraftMissing.length > 0 ? `Missing: ${relevantDraftMissing.join(", ")}` :
      relevantDraftBlockers.length > 0 ? `Blocked by: ${relevantDraftBlockers.join(", ")}` :
      relevantCreatedDrafts.length > 0 || relevantExistingDrafts.length > 0
        ? `${relevantCreatedDrafts.length} new and ${relevantExistingDrafts.length} existing draft${relevantCreatedDrafts.length + relevantExistingDrafts.length === 1 ? "" : "s"}.`
        : typeof relevantDraftPayload.safety === "string" ? relevantDraftPayload.safety : "Review the audit trail before rerunning.",
    reviewUrl: typeof relevantDraftPayload.reviewUrl === "string" ? relevantDraftPayload.reviewUrl : null,
    tone: draftEventTone(relevantDraftStatus),
    isStale: draftIsStale,
    staleReason: draftStaleReason,
  } : null;

  const equipment =
    job.mode === "SEA-FCL" && job.containerCount
      ? `${job.containerCount} × ${job.containerType ? (CONTAINER_TYPE_LABEL[job.containerType] ?? job.containerType) : "container"}`
      : dimensionsSummary(job.dimensions);

  const carrierQuotes = job.inquiry?.carrierQuotes ?? [];
  const receivedQuotes = carrierQuotes.filter((q) => q.status === "RECEIVED");
  const pendingQuotes = carrierQuotes.filter((q) => q.status === "PENDING");
  const headerMeta = [
    job.mode ? (MODE_LABEL[job.mode] ?? job.mode) : "Mode TBD",
    job.incoterms,
    equipment,
    job.volume != null && job.mode !== "SEA-FCL" ? `${job.volume.toLocaleString()} cbm` : null,
  ].filter(Boolean);

  return (
    <div>
      <AgentPagePresenceLayer listenForExternalCues />
      {/* Back */}
      <div className="record-back-row">
        <a href="/dashboard/jobs" className="back-link">
          <Icon name="chevron-left" size={14} strokeWidth={2} /> Deal Pipeline
        </a>
      </div>

      {/* Header strip */}
      <div className="record-hero" data-agent-target="job-summary">
        <div className="record-hero-top">
          <div className="record-hero-main">
            <div className="record-eyebrow">
              <span className="record-reference">
                {job.reference}
              </span>
              {headerMeta.map((item) => (
                <React.Fragment key={item}>
                  <span className="record-meta-separator" aria-hidden>-</span>
                  <span className="record-meta-token">{item}</span>
                </React.Fragment>
              ))}
            </div>
            <h1 className="record-title">
              {job.title ?? job.company?.name ?? "Unknown Customer"}
            </h1>
            <p className="record-subtitle">
              {job.title && job.company?.name ? `${job.company.name} · ` : ""}
              {job.origin && job.destination ? `${job.origin} → ${job.destination}` : job.origin ?? job.destination ?? "Route not set"}
              {job.commodity ? ` · ${job.commodity}` : ""}
              {job.quantity != null ? ` · ${job.quantity.toLocaleString()} ${job.quantityUnit ?? ""}`.trimEnd() : ""}
              {job.cadence ? ` · ${job.cadence === "MONTHLY" ? "Monthly" : "One-off"}` : ""}
            </p>
          </div>

          <div className="record-actions">
            <a
              href={`/dashboard/inbox?job=${jobId}`}
              className="btn btn-secondary btn-sm record-action-link"
              title="Show every email thread attached to this load"
            >
              <Icon name="inbox" size={11} /> Inbox
            </a>
            <PortalLinkButton jobId={jobId} hasToken={!!job.portalToken} notifyCustomer={job.notifyCustomer} />
            <PopulateJobButton jobId={jobId} />
            <form action={async (fd: FormData) => {
              "use server";
              await updateJobStatus(jobId, String(fd.get("status")));
            }} className="record-status-form">
              <select name="status" defaultValue={visibleStatus} className="record-status-select">
                {STATUS_SELECT.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
              <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Updating…">Update</SubmitButton>
            </form>
          </div>
        </div>

        {/* Status pipeline */}
        <div className="status-pipeline job-command-pipeline">
          {STATUS_ORDER.map((s, i) => (
            <div key={s} className={`status-step ${i < currentIdx ? "done" : i === currentIdx ? "current" : ""}`}>
              <span className="status-step-label">{STATUS_LABEL[s]}</span>
              {i < STATUS_ORDER.length - 1 && <div className="status-step-line" />}
            </div>
          ))}
        </div>

        {/* Pipeline / next auto step indicator */}
        <div className="record-automation-row">
          <span className="live-dot" aria-hidden />
          <strong>Desk status:</strong>
          <span className="record-automation-copy">{NEXT_AUTO[visibleStatus]}</span>
        </div>
      </div>

      {/* Two-pane: load trail | worktable */}
      <div className="record-two-pane">
        {/* ── LEFT: Load trail ───────────────────────────────────────────── */}
        <div className="card record-activity-card">
          <div className="record-card-header">
            <div className="record-card-title">
              <span className="live-dot" aria-hidden />
              <span>Load trail</span>
            </div>
            <span className="record-card-count">
              {events.length} event{events.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="record-scroll-area">
            {events.length === 0 ? (
              <div className="record-empty-state">
                No updates yet.
              </div>
            ) : (
              events.map((e, i) => (
                <div key={i} className="record-event-row">
                  <span className={["record-event-icon", e.kind === "auto" ? "auto" : "manual"].join(" ")}>
                    <Icon name={e.iconName} size={13} strokeWidth={2} />
                  </span>
                  <div className="record-event-main">
                    <div className="record-event-title-row">
                      <span className="record-event-title">{e.title}</span>
                      {e.kind === "auto" && (
                        <span className="record-auto-badge">AUTO</span>
                      )}
                    </div>
                    {e.sub && <div className="record-event-sub">{e.sub}</div>}
                  </div>
                  <span className="record-event-time">
                    {relTime(e.at)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT: Worktable ──────────────────────────────────────────── */}
        <div className="record-side-stack">

          {/* Parent / child links */}
          {(job.parent || job.children.length > 0) && (
            <div className="card">
              <div className="worktable-section-header">Linked jobs</div>
              <div className="record-linked-list">
                {job.parent && (
                  <a href={`/dashboard/jobs/${job.parent.id}`} className="record-linked-job">
                    Source: {job.parent.reference} <span className="record-linked-meta">{job.parent.type === "SOURCING" ? "Procurement" : "Forwarding"}</span>
                  </a>
                )}
                {job.children.map((c) => (
                  <a key={c.id} href={`/dashboard/jobs/${c.id}`} className="record-linked-job">
                    Spinoff: {c.reference} <span className="record-linked-meta">{c.type === "SOURCING" ? "Procurement" : "Forwarding"} - {c.status}</span>
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

          {strategy && (
            <CommercialDecisionCockpit
              strategy={strategy}
              docs={docs}
              jobReference={job.reference}
              jobId={job.id}
              inquiryId={job.inquiryId}
              recentDraft={recentDraft}
              auditDraftHealth={auditDraftStates.length > 0 ? {
                total: auditDraftStates.length,
                current: auditDraftCounts.fresh,
                stale: auditDraftCounts.stale,
                legacy: auditDraftCounts.legacy,
              } : null}
            />
          )}
          {strategy && <OpportunityScoreCard score={strategy} />}

          {job.agentProposals.length > 0 && (
            <div className="card agent-proposal-card">
              <div className="worktable-section-header record-split-header">
                <span>Agent proposals</span>
                <span className="record-section-note">{job.agentProposals.length} pending</span>
              </div>
              <div className="agent-proposal-list">
                {job.agentProposals.map((proposal) => {
                  const payload = proposal.payload as ProposalPayload;
                  const skippedLabels = asStringList(payload.skippedLabels);
                  const missing = asStringList(payload.qualification?.followUpQuestions);
                  const mature = payload.qualification?.isMature === true;
                  const update = asRecord(payload.update);
                  const inquiryUpdate = asRecord(payload.inquiryUpdate);
                  const fieldLabels = asRecord(payload.fieldLabels);
                  const conflictDetails = asRecordList(payload.conflictDetails);
                  const decisionImpact = asRecord(payload.decisionImpact);
                  const hasDecisionImpact = Object.keys(decisionImpact).length > 0;
                  const actionLabel = typeof payload.actionLabel === "string" ? payload.actionLabel : "";
                  const actionDetails = asStringList(payload.actionDetails);
                  const fieldEntries = [
                    ...Object.entries(update).map(([field, proposed]) => ({ scope: "job" as const, field, proposed })),
                    ...Object.entries(inquiryUpdate).map(([field, proposed]) => ({ scope: "rfq" as const, field, proposed })),
                  ];
                  const sourceText = typeof payload.sourceText === "string" ? payload.sourceText.trim() : "";
                  const sourcePreview = typeof proposal.sourcePreview === "string" ? proposal.sourcePreview.trim() : "";
                  const evidenceText = sourceText || sourcePreview;
                  const trace = asRecord(proposal.toolTrace);
                  const parser = typeof trace.parser === "string" ? trace.parser : null;
                  const proposedJobFields = asStringList(trace.proposedJobFields);
                  const proposedInquiryFields = asStringList(trace.proposedInquiryFields);
                  const conflictFields = asStringList(trace.conflictFields);
                  const hasVolumeBasisReview = conflictDetails.some((conflict) => {
                    const field = typeof conflict.field === "string" ? conflict.field : "";
                    const label = typeof conflict.label === "string" ? conflict.label : "";
                    return field === "volume" || /volume|cbm/i.test(label);
                  });
                  const conflictHelpText = hasVolumeBasisReview
                    ? "The agent did not convert this into an applied CBM. Review whether the customer meant physical CBM or chargeable CBM before updating volume."
                    : "The agent did not overwrite these. Update manually or paste a clear correction if the current value is wrong.";
                  return (
                    <div key={proposal.id} className="agent-proposal-item">
                      <div className="agent-proposal-topline">
                        <strong>Agent update {proposal.id.slice(0, 8)}</strong>
                        <span>{relTime(proposal.createdAt)}</span>
                      </div>
                      <div className="agent-proposal-audit">
                        <span>{proposal.kind}</span>
                        <span>{proposal.sourceType ?? "SOURCE_UNKNOWN"}</span>
                        {parser && <span>Parser: {parser}</span>}
                        {(proposedJobFields.length > 0 || proposedInquiryFields.length > 0) && (
                          <span>
                            Proposed {proposedJobFields.length} job field{proposedJobFields.length === 1 ? "" : "s"}
                            {proposedInquiryFields.length > 0 ? ` / ${proposedInquiryFields.length} RFQ field${proposedInquiryFields.length === 1 ? "" : "s"}` : ""}
                          </span>
                        )}
                        {conflictFields.length > 0 && (
                          <span>{conflictFields.length} conflict{conflictFields.length === 1 ? "" : "s"}</span>
                        )}
                      </div>
                      {hasDecisionImpact && (
                        <div className="agent-proposal-impact" aria-label="Decision impact of proposed agent update">
                          <ProposalDecisionDossier impact={decisionImpact} />
                        </div>
                      )}
                      {conflictDetails.length > 0 && (
                        <div className="agent-proposal-conflicts" aria-label="Pasted facts that conflict with current job values">
                          <div className="agent-proposal-conflict-head">
                            <span>Conflict</span>
                            <span>Current</span>
                            <span>Pasted</span>
                          </div>
                          {conflictDetails.slice(0, 8).map((conflict) => {
                            const field = typeof conflict.field === "string" ? conflict.field : "";
                            const label = typeof conflict.label === "string"
                              ? conflict.label
                              : PROPOSAL_FIELD_LABELS[field] ?? (field || "Field");
                            return (
                              <div key={`${field}-${label}-${String(conflict.pasted ?? "")}`} className="agent-proposal-conflict-row">
                                <strong>{label}</strong>
                                <span>{formatProposalValue(conflict.current, field)}</span>
                                <span>{formatProposalValue(conflict.pasted, field)}</span>
                              </div>
                            );
                          })}
                          <em>{conflictHelpText}</em>
                        </div>
                      )}
                      {fieldEntries.length > 0 ? (
                        <form action={applyAgentProposalAction.bind(null, proposal.id)} className="agent-proposal-field-form">
                          <div className="agent-proposal-field-head" aria-hidden>
                            <span>Use</span>
                            <span>Field</span>
                            <span>Current</span>
                            <span>Proposed</span>
                          </div>
                          {fieldEntries.map(({ scope, field, proposed }) => {
                            const label = typeof fieldLabels[field] === "string"
                              ? fieldLabels[field] as string
                              : PROPOSAL_FIELD_LABELS[field] ?? field;
                            const current = scope === "rfq"
                              ? (job.inquiry as unknown as Record<string, unknown> | null)?.[field]
                              : (job as unknown as Record<string, unknown>)[field];
                            return (
                              <label key={`${scope}-${field}`} className="agent-proposal-field-row">
                                <input type="checkbox" name="field" value={`${scope}:${field}`} defaultChecked />
                                <strong>{scope === "rfq" ? `RFQ ${label}` : label}</strong>
                                <span>{formatProposalValue(current, field)}</span>
                                <span>{formatProposalValue(proposed, field)}</span>
                              </label>
                            );
                          })}
                          {evidenceText && (
                            <details className="agent-proposal-source">
                              <summary>Source evidence</summary>
                              <pre>{evidenceText.slice(0, 1400)}</pre>
                            </details>
                          )}
                          <div className="agent-proposal-readiness-note">
                            Unchecked fields will be rejected when you apply this proposal.
                          </div>
                          <div className="agent-proposal-actions">
                            <SubmitButton className="btn btn-sm" pendingLabel="Applying...">Apply selected</SubmitButton>
                          </div>
                        </form>
                      ) : actionLabel ? (
                        <form action={applyAgentProposalAction.bind(null, proposal.id)} className="agent-proposal-action-form">
                          <div className="agent-proposal-action-copy">
                            <strong>{actionLabel}</strong>
                            {actionDetails.length > 0 && (
                              <ul>
                                {actionDetails.map((detail) => <li key={detail}>{detail}</li>)}
                              </ul>
                            )}
                          </div>
                          {evidenceText && (
                            <details className="agent-proposal-source">
                              <summary>Source evidence</summary>
                              <pre>{evidenceText.slice(0, 1400)}</pre>
                            </details>
                          )}
                          <div className="agent-proposal-readiness-note">
                            This action will not run until you apply this proposal.
                          </div>
                          <div className="agent-proposal-actions">
                            <SubmitButton className="btn btn-sm" pendingLabel="Applying...">Apply action</SubmitButton>
                          </div>
                        </form>
                      ) : (
                        <div className="record-empty-line subtle">No empty job fields would change.</div>
                      )}
                      {skippedLabels.length > 0 && (
                        <div className="agent-proposal-warning">
                          Existing fields not overwritten: {skippedLabels.join(", ")}
                        </div>
                      )}
                      <div className={["agent-proposal-readiness", mature ? "mature" : "blocked"].join(" ")}>
                        {mature ? "RFQ would be mature after applying." : `Still missing: ${missing.join(" ") || "review required"}`}
                      </div>
                      <div className="agent-proposal-actions">
                        <form action={discardAgentProposalAction.bind(null, proposal.id, jobId, job.inquiryId)}>
                          <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Discarding...">Discard</SubmitButton>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {agentRunEvents.length > 0 && (
            <div className="card agent-audit-card">
              <div className="worktable-section-header record-split-header">
                <span>Agent audit trail</span>
                <div className="agent-audit-header-meta">
                  <span className="record-section-note">{agentRunEvents.length} recent</span>
                  {auditDraftStates.length > 0 && (
                    <span className="agent-audit-health-strip" aria-label="Draft freshness summary">
                      <span className="fresh">{auditDraftCounts.fresh} current</span>
                      {auditDraftCounts.stale > 0 && <span className="stale">{auditDraftCounts.stale} stale</span>}
                      {auditDraftCounts.legacy > 0 && <span className="legacy">{auditDraftCounts.legacy} legacy</span>}
                    </span>
                  )}
                </div>
              </div>
              <div className="agent-audit-list">
                {agentRunEvents.map((event) => {
                  const payload = asRecord(event.payload);
                  const tools = asRecordList(payload.tools);
                  const status = typeof payload.status === "string" ? payload.status : "UNKNOWN";
                  const decision = typeof payload.decision === "string" ? payload.decision : status;
                  const statusClass = decision.toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
                  const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
                  const reply = typeof payload.reply === "string" ? payload.reply : "";
                  const error = typeof payload.error === "string" ? payload.error : "";
                  const subject = typeof payload.subject === "string" ? payload.subject : "";
                  const to = typeof payload.to === "string" ? payload.to : "";
                  const safety = typeof payload.safety === "string" ? payload.safety : "";
                  const preview = typeof payload.preview === "string" ? payload.preview : "";
                  const sourcePreview = typeof payload.sourcePreview === "string" ? payload.sourcePreview : "";
                  const reviewUrl = typeof payload.reviewUrl === "string" ? payload.reviewUrl : "";
                  const proposalId = typeof payload.proposalId === "string" ? payload.proposalId : "";
                  const note = typeof payload.note === "string" ? payload.note : "";
                  const sourceType = typeof payload.sourceType === "string" ? payload.sourceType : "";
                  const acceptedFields = asStringList(payload.acceptedFields);
                  const changedJobFields = asStringList(payload.changedJobFields);
                  const changedInquiryFields = asStringList(payload.changedInquiryFields);
                  const reviewedFieldChanges = asRecordList(payload.reviewedFieldChanges);
                  const reviewedFieldRows = reviewFieldRowsFromAudit({ reviewedFieldChanges, changedJobFields, changedInquiryFields });
                  const acceptedFieldLabels = acceptedFields.map((field) => reviewedFieldTokenLabel(field, PROPOSAL_FIELD_LABELS));
                  const missing = asStringList(payload.missing);
                  const blockers = asStringList(payload.blockers);
                  const lineItems = asRecordList(payload.lineItems);
                  const createdDrafts = asRecordList(payload.createdDrafts);
                  const existingDrafts = asRecordList(payload.existingDrafts);
                  const skippedForwarders = asRecordList(payload.skippedForwarders);
                  const isReview = event.type === "agent.proposal_reviewed";
                  const reviewImpact = asRecord(payload.decisionImpact);
                  const hasReviewImpact = Object.keys(reviewImpact).length > 0;
                  const draftAuditState = draftAuditStateForEvent(event);
                  const isDraftEvent = !!draftAuditState;
                  const draftFreshnessClass = draftAuditState?.className ?? "";
                  const draftFreshnessLabel = draftAuditState?.label ?? "";
                  const draftFreshnessNote = draftAuditState?.note ?? "";
                  const isDraftInputStale = draftAuditState?.isStale ?? false;
                  const draftTitle =
                    event.type === "missing_info_draft.created" ? "Missing-info draft created" :
                    event.type === "missing_info_draft.blocked" ? "Missing-info draft skipped" :
                    event.type === "forwarder_drafts.created" ? "Forwarder drafts created" :
                    event.type === "forwarder_drafts.blocked" ? "Forwarder drafts blocked" :
                    event.type === "customer_quote_draft.created" ? "Customer quote draft created" :
                    event.type === "customer_quote_draft.blocked" ? "Customer quote draft blocked" :
                    event.type === "customer_quote_draft.applied" ? "Customer quote line applied" :
                    "";
                  const toolNames = tools
                    .map((tool) => typeof tool.name === "string" ? tool.name : null)
                    .filter((name): name is string => !!name);
                  return (
                    <details key={event.id} className="agent-audit-item">
                      <summary>
                        <span className={`agent-audit-status ${statusClass}`}>{decision}</span>
                        <strong>
                          {isReview
                            ? `Proposal review${proposalId ? ` ${proposalId.slice(0, 8)}` : ""}`
                            : isDraftEvent ? draftTitle
                              : prompt ? prompt.slice(0, 90) : "Agent run"}
                        </strong>
                        <em>{relTime(event.createdAt)}</em>
                      </summary>
                      <div className="agent-audit-body">
                        {(toolNames.length > 0 || isReview || isDraftEvent) && (
                          <div className="agent-audit-tools">
                            {isReview && sourceType && <span>{sourceType}</span>}
                            {isReview && acceptedFieldLabels.length > 0 && (
                              <span>
                                Accepted {acceptedFieldLabels.slice(0, 4).join(", ")}
                                {acceptedFieldLabels.length > 4 ? ` +${acceptedFieldLabels.length - 4}` : ""}
                              </span>
                            )}
                            {isReview && changedJobFields.length > 0 && <span>{changedJobFields.length} job field{changedJobFields.length === 1 ? "" : "s"}</span>}
                            {isReview && changedInquiryFields.length > 0 && <span>{changedInquiryFields.length} RFQ field{changedInquiryFields.length === 1 ? "" : "s"}</span>}
                            {isDraftEvent && <span className={`agent-audit-freshness ${draftFreshnessClass}`}>{draftFreshnessLabel}</span>}
                            {isDraftEvent && to && <span>To {to}</span>}
                            {isDraftEvent && subject && <span>{subject.slice(0, 80)}</span>}
                            {isDraftEvent && missing.length > 0 && <span>{missing.length} missing field{missing.length === 1 ? "" : "s"}</span>}
                            {isDraftEvent && blockers.length > 0 && <span>{blockers.length} blocker{blockers.length === 1 ? "" : "s"}</span>}
                            {isDraftEvent && createdDrafts.length > 0 && <span>{createdDrafts.length} new draft{createdDrafts.length === 1 ? "" : "s"}</span>}
                            {isDraftEvent && existingDrafts.length > 0 && <span>{existingDrafts.length} existing draft{existingDrafts.length === 1 ? "" : "s"}</span>}
                            {isDraftEvent && skippedForwarders.length > 0 && <span>{skippedForwarders.length} skipped forwarder{skippedForwarders.length === 1 ? "" : "s"}</span>}
                            {isDraftEvent && lineItems.length > 0 && <span>{lineItems.length} line item{lineItems.length === 1 ? "" : "s"}</span>}
                            {isDraftEvent && reviewUrl && <a href={reviewUrl}>Review</a>}
                            {!isReview && toolNames.map((name, index) => (
                              <span key={`${event.id}-${name}-${index}`}>{name}</span>
                            ))}
                          </div>
                        )}
                        {isReview && reviewedFieldRows.length > 0 && (
                          <div className="agent-review-field-ledger" aria-label="Reviewed agent field changes">
                            <div className="agent-review-field-ledger-head">
                              <span>Scope</span>
                              <span>Field</span>
                              <span>Before</span>
                              <span>After</span>
                            </div>
                            {reviewedFieldRows.slice(0, 12).map((row) => (
                              <div key={`${event.id}-${row.scope}-${row.field}`} className="agent-review-field-row">
                                <span>{row.scope === "rfq" ? "RFQ" : "Job"}</span>
                                <strong>{row.label}</strong>
                                <em>{row.hasValues ? formatProposalValue(row.before, row.field) : "—"}</em>
                                <em>{row.hasValues ? formatProposalValue(row.after, row.field) : formatProposalValue(row.after)}</em>
                              </div>
                            ))}
                            {reviewedFieldRows.length > 12 && (
                              <p>{reviewedFieldRows.length - 12} more reviewed change{reviewedFieldRows.length - 12 === 1 ? "" : "s"} hidden here.</p>
                            )}
                          </div>
                        )}
                        {isReview && hasReviewImpact && (
                          <div className="agent-audit-impact" aria-label="Reviewed proposal decision impact">
                            <ProposalDecisionDossier impact={reviewImpact} mode="reviewed" />
                          </div>
                        )}
                        {prompt && (
                          <details className="agent-proposal-source">
                            <summary>Prompt</summary>
                            <pre>{prompt.slice(0, 1600)}</pre>
                          </details>
                        )}
                        {sourcePreview && (
                          <details className="agent-proposal-source">
                            <summary>Source preview</summary>
                            <pre>{sourcePreview.slice(0, 1200)}</pre>
                          </details>
                        )}
                        {!isReview && tools.length > 0 && (
                          <div className="agent-audit-tool-ledger" aria-label="Agent tool calls">
                            {tools.slice(0, 8).map((tool, index) => {
                              const name = typeof tool.name === "string" ? tool.name : "tool";
                              const ok = tool.ok !== false;
                              const toolError = typeof tool.error === "string" ? tool.error : "";
                              const pageCues = asRecordList(tool.pageCues);
                              return (
                                <details key={`${event.id}-tool-${index}`} className={`agent-audit-tool-row ${ok ? "ok" : "failed"}`}>
                                  <summary>
                                    <strong>{name}</strong>
                                    <span>{ok ? "ok" : "failed"}</span>
                                    {pageCues.length > 0 && <em>{pageCues.length} page cue{pageCues.length === 1 ? "" : "s"}</em>}
                                  </summary>
                                  <pre>{auditInputPreview(tool.input)}</pre>
                                  {toolError && <p className="agent-audit-error">{toolError.slice(0, 700)}</p>}
                                </details>
                              );
                            })}
                          </div>
                        )}
                        {safety && <p>{safety}</p>}
                        {draftFreshnessNote && <p className={`agent-audit-freshness-note ${draftFreshnessClass}`}>{draftFreshnessNote}</p>}
                        {isDraftInputStale && (
                          <AgentAuditRerunButton jobId={jobId} eventType={event.type} />
                        )}
                        {preview && <p>{preview.slice(0, 900)}</p>}
                        {missing.length > 0 && <p>Missing: {missing.join(", ")}</p>}
                        {blockers.length > 0 && <p>Blocked by: {blockers.join(", ")}</p>}
                        {note && <p>{note}</p>}
                        {reply && <p>{reply.slice(0, 900)}</p>}
                        {error && <p className="agent-audit-error">{error.slice(0, 500)}</p>}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          )}

          {job.targetPriceHistory.length > 0 && (
            <div className="card" data-agent-target="target-price">
              <div className="worktable-section-header">Target price history</div>
              <div className="record-row-list compact">
                {job.targetPriceHistory.map((entry) => (
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
          )}

          {/* Customer */}
          <div className="card">
            <div className="worktable-section-header">Customer</div>
            <div className="record-card-body">
              {job.company ? (
                <a href={`/dashboard/customers/${job.company.id}`} className="record-customer-link">
                  {job.company.name}
                </a>
              ) : (
                <span className="record-muted">No customer linked</span>
              )}
              {job.inquiry?.fromEmail && (
                <div className="record-small-muted">{job.inquiry.fromEmail}</div>
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

          {/* Forwarding: forwarder pricing */}
          {job.type === "FORWARDING" && (
          <div className="card" data-agent-target="carrier-rates">
            <div className="worktable-section-header">
              Forwarder pricing
              {receivedQuotes.length > 0 && (
                <span className="record-section-note">
                  {receivedQuotes.length} of {carrierQuotes.length} replied
                </span>
              )}
            </div>
            <div className="record-card-body compact">
              {!job.inquiry ? (
                <div className="record-empty-line">No source RFQ - pricing tracked manually.</div>
              ) : carrierQuotes.length === 0 ? (
                <div className="record-empty-line">No forwarder pricing requests sent yet.</div>
              ) : (
                <div className="record-row-list compact">
                  {carrierQuotes.map((q) => {
                    const total = q.total40HC ?? q.total40 ?? q.total20;
                    const isSelected = job.cost && total === job.cost;
                    return (
                      <div key={q.id} className="record-rate-row">
                        <div className="record-row-copy">
                          <div className="record-row-title">{q.carrier}</div>
                          <div className="record-row-meta">
                            {q.status === "PENDING" ? "Awaiting reply" : `${q.transitDays ? `${q.transitDays}d transit` : "-"}${q.service ? ` - ${q.service}` : ""}`}
                          </div>
                        </div>
                        <div className="record-row-actions">
                          {q.status === "RECEIVED" && total ? (
                            <span className="record-money">${total.toLocaleString()}</span>
                          ) : (
                            <span className="record-pending">pending</span>
                          )}
                          {isSelected && (
                            <span className="workbench-selected-badge inline">SELECTED</span>
                          )}
                          {!isSelected && q.status === "RECEIVED" && (
                            <form action={selectCarrierQuote.bind(null, jobId, q.id)}>
                              <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="...">Select</SubmitButton>
                            </form>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {pendingQuotes.length > 0 && receivedQuotes.length > 0 && (
                    <div className="record-empty-line subtle">
                      {pendingQuotes.length} more pending - desk is watching for replies.
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick add carrier rate (manual) */}
            {job.inquiry && (
              <details className="record-inline-details">
                <summary className="record-details-summary">
                  + Add forwarder price manually
                </summary>
                <form action={addCarrierQuote.bind(null, job.inquiry.id)} className="record-add-grid two">
                  <input name="carrier" placeholder="Forwarder name" required />
                  <input name="service" placeholder="Service" />
                  <input name="total40HC" type="number" placeholder="Total 40HC ($)" />
                  <input name="transitDays" type="number" placeholder="Transit days" />
                  <SubmitButton className="btn btn-secondary btn-sm record-grid-full" pendingLabel="Adding...">
                    Add price
                  </SubmitButton>
                </form>
              </details>
            )}
          </div>
          )}

          {/* Milestones */}
          <div className="card" data-agent-target="timeline">
            <div className="worktable-section-header">Milestones</div>
            <div className="record-card-body compact">
              {timelineMilestones.map((m) => {
                const isDone = !!m.actualAt;
                const isLate = m.plannedAt && !isDone && new Date(m.plannedAt) < today;
                return (
                  <div key={m.id} className="record-milestone-row">
                    <div className={["record-status-dot", isDone ? "done" : "", isLate ? "late" : ""].filter(Boolean).join(" ")}>
                      {isDone && <Icon name="check" size={10} strokeWidth={3} />}
                    </div>
                    <div className="record-row-copy">
                      <div className="record-row-title">
                        {MILESTONE_LABEL[m.type] ?? m.type}
                      </div>
                      <div className={["record-row-meta", isLate ? "late" : ""].filter(Boolean).join(" ")}>
                        {isDone ? `Done ${fmt(m.actualAt)}` : m.plannedAt ? `Planned ${fmt(m.plannedAt)}` : "No date set"}
                      </div>
                    </div>
                    {!isDone && (
                      <div className="record-inline-actions">
                        <form action={async (fd: FormData) => {
                          "use server";
                          const date = String(fd.get("plannedAt"));
                          if (date) await updateMilestonePlanned(m.id, date);
                        }} className="record-date-form">
                          <input type="date" name="plannedAt" defaultValue={fmtInput(m.plannedAt)} className="record-date-input" />
                          <SubmitButton className="btn btn-secondary btn-sm compact-btn" pendingLabel="...">Set</SubmitButton>
                        </form>
                        <form action={markMilestoneActual.bind(null, m.id)}>
                          <SubmitButton className="btn btn-sm compact-btn" pendingLabel="...">Mark done</SubmitButton>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Documents */}
          <div className="card" data-agent-target="documents">
            <div className="worktable-section-header">
              Documents
              <span className="record-section-note">
                {docs.filter((d) => d.status === "APPROVED").length}/{docs.length} approved
              </span>
            </div>
            <DocumentReadinessBoard docs={docs} title={`${job.reference} document control`} />
            <div className="record-card-body compact">
              {docs.map((d) => {
                let flags: string[] = [];
                let keyFields: Record<string, unknown> = {};
                if (d.aiFlags) { try { const x = JSON.parse(d.aiFlags); if (Array.isArray(x)) flags = x.filter((y) => typeof y === "string"); } catch {} }
                if (d.aiKeyFields) { try { const x = JSON.parse(d.aiKeyFields); if (x && typeof x === "object") keyFields = x; } catch {} }
                return (
                <div key={d.id} className="record-document-row">
                  <div className="record-document-top">
                    <div className={["record-doc-state", d.status.toLowerCase()].join(" ")}>
                      {d.status === "APPROVED" ? <Icon name="check" size={13} strokeWidth={2.5} />
                        : d.status === "UPLOADED" ? <Icon name="chevron-up" size={12} strokeWidth={2.5} />
                        : <Icon name="circle" size={9} strokeWidth={1.5} />}
                    </div>
                    <div className="record-row-copy">
                      <div className="record-row-title">{d.name}</div>
                      <div className="record-row-meta">
                        {DOC_TYPE_LABEL[d.docType] ?? d.docType} - {d.status.toLowerCase()}
                        {d.aiAnalyzedAt && <span className="record-ai-inline">AI commented</span>}
                      </div>
                    </div>
                    <div className="record-row-actions">
                      {d.url && d.status !== "PENDING" && (
                        <DocumentViewer documentId={d.id} name={d.name} status={d.status} />
                      )}
                      {d.status === "PENDING" && (
                        <form action={uploadJobDocument.bind(null, d.id)} className="record-upload-form">
                          <input
                            type="file"
                            name="file"
                            required
                            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,application/pdf,image/*"
                          />
                          <SubmitButton className="btn btn-secondary btn-sm" pendingLabel="Uploading...">Upload</SubmitButton>
                        </form>
                      )}
                      {d.status === "UPLOADED" && (
                        <form action={updateDocStatus.bind(null, d.id, "APPROVED")}>
                          <SubmitButton className="btn btn-sm" pendingLabel="...">Approve</SubmitButton>
                        </form>
                      )}
                    </div>
                  </div>
                  {(d.aiSummary || flags.length > 0) && (
                    <div className="record-ai-panel">
                      {d.aiSummary && (
                        <div className="record-ai-summary">
                          <span className="record-ai-label">AI</span>
                          {d.aiSummary}
                        </div>
                      )}
                      {flags.length > 0 && (
                        <div className="record-ai-flags">
                          {flags.map((f, i) => (
                            <div key={i} className="record-ai-flag">
                              <Icon name="alert" size={11} /><span>{f}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {Object.keys(keyFields).length > 0 && (
                        <details className="record-ai-details">
                          <summary className="record-ai-summary-toggle">
                            Extracted fields ({Object.keys(keyFields).length})
                          </summary>
                          <div className="record-keyfield-grid">
                            {Object.entries(keyFields).map(([k, v]) => (
                              <React.Fragment key={k}>
                                <span className="record-keyfield-key">{k}</span>
                                <span className="record-keyfield-value">{Array.isArray(v) ? v.join(", ") : String(v)}</span>
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
          <div className="card" data-agent-target="financials">
            <div className="worktable-section-header record-split-header">
              <span>Financials & Quote</span>
              <a href={`/api/jobs/${jobId}/quote-pdf`} target="_blank" className="record-header-link">
                <Icon name="external" size={11} /> Quote PDF
              </a>
            </div>
            <div className="record-financial-grid">
              <div className="record-financial-item">
                <div className="record-financial-label">Revenue</div>
                <div className="record-financial-value">{job.revenue ? `$${job.revenue.toLocaleString()}` : "-"}</div>
              </div>
              <div className="record-financial-item">
                <div className="record-financial-label">Cost</div>
                <div className="record-financial-value">{job.cost ? `$${job.cost.toLocaleString()}` : "-"}</div>
              </div>
              <div className="record-financial-item">
                <div className="record-financial-label">Margin</div>
                <div className="record-financial-value">
                  {job.revenue && job.cost ? `${(((job.revenue - job.cost) / job.revenue) * 100).toFixed(1)}%` : "-"}
                </div>
              </div>
            </div>

            {job.type === "FORWARDING" && (
              <div className="customer-quote-draft-slot">
                <CustomerQuoteDraftButton jobId={jobId} quoteReady={strategy?.quoteGate.canQuoteCustomer} />
              </div>
            )}

            {quoteLines.length > 0 && (
              <div className="record-line-items">
                <div className="record-line-title">
                  Line items
                </div>
                {quoteLines.map((l, i) => (
                  <div key={i} className="record-line-item">
                    <span>{l.desc}</span>
                    <strong>{l.amount.toLocaleString()} {l.cur}</strong>
                  </div>
                ))}
              </div>
            )}

            <details className="record-inline-details">
              <summary className="record-details-summary">
                + Add line item
              </summary>
              <form action={addQuoteLine.bind(null, jobId)} className="record-add-grid quote">
                <input name="description" placeholder="Description" required />
                <input name="amount" type="number" placeholder="Amount" required />
                <select name="currency" defaultValue="USD"><option>USD</option><option>EUR</option><option>TRY</option><option>GBP</option></select>
                <SubmitButton className="btn btn-secondary btn-sm record-grid-full" pendingLabel="Adding...">Add line</SubmitButton>
              </form>
            </details>
          </div>

        </div>
      </div>
    </div>
  );
}
