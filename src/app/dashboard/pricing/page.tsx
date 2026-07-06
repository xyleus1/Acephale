import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { CommercialChecklistAction } from "@/components/commercial-checklist-action";
import { CommercialChecklistRow } from "@/components/commercial-checklist-row";
import { CustomerQuoteDraftButton } from "@/components/customer-quote-draft-button";
import { Icon } from "@/components/icon";
import { MissingInfoDraftButton } from "@/components/missing-info-draft-button";
import { NegotiationPlanDraftButton } from "@/components/negotiation-plan-draft-button";
import { OpportunityScoreCard, OpportunityScorePill } from "@/components/opportunity-score-card";
import { requiredRfqMissing } from "@/lib/opportunity-score";
import { createWithFileReference } from "@/lib/references";
import { assessInquiryStrategy } from "@/lib/commercial-strategy-persistence";
import { recordTargetPriceHistory, targetPriceChanged } from "@/lib/target-price-history";
import { sendNewEmailFromAccount } from "@/lib/gmail-send";
import { coversForwarderMode, forwarderModeCoverageLabel } from "@/lib/forwarder-draft-core";
import { createForwarderRequestDrafts } from "@/lib/forwarder-drafts";
import { buildStrategyDecisionBrief, buildStrategyExecutionPacket, buildStrategyProofGaps, buildStrategyRouteDecision, type CommercialStrategy, type StrategyCommercialPriority, type StrategyDecisionContract, type StrategyDecisionContractItem, type StrategyEvidenceCheck, type StrategyOperatorDecision, type StrategyProofGap, type StrategyRouteDecisionRow } from "@/lib/commercial-strategy";
import { commercialChecklistItemsWithActions } from "@/lib/commercial-checklist-actions";
import { buildPricingCommandFactors, type PricingCommandFactor } from "@/lib/pricing-command-factors";
import { operatorMaturityLabel, operatorMetricLabel, operatorPhaseLabel, operatorToolLabel } from "@/lib/operator-action-labels";
import { canonicalInquiryStatus } from "@/lib/inquiry-status";
import { recordMemoryEvent } from "@/lib/memory/record-event";

type SearchParams = Promise<{ inquiry?: string }>;

const ALLOWED_FORWARDER_SENDER_EMAILS = ["mert@usederya.com", "oguzhan@usederya.com"];

const MAJOR_FORWARDERS = new Set([
  "DSV",
  "DHL",
  "KUEHNE+NAGEL",
  "KUEHNE NAGEL",
  "EXPEDITORS",
  "DB SCHENKER",
  "CEVA",
]);

const STATUS_META: Record<string, { label: string; className: string }> = {
  // Canonical RFQ statuses (see src/lib/inquiry-status.ts).
  BOOKED: { label: "Booked", className: "status-priced" },
  PRICING: { label: "Pricing", className: "status-priced" },
  MISSED: { label: "Missed ($)", className: "status-needs-info" },
  RECEIVED: { label: "Received", className: "status-ingested" },
  IGNORED: { label: "Ignored", className: "status-needs-info" },
  // Legacy values still on old rows.
  INGESTED: { label: "Received", className: "status-ingested" },
  PARSED: { label: "Received", className: "status-parsed" },
  NEEDS_INFO: { label: "Needs Info", className: "status-needs-info" },
  PRICED: { label: "Pricing", className: "status-priced" },
  QUOTED: { label: "Pricing", className: "status-sent" },
  WON: { label: "Booked", className: "status-priced" },
  LOST: { label: "Missed ($)", className: "status-needs-info" },
};

type CarrierQuoteRow = {
  id: string;
  carrier: string;
  quoteType: string;
  rateName: string | null;
  total20: number | null;
  total40: number | null;
  total40HC: number | null;
  transitDays: number | null;
  service: string | null;
  validity: string | null;
  transshipments: string | null;
  status: string;
};

type ForwarderRow = {
  id: string;
  name: string;
  email: string;
  modeCoverage: string | null;
  apiType: string;
  active: boolean;
  notes: string | null;
};

type ForwarderDraftRow = {
  id: string;
  forwarderName: string;
  toEmail: string;
  subject: string;
  body: string;
  status: string;
  sentByEmail: string | null;
  sentAt: Date | null;
  sendError: string | null;
  createdAt: Date;
};

type SenderAccountRow = {
  id: string;
  email: string;
};

type PricingCommandSummary = {
  score: number;
  band: CommercialStrategy["band"];
  confidence: CommercialStrategy["confidence"];
  commandLabel: string;
  commandReason: string;
  priority: StrategyOperatorDecision["priority"];
  phase: StrategyOperatorDecision["phase"];
  quoteGateStatus: CommercialStrategy["quoteGate"]["status"];
  quoteGateLabel: string;
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
  receivedQuotes: number;
  stale: boolean;
  source: "live" | "cached";
  playbookObjective: string;
  playbookFirstMove: string;
  playbookExactAsk: string | null;
  playbookEvidenceGap: string | null;
  playbookSafetyRule: string;
  playbookStopCondition: string;
  playbookToolHint: StrategyOperatorDecision["toolHint"];
  routeLabel: string | null;
  routeSummary: string | null;
  routeCostLabel: string | null;
  routeFreshnessLabel: string | null;
  routeCanQuoteCustomer: boolean | null;
  decisionQuality: StrategyEvidenceCheck | null;
  decisionContract: StrategyDecisionContract;
  commercialPriority: StrategyCommercialPriority;
  proofGaps: StrategyProofGap[];
  priorityFactors: PricingCommandFactor[];
};

type PricingFreshnessInquiry = {
  updatedAt: Date;
  receivedAt: Date;
  carrierQuotes: Array<{ status: string; updatedAt: Date }>;
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, className: "status-ingested" };
}

function initials(name: string) {
  const words = name.trim().split(/\s+/);
  return words.length >= 2
    ? (words[0][0] + words[words.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function money(value: number | null) {
  return value != null ? `$${value.toLocaleString()}` : "-";
}

function strategyMoney(value: number | null | undefined, currency: string) {
  return value != null && Number.isFinite(value) ? `${currency} ${Math.round(value).toLocaleString()}` : "-";
}

function quoteTotal(q: CarrierQuoteRow) {
  return q.total40HC ?? q.total40 ?? q.total20 ?? null;
}

function bestReceivedQuote(quotes: CarrierQuoteRow[]) {
  const received = quotes.filter((q) => q.status === "RECEIVED" && quoteTotal(q) != null);
  return received.reduce<CarrierQuoteRow | null>((best, q) => {
    if (!best) return q;
    return (quoteTotal(q) ?? Infinity) < (quoteTotal(best) ?? Infinity) ? q : best;
  }, null);
}

function hoursSince(value: Date | string | null | undefined) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 0;
  return Math.max(0, (Date.now() - date.getTime()) / 36e5);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDecisionQualityTone(value: string | null | undefined): StrategyEvidenceCheck["tone"] {
  if (value === "ready" || value === "review" || value === "blocked" || value === "info") return value;
  return "review";
}

function cachedDecisionQualitySummary(args: {
  brief: Record<string, unknown> | null;
  band: string | null | undefined;
  confidence: string | null | undefined;
  gateStatus: CommercialStrategy["quoteGate"]["status"] | null;
  stale: boolean;
  blockerCount: number;
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
  receivedQuotes: number;
}): StrategyEvidenceCheck {
  const fromBrief = isPlainRecord(args.brief?.decisionQuality) ? args.brief.decisionQuality : null;
  if (fromBrief) {
    return {
      key: "decision_quality",
      label: readString(fromBrief, "label") ?? "Decision quality",
      tone: normalizeDecisionQualityTone(readString(fromBrief, "tone")),
      metric: operatorMetricLabel(
        readString(fromBrief, "metric") ?? `${normalizeBand(args.band)} / ${normalizeConfidence(args.confidence)}`,
        readString(fromBrief, "tone")
      ),
      detail: readString(fromBrief, "detail") ?? "Decision-quality detail was not captured in this snapshot.",
    };
  }

  const weakInputs = [
    args.stale ? "snapshot is stale" : null,
    args.blockerCount > 0 ? `${args.blockerCount} RFQ blocker${args.blockerCount === 1 ? "" : "s"}` : null,
    args.gateStatus === "NEEDS_RATES" || args.receivedQuotes === 0 ? "live rates are missing" : null,
    args.guardrailStatus !== "PASS" ? `guardrail is ${args.guardrailStatus.toLowerCase().replace("_", " ")}` : null,
  ].filter((item): item is string => Boolean(item));
  const tone: StrategyEvidenceCheck["tone"] =
    args.gateStatus === "BLOCKED" || args.blockerCount > 0
      ? "blocked"
      : weakInputs.length > 0 || normalizeConfidence(args.confidence) === "low"
        ? "review"
        : "ready";

  return {
    key: "decision_quality",
    label: "Decision quality",
    tone,
    metric: `${normalizeBand(args.band)} / ${normalizeConfidence(args.confidence)}`,
    detail: weakInputs.length > 0
      ? `Cached recommendation can change because ${weakInputs.slice(0, 4).join("; ")}. Refresh before customer-facing use.`
      : "Cached recommendation has enough proof for the current next step.",
  };
}

function displayDecisionQuality(check: StrategyEvidenceCheck | null): StrategyEvidenceCheck | null {
  if (!check) return null;
  return {
    ...check,
    metric: operatorMetricLabel(check.metric, check.tone),
  };
}

function routeDecisionTone(row: StrategyRouteDecisionRow) {
  if (row.rateReliable === false) return "blocked";
  if (row.confidence === "high" && row.rateReliable === true) return "ready";
  if (row.confidence === "medium") return "review";
  return "rates";
}

function routeFreshnessLabel(row: StrategyRouteDecisionRow) {
  if (row.rateFreshnessStatus) return row.rateFreshnessStatus.replace(/_/g, " ");
  if (row.source === "LANE_RATE") return "benchmark";
  if (row.source === "HISTORY") return "history";
  return "unverified";
}

function normalizePriority(value: string | null | undefined): StrategyOperatorDecision["priority"] {
  return value === "critical" || value === "high" || value === "medium" || value === "low" ? value : "medium";
}

function priorityRank(value: string | null | undefined) {
  const priority = normalizePriority(value);
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function normalizeGuardrail(value: string | null | undefined): CommercialStrategy["price"]["guardrailStatus"] {
  return value === "PASS" || value === "REVIEW" || value === "BLOCKED" || value === "NEEDS_COST" ? value : "NEEDS_COST";
}

function normalizeBand(value: string | null | undefined): CommercialStrategy["band"] {
  return value === "A" || value === "B" || value === "C" || value === "D" ? value : "D";
}

function normalizeConfidence(value: string | null | undefined): CommercialStrategy["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizePhase(value: string | null | undefined): StrategyOperatorDecision["phase"] | null {
  if (
    value === "MATURE_RFQ"
    || value === "GET_RATES"
    || value === "APPROVE_ECONOMICS"
    || value === "QUOTE_CUSTOMER"
    || value === "PARK_DEAL"
  ) {
    return value;
  }
  return null;
}

function normalizeQuoteGateStatus(value: string | null | undefined): CommercialStrategy["quoteGate"]["status"] | null {
  if (
    value === "BLOCKED"
    || value === "NEEDS_RATES"
    || value === "REVIEW_REQUIRED"
    || value === "READY_TO_QUOTE"
  ) {
    return value;
  }
  return null;
}

function normalizeToolHint(value: string | null | undefined): StrategyOperatorDecision["toolHint"] {
  if (
    value === "draft_missing_info_request"
    || value === "create_forwarder_drafts"
    || value === "draft_customer_quote"
    || value === "draft_negotiation_plan"
    || value === "recommend_price"
    || value === "assess_strategy"
    || value === "none"
  ) {
    return value;
  }
  return "none";
}

function phaseFromAction(actionType: string | null | undefined): StrategyOperatorDecision["phase"] {
  if (actionType === "ASK_CUSTOMER") return "MATURE_RFQ";
  if (actionType === "REQUEST_RATES") return "GET_RATES";
  if (actionType === "COUNTER_FORWARDER") return "APPROVE_ECONOMICS";
  if (actionType === "QUOTE_CUSTOMER") return "QUOTE_CUSTOMER";
  return "PARK_DEAL";
}

function quoteGateStatusFromAction(actionType: string | null | undefined): CommercialStrategy["quoteGate"]["status"] {
  if (actionType === "ASK_CUSTOMER") return "BLOCKED";
  if (actionType === "REQUEST_RATES") return "NEEDS_RATES";
  if (actionType === "QUOTE_CUSTOMER") return "READY_TO_QUOTE";
  return "REVIEW_REQUIRED";
}

function commandLabelFromAction(actionType: string | null | undefined, fallback: string | null | undefined) {
  if (actionType === "ASK_CUSTOMER") return "Mature RFQ";
  if (actionType === "REQUEST_RATES") return "Get rates";
  if (actionType === "COUNTER_FORWARDER") return "Protect margin";
  if (actionType === "QUOTE_CUSTOMER") return "Quote customer";
  if (actionType === "ESCALATE") return "Review";
  if (actionType === "DECLINE") return "Park";
  return fallback || "Review RFQ";
}

function quoteGateLabelFromAction(actionType: string | null | undefined, fallback: string | null | undefined) {
  if (actionType === "ASK_CUSTOMER") return "Mature RFQ first";
  if (actionType === "REQUEST_RATES") return "Need live rates";
  if (actionType === "COUNTER_FORWARDER") return "Economics review";
  if (actionType === "QUOTE_CUSTOMER") return "Ready to quote";
  if (actionType === "ESCALATE") return "Review required";
  if (actionType === "DECLINE") return "Park deal";
  return fallback || "No assessment";
}

function fallbackPricingSafetyRule(args: {
  phase?: StrategyOperatorDecision["phase"] | null;
  gateStatus?: CommercialStrategy["quoteGate"]["status"] | null;
  requiresApproval?: boolean | null;
}) {
  if (args.gateStatus === "BLOCKED" || args.phase === "MATURE_RFQ") {
    return "Do not send to forwarders or quote the customer until these RFQ facts are explicit.";
  }
  if (args.gateStatus === "NEEDS_RATES" || args.phase === "GET_RATES") {
    return "Create reviewed drafts only; do not externally send rate requests without operator approval.";
  }
  if (args.gateStatus === "REVIEW_REQUIRED" || args.phase === "APPROVE_ECONOMICS" || args.requiresApproval) {
    return "Do not quote the customer until the margin or risk exception is approved.";
  }
  if (args.gateStatus === "READY_TO_QUOTE" || args.phase === "QUOTE_CUSTOMER") {
    return "Draft the customer quote for review; never send externally without user approval.";
  }
  return "Prepare the next artifact for review; do not send anything externally without user approval.";
}

function fallbackPricingStopCondition(args: {
  phase?: StrategyOperatorDecision["phase"] | null;
  requiresApproval?: boolean | null;
  blockers?: unknown[];
}) {
  if (args.requiresApproval) return "Stop after preparing the artifact and wait for approval.";
  if (args.phase === "MATURE_RFQ" && args.blockers?.length) {
    return "Stop after drafting the missing-info request; wait for the customer facts before forwarding or quoting.";
  }
  return "Stop after creating the review draft; no external side effects.";
}

function latestDecisionInputAt(inquiry: PricingFreshnessInquiry) {
  return inquiry.carrierQuotes.reduce((latest, quote) => {
    return quote.updatedAt.getTime() > latest.getTime() ? quote.updatedAt : latest;
  }, inquiry.updatedAt);
}

function commandContractItem(check: StrategyEvidenceCheck): StrategyDecisionContractItem {
  return {
    key: check.key,
    label: check.label,
    value: operatorMetricLabel(check.metric, check.tone),
    detail: check.detail,
    tone: check.tone,
  };
}

function cachedPricingDecisionContractSummary(args: {
  quoteGateStatus: CommercialStrategy["quoteGate"]["status"];
  blockerCount: number;
  firstBlockerAsk: string | null;
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
  requiresApproval: boolean;
  canRunNow: boolean | null;
  playbookObjective: string;
  playbookFirstMove: string;
  playbookSafetyRule: string;
  playbookStopCondition: string;
  decisionQuality: StrategyEvidenceCheck;
  stale: boolean;
}): StrategyDecisionContract {
  const blocked = args.quoteGateStatus === "BLOCKED"
    || args.guardrailStatus === "BLOCKED"
    || args.decisionQuality.tone === "blocked"
    || args.canRunNow === false
    || args.blockerCount > 0;
  const review = !blocked && (
    args.stale
    || args.quoteGateStatus === "NEEDS_RATES"
    || args.quoteGateStatus === "REVIEW_REQUIRED"
    || args.guardrailStatus === "REVIEW"
    || args.guardrailStatus === "NEEDS_COST"
    || args.requiresApproval
    || args.decisionQuality.tone === "review"
  );
  const state: StrategyDecisionContract["state"] = blocked ? "blocked" : review ? "review" : "ready";
  const firstBlocker = args.firstBlockerAsk
    ?? (args.blockerCount > 0 ? `${args.blockerCount} RFQ blocker${args.blockerCount === 1 ? "" : "s"} must clear.` : null);
  const proven: StrategyDecisionContractItem[] = [
    {
      key: "quote_gate",
      label: "Quote gate",
      value: args.quoteGateStatus,
      detail: args.playbookSafetyRule,
      tone: args.quoteGateStatus === "READY_TO_QUOTE" ? "ready" : args.quoteGateStatus === "NEEDS_RATES" ? "rates" : args.quoteGateStatus === "REVIEW_REQUIRED" ? "review" : "blocked",
    },
  ];
  if (args.decisionQuality.tone === "ready") proven.push(commandContractItem(args.decisionQuality));

  const assumptions: StrategyDecisionContractItem[] = [];
  if (args.decisionQuality.tone !== "ready") {
    assumptions.push({
      ...commandContractItem(args.decisionQuality),
      detail: `${args.decisionQuality.detail} Refresh strategy before using this for customer-facing work.`,
    });
  }
  if (args.stale) {
    assumptions.push({
      key: "stale_snapshot",
      label: "Snapshot age",
      value: "stale",
      detail: "This pricing command is based on a cached assessment older than the latest RFQ or rate input.",
      tone: "review",
    });
  }
  if (args.guardrailStatus !== "PASS") {
    assumptions.push({
      key: "guardrail",
      label: "Guardrail",
      value: args.guardrailStatus,
      detail: "Economics are not a clean pass, so customer-facing price work stays review-only.",
      tone: args.guardrailStatus === "BLOCKED" ? "blocked" : "review",
    });
  }

  return {
    state,
    title: state === "blocked"
      ? "Contract blocks queue execution"
      : state === "review"
        ? "Contract allows review only"
        : "Contract ready for reviewed action",
    summary: state === "blocked"
      ? `${firstBlocker ?? args.decisionQuality.detail} ${args.playbookStopCondition}`
      : state === "review"
        ? `${args.playbookObjective} is allowed as a review artifact; cached proof may still require approval or refresh.`
        : `${args.playbookObjective} can be prepared from the cached commercial assessment.`,
    proven: proven.slice(0, 4),
    assumptions: assumptions.slice(0, 5),
    allowedAgentMoves: state === "blocked"
      ? [`No agent execution until ${firstBlocker ?? "the listed blockers"} clear.`]
      : [
        `Prepare ${args.playbookObjective.toLowerCase()}.`,
        args.requiresApproval ? "Stop at reviewed draft or plan until approval is recorded." : "Stop at review artifact; no external send from the agent.",
      ],
    forbidden: [
      args.quoteGateStatus === "BLOCKED" ? "Do not send to forwarders." : null,
      args.quoteGateStatus === "READY_TO_QUOTE" ? null : "Do not quote the customer.",
      "Do not send external messages from the agent without operator approval.",
      args.requiresApproval ? "Do not execute past the review artifact until approval is recorded." : null,
    ].filter((item): item is string => Boolean(item)),
    nextHumanQuestion: args.firstBlockerAsk ?? (args.requiresApproval ? args.playbookStopCondition : null),
  };
}

function cachedCommercialPrioritySummary(args: {
  commandLabel: string;
  commandReason: string;
  quoteGateStatus: CommercialStrategy["quoteGate"]["status"];
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
  receivedQuotes: number;
  stale: boolean;
  firstAsk: string | null;
  decisionQuality: StrategyEvidenceCheck | null;
  routeLabel: string | null;
  routeSummary: string | null;
}): StrategyCommercialPriority {
  const tone: StrategyCommercialPriority["tone"] =
    args.quoteGateStatus === "BLOCKED" || args.guardrailStatus === "BLOCKED" || args.decisionQuality?.tone === "blocked"
      ? "blocked"
      : args.quoteGateStatus === "NEEDS_RATES"
        ? "rates"
        : args.quoteGateStatus === "REVIEW_REQUIRED" || args.guardrailStatus === "REVIEW" || args.stale || args.decisionQuality?.tone === "review"
          ? "review"
          : "ready";
  const label =
    args.quoteGateStatus === "BLOCKED" ? "Qualify before pricing" :
    args.guardrailStatus === "BLOCKED" ? "Economics blocked" :
    args.quoteGateStatus === "NEEDS_RATES" ? "Get live coverage" :
    tone === "review" ? "Review before quote" :
    "Quote-ready priority";
  const valueSignal = args.stale
    ? "Cached value needs refresh before customer-facing use"
    : "Cached assessment has no exact value signal";
  const economicUnlock =
    args.firstAsk ??
    (args.guardrailStatus !== "PASS"
      ? "Review economics before any customer-facing quote."
      : args.quoteGateStatus === "NEEDS_RATES"
        ? "Get current forwarder proof before pricing the customer."
        : "Use the current command, but refresh if RFQ facts or rates changed.");
  const nextProof = args.decisionQuality
    ? `${args.decisionQuality.label}: ${args.decisionQuality.detail}`
    : "Cached command has no detailed proof audit.";
  const checklist: StrategyCommercialPriority["checklist"] = [
    args.quoteGateStatus === "BLOCKED"
      ? {
        key: "qualify",
        label: "Clear RFQ blocker",
        owner: "CUSTOMER",
        action: args.firstAsk ?? args.commandReason,
        why: "Cached command is blocked before pricing or forwarder work.",
        stopRule: "Do not request rates or quote until the blocker is explicit.",
        target: "blocker-resolution",
        tone: "blocked",
        done: false,
      }
      : args.quoteGateStatus === "NEEDS_RATES"
        ? {
          key: "rates",
          label: "Get live route proof",
          owner: "FORWARDER",
          action: economicUnlock,
          why: args.routeSummary ?? "Cached assessment says customer pricing needs current route evidence.",
          stopRule: "Do not quote customer from stale or missing buy cost.",
          target: "movement",
          tone: "rates",
          done: false,
        }
        : args.guardrailStatus !== "PASS"
          ? {
            key: "economics",
            label: "Review economics",
            owner: "INTERNAL",
            action: economicUnlock,
            why: args.commandReason,
            stopRule: "Wait before customer quote until economics are approved.",
            target: "financials",
            tone: args.guardrailStatus === "BLOCKED" ? "blocked" : "review",
            done: false,
          }
          : {
            key: "agent",
            label: "Run reviewed artifact",
            owner: "INTERNAL",
            action: args.commandLabel,
            why: args.commandReason,
            stopRule: "Keep this at review output; external sends stay operator-controlled.",
            target: "agent-action",
            tone: args.stale ? "review" : "ready",
            done: false,
          },
  ];

  return {
    tone,
    label,
    headline: args.commandLabel,
    whyNow: `${valueSignal}; ${args.commandReason}`,
    valueSignal,
    economicUnlock,
    nextProof,
    riskTradeoff: args.routeSummary ?? "Cached route/risk detail is limited; refresh strategy before external output.",
    checklist,
    rows: [
      {
        key: "value",
        label: "Money at stake",
        value: valueSignal,
        detail: "Old snapshots intentionally avoid inventing margin or target economics.",
        tone: args.stale ? "review" : "info",
      },
      {
        key: "margin",
        label: "Margin unlock",
        value: args.guardrailStatus.toLowerCase().replace(/_/g, " "),
        detail: economicUnlock,
        tone: args.guardrailStatus === "PASS" ? "ready" : args.guardrailStatus === "NEEDS_COST" ? "rates" : args.guardrailStatus === "REVIEW" ? "review" : "blocked",
      },
      {
        key: "route",
        label: "Route proof",
        value: args.routeLabel ?? `${args.receivedQuotes} received quote${args.receivedQuotes === 1 ? "" : "s"}`,
        detail: args.routeSummary ?? "Cached route summary is not available.",
        tone: args.quoteGateStatus === "NEEDS_RATES" ? "rates" : args.receivedQuotes > 0 ? "review" : "blocked",
      },
      {
        key: "proof",
        label: "Next proof",
        value: args.decisionQuality ? operatorMetricLabel(args.decisionQuality.metric, args.decisionQuality.tone) : "No audit",
        detail: nextProof,
        tone: args.decisionQuality?.tone ?? "info",
      },
    ],
  };
}

function cachedProofGapsSummary(args: {
  quoteGateStatus: CommercialStrategy["quoteGate"]["status"];
  guardrailStatus: CommercialStrategy["price"]["guardrailStatus"];
  receivedQuotes: number;
  stale: boolean;
  commandReason: string;
  decisionQuality: StrategyEvidenceCheck | null;
}): StrategyProofGap[] {
  const checks: StrategyEvidenceCheck[] = [];
  if (args.quoteGateStatus === "BLOCKED") {
    checks.push({
      key: "rfq",
      label: "RFQ gate",
      tone: "blocked",
      metric: "Blocked",
      detail: args.commandReason,
    });
  }
  if (args.quoteGateStatus === "NEEDS_RATES" || args.receivedQuotes === 0) {
    checks.push({
      key: "coverage",
      label: "Forwarder coverage",
      tone: args.quoteGateStatus === "NEEDS_RATES" ? "review" : "blocked",
      metric: `${args.receivedQuotes} received`,
      detail: "Cached assessment does not prove enough live forwarder coverage for customer pricing.",
    });
  }
  if (args.guardrailStatus !== "PASS") {
    checks.push({
      key: "economics",
      label: "Economics",
      tone: args.guardrailStatus === "BLOCKED" ? "blocked" : "review",
      metric: args.guardrailStatus,
      detail: "Cached economics are not a clean pass; review buy cost, floor, margin, and target pressure.",
    });
  }
  if (args.stale || (args.decisionQuality && args.decisionQuality.tone !== "ready")) {
    checks.push({
      key: "decision_quality",
      label: "Decision quality",
      tone: args.decisionQuality?.tone === "blocked" ? "blocked" : "review",
      metric: args.stale ? "stale" : args.decisionQuality?.metric ?? "Needs proof",
      detail: args.stale
        ? "Cached strategy is older than the latest RFQ or rate input; refresh before acting."
        : args.decisionQuality?.detail ?? "Decision quality needs review before acting.",
    });
  }
  return buildStrategyProofGaps(checks);
}

function commandSummaryFromLive(strategy: CommercialStrategy): PricingCommandSummary {
  const decisionBrief = buildStrategyDecisionBrief(strategy);
  const executionPacket = buildStrategyExecutionPacket(strategy);
  const routeDecision = buildStrategyRouteDecision(strategy);
  const selectedRoute = routeDecision.selected;
  const playbook = decisionBrief.operatorPlaybook;
  const blockerCount = strategy.blockerResolutionPlan.length;
  const decisionQuality = displayDecisionQuality(decisionBrief.decisionQuality);
  return {
    score: strategy.score,
    band: strategy.band,
    confidence: strategy.confidence,
    commandLabel: strategy.operatorDecision.ctaLabel,
    commandReason: strategy.decisionReasons[0]?.summary ?? strategy.operatorDecision.rationale,
    priority: strategy.operatorDecision.priority,
    phase: strategy.operatorDecision.phase,
    quoteGateStatus: strategy.quoteGate.status,
    quoteGateLabel: strategy.quoteGate.label,
    guardrailStatus: strategy.price.guardrailStatus,
    receivedQuotes: strategy.evidence.coveragePosture.receivedQuotes,
    stale: false,
    source: "live",
    playbookObjective: playbook.objective,
    playbookFirstMove: playbook.firstMove,
    playbookExactAsk: playbook.exactAsk,
    playbookEvidenceGap: playbook.evidenceGap,
    playbookSafetyRule: playbook.safetyRule,
    playbookStopCondition: playbook.stopCondition,
    playbookToolHint: strategy.operatorDecision.toolHint,
    routeLabel: selectedRoute?.label ?? null,
    routeSummary: routeDecision.summary,
    routeCostLabel: selectedRoute?.costLabel ?? null,
    routeFreshnessLabel: selectedRoute ? routeFreshnessLabel(selectedRoute) : null,
    routeCanQuoteCustomer: routeDecision.canQuoteCustomer,
    decisionQuality,
    decisionContract: executionPacket.contract,
    commercialPriority: executionPacket.commercialPriority,
    proofGaps: executionPacket.evidence.gaps,
    priorityFactors: buildPricingCommandFactors({
      phase: strategy.operatorDecision.phase,
      blockerCount,
      guardrailStatus: strategy.price.guardrailStatus,
      receivedQuotes: strategy.evidence.coveragePosture.receivedQuotes,
      band: strategy.band,
      confidence: strategy.confidence,
      decisionQuality,
      stale: false,
    }),
  };
}

function commandSummaryFromCached(
  assessment: {
    score: number;
    band: string;
    confidence: string;
    recommendation: string;
    recommendationLabel: string;
    strategyMemo: string;
    evidence: unknown;
    decisionBrief: unknown;
    createdAt: Date;
    priceRecommendation: { guardrailStatus: string } | null;
    actions: Array<{ actionType: string; priority: string; title: string; rationale: string }>;
  },
  inquiry: PricingFreshnessInquiry,
): PricingCommandSummary {
  const primaryAction = [...assessment.actions].sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))[0] ?? null;
  const actionType = primaryAction?.actionType ?? assessment.recommendation;
  const evidence = isPlainRecord(assessment.evidence) ? assessment.evidence : {};
  const coverage = isPlainRecord(evidence.coveragePosture) ? evidence.coveragePosture : null;
  const receivedQuotes = readNumber(coverage, "receivedQuotes")
    ?? readNumber(evidence, "receivedQuotes")
    ?? inquiry.carrierQuotes.filter((quote) => quote.status === "RECEIVED").length;
  const target = isPlainRecord(evidence.targetPosture) ? evidence.targetPosture : null;
  const decisionBrief = isPlainRecord(assessment.decisionBrief) ? assessment.decisionBrief : null;
  const nextAction = isPlainRecord(decisionBrief?.nextAction) ? decisionBrief.nextAction : null;
  const economics = isPlainRecord(decisionBrief?.economics) ? decisionBrief.economics : null;
  const playbook = isPlainRecord(decisionBrief?.operatorPlaybook) ? decisionBrief.operatorPlaybook : null;
  const route = isPlainRecord(decisionBrief?.route) ? decisionBrief.route : null;
  const blockingQuestions = Array.isArray(decisionBrief?.blockingQuestions) ? decisionBrief.blockingQuestions : [];
  const blockerCount = readNumber(decisionBrief, "blockerCount") ?? blockingQuestions.length;
  const firstBlockingQuestion = isPlainRecord(blockingQuestions[0]) ? blockingQuestions[0] : null;
  const phase = normalizePhase(readString(decisionBrief, "phase")) ?? phaseFromAction(actionType);
  const quoteGateStatus = normalizeQuoteGateStatus(readString(decisionBrief, "gateStatus")) ?? quoteGateStatusFromAction(actionType);
  const requiresApproval = readString(nextAction, "requiresApproval") === "true" || nextAction?.requiresApproval === true;
  const canRunNow = typeof nextAction?.canRunNow === "boolean" ? nextAction.canRunNow : null;
  const commandReason = primaryAction?.rationale
    || readString(decisionBrief, "nextCommand")
    || readString(target, "stance")
    || assessment.strategyMemo
    || "Cached commercial assessment";
  const priority = normalizePriority(readString(nextAction, "priority") ?? primaryAction?.priority);
  const band = normalizeBand(readString(decisionBrief, "band") ?? assessment.band);
  const confidence = normalizeConfidence(readString(decisionBrief, "confidence") ?? assessment.confidence);
  const guardrailStatus = normalizeGuardrail(readString(economics, "guardrailStatus") ?? assessment.priceRecommendation?.guardrailStatus);
  const stale = assessment.createdAt.getTime() < latestDecisionInputAt(inquiry).getTime();
  const decisionQuality = cachedDecisionQualitySummary({
    brief: decisionBrief,
    band,
    confidence,
    gateStatus: quoteGateStatus,
    stale,
    blockerCount,
    guardrailStatus,
    receivedQuotes,
  });
  const playbookObjective = readString(playbook, "objective") ?? readString(nextAction, "label") ?? commandLabelFromAction(actionType, assessment.recommendationLabel);
  const playbookFirstMove = readString(playbook, "firstMove") ?? readString(decisionBrief, "nextCommand") ?? commandReason;
  const playbookExactAsk = readString(playbook, "exactAsk") ?? readString(firstBlockingQuestion, "ask");
  const playbookSafetyRule = readString(playbook, "safetyRule") ?? fallbackPricingSafetyRule({ phase, gateStatus: quoteGateStatus, requiresApproval });
  const playbookStopCondition = readString(playbook, "stopCondition") ?? fallbackPricingStopCondition({ phase, requiresApproval, blockers: blockingQuestions });
  const playbookToolHint = normalizeToolHint(readString(playbook, "toolHint") ?? readString(nextAction, "toolHint"));
  const commandLabel = readString(nextAction, "label") ?? commandLabelFromAction(actionType, assessment.recommendationLabel);
  const decisionContract = cachedPricingDecisionContractSummary({
    quoteGateStatus,
    blockerCount,
    firstBlockerAsk: playbookExactAsk,
    guardrailStatus,
    requiresApproval,
    canRunNow,
    playbookObjective,
    playbookFirstMove,
    playbookSafetyRule,
    playbookStopCondition,
    decisionQuality,
    stale,
  });

  return {
    score: readNumber(decisionBrief, "score") ?? assessment.score,
    band,
    confidence,
    commandLabel,
    commandReason,
    priority,
    phase,
    quoteGateStatus,
    quoteGateLabel: readString(decisionBrief, "verdict") ?? quoteGateLabelFromAction(actionType, assessment.recommendationLabel),
    guardrailStatus,
    receivedQuotes,
    stale,
    source: "cached",
    playbookObjective,
    playbookFirstMove,
    playbookExactAsk,
    playbookEvidenceGap: readString(playbook, "evidenceGap"),
    playbookSafetyRule,
    playbookStopCondition,
    playbookToolHint,
    routeLabel: readString(route, "label"),
    routeSummary: readString(route, "tradeoff"),
    routeCostLabel: null,
    routeFreshnessLabel: readString(route, "confidence"),
    routeCanQuoteCustomer: quoteGateStatus === "READY_TO_QUOTE",
    decisionQuality,
    decisionContract,
    commercialPriority: cachedCommercialPrioritySummary({
      commandLabel,
      commandReason,
      quoteGateStatus,
      guardrailStatus,
      receivedQuotes,
      stale,
      firstAsk: playbookExactAsk,
      decisionQuality,
      routeLabel: readString(route, "label"),
      routeSummary: readString(route, "tradeoff"),
    }),
    proofGaps: cachedProofGapsSummary({
      quoteGateStatus,
      guardrailStatus,
      receivedQuotes,
      stale,
      commandReason,
      decisionQuality,
    }),
    priorityFactors: buildPricingCommandFactors({
      phase,
      blockerCount,
      guardrailStatus,
      receivedQuotes,
      band,
      confidence,
      decisionQuality,
      stale,
    }),
  };
}

function pricingCommandRank(summary: PricingCommandSummary | null, receivedAt: Date | string | null | undefined) {
  if (!summary) return hoursSince(receivedAt) * 0.5;
  const phaseWeight: Record<StrategyOperatorDecision["phase"], number> = {
    QUOTE_CUSTOMER: 520,
    APPROVE_ECONOMICS: 480,
    GET_RATES: 440,
    MATURE_RFQ: 420,
    PARK_DEAL: 80,
  };
  const priorityWeight: Record<StrategyOperatorDecision["priority"], number> = {
    critical: 220,
    high: 160,
    medium: 90,
    low: 35,
  };
  const gateWeight: Record<CommercialStrategy["quoteGate"]["status"], number> = {
    READY_TO_QUOTE: 170,
    REVIEW_REQUIRED: 135,
    NEEDS_RATES: 110,
    BLOCKED: 85,
  };
  const economicsWeight: Record<CommercialStrategy["price"]["guardrailStatus"], number> = {
    PASS: 70,
    REVIEW: 55,
    NEEDS_COST: 35,
    BLOCKED: 20,
  };
  const staleBoost = Math.min(80, hoursSince(receivedAt) / 3);
  const stalePenalty = summary.stale ? 30 : 0;
  return phaseWeight[summary.phase]
    + priorityWeight[summary.priority]
    + gateWeight[summary.quoteGateStatus]
    + economicsWeight[summary.guardrailStatus]
    + summary.score
    + staleBoost
    - stalePenalty;
}

function pricingCommandTone(priority?: StrategyOperatorDecision["priority"]) {
  if (priority === "critical" || priority === "high") return "hot";
  if (priority === "medium") return "review";
  return "steady";
}

export default async function PricingPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const sp = await searchParams;

  const [inquiries, marginProfiles, forwarders, senderAccounts] = await Promise.all([
    prisma.inquiry.findMany({
      where: { officeId: session.officeId },
      include: {
        company: { select: { id: true, name: true } },
        job: { select: { id: true, reference: true, status: true } },
        carrierQuotes: { orderBy: { createdAt: "asc" } },
        forwarderDrafts: { orderBy: { createdAt: "desc" }, take: 20 },
      },
      orderBy: { receivedAt: "desc" },
    }),
    prisma.marginProfile.findMany({
      where: { officeId: session.officeId },
      orderBy: { marginPercent: "asc" },
      take: 1,
    }),
    prisma.forwarder.findMany({
      where: { officeId: session.officeId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    prisma.emailAccount.findMany({
      where: {
        officeId: session.officeId,
        provider: "GMAIL",
        isActive: true,
        email: { in: ALLOWED_FORWARDER_SENDER_EMAILS },
      },
      select: { id: true, email: true },
      orderBy: { email: "asc" },
    }),
  ]);

  const latestAssessments = inquiries.length > 0
    ? await prisma.strategyAssessment.findMany({
        where: {
          officeId: session.officeId,
          status: "ACTIVE",
          inquiryId: { in: inquiries.map((inquiry) => inquiry.id) },
        },
        include: {
          priceRecommendation: { select: { guardrailStatus: true } },
          actions: {
            where: { status: "PROPOSED" },
            orderBy: { createdAt: "asc" },
            take: 6,
            select: { actionType: true, priority: true, title: true, rationale: true },
          },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const assessmentByInquiryId = new Map<string, (typeof latestAssessments)[number]>();
  for (const assessment of latestAssessments) {
    if (assessment.inquiryId && !assessmentByInquiryId.has(assessment.inquiryId)) {
      assessmentByInquiryId.set(assessment.inquiryId, assessment);
    }
  }
  const commandSummaryByInquiryId = new Map<string, PricingCommandSummary>();
  for (const inquiry of inquiries) {
    const assessment = assessmentByInquiryId.get(inquiry.id);
    if (assessment) commandSummaryByInquiryId.set(inquiry.id, commandSummaryFromCached(assessment, inquiry));
  }

  const sortInquiriesByCommand = (items: typeof inquiries) => [...items].sort((a, b) => {
    const byCommand = pricingCommandRank(commandSummaryByInquiryId.get(b.id) ?? null, b.receivedAt)
      - pricingCommandRank(commandSummaryByInquiryId.get(a.id) ?? null, a.receivedAt);
    if (Math.abs(byCommand) > 0.001) return byCommand;
    return b.receivedAt.getTime() - a.receivedAt.getTime();
  });
  let rankedInquiries = sortInquiriesByCommand(inquiries);

  let selectedInquiry = sp.inquiry
    ? inquiries.find((i) => i.id === sp.inquiry) ?? null
    : rankedInquiries[0] ?? null;
  const liveStrategyByInquiryId = new Map<string, CommercialStrategy | null>();
  const ensureLiveStrategy = async (inquiryId: string) => {
    if (!liveStrategyByInquiryId.has(inquiryId)) {
      liveStrategyByInquiryId.set(
        inquiryId,
        (await assessInquiryStrategy(session.officeId, inquiryId))?.strategy ?? null,
      );
    }
    return liveStrategyByInquiryId.get(inquiryId) ?? null;
  };
  if (selectedInquiry) {
    const liveStrategy = await ensureLiveStrategy(selectedInquiry.id);
    if (liveStrategy) commandSummaryByInquiryId.set(selectedInquiry.id, commandSummaryFromLive(liveStrategy));
  }
  rankedInquiries = sortInquiriesByCommand(inquiries);
  if (!sp.inquiry && rankedInquiries[0] && rankedInquiries[0].id !== selectedInquiry?.id) {
    selectedInquiry = rankedInquiries[0];
    const liveStrategy = await ensureLiveStrategy(selectedInquiry.id);
    if (liveStrategy) commandSummaryByInquiryId.set(selectedInquiry.id, commandSummaryFromLive(liveStrategy));
    rankedInquiries = sortInquiriesByCommand(inquiries);
  }

  async function addInquiryAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const subject = String(formData.get("subject") ?? "").trim();
    const fromEmail = String(formData.get("fromEmail") ?? "").trim() || null;
    const fromCompany = String(formData.get("fromCompany") ?? "").trim() || null;
    const rawEmailBody = String(formData.get("rawEmailBody") ?? "").trim() || null;
    const targetPrice = formData.get("targetPrice") ? Number(formData.get("targetPrice")) : null;
    if (!subject) return;

    const targetCurrency = String(formData.get("targetCurrency") || "USD");
    const targetPriceStatus = targetPrice != null ? "PROVIDED" : String(formData.get("targetPriceStatus") || "UNKNOWN");
    const targetPriceSource = String(formData.get("targetPriceSource") || "").trim() || null;
    const inquiry = await createWithFileReference(s.officeId, (reference) => prisma.inquiry.create({
      data: {
        officeId: s.officeId,
        reference,
        subject,
        fromEmail,
        fromCompany,
        origin: String(formData.get("origin") ?? "").trim() || null,
        destination: String(formData.get("destination") ?? "").trim() || null,
        mode: String(formData.get("mode") ?? "").trim() || null,
        containerType: String(formData.get("containerType") ?? "").trim() || null,
        rawEmailBody,
        targetPrice,
        targetCurrency,
        targetPriceStatus,
        targetPriceSource,
        status: "INGESTED",
      },
    }));
    await recordMemoryEvent({
      officeId: s.officeId,
      sourceType: "INQUIRY",
      sourceExternalId: `pricing_desk:${inquiry.id}`,
      eventType: "inquiry.created",
      entityType: "inquiry",
      entityId: inquiry.id,
      actorType: "user",
      actorId: s.userId,
      occurredAt: inquiry.createdAt,
      payloadVersion: 1,
      payload: { inquiryId: inquiry.id, subject, fromEmail, fromCompany, targetPrice, targetCurrency, targetPriceStatus, source: "pricing_desk" },
      provenance: {
        source: "pricing_desk",
        operation: "create_inquiry",
        path: "src/app/dashboard/pricing/page.tsx",
        function: "addInquiryAction",
        sourceRecordId: inquiry.id,
        actorType: "user",
        actorId: s.userId,
      },
      idempotencyKey: `inquiry:${inquiry.id}:pricing_created`,
    }).catch(() => null);
    if (targetPrice != null || targetPriceStatus === "NO_TARGET") {
      await recordTargetPriceHistory({
        officeId: s.officeId,
        inquiryId: inquiry.id,
        createdByUserId: s.userId,
        amount: targetPrice,
        currency: targetCurrency,
        status: targetPriceStatus,
        source: targetPriceSource,
        note: "Pricing desk RFQ creation.",
      });
    }
    revalidatePath("/dashboard/pricing");
  }

  async function deleteInquiryAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const id = String(formData.get("id") ?? "");
    await prisma.inquiry.delete({ where: { id, officeId: s.officeId } });
    revalidatePath("/dashboard/pricing");
  }

  async function updateInquiryStatusAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "");
    if (!id || !status) return;
    const updated = await prisma.inquiry.update({ where: { id, officeId: s.officeId }, data: { status } });
    await recordMemoryEvent({
      officeId: s.officeId,
      sourceType: "INQUIRY",
      sourceExternalId: `pricing_desk:${id}`,
      eventType: "inquiry.status_updated",
      entityType: "inquiry",
      entityId: id,
      actorType: "user",
      actorId: s.userId,
      occurredAt: updated.updatedAt,
      payloadVersion: 1,
      payload: { inquiryId: id, status, source: "pricing_desk" },
      provenance: {
        source: "pricing_desk",
        operation: "update_inquiry_status",
        path: "src/app/dashboard/pricing/page.tsx",
        function: "updateInquiryStatusAction",
        sourceRecordId: id,
        actorType: "user",
        actorId: s.userId,
      },
      idempotencyKey: `inquiry:${id}:pricing_status:${status}:${updated.updatedAt.toISOString()}`,
    }).catch(() => null);
    revalidatePath("/dashboard/pricing");
    revalidatePath(`/dashboard/rfq/${id}`);
  }

  async function updateTargetPriceAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    const before = await prisma.inquiry.findFirst({
      where: { id, officeId: s.officeId },
      select: { targetPrice: true, targetCurrency: true, targetPriceStatus: true, targetPriceSource: true },
    });
    if (!before) return;
    const targetPrice = formData.get("targetPrice") ? Number(formData.get("targetPrice")) : null;
    const data = {
      targetPrice,
      targetCurrency: String(formData.get("targetCurrency") || "USD"),
      targetPriceStatus: targetPrice != null ? "PROVIDED" : String(formData.get("targetPriceStatus") || "UNKNOWN"),
      targetPriceSource: String(formData.get("targetPriceSource") || "").trim() || null,
    };
    const updated = await prisma.inquiry.update({
      where: { id, officeId: s.officeId },
      data,
    });
    await recordMemoryEvent({
      officeId: s.officeId,
      sourceType: "INQUIRY",
      sourceExternalId: `pricing_desk:${id}`,
      eventType: "inquiry.target_price_updated",
      entityType: "inquiry",
      entityId: id,
      actorType: "user",
      actorId: s.userId,
      occurredAt: updated.updatedAt,
      payloadVersion: 1,
      payload: { inquiryId: id, ...data, previous: before, source: "pricing_desk" },
      provenance: {
        source: "pricing_desk",
        operation: "update_target_price",
        path: "src/app/dashboard/pricing/page.tsx",
        function: "updateTargetPriceAction",
        sourceRecordId: id,
        actorType: "user",
        actorId: s.userId,
      },
      idempotencyKey: `inquiry:${id}:target_price:${updated.updatedAt.toISOString()}`,
    }).catch(() => null);
    if (targetPriceChanged(before, data)) {
      await recordTargetPriceHistory({
        officeId: s.officeId,
        inquiryId: id,
        createdByUserId: s.userId,
        amount: data.targetPrice,
        currency: data.targetCurrency,
        status: data.targetPriceStatus,
        source: data.targetPriceSource,
        note: "Pricing desk target update.",
      });
    }
    revalidatePath("/dashboard/pricing");
    revalidatePath(`/dashboard/rfq/${id}`);
  }

  async function addCarrierQuoteAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const inquiryId = String(formData.get("inquiryId") ?? "");
    const carrier = String(formData.get("carrier") ?? "").trim();
    const quoteType = String(formData.get("quoteType") ?? "EMAIL");
    const rateName = String(formData.get("rateName") ?? "").trim() || null;
    const total20 = Number(formData.get("total20") || 0) || null;
    const total40 = Number(formData.get("total40") || 0) || null;
    const total40HC = Number(formData.get("total40HC") || 0) || null;
    const transitDays = Number(formData.get("transitDays") || 0) || null;
    const service = String(formData.get("service") ?? "").trim() || null;
    const validity = String(formData.get("validity") ?? "").trim() || null;
    const transshipments = String(formData.get("transshipments") ?? "").trim() || null;
    const status = total20 || total40 || total40HC ? "RECEIVED" : "PENDING";
    if (!inquiryId || !carrier) return;
    // Tenant guard: the inquiry must belong to the caller's office (a carrier
    // quote is scoped only via this relation, so an unvalidated inquiryId would
    // let one office attach/poison a quote on another office's inquiry).
    const inquiry = await prisma.inquiry.findFirst({
      where: { id: inquiryId, officeId: s.officeId },
      select: { id: true },
    });
    if (!inquiry) return;
    // Ingest sanity: reject non-positive rates. Carrier rates that price the
    // customer quote must be a positive number; 0/negative is invalid data.
    for (const rate of [total20, total40, total40HC]) {
      if (rate != null && rate <= 0) return;
    }
    await prisma.carrierQuote.create({
      data: {
        inquiryId,
        carrier,
        quoteType,
        rateName,
        total20,
        total40,
        total40HC,
        transitDays,
        service,
        validity,
        transshipments,
        status,
      },
    });
    revalidatePath("/dashboard/pricing");
    revalidatePath(`/dashboard/rfq/${inquiryId}`);
  }

  async function deleteCarrierQuoteAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    // Tenant guard: only delete a quote whose inquiry is in the caller's office.
    await prisma.carrierQuote.deleteMany({
      where: { id, inquiry: { officeId: s.officeId } },
    });
    revalidatePath("/dashboard/pricing");
  }

  async function addForwarderAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const name = String(formData.get("name") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const modeCoverage = String(formData.get("modeCoverage") ?? "").trim().toUpperCase() || null;
    const apiType = String(formData.get("apiType") ?? "EMAIL").trim().toUpperCase() || "EMAIL";
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!name || !email) return;
    await prisma.forwarder.upsert({
      where: { officeId_email: { officeId: s.officeId, email } },
      create: { officeId: s.officeId, name, email, modeCoverage, apiType, notes, active: true },
      update: { name, modeCoverage, apiType, notes, active: true },
    });
    revalidatePath("/dashboard/pricing");
  }

  async function toggleForwarderAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const id = String(formData.get("id") ?? "");
    const active = String(formData.get("active") ?? "") === "true";
    if (!id) return;
    await prisma.forwarder.updateMany({
      where: { id, officeId: s.officeId },
      data: { active },
    });
    revalidatePath("/dashboard/pricing");
  }

  async function createForwarderDraftsAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const inquiryId = String(formData.get("inquiryId") ?? "");
    const selectedIds = formData.getAll("forwarderId").map((v) => String(v)).filter(Boolean);
    if (!inquiryId) return;
    const result = await createForwarderRequestDrafts({
      officeId: s.officeId,
      userId: s.userId,
      inquiryId,
      forwarderIds: selectedIds,
      recordBlockedNote: true,
    });
    revalidatePath("/dashboard/pricing");
    if (result.inquiry) revalidatePath(`/dashboard/rfq/${result.inquiry.id}`);
  }

  async function discardForwarderDraftAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await prisma.forwarderRequestDraft.updateMany({
      where: { id, officeId: s.officeId },
      data: { status: "DISCARDED" },
    });
    revalidatePath("/dashboard/pricing");
  }

  async function sendForwarderDraftAction(formData: FormData) {
    "use server";
    const s = await requireSession();
    const id = String(formData.get("id") ?? "");
    const accountId = String(formData.get("accountId") ?? "");
    if (!id) return;

    const draft = await prisma.forwarderRequestDraft.findFirst({
      where: { id, officeId: s.officeId, status: "DRAFT" },
      include: { inquiry: { include: { job: { select: { id: true } } } } },
    });
    if (!draft) return;

    const fail = async (message: string) => {
      await prisma.forwarderRequestDraft.update({
        where: { id: draft.id },
        data: { sendError: message },
      });
      revalidatePath("/dashboard/pricing");
      revalidatePath(`/dashboard/rfq/${draft.inquiryId}`);
    };

    const account = accountId
      ? await prisma.emailAccount.findFirst({
          where: {
            id: accountId,
            officeId: s.officeId,
            provider: "GMAIL",
            isActive: true,
            email: { in: ALLOWED_FORWARDER_SENDER_EMAILS },
          },
          select: { id: true, email: true },
        })
      : null;
    if (!account) {
      await fail(`Connect or select one allowed sender first: ${ALLOWED_FORWARDER_SENDER_EMAILS.join(", ")}.`);
      return;
    }

    const missing = requiredRfqMissing(draft.inquiry);
    if (missing.length > 0) {
      await fail(`RFQ is no longer mature. Missing: ${missing.join(", ")}.`);
      return;
    }

    const sent = await sendNewEmailFromAccount({
      officeId: s.officeId,
      accountId: account.id,
      to: draft.toEmail,
      subject: draft.subject,
      body: draft.body,
      inquiryId: draft.inquiryId,
      jobId: draft.inquiry.job?.id ?? null,
    });
    if ("error" in sent) {
      await fail(sent.error);
      return;
    }

    await prisma.forwarderRequestDraft.updateMany({
      where: { id: draft.id, officeId: s.officeId },
      data: {
        status: "SENT",
        senderAccountId: account.id,
        sentByEmail: account.email,
        sentAt: new Date(),
        gmailMessageId: sent.messageId,
        gmailThreadId: sent.threadId,
        sendError: null,
      },
    });

    const existingPending = await prisma.carrierQuote.findFirst({
      where: {
        inquiryId: draft.inquiryId,
        inquiry: { officeId: s.officeId },
        carrier: draft.forwarderName,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (!existingPending) {
      await prisma.carrierQuote.create({
        data: {
          inquiryId: draft.inquiryId,
          carrier: draft.forwarderName,
          quoteType: "EMAIL",
          rateName: "Forwarder RFQ sent",
          status: "PENDING",
        },
      });
    }

    await recordMemoryEvent({
      officeId: s.officeId,
      sourceType: "GMAIL",
      sourceExternalId: `gmail:forwarder_draft:${draft.id}:${sent.messageId}`,
      sourceLabel: "Forwarder RFQ email",
      eventType: "forwarder_draft.sent",
      entityType: "forwarder_draft",
      entityId: draft.id,
      actorType: "user",
      actorId: s.userId,
      occurredAt: new Date(),
      payloadVersion: 1,
      payload: {
        draftId: draft.id,
        inquiryId: draft.inquiryId,
        jobId: draft.inquiry.job?.id ?? null,
        toEmail: draft.toEmail,
        forwarderName: draft.forwarderName,
        subject: draft.subject,
        senderAccountId: account.id,
        sentByEmail: account.email,
        gmailMessageId: sent.messageId,
        gmailThreadId: sent.threadId,
        carrierQuoteCreated: !existingPending,
      },
      provenance: {
        source: "pricing_dashboard",
        operation: "send_forwarder_draft",
        path: "src/app/dashboard/pricing/page.tsx",
        function: "sendForwarderDraftAction",
        sourceRecordId: draft.id,
        sourceExternalId: sent.messageId,
        actorType: "user",
        actorId: s.userId,
      },
      idempotencyKey: `forwarder_draft:${draft.id}:sent:${sent.messageId}`,
    }).catch(() => null);

    revalidatePath("/dashboard/pricing");
    revalidatePath("/dashboard/inbox");
    revalidatePath(`/dashboard/rfq/${draft.inquiryId}`);
    if (draft.inquiry.job?.id) revalidatePath(`/dashboard/jobs/${draft.inquiry.job.id}`);
  }

  function renderCarrierTable(
    quotes: CarrierQuoteRow[],
    title: string,
    description: string,
    inquiryId: string,
    quoteType: "API" | "EMAIL",
  ) {
    if (quotes.length === 0) return null;
    const recommended = bestReceivedQuote(quotes);
    const pending = quotes.filter((q) => q.status === "PENDING").length;
    const receivedCount = quotes.filter((q) => q.status === "RECEIVED").length;

    return (
      <section className="pricing-carrier-card">
        <header className="pricing-carrier-header">
          <div>
            <h2 className="pricing-carrier-title">{title}</h2>
            <p className="pricing-carrier-description">{description}</p>
          </div>
          <div className="pricing-carrier-stats">
            <span className="pricing-stat-pill">Pending: {pending}</span>
            <span className="pricing-stat-pill received">Received: {receivedCount}</span>
          </div>
        </header>
        <div className="pricing-table-wrap">
          <table className="pricing-table">
            <thead>
              <tr>
                <th>Forwarder</th>
                <th>Method</th>
                <th>Rate</th>
                <th className="right">20DRY</th>
                <th className="right">40DRY</th>
                <th className="right">40HC</th>
                <th>Validity</th>
                <th>Service</th>
                <th className="center">Transit</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const isRec = recommended?.id === q.id;
                return (
                  <tr key={q.id} className={isRec ? "recommended" : undefined}>
                    <td className="pricing-carrier-cell">
                      <div className="pricing-carrier-lockup">
                        <div className="pricing-carrier-avatar">{initials(q.carrier)}</div>
                        <div>
                          <div className="pricing-carrier-name">{q.carrier}</div>
                          {isRec && <div className="pricing-recommended">Best cost</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={["pricing-method-pill", q.quoteType === "API" ? "api" : "email"].join(" ")}>
                        {q.quoteType}
                      </span>
                    </td>
                    <td className="pricing-muted-cell">{q.rateName ?? "-"}</td>
                    <td className="right pricing-money">{money(q.total20)}</td>
                    <td className="right pricing-money">{money(q.total40)}</td>
                    <td className={["right", "pricing-money", isRec ? "recommended" : ""].filter(Boolean).join(" ")}>{money(q.total40HC)}</td>
                    <td className="pricing-muted-cell">{q.validity ?? "-"}</td>
                    <td className="pricing-muted-cell">{q.service ?? "-"}</td>
                    <td className="center pricing-muted-cell">{q.transitDays ? `${q.transitDays}d` : "-"}</td>
                    <td>
                      <form action={deleteCarrierQuoteAction} className="pricing-delete-form">
                        <input type="hidden" name="id" value={q.id} />
                        <button type="submit" className="pricing-icon-btn" aria-label={`Delete ${q.carrier} quote`}>x</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="pricing-add-strip">
          <details>
            <summary className="pricing-add-summary">+ Add forwarder quote</summary>
            <form action={addCarrierQuoteAction} className="pricing-form-grid-5 pricing-add-form">
              <input type="hidden" name="inquiryId" value={inquiryId} />
              <input type="hidden" name="quoteType" value={quoteType} />
              <input name="carrier" required placeholder="Forwarder" />
              <input name="rateName" placeholder="Rate name" />
              <input name="total40HC" type="number" placeholder="40HC" />
              <input name="transitDays" type="number" placeholder="Transit days" />
              <input name="validity" placeholder="Validity" />
              <button type="submit" className="btn btn-sm">Add</button>
            </form>
          </details>
        </div>
      </section>
    );
  }

  const selectedQuotes = selectedInquiry?.carrierQuotes ?? [];
  const best = selectedInquiry ? bestReceivedQuote(selectedQuotes) : null;
  const marginPct = marginProfiles[0]?.marginPercent ?? 18;
  const bestCost = best ? quoteTotal(best) ?? 0 : 0;
  const finalRate = best ? Math.round(bestCost * (1 + marginPct / 100)) : 0;
  const opportunity = selectedInquiry ? liveStrategyByInquiryId.get(selectedInquiry.id) ?? null : null;
  const missing = selectedInquiry ? requiredRfqMissing(selectedInquiry) : [];
  const canSendToForwarders = selectedInquiry != null && missing.length === 0;
  const forwarderRows = forwarders as ForwarderRow[];
  const eligibleForwarders = selectedInquiry
    ? forwarderRows.filter((f) => f.active && coversForwarderMode(f, selectedInquiry.mode))
    : [];
  const selectedDrafts = (selectedInquiry?.forwarderDrafts ?? [])
    .filter((d) => d.status === "DRAFT") as ForwarderDraftRow[];
  const sentDrafts = (selectedInquiry?.forwarderDrafts ?? [])
    .filter((d) => d.status === "SENT") as ForwarderDraftRow[];
  const senderRows = senderAccounts as SenderAccountRow[];
  const pricingCommandRows = rankedInquiries.map((inquiry) => ({
    inquiry,
    summary: commandSummaryByInquiryId.get(inquiry.id) ?? null,
  }));
  const assessedCommandRows = pricingCommandRows.filter((row): row is typeof row & { summary: PricingCommandSummary } => row.summary != null);
  const topCommandRow = assessedCommandRows[0] ?? null;
  const topCommandInquiry = topCommandRow?.inquiry ?? null;
  const topCommandJobId = topCommandInquiry?.job?.id ?? null;
  const topCommandToolHint = topCommandRow?.summary.playbookToolHint ?? "none";
  const topCommandReviewUrl = topCommandInquiry ? `/dashboard/pricing?inquiry=${topCommandInquiry.id}` : "/dashboard/pricing";
  const topEligibleForwarders = topCommandInquiry
    ? forwarderRows.filter((f) => f.active && coversForwarderMode(f, topCommandInquiry.mode))
    : [];
  const staleCommandCount = assessedCommandRows.filter((row) => row.summary.stale).length;
  const unassessedCommandCount = pricingCommandRows.length - assessedCommandRows.length;
  const pricingCommandPhases = [
    {
      phase: "MATURE_RFQ",
      label: "Mature",
      detail: "Customer facts blocking send",
      icon: "list",
    },
    {
      phase: "GET_RATES",
      label: "Get rates",
      detail: "Ready for forwarder coverage",
      icon: "users",
    },
    {
      phase: "APPROVE_ECONOMICS",
      label: "Review",
      detail: "Margin or risk needs approval",
      icon: "shield",
    },
    {
      phase: "QUOTE_CUSTOMER",
      label: "Quote",
      detail: "Customer quote can be prepared",
      icon: "mail-out",
    },
  ] as const;
  const pricingCommandStats = pricingCommandPhases.map((item) => ({
    ...item,
    count: assessedCommandRows.filter((row) => row.summary.phase === item.phase).length,
  }));

  function renderPricingDecisionRail() {
    if (!selectedInquiry || !opportunity) return null;

    const decision = opportunity.operatorDecision;
    const gate = opportunity.quoteGate;
    const firstBlocker = opportunity.blockerResolutionPlan[0] ?? null;
    const weakestEvidence = opportunity.evidenceChecks.find((check) => check.tone === "blocked")
      ?? opportunity.evidenceChecks.find((check) => check.tone === "review")
      ?? opportunity.evidenceChecks.find((check) => check.tone === "info")
      ?? null;
    const decisionQuality = opportunity.evidenceChecks.find((check) => check.key === "decision_quality") ?? null;
    const coverage = opportunity.evidence.coveragePosture;
    const target = opportunity.evidence.targetPosture;
    const primaryReason = opportunity.decisionReasons[0] ?? null;
    const route = opportunity.recommendedRoute;
    const routeDecision = buildStrategyRouteDecision(opportunity);
    const executionPacket = buildStrategyExecutionPacket(opportunity);
    const commercialPriority = executionPacket.commercialPriority;
    const decisionContract = executionPacket.contract;
    const contractTone = decisionContract.state === "ready" ? "ready" : decisionContract.state === "review" ? "review" : "blocked";
    const proofGaps = executionPacket.evidence.gaps;
    const priorityChecklist = commercialChecklistItemsWithActions(commercialPriority.checklist, { limit: 3 });
    const routeDecisionRows = [
      routeDecision.selected,
      ...routeDecision.alternatives,
    ].filter((item): item is StrategyRouteDecisionRow => Boolean(item)).slice(0, 4);
    const actionLocked = !decision.canRunNow || decision.blockers.length > 0;
    const flow = [
      {
        key: "maturity",
        label: "Mature RFQ",
        icon: "list" as const,
        state: gate.canSendToForwarders ? "done" : "active",
        metric: operatorMaturityLabel(!gate.canSendToForwarders, opportunity.components.maturity),
        detail: gate.canSendToForwarders ? "Forwarder-safe" : `${gate.blockers.length || opportunity.missing.length} blocker${(gate.blockers.length || opportunity.missing.length) === 1 ? "" : "s"}`,
      },
      {
        key: "coverage",
        label: "Get rates",
        icon: "users" as const,
        state: !gate.canSendToForwarders ? "locked" : coverage.receivedQuotes > 0 ? "done" : "active",
        metric: `${coverage.receivedQuotes} live`,
        detail: coverage.label,
      },
      {
        key: "guardrail",
        label: "Approve economics",
        icon: "shield" as const,
        state: opportunity.price.guardrailStatus === "PASS" ? "done" : opportunity.price.guardrailStatus === "BLOCKED" ? "active" : "review",
        metric: opportunity.price.guardrailStatus.toLowerCase().replace("_", " "),
        detail: strategyMoney(opportunity.price.floorPrice, opportunity.price.currency),
      },
      {
        key: "quote",
        label: "Quote customer",
        icon: "mail-out" as const,
        state: gate.canQuoteCustomer ? "active" : "locked",
        metric: gate.canQuoteCustomer ? "ready" : "blocked",
        detail: strategyMoney(opportunity.price.recommendedPrice, opportunity.price.currency),
      },
    ];

    return (
      <section className={`pricing-decision-rail ${decision.priority}`} aria-label="Pricing command rail">
        <div className="pricing-decision-head">
          <div>
            <span className="pricing-section-label">Pricing command</span>
            <h3>{decision.ctaLabel}</h3>
            <p>{decision.command}</p>
          </div>
          <div className={`pricing-decision-verdict ${gate.status.toLowerCase().replace(/_/g, "-")}`}>
            <strong>{gate.label}</strong>
            <span>{decision.owner.toLowerCase()} owned</span>
          </div>
        </div>

        <div className="pricing-decision-body">
          <div className="pricing-decision-primary">
            <div className="pricing-decision-icon"><Icon name={actionLocked ? "alert" : "zap"} size={16} /></div>
            <div>
              <span>{operatorPhaseLabel(decision.phase)}</span>
              <strong>{decision.title}</strong>
              <em>{decision.rationale}</em>
            </div>
          </div>

          <div className="pricing-decision-proof">
            <div>
              <span>Why first</span>
              <strong>{primaryReason?.summary ?? "No ranked reason"}</strong>
              <em>{primaryReason?.detail ?? "The strategy brain did not produce a primary rationale."}</em>
            </div>
            <div>
              <span>Weakest evidence</span>
              <strong>{weakestEvidence?.label ?? "Covered"}</strong>
              <em>{weakestEvidence?.detail ?? "No weak evidence is blocking this pricing action."}</em>
            </div>
            <div>
              <span>Decision quality</span>
              <strong>{operatorMetricLabel(decisionQuality?.metric ?? `${opportunity.components.confidence}/100`, decisionQuality?.tone)}</strong>
              <em>{decisionQuality?.detail ?? "Confidence score exists, but no decision-quality audit was produced."}</em>
            </div>
            <div>
              <span>Target posture</span>
              <strong>{target.label}</strong>
              <em>{target.target == null ? "No target captured" : strategyMoney(target.target, target.currency)}</em>
            </div>
          </div>
        </div>

        <div className={`pricing-decision-priority ${commercialPriority.tone}`} aria-label="Commercial priority">
          <div className="pricing-decision-priority-head">
            <div>
              <span>Commercial priority</span>
              <strong>{commercialPriority.label}</strong>
              <em>{commercialPriority.whyNow}</em>
            </div>
            <div>
              <span>Economic unlock</span>
              <strong>{commercialPriority.economicUnlock}</strong>
              <em>{commercialPriority.riskTradeoff}</em>
            </div>
          </div>
          <div className="pricing-decision-priority-grid">
            {commercialPriority.rows.slice(0, 4).map((row) => (
              <div key={row.key} className={`pricing-decision-priority-row ${row.tone}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
                <em>{row.detail}</em>
              </div>
            ))}
          </div>
          <div className="pricing-decision-priority-checklist" aria-label="Pricing operator checklist">
            {priorityChecklist.map(({ item, actionKind }, index) => (
              <CommercialChecklistRow
                key={`${item.key}-${item.target}-${index}`}
                item={item}
                index={index}
                className="pricing-decision-priority-check"
                actionSlot={actionKind && (
                  <CommercialChecklistAction
                    kind={actionKind}
                    inquiryId={selectedInquiry.id}
                    jobId={selectedInquiry.job?.id}
                    quoteReady={gate.canQuoteCustomer}
                    className="pricing-decision-priority-check-action"
                    noteClassName="pricing-decision-note"
                    forwarderDraftControl={
                      eligibleForwarders.length > 0 ? (
                        <form action={createForwarderDraftsAction} className="pricing-decision-inline-form">
                          <input type="hidden" name="inquiryId" value={selectedInquiry.id} />
                          {eligibleForwarders.map((f) => (
                            <input key={f.id} type="hidden" name="forwarderId" value={f.id} />
                          ))}
                          <button type="submit" className="btn btn-secondary record-wide-action">
                            <Icon name="mail-out" size={13} />
                            Create {eligibleForwarders.length} draft{eligibleForwarders.length === 1 ? "" : "s"}
                          </button>
                        </form>
                      ) : (
                        <span className="pricing-decision-note">No active forwarder matches this mode yet.</span>
                      )
                    }
                  />
                )}
              />
            ))}
          </div>
        </div>

        <div className="pricing-decision-proof-gaps" aria-label="Pricing proof gap queue">
          <div className="pricing-decision-proof-gaps-head">
            <span>Proof gap queue</span>
            <strong>{proofGaps.length > 0 ? `${proofGaps.length} input${proofGaps.length === 1 ? "" : "s"} to clear` : "Proof queue clear"}</strong>
            <em>{proofGaps[0]?.detail ?? "No blocked or review evidence is holding the selected pricing move."}</em>
          </div>
          {proofGaps.length > 0 ? (
            <div className="pricing-decision-proof-gaps-list">
              {proofGaps.slice(0, 4).map((gap, index) => (
                <div key={`${gap.key}-${index}`} className={`pricing-decision-proof-gap ${gap.tone}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{gap.label} · {gap.owner.toLowerCase()}</strong>
                    <em>{gap.action}</em>
                    <small>{gap.metric} · {gap.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {firstBlocker && (
          <div className={`pricing-decision-blocker ${firstBlocker.priority}`}>
            <span>Clear next</span>
            <strong>{firstBlocker.ask}</strong>
            <em>{firstBlocker.why}</em>
          </div>
        )}

        <div className={`pricing-decision-contract ${contractTone}`} aria-label="Pricing decision contract">
          <div>
            <span>Decision contract</span>
            <strong>{decisionContract.title}</strong>
            <em>{decisionContract.summary}</em>
          </div>
          <div>
            <span>Agent may</span>
            <strong>{decisionContract.allowedAgentMoves[0]}</strong>
            <em>{decisionContract.allowedAgentMoves[1] ?? decisionContract.nextHumanQuestion ?? "Stay inside review-only output."}</em>
          </div>
          <div>
            <span>Watch assumption</span>
            <strong>{decisionContract.assumptions[0]?.label ?? "None"}</strong>
            <em>{decisionContract.assumptions[0]?.detail ?? "No weak input is currently driving the decision."}</em>
          </div>
          <div>
            <span>Forbidden</span>
            <strong>{decisionContract.forbidden[0] ?? "No extra hard stop"}</strong>
            <em>{decisionContract.forbidden.length > 1 ? `${decisionContract.forbidden.length - 1} more stop rule${decisionContract.forbidden.length - 1 === 1 ? "" : "s"}.` : "External sends still stay operator-controlled."}</em>
          </div>
        </div>

        <div className="pricing-decision-flow" aria-label="Pricing decision flow">
          {flow.map((item) => (
            <div key={item.key} className={`pricing-decision-step ${item.state}`}>
              <Icon name={item.icon} size={14} />
              <span>{item.label}</span>
              <strong>{item.metric}</strong>
              <em>{item.detail}</em>
            </div>
          ))}
        </div>

        <div className="pricing-decision-action-row">
          <div>
            <span>Safe action</span>
            <strong>{operatorToolLabel(decision.toolHint)}</strong>
            <em>
              {decision.requiresApproval
                ? "Prepare the artifact, then stop for review."
                : "Review-only action; nothing external is sent automatically."}
            </em>
          </div>
          {decision.toolHint === "draft_missing_info_request" && (
            <MissingInfoDraftButton inquiryId={selectedInquiry.id} />
          )}
          {decision.toolHint === "create_forwarder_drafts" && (
            eligibleForwarders.length > 0 ? (
              <form action={createForwarderDraftsAction} className="pricing-decision-inline-form">
                <input type="hidden" name="inquiryId" value={selectedInquiry.id} />
                {eligibleForwarders.map((f) => (
                  <input key={f.id} type="hidden" name="forwarderId" value={f.id} />
                ))}
                <button type="submit" className="btn btn-secondary">
                  <Icon name="mail-out" size={13} />
                  Create {eligibleForwarders.length} draft{eligibleForwarders.length === 1 ? "" : "s"}
                </button>
              </form>
            ) : (
              <span className="pricing-decision-note">No active forwarder matches this mode yet.</span>
            )
          )}
          {(decision.toolHint === "draft_customer_quote" || decision.toolHint === "draft_negotiation_plan") && (
            selectedInquiry.job ? (
              <a href={`/dashboard/jobs/${selectedInquiry.job.id}`} className="btn btn-secondary">
                <Icon name="external" size={13} />
                Open {decision.toolHint === "draft_customer_quote" ? "quote" : "negotiation"} cockpit
              </a>
            ) : (
              <span className="pricing-decision-note">Create or link the job before this job-scoped draft is available.</span>
            )
          )}
          {["recommend_price", "assess_strategy", "none"].includes(decision.toolHint) && (
            <a href="#pricing-strategy-card" className="btn btn-secondary">
              <Icon name="shield" size={13} />
              Review strategy
            </a>
          )}
        </div>

        <div className={`pricing-decision-route ${routeDecision.canQuoteCustomer ? "ready" : "review"}`}>
          <div className="pricing-decision-route-head">
            <div>
              <span>Route decision</span>
              <strong>{routeDecision.selected?.label ?? route?.label ?? "No priced route yet"}</strong>
            </div>
            <em>{routeDecision.summary}</em>
          </div>
          {routeDecisionRows.length > 0 ? (
            <div className="pricing-decision-route-list" aria-label="Route decision table">
              {routeDecisionRows.map((row) => (
                <div key={`${row.rank}-${row.label}-${row.source}`} className={`pricing-decision-route-row ${row.rank === 1 ? "selected" : ""} ${routeDecisionTone(row)}`}>
                  <span>{row.rank}</span>
                  <div>
                    <strong>{row.label}</strong>
                    <em>{row.provider ?? row.source.toLowerCase().replace(/_/g, " ")} · {routeFreshnessLabel(row)}</em>
                  </div>
                  <b>{row.costLabel}</b>
                  <small>{row.confidence} · risk {row.riskScore}</small>
                </div>
              ))}
            </div>
          ) : (
            <p>Do not invent route confidence before real quotes or history exist.</p>
          )}
          <p>{routeDecision.selectionRule}</p>
        </div>
      </section>
    );
  }

  return (
    <div className="pricing-page">
      <div className="page-header pricing-header">
        <div>
          <h1 className="page-title">Pricing</h1>
          <p className="page-subtitle">Target prices, mature RFQs, and forwarder quote comparison.</p>
        </div>
      </div>

      <section className="pricing-command-board" aria-label="Pricing brain queue">
        <div className="pricing-command-board-head">
          <div>
            <span className="pricing-section-label">Pricing brain queue</span>
            <h2>Do the commercial work in this order.</h2>
            <p>Same persisted decision briefs the agent reads. No guesswork from stale chat context.</p>
          </div>
          <div className="pricing-command-board-meta">
            <span>{assessedCommandRows.length} assessed</span>
            <span>{unassessedCommandCount} unassessed</span>
            <span>{staleCommandCount} stale</span>
          </div>
        </div>
        <div className="pricing-command-board-grid">
          <div
            className={[
              "pricing-command-top",
              topCommandRow ? pricingCommandTone(topCommandRow.summary.priority) : "",
              topCommandRow?.summary.stale ? "stale" : "",
            ].filter(Boolean).join(" ")}
          >
            <span>Do first</span>
            <strong>{topCommandRow?.summary.commandLabel ?? "No assessed RFQs yet"}</strong>
            <em>{topCommandRow?.inquiry.subject ?? "Create or assess an RFQ to start the pricing queue."}</em>
            {topCommandRow?.summary.commandReason && <p>{topCommandRow.summary.commandReason}</p>}
            {topCommandRow?.summary.commercialPriority && (
              <div className={`pricing-command-priority ${topCommandRow.summary.commercialPriority.tone}`} aria-label="Top command commercial priority">
                <div>
                  <span>Commercial priority</span>
                  <strong>{topCommandRow.summary.commercialPriority.label}</strong>
                  <em>{topCommandRow.summary.commercialPriority.whyNow}</em>
                </div>
                <div>
                  <span>Economic unlock</span>
                  <strong>{topCommandRow.summary.commercialPriority.economicUnlock}</strong>
                  <em>{topCommandRow.summary.commercialPriority.nextProof}</em>
                </div>
                <div className="pricing-command-priority-checklist" aria-label="Top command checklist">
                  {topCommandRow.summary.commercialPriority.checklist.slice(0, 2).map((item, index) => (
                    <CommercialChecklistRow
                      key={`${item.key}-${item.target}-${index}`}
                      item={item}
                      index={index}
                      className="pricing-command-priority-check"
                      showStopRule={false}
                    />
                  ))}
                </div>
              </div>
            )}
            {topCommandRow?.summary.proofGaps.length ? (
              <div className="pricing-command-proof-gaps" aria-label="Top command proof gaps">
                <span>Proof gaps</span>
                {topCommandRow.summary.proofGaps.slice(0, 3).map((gap, index) => (
                  <div key={`${gap.key}-${index}`} className={`pricing-command-proof-gap ${gap.tone}`}>
                    <strong>{gap.label} · {gap.owner.toLowerCase()}</strong>
                    <em>{gap.action}</em>
                  </div>
                ))}
              </div>
            ) : null}
            {topCommandRow?.summary && (
              <div className={`pricing-command-action ${topCommandRow.summary.decisionContract.state}`} aria-label="Safe pricing command action">
                <div>
                  <span>Safe reviewed action</span>
                  <strong>{operatorToolLabel(topCommandRow.summary.playbookToolHint)}</strong>
                  <em>{topCommandRow.summary.decisionContract.allowedAgentMoves[0]}</em>
                </div>
                <div className="pricing-command-action-controls">
                  {topCommandToolHint === "draft_missing_info_request" && topCommandInquiry && (
                    <MissingInfoDraftButton inquiryId={topCommandInquiry.id} jobId={topCommandJobId} />
                  )}
                  {topCommandToolHint === "create_forwarder_drafts" && topCommandInquiry && (
                    topEligibleForwarders.length > 0 ? (
                      <form action={createForwarderDraftsAction} className="pricing-command-inline-form">
                        <input type="hidden" name="inquiryId" value={topCommandInquiry.id} />
                        {topEligibleForwarders.map((f) => (
                          <input key={f.id} type="hidden" name="forwarderId" value={f.id} />
                        ))}
                        <button type="submit" className="btn btn-secondary record-wide-action">
                          <Icon name="mail-out" size={13} />
                          Create {topEligibleForwarders.length} draft{topEligibleForwarders.length === 1 ? "" : "s"}
                        </button>
                      </form>
                    ) : (
                      <span className="pricing-command-action-note">No active forwarder matches this mode yet.</span>
                    )
                  )}
                  {topCommandToolHint === "draft_customer_quote" && (
                    topCommandJobId ? (
                      <CustomerQuoteDraftButton jobId={topCommandJobId} quoteReady={topCommandRow.summary.quoteGateStatus === "READY_TO_QUOTE"} />
                    ) : (
                      <span className="pricing-command-action-note">Create or link the job before quote drafting.</span>
                    )
                  )}
                  {topCommandToolHint === "draft_negotiation_plan" && (
                    topCommandJobId ? (
                      <NegotiationPlanDraftButton jobId={topCommandJobId} />
                    ) : (
                      <span className="pricing-command-action-note">Create or link the job before negotiation drafting.</span>
                    )
                  )}
                  {["recommend_price", "assess_strategy", "none"].includes(topCommandToolHint) && (
                    <a href={topCommandReviewUrl} className="btn btn-secondary record-wide-action">
                      <Icon name="external" size={13} />
                      Open RFQ
                    </a>
                  )}
                  {topCommandToolHint !== "none" && (
                    <a href={topCommandReviewUrl} className="pricing-command-open-link">Open RFQ</a>
                  )}
                </div>
              </div>
            )}
            {topCommandRow?.summary && (
              <details className="pricing-command-details">
                <summary>
                  <span>Decision audit</span>
                  <strong>Contract, route, quality, and factors</strong>
                </summary>
                <div className="pricing-command-details-body">
                  {topCommandRow.summary.decisionContract && (
                    <div
                      className={`pricing-command-contract ${topCommandRow.summary.decisionContract.state}`}
                      aria-label="Top command decision contract"
                    >
                      <span>Decision contract</span>
                      <strong>{topCommandRow.summary.decisionContract.title}</strong>
                      <em>{topCommandRow.summary.decisionContract.summary}</em>
                      <div>
                        <span>Agent may</span>
                        <strong>{topCommandRow.summary.decisionContract.allowedAgentMoves[0]}</strong>
                      </div>
                      <div>
                        <span>Forbidden</span>
                        <strong>{topCommandRow.summary.decisionContract.forbidden[0] ?? "No external send without approval."}</strong>
                      </div>
                    </div>
                  )}
                  {topCommandRow.summary.decisionQuality && (
                    <div className={`pricing-command-quality ${topCommandRow.summary.decisionQuality.tone}`} aria-label="Top command decision quality">
                      <span>Decision quality</span>
                      <strong>{topCommandRow.summary.decisionQuality.metric}</strong>
                      <em>{topCommandRow.summary.decisionQuality.detail}</em>
                    </div>
                  )}
                  <div className="pricing-command-playbook" aria-label="Operator playbook">
                    <div>
                      <span>First move</span>
                      <strong>{topCommandRow.summary.playbookExactAsk ?? topCommandRow.summary.playbookFirstMove}</strong>
                    </div>
                    <div>
                      <span>Safety</span>
                      <strong>{topCommandRow.summary.playbookSafetyRule}</strong>
                    </div>
                    <div>
                      <span>Stop when</span>
                      <strong>{topCommandRow.summary.playbookStopCondition}</strong>
                    </div>
                  </div>
                  {topCommandRow.summary.routeLabel && (
                    <div className={`pricing-command-route ${topCommandRow.summary.routeCanQuoteCustomer ? "ready" : "review"}`}>
                      <span>Route evidence</span>
                      <strong>{topCommandRow.summary.routeLabel}</strong>
                      <em>
                        {[topCommandRow.summary.routeCostLabel, topCommandRow.summary.routeFreshnessLabel]
                          .filter(Boolean)
                          .join(" · ") || "decision context"}
                      </em>
                      {topCommandRow.summary.routeSummary && <p>{topCommandRow.summary.routeSummary}</p>}
                    </div>
                  )}
                  {topCommandRow.summary.priorityFactors.length ? (
                    <div className="pricing-command-factors" aria-label="Pricing priority factors">
                      {topCommandRow.summary.priorityFactors.slice(0, 6).map((factor) => (
                        <div key={`${factor.label}-${factor.value}`} className={`pricing-command-factor ${factor.tone}`}>
                          <span>{factor.label}</span>
                          <strong>{factor.value}</strong>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </details>
            )}
          </div>
          <div className="pricing-command-phase-grid">
            {pricingCommandStats.map((stat) => (
              <div key={stat.phase} className={`pricing-command-phase ${stat.phase.toLowerCase().replace(/_/g, "-")}`}>
                <Icon name={stat.icon} size={15} strokeWidth={2.1} />
                <span>{stat.label}</span>
                <strong>{stat.count}</strong>
                <em>{stat.detail}</em>
              </div>
            ))}
          </div>
          <div className="pricing-command-health">
            <div>
              <span>Freshness</span>
              <strong>{staleCommandCount === 0 ? "Current enough" : `${staleCommandCount} stale snapshot${staleCommandCount === 1 ? "" : "s"}`}</strong>
              <em>{staleCommandCount === 0 ? "Cached strategy matches the latest RFQ/rate inputs." : "Open each stale RFQ to refresh the live strategy before trusting the command."}</em>
            </div>
            <div>
              <span>Coverage gap</span>
              <strong>{unassessedCommandCount === 0 ? "All RFQs assessed" : `${unassessedCommandCount} not assessed`}</strong>
              <em>{unassessedCommandCount === 0 ? "Every visible RFQ has a persisted commercial decision." : "Unassessed rows need a first strategy run before the agent can rank them confidently."}</em>
            </div>
          </div>
        </div>
      </section>

      <div className="pricing-workspace">
        <aside className="pricing-sidebar">
          <div className="pricing-sidebar-head">
            <div>
              <span className="pricing-section-label">RFQs</span>
              <strong className="pricing-sidebar-mode">Ranked by command</strong>
            </div>
            <details className="pricing-details">
              <summary className="pricing-summary-btn">+ New</summary>
              <div className="pricing-popover left">
                <div className="pricing-popover-title">New RFQ</div>
                <form action={addInquiryAction} className="pricing-form-stack">
                  <input name="subject" required placeholder="Subject / title" />
                  <input name="fromEmail" type="email" placeholder="Client email" />
                  <input name="fromCompany" placeholder="Client company" />
                  <div className="pricing-form-grid-2">
                    <input name="origin" placeholder="Origin" />
                    <input name="destination" placeholder="Destination" />
                  </div>
                  <div className="pricing-form-grid-2">
                    <select name="mode" defaultValue="">
                      <option value="">Mode...</option>
                      {["SEA-FCL", "SEA-LCL", "AIR", "ROAD", "COURIER"].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select name="containerType" defaultValue="">
                      <option value="">Container...</option>
                      {["20GP", "20DRY", "40GP", "40DRY", "40HC", "40HQ", "45HC"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="pricing-form-grid-2">
                    <select name="targetPriceStatus" defaultValue="UNKNOWN">
                      <option value="UNKNOWN">Target unknown</option>
                      <option value="NO_TARGET">No target</option>
                      <option value="PROVIDED">Target provided</option>
                    </select>
                    <input name="targetPrice" type="number" step="any" placeholder="Target price" />
                  </div>
                  <div className="pricing-form-grid-2">
                    <select name="targetCurrency" defaultValue="USD">
                      {["USD", "EUR", "TRY", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input name="targetPriceSource" placeholder="Target source" />
                  </div>
                  <textarea name="rawEmailBody" placeholder="Paste email body" rows={4} className="pricing-mono-input" />
                  <button type="submit">Create RFQ</button>
                </form>
              </div>
            </details>
          </div>

          <div className="pricing-inquiry-list">
            {inquiries.length === 0 ? (
              <div className="pricing-first-quote">No RFQs yet.</div>
            ) : rankedInquiries.map((inq, index) => {
              const isSelected = selectedInquiry?.id === inq.id;
              const meta = statusMeta(inq.status);
              const receivedCount = inq.carrierQuotes.filter((q) => q.status === "RECEIVED").length;
              const totalCount = inq.carrierQuotes.length;
              const summary = commandSummaryByInquiryId.get(inq.id) ?? null;
              const commandTone = pricingCommandTone(summary?.priority);
              return (
                <a
                  key={inq.id}
                  href={`/dashboard/pricing?inquiry=${inq.id}`}
                  className={["pricing-inquiry-card", isSelected ? "active" : ""].filter(Boolean).join(" ")}
                >
                  <div className="pricing-inquiry-top">
                    <div className="pricing-inquiry-rank">
                      <span>#{index + 1}</span>
                      <div className="pricing-inquiry-company">{inq.company?.name ?? inq.fromCompany ?? inq.fromEmail ?? "Unknown"}</div>
                    </div>
                    <span className={["pricing-status", meta.className].join(" ")}>{meta.label}</span>
                  </div>
                  <div className="pricing-inquiry-subject">{inq.subject}</div>
                  <div className={`pricing-inquiry-command ${commandTone}${summary?.stale ? " stale" : ""}`}>
                    <span>{summary?.commandLabel ?? "Review RFQ"}</span>
                    <strong>{summary?.commandReason ?? "No commercial assessment"}</strong>
                  </div>
                  {summary?.playbookExactAsk && (
                    <div className="pricing-inquiry-playbook">
                      <span>Ask</span>
                      <strong>{summary.playbookExactAsk}</strong>
                    </div>
                  )}
                  {summary?.routeLabel && (
                    <div className={`pricing-inquiry-route-decision ${summary.routeCanQuoteCustomer ? "ready" : "review"}`}>
                      <span>Route</span>
                      <strong>{summary.routeLabel}</strong>
                      <em>
                        {[summary.routeCostLabel, summary.routeFreshnessLabel]
                          .filter(Boolean)
                          .join(" · ") || "decision context"}
                      </em>
                    </div>
                  )}
                  {(inq.origin || inq.destination) && (
                    <div className="pricing-inquiry-route">
                      {inq.origin ?? "?"} to {inq.destination ?? "?"}
                      {inq.mode && <span>{inq.mode}</span>}
                    </div>
                  )}
                  {summary && (
                    <div className="pricing-inquiry-brain-row">
                      <span>{summary.quoteGateLabel}</span>
                      <span>{summary.guardrailStatus.toLowerCase().replace("_", " ")}</span>
                      <span>{summary.receivedQuotes} live</span>
                      {summary.stale && <span className="stale">stale</span>}
                    </div>
                  )}
                  {summary?.priorityFactors.length ? (
                    <div className="pricing-inquiry-factor-row" aria-label="Pricing rank factors">
                      {summary.priorityFactors.slice(0, 3).map((factor) => (
                        <span key={`${inq.id}-${factor.label}-${factor.value}`} className={`pricing-mini-factor ${factor.tone}`}>
                          <em>{factor.label}</em>
                          <strong>{factor.value}</strong>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="pricing-inquiry-counts">
                    {inq.targetPrice != null
                      ? `${inq.targetCurrency ?? "USD"} ${inq.targetPrice.toLocaleString()} target`
                      : inq.targetPriceStatus === "NO_TARGET"
                        ? "No customer target"
                        : "Target missing"}
                    {totalCount > 0 ? ` · ${receivedCount}/${totalCount} quotes` : ""}
                  </div>
                </a>
              );
            })}
          </div>

          <section className="pricing-carrier-card pricing-directory-card">
            <header className="pricing-carrier-header">
              <div>
                <h2 className="pricing-carrier-title">Forwarder directory</h2>
                <p className="pricing-carrier-description">
                  Real recipients only. Drafts use this list; sends stay blocked.
                </p>
              </div>
              <span className="pricing-status status-parsed">{forwarderRows.filter((f) => f.active).length} active</span>
            </header>
            <details className="pricing-details">
              <summary className="pricing-summary-btn">+ Add forwarder</summary>
              <form action={addForwarderAction} className="pricing-form-stack pricing-directory-form">
                <input name="name" required placeholder="Forwarder name" />
                <input name="email" type="email" required placeholder="pricing@example.com" />
                <input name="modeCoverage" placeholder="SEA-FCL, SEA-LCL, AIR" />
                <select name="apiType" defaultValue="EMAIL">
                  <option value="EMAIL">Email</option>
                  <option value="API">API later</option>
                </select>
                <input name="notes" placeholder="Coverage notes" />
                <button type="submit" className="btn btn-sm">Save forwarder</button>
              </form>
            </details>
            {forwarderRows.length === 0 ? (
              <div className="pricing-first-quote">No forwarders saved yet.</div>
            ) : (
              <div className="pricing-forwarder-list">
                {forwarderRows.slice(0, 8).map((f) => (
                  <div key={f.id} className={`pricing-forwarder-row${f.active ? "" : " muted"}`}>
                    <div>
                      <strong>{f.name}</strong>
                      <span>{f.email}</span>
                      <em>{forwarderModeCoverageLabel(f.modeCoverage)} · {f.apiType}</em>
                    </div>
                    <form action={toggleForwarderAction}>
                      <input type="hidden" name="id" value={f.id} />
                      <input type="hidden" name="active" value={f.active ? "false" : "true"} />
                      <button type="submit" className="pricing-icon-btn">
                        {f.active ? "Pause" : "Use"}
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>

        <main className="pricing-main">
          {!selectedInquiry ? (
            <div className="pricing-main-empty">Select an RFQ or create a new one.</div>
          ) : (
            <div className="pricing-detail">
              <header className="pricing-detail-header">
                <div>
                  <h2 className="pricing-detail-title">{selectedInquiry.subject}</h2>
                  <div className="pricing-detail-meta">
                    {selectedInquiry.fromEmail && <span>{selectedInquiry.fromEmail}</span>}
                    {selectedInquiry.origin && selectedInquiry.destination && <strong>{selectedInquiry.origin} to {selectedInquiry.destination}</strong>}
                    {selectedInquiry.mode && <span>{selectedInquiry.mode}</span>}
                    {selectedInquiry.job && <a href={`/dashboard/jobs/${selectedInquiry.job.id}`}>{selectedInquiry.job.reference}</a>}
                  </div>
                </div>
                <div className="pricing-detail-actions">
                  {opportunity && <OpportunityScorePill score={opportunity} />}
                  <form action={updateInquiryStatusAction}>
                    <input type="hidden" name="id" value={selectedInquiry.id} />
                    <AutoSubmitSelect
                      name="status"
                      defaultValue={canonicalInquiryStatus(selectedInquiry.status)}
                      className="pricing-status-select"
                      options={[...new Set([canonicalInquiryStatus(selectedInquiry.status), "BOOKED", "PRICING", "MISSED", "RECEIVED", "IGNORED"])].map((s) => ({ value: s, label: statusMeta(s).label }))}
                    />
                  </form>
                  <form action={deleteInquiryAction}>
                    <input type="hidden" name="id" value={selectedInquiry.id} />
                    <button type="submit" className="pricing-delete-btn">Delete</button>
                  </form>
                </div>
              </header>

              {renderPricingDecisionRail()}

              {missing.length > 0 && (
                <div className="pricing-first-quote">
                  Missing before forwarder outreach: {missing.join(", ")}.
                </div>
              )}

              {opportunity && (
                <details id="pricing-strategy-card" className="strategy-audit-details">
                  <summary>
                    <span>Strategy audit details</span>
                    <strong>Score, ladder, evidence, and risks</strong>
                  </summary>
                  <OpportunityScoreCard score={opportunity} />
                </details>
              )}

              <section className="pricing-carrier-card">
                <header className="pricing-carrier-header">
                  <div>
                    <h2 className="pricing-carrier-title">Target price</h2>
                    <p className="pricing-carrier-description">Customer budget or explicit no-target confirmation.</p>
                  </div>
                  <span className={["pricing-status", selectedInquiry.targetPriceStatus === "PROVIDED" || selectedInquiry.targetPrice != null ? "status-priced" : selectedInquiry.targetPriceStatus === "NO_TARGET" ? "status-parsed" : "status-needs-info"].join(" ")}>
                    {selectedInquiry.targetPrice != null
                      ? `${selectedInquiry.targetCurrency ?? "USD"} ${selectedInquiry.targetPrice.toLocaleString()}`
                      : selectedInquiry.targetPriceStatus === "NO_TARGET"
                        ? "No target"
                        : "Ask"}
                  </span>
                </header>
                <form action={updateTargetPriceAction} className="pricing-form-grid-5 pricing-add-form">
                  <input type="hidden" name="id" value={selectedInquiry.id} />
                  <select name="targetPriceStatus" defaultValue={selectedInquiry.targetPriceStatus ?? "UNKNOWN"}>
                    <option value="UNKNOWN">Target unknown</option>
                    <option value="NO_TARGET">No target</option>
                    <option value="PROVIDED">Target provided</option>
                  </select>
                  <input name="targetPrice" type="number" step="any" defaultValue={selectedInquiry.targetPrice ?? ""} placeholder="Target price" />
                  <select name="targetCurrency" defaultValue={selectedInquiry.targetCurrency ?? "USD"}>
                    {["USD", "EUR", "TRY", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input name="targetPriceSource" defaultValue={selectedInquiry.targetPriceSource ?? ""} placeholder="Source / context" />
                  <button type="submit" className="btn btn-sm">Save</button>
                </form>
              </section>

              {selectedInquiry.rawEmailBody && (
                <details className="pricing-raw">
                  <summary>View original email</summary>
                  <pre>{selectedInquiry.rawEmailBody}</pre>
                </details>
              )}

              <section className="pricing-carrier-card">
                <header className="pricing-carrier-header">
                  <div>
                    <h2 className="pricing-carrier-title">Forwarder handoff drafts</h2>
                    <p className="pricing-carrier-description">
                      Create reviewed outbound emails, then send them one forwarder at a time.
                    </p>
                  </div>
                  <span className={["pricing-status", canSendToForwarders ? "status-priced" : "status-needs-info"].join(" ")}>
                    {canSendToForwarders ? "Draft-ready" : "Blocked"}
                  </span>
                </header>
                {!canSendToForwarders ? (
                  <div className="pricing-first-quote">
                    Missing before draft creation: {missing.join(", ")}.
                  </div>
                ) : eligibleForwarders.length === 0 ? (
                  <div className="pricing-first-quote">
                    No active forwarder matches {selectedInquiry.mode ?? "this mode"}. Add one in the directory.
                  </div>
                ) : (
                  <form action={createForwarderDraftsAction} className="pricing-forwarder-draft-form">
                    <input type="hidden" name="inquiryId" value={selectedInquiry.id} />
                    <div className="pricing-forwarder-checkboxes">
                      {eligibleForwarders.map((f) => (
                        <label key={f.id} className="pricing-forwarder-check">
                          <input type="checkbox" name="forwarderId" value={f.id} defaultChecked />
                          <span>
                            <strong>{f.name}</strong>
                            <em>{f.email}</em>
                          </span>
                        </label>
                      ))}
                    </div>
                    <button type="submit" className="btn btn-sm">Create reviewed drafts</button>
                  </form>
                )}
                {senderRows.length === 0 && (
                  <div className="pricing-first-quote">
                    Sending is ready, but no allowed Gmail sender is connected. Connect mert@usederya.com or oguzhan@usederya.com in Email Settings.
                  </div>
                )}
                {selectedDrafts.length > 0 && (
                  <div className="pricing-draft-list">
                    {selectedDrafts.map((draft) => (
                      <details key={draft.id} className="pricing-draft-card">
                        <summary>
                          <span>{draft.forwarderName}</span>
                          <em>{draft.toEmail}</em>
                        </summary>
                        <div className="quote-ready-grid">
                          <label>
                            <span className="quote-ready-label">To</span>
                            <input readOnly value={draft.toEmail} className="quote-ready-readonly" />
                          </label>
                          <label>
                            <span className="quote-ready-label">Subject</span>
                            <input readOnly value={draft.subject} className="quote-ready-readonly" />
                          </label>
                        </div>
                        <textarea readOnly rows={12} value={draft.body} className="quote-ready-message" />
                        {draft.sendError && (
                          <div className="pricing-send-error">{draft.sendError}</div>
                        )}
                        <div className="pricing-draft-actions">
                          <form action={sendForwarderDraftAction} className="pricing-send-form">
                            <input type="hidden" name="id" value={draft.id} />
                            <select name="accountId" defaultValue={senderRows[0]?.id ?? ""} disabled={senderRows.length === 0}>
                              {senderRows.length === 0 ? (
                                <option value="">Connect allowed Gmail sender</option>
                              ) : senderRows.map((account) => (
                                <option key={account.id} value={account.id}>{account.email}</option>
                              ))}
                            </select>
                            <button type="submit" className="btn btn-sm" disabled={senderRows.length === 0}>
                              Send to forwarder
                            </button>
                          </form>
                          <form action={discardForwarderDraftAction}>
                            <input type="hidden" name="id" value={draft.id} />
                            <button type="submit" className="btn btn-secondary btn-sm">Discard draft</button>
                          </form>
                        </div>
                      </details>
                    ))}
                  </div>
                )}
                {sentDrafts.length > 0 && (
                  <div className="pricing-sent-list">
                    {sentDrafts.slice(0, 6).map((draft) => (
                      <div key={draft.id} className="pricing-sent-row">
                        <strong>{draft.forwarderName}</strong>
                        <span>
                          Sent from {draft.sentByEmail ?? "Gmail"}{draft.sentAt ? ` · ${draft.sentAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="pricing-carrier-area">
                {renderCarrierTable(
                  selectedQuotes.filter((q) => MAJOR_FORWARDERS.has(q.carrier.toUpperCase())),
                  "Major forwarders",
                  canSendToForwarders ? "Use for mature RFQs only." : "Blocked until the RFQ is mature.",
                  selectedInquiry.id,
                  "API",
                )}
                {renderCarrierTable(
                  selectedQuotes.filter((q) => !MAJOR_FORWARDERS.has(q.carrier.toUpperCase())),
                  "Regional and local forwarders",
                  "Email/API quotes copied back into this RFQ.",
                  selectedInquiry.id,
                  "EMAIL",
                )}
                {selectedQuotes.length === 0 && (
                  <div className="pricing-first-quote">
                    No forwarder quotes yet.
                    <details>
                      <summary className="pricing-summary-btn">+ Add first quote</summary>
                      <form action={addCarrierQuoteAction} className="pricing-form-grid-3 pricing-add-form">
                        <input type="hidden" name="inquiryId" value={selectedInquiry.id} />
                        <input type="hidden" name="quoteType" value="EMAIL" />
                        <input name="carrier" required placeholder="Forwarder" />
                        <input name="total40HC" type="number" placeholder="40HC rate" />
                        <input name="transitDays" type="number" placeholder="Transit days" />
                        <button type="submit" className="btn btn-sm">Add quote</button>
                      </form>
                    </details>
                  </div>
                )}
              </div>

              {best && (
                <section className="quote-ready">
                  <details>
                    <summary className="quote-ready-summary">
                      <span className="quote-ready-dot" />
                      <span className="quote-ready-title">Customer quote draft</span>
                      <span className="quote-ready-meta">{best.carrier} cost {money(bestCost)} · sell {money(finalRate)}</span>
                    </summary>
                    <div className="quote-ready-body">
                      <div className="quote-ready-grid">
                        <label>
                          <span className="quote-ready-label">To</span>
                          <input readOnly value={selectedInquiry.fromEmail ?? ""} className="quote-ready-readonly" />
                        </label>
                        <label>
                          <span className="quote-ready-label">Subject</span>
                          <input readOnly value={`Quote - ${selectedInquiry.origin ?? ""} to ${selectedInquiry.destination ?? ""}`.trim()} className="quote-ready-readonly" />
                        </label>
                      </div>
                      <label>
                        <span className="quote-ready-label">Message</span>
                        <textarea
                          readOnly
                          rows={10}
                          value={`Dear ${selectedInquiry.fromCompany ?? "Client"},

Thank you for your inquiry.

Route: ${selectedInquiry.origin ?? "-"} to ${selectedInquiry.destination ?? "-"}
Mode: ${selectedInquiry.mode ?? "-"}
Forwarder: ${best.carrier}
Transit time: ${best.transitDays ? `${best.transitDays} days` : "-"}

Quote: USD ${finalRate.toLocaleString()}
Validity: ${best.validity ?? "48 hours"}

Best regards,`}
                          className="quote-ready-message"
                        />
                      </label>
                    </div>
                  </details>
                </section>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
