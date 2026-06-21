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
import { DocumentReadinessBoard } from "@/components/document-readiness-board";
import { OpportunityScoreCard, OpportunityScorePill } from "@/components/opportunity-score-card";
import { CustomerQuoteDraftButton } from "@/components/customer-quote-draft-button";
import { ForwarderDraftsButton } from "@/components/forwarder-drafts-button";
import { MissingInfoDraftButton } from "@/components/missing-info-draft-button";
import { NegotiationPlanDraftButton } from "@/components/negotiation-plan-draft-button";
import type { OpportunityScore } from "@/lib/opportunity-score";
import { assessJobStrategy } from "@/lib/commercial-strategy-persistence";
import { buildReferenceDealOperatorPlaybook, getReferenceDealDecisions, getReferenceDealSummary, type ReferenceDealDecision, type ReferenceDealOperatorPlaybook, type ReferenceDealSummary } from "@/lib/reference-deals";
import { listDecisionQueueItems, type DecisionQueueItem } from "@/lib/decision-queue";
import { buildDecisionQueueBrief, type DecisionQueueBrief } from "@/lib/decision-queue-brief";
import { operatorToolLabel } from "@/lib/operator-action-labels";
import { createRfqFromReferenceDeal } from "./reference-deal-actions";
import { Fragment } from "react";
import {
  initJobDocuments, initJobMilestones, updateDocStatus,
  markMilestoneActual, updateMilestonePlanned,
  addCarrierQuote, selectCarrierQuote, updateJobStatus,
  addQuoteLine, uploadJobDocument,
} from "./jobs/[jobId]/actions";

const STATUS_ORDER = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "DELIVERED"] as const;
const STATUS_LABEL: Record<string, string> = {
  INQUIRY: "RFQ", QUOTED: "Pricing", BOOKED: "Booked / Waiting Cargo",
  IN_TRANSIT: "En Route", CUSTOMS: "En Route", DELIVERED: "Delivered",
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

type TargetPriceTrailEntry = {
  id: string;
  amount: number | null;
  currency: string | null;
  status: string;
  source: string | null;
  note: string | null;
  createdAt: Date;
  jobId?: string | null;
  inquiryId?: string | null;
};

function targetHistoryValue(entry: TargetPriceTrailEntry) {
  if (entry.amount != null) return `${entry.currency ?? "USD"} ${entry.amount.toLocaleString()}`;
  if (entry.status === "NO_TARGET") return "No target";
  return entry.status.toLowerCase().replace("_", " ");
}

function TargetPriceTrail({
  entries,
  currentLabel,
  currentSource,
  currentStatus,
}: {
  entries: TargetPriceTrailEntry[];
  currentLabel: string;
  currentSource: string | null;
  currentStatus: string | null;
}) {
  const latest = entries[0] ?? null;
  const statusLabel = currentStatus === "NO_TARGET"
    ? "No target confirmed"
    : currentStatus === "PROVIDED" || latest?.amount != null
      ? "Target captured"
      : "Needs customer answer";

  return (
    <section className="target-trail" data-agent-target="target-price" aria-label="Target price history">
      <div className="target-trail-head">
        <div>
          <div className="target-trail-kicker">Target price memory</div>
          <h2>{statusLabel}</h2>
        </div>
        <div className="target-trail-current">
          <span>Current</span>
          <strong>{currentLabel}</strong>
        </div>
      </div>
      <div className="target-trail-body">
        <div className="target-trail-context">
          <span>Source context</span>
          <strong>{currentSource || latest?.source || latest?.note || "No source recorded"}</strong>
          <em>
            {entries.length > 0
              ? `${entries.length} historical signal${entries.length === 1 ? "" : "s"} preserved for pricing decisions.`
              : "No target-price history yet. Ask explicitly or mark no target before forwarding."}
          </em>
        </div>
        <div className="target-trail-list">
          {entries.length > 0 ? entries.slice(0, 4).map((entry) => (
            <div key={entry.id} className="target-trail-row">
              <div>
                <strong>{targetHistoryValue(entry)}</strong>
                <span>{[entry.source, entry.note].filter(Boolean).join(" · ") || "Internal update"}</span>
              </div>
              <em>{fmt(entry.createdAt)}</em>
            </div>
          )) : (
            <div className="target-trail-empty">
              Target price is still an unanswered commercial fact.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function firstCommandLedgerStop(brief: DecisionQueueBrief) {
  return brief.execution_brief?.command_ledger.find((row) => row.tone === "blocked" || row.tone === "review")
    ?? brief.execution_brief?.command_ledger[0]
    ?? null;
}

type DeskExecutionBrief = NonNullable<DecisionQueueBrief["execution_brief"]>;

function DeskSafeAction({ brief }: { brief: DeskExecutionBrief }) {
  const toolHint = brief.decision_move?.toolHint ?? "none";
  const jobId = brief.entity_type === "job" ? brief.entity_id : null;
  const inquiryId = brief.entity_type === "inquiry" ? brief.entity_id : null;
  const leadId = brief.entity_type === "lead" ? brief.entity_id : null;
  const hasInlineAction = Boolean(
    (toolHint === "draft_missing_info_request" && (jobId || inquiryId)) ||
    (toolHint === "create_forwarder_drafts" && jobId) ||
    (toolHint === "draft_customer_quote" && jobId) ||
    (toolHint === "draft_negotiation_plan" && jobId) ||
    (toolHint === "prepare_control_sheet_rfq" && leadId)
  );
  const contractState = brief.decision_contract?.state ?? "review";

  return (
    <div className={`attention-brief-action ${contractState}`} data-agent-target="agent-action" aria-label="Safe desk action">
      <div>
        <span>Safe reviewed action</span>
        <strong>{operatorToolLabel(toolHint)}</strong>
        <em>{brief.decision_contract?.allowedAgentMoves[0] ?? brief.next_step}</em>
      </div>
      <div className="attention-brief-action-controls">
        {toolHint === "draft_missing_info_request" && (jobId || inquiryId) && (
          <MissingInfoDraftButton inquiryId={inquiryId} jobId={jobId} />
        )}
        {toolHint === "create_forwarder_drafts" && jobId && (
          <ForwarderDraftsButton jobId={jobId} />
        )}
        {toolHint === "draft_customer_quote" && jobId && (
          <CustomerQuoteDraftButton jobId={jobId} quoteReady={brief.decision_contract?.state === "ready"} />
        )}
        {toolHint === "draft_negotiation_plan" && jobId && (
          <NegotiationPlanDraftButton jobId={jobId} />
        )}
        {toolHint === "prepare_control_sheet_rfq" && leadId && (
          <form action={createRfqFromReferenceDeal} className="attention-brief-inline-form">
            <input type="hidden" name="dealId" value={leadId} />
            <button type="submit" className="btn btn-secondary record-wide-action">
              <Icon name="plus" size={13} />
              Create RFQ from lead
            </button>
          </form>
        )}
        <a href={brief.href} className={hasInlineAction ? "attention-brief-open-link" : "btn btn-secondary record-wide-action"}>
          {!hasInlineAction && <Icon name="external" size={13} />}
          {hasInlineAction ? "Open record" : "Open scoped record"}
        </a>
      </div>
    </div>
  );
}

function DecisionQueueSection({ items, brief }: { items: DecisionQueueItem[]; brief: DecisionQueueBrief }) {
  if (items.length === 0) return null;
  const ledgerStop = firstCommandLedgerStop(brief);
  return (
    <section className="attention-queue" data-agent-target="decision-queue" aria-label="Decision queue">
      <div className="attention-queue-header">
        <span className="live-dot" aria-hidden />
        <strong>Decision queue</strong>
        <span>{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>
      {brief.focus && (
        <div className={`attention-brief ${brief.focus.tone}`}>
          <div className="attention-brief-main">
            <span>Desk focus</span>
            <strong>{brief.focus.label}</strong>
            <em>{brief.focus.operator_mode}</em>
          </div>
          {brief.execution_brief && (
            <div className="attention-brief-execution">
              <span>First move</span>
              <strong>{brief.execution_brief.safe_action_label}</strong>
              <em>{brief.execution_brief.next_step}</em>
              {brief.execution_brief.decision_move && (
                <div className="attention-brief-move" aria-label="First move decision">
                  <span>{brief.execution_brief.decision_move.owner}</span>
                  <strong>{brief.execution_brief.decision_move.label}</strong>
                </div>
              )}
              {brief.execution_brief.visual_target && (
                <div className="attention-brief-target" aria-label="Agent page target">
                  <span>Agent is looking at</span>
                  <strong>{brief.execution_brief.visual_target_label ?? "Scoped area"}</strong>
                </div>
              )}
              {brief.execution_brief.decision_contract && (
                <div
                  className={`attention-brief-contract ${brief.execution_brief.decision_contract.state}`}
                  data-agent-target="decision-contract"
                  aria-label="Desk decision contract"
                >
                  <span>Decision contract</span>
                  <strong>{brief.execution_brief.decision_contract.title}</strong>
                  <em>{brief.execution_brief.decision_contract.summary}</em>
                  <div>
                    <span>Agent may</span>
                    <strong>{brief.execution_brief.decision_contract.allowedAgentMoves[0]}</strong>
                  </div>
                  <div>
                    <span>Forbidden</span>
                    <strong>{brief.execution_brief.decision_contract.forbidden[0] ?? "No external send without approval."}</strong>
                  </div>
                </div>
              )}
              {brief.execution_brief.proof_gaps.length > 0 && (
                <div className="attention-brief-proof-gaps" aria-label="First move proof gaps">
                  <span>Proof gaps</span>
                  {brief.execution_brief.proof_gaps.slice(0, 3).map((gap, index) => (
                    <a
                      key={`${gap.key}-${gap.target}-${index}`}
                      href={brief.execution_brief?.href ?? "/dashboard"}
                      className={`attention-proof-gap ${gap.tone}`}
                      data-agent-target={gap.target}
                    >
                      <strong>{gap.owner} · {gap.label}</strong>
                      <em>{gap.action}</em>
                      <small>{gap.metric}{gap.detail ? ` · ${gap.detail}` : ""}</small>
                    </a>
                  ))}
                </div>
              )}
              {brief.execution_brief.gate_checks.length > 0 && (
                <div className="attention-brief-gates" aria-label="First move gates">
                  {brief.execution_brief.gate_checks.slice(0, 3).map((gate) => (
                    <span
                      key={`${gate.label}-${gate.metric}`}
                      className={gate.status}
                      data-agent-target={gate.label === "Decision quality" ? "decision-quality" : undefined}
                      aria-label={`${gate.label}: ${gate.metric}`}
                    >
                      {gate.label}
                      <strong>{gate.metric}</strong>
                    </span>
                  ))}
                </div>
              )}
              {brief.execution_brief.rank_reasons.length > 0 && (
                <div className="attention-brief-rank" aria-label="Why this is first">
                  <span>Why first</span>
                  <strong>
                    {brief.execution_brief.rank_reasons[0].label}: {brief.execution_brief.rank_reasons[0].summary}
                  </strong>
                </div>
              )}
              {ledgerStop && (
                <div className={`attention-brief-ledger ${ledgerStop.tone}`} aria-label="Command ledger stop rule">
                  <span>{ledgerStop.label}</span>
                  <strong>{ledgerStop.command}</strong>
                  <em>{ledgerStop.stopRule}</em>
                </div>
              )}
              {brief.execution_brief.evidence.length > 0 && (
                <div className="attention-brief-evidence" aria-label="First move evidence">
                  {brief.execution_brief.evidence.map((factor) => (
                    <span
                      key={`execution-${factor.label}`}
                      className={factor.tone}
                      data-agent-target={factor.label === "Decision quality" ? "decision-quality" : undefined}
                    >
                      {factor.label}
                      <strong>{factor.value}</strong>
                    </span>
                  ))}
                </div>
              )}
              {brief.execution_brief.blockers.length > 0 && (
                <div className="attention-brief-blockers" aria-label="First move blockers">
                  <span>Clear first</span>
                  {brief.execution_brief.blockers.slice(0, 2).map((blocker) => (
                    <strong key={`${blocker.label}-${blocker.ask}`}>
                      {blocker.label}: {blocker.ask}
                    </strong>
                  ))}
                </div>
              )}
              <DeskSafeAction brief={brief.execution_brief} />
              <small>{brief.execution_brief.safety}</small>
            </div>
          )}
          <div className="attention-brief-side">
            {brief.categoryBreakdown.slice(0, 4).map((bucket) => (
              <span key={bucket.category}>
                {bucket.label}
                <strong>{bucket.count}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="attention-queue-list">
        {items.map((item) => {
          const safeAction = operatorToolLabel(item.decisionMove?.toolHint);
          const rowAction = safeAction === "Open scoped record" ? item.actionLabel : safeAction;
          return (
          <div key={item.key} className={`attention-item ${item.tone}`}>
            <span className="attention-item-dot" />
            <a href={item.href} className="attention-item-copy">
              <strong>{item.title}</strong>
              <em>{item.meta}</em>
              <small>{item.reason}</small>
              {item.decisionMove && (
                <div className="attention-item-move" aria-label="Commercial move">
                  <span>{item.decisionMove.owner}</span>
                  <strong>{item.decisionMove.label}</strong>
                  <em>{item.decisionMove.command}</em>
                </div>
              )}
              {item.gateChecks && item.gateChecks.length > 0 && (
                <div className="attention-item-gates" aria-label="Decision gates">
                  {item.gateChecks.slice(0, 3).map((gate) => (
                    <span
                      key={`${item.key}-${gate.label}-${gate.metric}`}
                      className={gate.status}
                      data-agent-target={gate.label === "Decision quality" ? "decision-quality" : undefined}
                      aria-label={`${gate.label}: ${gate.metric}`}
                    >
                      <em>{gate.label}</em>
                      <strong>{gate.metric}</strong>
                    </span>
                  ))}
                </div>
              )}
              {item.proofGaps && item.proofGaps.length > 0 && (
                <div className="attention-item-proof-gaps" aria-label="Decision proof gaps">
                  {item.proofGaps.slice(0, 2).map((gap, index) => (
                    <span
                      key={`${item.key}-${gap.key}-${gap.target}-${index}`}
                      className={`attention-item-proof-gap ${gap.tone}`}
                      data-agent-target={gap.target}
                    >
                      <em>{gap.owner} · {gap.label}</em>
                      <strong>{gap.action}</strong>
                      <small>{gap.metric}</small>
                    </span>
                  ))}
                </div>
              )}
              {item.rankReasons && item.rankReasons.length > 0 && (
                <div className="attention-item-rank" aria-label="Why ranked here">
                  <span>Why ranked</span>
                  {item.rankReasons.slice(0, 2).map((reason) => (
                    <strong key={`${item.key}-${reason.label}-${reason.summary}`} className={reason.tone}>
                      {reason.label}: {reason.summary}
                    </strong>
                  ))}
                </div>
              )}
              {item.priorityFactors && item.priorityFactors.length > 0 && (
                <div className="attention-item-factors" aria-label="Priority factors">
                  {item.priorityFactors.slice(0, 5).map((factor) => (
                    <span
                      key={`${item.key}-${factor.label}`}
                      className={factor.tone}
                      data-agent-target={factor.label === "Decision quality" ? "decision-quality" : undefined}
                    >
                      {factor.label}
                      <strong>{factor.value}</strong>
                    </span>
                  ))}
                </div>
              )}
            </a>
            <div className="attention-item-actions">
              <span className="attention-item-action">
                {item.category} · {item.tone === "critical" ? "critical" : item.tone === "high" ? "high priority" : "normal"}
              </span>
              {item.entityType === "lead" && item.entityId ? (
                <form action={createRfqFromReferenceDeal} className="attention-item-form">
                  <input type="hidden" name="dealId" value={item.entityId} />
                  <button type="submit">{rowAction}</button>
                </form>
              ) : (
                <a href={item.href} className="attention-item-open">
                  {rowAction}
                  <Icon name="arrow-right" size={12} />
                </a>
              )}
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}

function DecisionFlowPanel({
  summary,
  opportunity,
  approvedDocs,
  totalDocs,
  targetPriceLabel,
}: {
  summary: ReferenceDealSummary;
  opportunity?: OpportunityScore | null;
  approvedDocs: number;
  totalDocs: number;
  targetPriceLabel: string;
}) {
  const topLead = summary.topDeals[0];
  const missingCount = opportunity?.missing.length ?? 0;
  const maturityBlocked = missingCount > 0;
  const quoteCoverage = opportunity?.evidence.quoteCoverage ?? "no quote coverage";
  const guardrail = opportunity?.price.guardrailStatus ?? "NEEDS_COST";
  const docsReady = totalDocs > 0 && approvedDocs === totalDocs;
  const steps = [
    {
      key: "lead",
      label: "Lead intake",
      status: summary.activeRows > 0 ? "live" : "empty",
      title: topLead ? topLead.contract : "No sheet rows",
      meta: topLead
        ? `${topLead.contact} · ${topLead.profit != null ? "profit known" : topLead.contractValue != null ? "value known" : "needs economics"}`
        : "No lead source loaded",
    },
    {
      key: "maturity",
      label: "RFQ maturity",
      status: maturityBlocked ? "blocked" : "ready",
      title: maturityBlocked ? `${missingCount} blocker${missingCount === 1 ? "" : "s"}` : "Mature enough",
      meta: maturityBlocked ? (opportunity?.missing.slice(0, 2).join(", ") ?? "Missing facts") : "Can move toward pricing",
    },
    {
      key: "price",
      label: "Pricing brain",
      status: guardrail === "PASS" ? "ready" : guardrail === "BLOCKED" ? "blocked" : "review",
      title: guardrail.toLowerCase().replace("_", " "),
      meta: `${targetPriceLabel} · ${quoteCoverage}`,
    },
    {
      key: "proof",
      label: "Document proof",
      status: docsReady ? "ready" : approvedDocs > 0 ? "review" : "blocked",
      title: `${approvedDocs}/${totalDocs} approved`,
      meta: docsReady ? "Proof pack ready" : "Upload, analyze, approve",
    },
  ];

  return (
    <section className="decision-flow-panel" data-agent-target="decision-flow">
      <div className="decision-flow-head">
        <div>
          <div className="decision-flow-kicker">Commercial brain</div>
          <h2>Lead to quote flow</h2>
        </div>
        <div className="decision-flow-note">
          One path: pick lead, mature RFQ, protect price, prove with documents.
        </div>
      </div>
      <div className="decision-flow-steps">
        {steps.map((step, index) => (
          <div key={step.key} className={`decision-flow-step ${step.status}`}>
            <div className="decision-flow-index">{index + 1}</div>
            <div className="decision-flow-copy">
              <span>{step.label}</span>
              <strong>{step.title}</strong>
              <em>{step.meta}</em>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ stage?: string }>;
}) {
  const sp = searchParams ? await searchParams : {};
  const stageOverride = sp.stage && ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "DELIVERED"].includes(sp.stage)
    ? sp.stage
    : null;
  return _DashboardPageImpl(stageOverride);
}

async function _DashboardPageImpl(stageOverride: string | null) {
  const session = await requireSession();
  const focusedId = await getFocusedJobId();
  const attentionItems = await listDecisionQueueItems(session.officeId, 8);
  const decisionBrief = buildDecisionQueueBrief(attentionItems);

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
      <div className="workbench-grid">
        <DecisionQueueSection items={attentionItems} brief={decisionBrief} />
        <div className="card workbench-empty-card">
          <div className="workbench-empty-title">No focused deal yet</div>
          <p className="workbench-empty-copy">
            Start from the decision queue, add a manual RFQ, or create a job. Once a deal exists, this page becomes the focused commercial desk.
          </p>
          <div className="workbench-empty-actions">
            <a href="/dashboard/rfq/new" className="btn btn-secondary">Manual RFQ</a>
            <a href="/dashboard/jobs/new" className="btn">New Job</a>
          </div>
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
          targetPriceHistory: { orderBy: { createdAt: "desc" }, take: 6 },
          // Inquiry-linked threads — these are the supplier replies attached
          // when the inquiry was the only attachment point.
          emailThreads: { include: { messages: { orderBy: { sentAt: "asc" } } } },
        },
      },
      targetPriceHistory: { orderBy: { createdAt: "desc" }, take: 6 },
      documents: { orderBy: { createdAt: "asc" } },
      milestones: { orderBy: { createdAt: "asc" } },
      emailThreads: { include: { messages: { orderBy: { sentAt: "asc" } } } },
    },
  });

  if (!job) {
    return <div className="workbench-not-found">Job not found.</div>;
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
    : await prisma.jobDocument.findMany({ where: { jobId, officeId: session.officeId }, orderBy: { createdAt: "asc" } });
  const milestones = job.milestones.length > 0
    ? job.milestones
    : await prisma.jobMilestone.findMany({ where: { jobId, job: { officeId: session.officeId } }, orderBy: { createdAt: "asc" } });

  const visibleStatus = job.status === "CUSTOMS" ? "IN_TRANSIT" : job.status;
  const currentIdx = (STATUS_ORDER as readonly string[]).indexOf(visibleStatus);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const timelineMilestones = milestones.filter((m) => !["ETD", "ETA", "CUSTOMS_ENTRY", "CUSTOMS_RELEASE"].includes(m.type));

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
    INQUIRY: "Qualify missing RFQ facts before forwarder handoff",
    QUOTED: "Prepare customer price and protect margin",
    BOOKED: "Booked / waiting cargo confirmation",
    IN_TRANSIT: "Track customer-visible updates by email",
    CUSTOMS: "Track customer-visible updates by email",
    DELIVERED: "Closed for margin review",
  };

  // Quote lines
  const quoteLines = (job.notes ?? "")
    .split("\n").filter((l) => l.includes("|"))
    .map((l) => { const [desc, amt, cur] = l.split("|"); return { desc, amount: Number(amt), cur }; });

  const carrierQuotes = job.inquiry?.carrierQuotes ?? [];
  const receivedQuotes = carrierQuotes.filter((q) => q.status === "RECEIVED");
  const opportunity = (await assessJobStrategy(session.officeId, job.id))?.strategy;

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

  const laneRates: {
    id: string; origin: string; destination: string; mode: string;
    baseAmount: number; currency: string; validFrom: Date; validTo: Date | null; notes: string | null;
  }[] = [];

  const referenceDealSummary = getReferenceDealSummary();
  const referenceDealDecisions = getReferenceDealDecisions(undefined, 6);
  const referenceDealPlaybook = buildReferenceDealOperatorPlaybook(referenceDealDecisions, referenceDealSummary);

  const suggestions = [
    "Rank the control sheet leads.",
    "What is missing before this RFQ can go to forwarders?",
    "Check target price and margin.",
    "Draft the missing-info email to the customer.",
  ];
  const routeLabel = job.origin && job.destination
    ? `${job.origin} → ${job.destination}`
    : "Route TBD";
  const modeLabel = job.mode ? (MODE_LABEL[job.mode] ?? job.mode) : "Mode TBD";
  const approvedDocs = docs.filter((d) => d.status === "APPROVED").length;
  const costLabel = job.cost ? `$${job.cost.toLocaleString()}` : "—";
  const marginLabel = job.revenue && job.cost
    ? `${(((job.revenue - job.cost) / job.revenue) * 100).toFixed(1)}%`
    : "—";
  const targetPriceLabel = job.targetPrice
    ? `${job.targetCurrency ?? job.currency ?? "USD"} ${job.targetPrice.toLocaleString()}`
    : job.targetPriceStatus === "NO_TARGET" ? "No target" : "Ask";
  const targetPriceTrail = [...job.targetPriceHistory, ...(job.inquiry?.targetPriceHistory ?? [])]
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const nextMilestone = timelineMilestones.find((m) => !m.actualAt);
  const nextMilestoneLabel = nextMilestone
    ? `${MILESTONE_LABEL[nextMilestone.type] ?? nextMilestone.type}${nextMilestone.plannedAt ? ` · ${fmt(nextMilestone.plannedAt)}` : ""}`
    : "All clear";

  return (
    <div className="workbench-grid">
      {/* LEFT: main workspace stack */}
      <div className="workbench-main">
        <section className="ops-brief" aria-label="Lead-to-quote desk brief" data-agent-target="job-brief">
          <div className="ops-brief-copy">
            <div className="ops-eyebrow">
              <span className="ops-status-light" aria-hidden />
              RFQ desk
            </div>
            <div className="ops-brief-title">
              <span>{job.reference}</span>
              <strong>{job.company?.name ?? "Unassigned customer"}</strong>
            </div>
            <div className="ops-brief-meta">
              <span>{modeLabel}</span>
              <span>{routeLabel}</span>
              <span>{STATUS_LABEL[visibleStatus] ?? visibleStatus}</span>
            </div>
          </div>

          <div className="ops-route-visual" aria-hidden="true">
            <span className="ops-route-label">{job.origin ?? "Origin TBD"}</span>
            <span className="ops-route-line">
              <span className="ops-route-port start" />
              <span className="ops-route-vessel" />
              <span className="ops-route-port end" />
            </span>
            <span className="ops-route-label right">{job.destination ?? "Destination TBD"}</span>
          </div>

          <div className="ops-brief-stats">
            <div className="ops-brief-stat">
              <span>Target</span>
              <strong>{targetPriceLabel}</strong>
            </div>
            <div className="ops-brief-stat">
              <span>Forwarders</span>
              <strong>{receivedQuotes.length}/{carrierQuotes.length}</strong>
            </div>
            <div className="ops-brief-stat">
              <span>Margin</span>
              <strong>{marginLabel}</strong>
            </div>
          </div>
        </section>

        <DecisionFlowPanel
          summary={referenceDealSummary}
          opportunity={opportunity}
          approvedDocs={approvedDocs}
          totalDocs={docs.length}
          targetPriceLabel={targetPriceLabel}
        />

        <TargetPriceTrail
          entries={targetPriceTrail}
          currentLabel={targetPriceLabel}
          currentSource={job.targetPriceSource}
          currentStatus={job.targetPriceStatus}
        />

        <DecisionQueueSection items={attentionItems} brief={decisionBrief} />

      <ReferenceDealSnapshot summary={referenceDealSummary} decisions={referenceDealDecisions} playbook={referenceDealPlaybook} />

      <section className="job-command-panel" aria-label="Focused job" data-agent-target="job-summary">
        <div className="job-command-main">
          <div className="job-command-eyebrow">
            <span className="job-reference">{job.reference}</span>
            <span className="job-stage-pill">{STATUS_LABEL[visibleStatus] ?? visibleStatus}</span>
            {opportunity && <OpportunityScorePill score={opportunity} />}
          </div>
          <div className="job-command-title-row">
            {job.company ? (
              <CustomerPopover companyId={job.company.id} name={job.company.name} />
            ) : (
              <span className="job-command-customer">Unknown Customer</span>
            )}
            <span className="job-command-route">{routeLabel}</span>
          </div>
          <div className="job-command-meta">
            <span>{modeLabel}</span>
            <span>Target {targetPriceLabel}</span>
            <span>{carrierQuotes.length} forwarder requests</span>
          </div>
        </div>

        <div className="job-command-actions">
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
                dimensions: job.dimensions, stackable: job.stackable, topLoad: job.topLoad,
                dangerousGoods: job.dangerousGoods, customsBy: job.customsBy,
                containerCount: job.containerCount, containerType: job.containerType,
                etd: job.etd, eta: job.eta,
                revenue: job.revenue, cost: job.cost, currency: job.currency,
                targetPrice: job.targetPrice, targetCurrency: job.targetCurrency,
                targetPriceStatus: job.targetPriceStatus, targetPriceSource: job.targetPriceSource,
                notes: job.notes,
              }}
              companies={companies}
            />
            <span className="job-command-shortcut">
              <kbd>⌘K</kbd> switch
            </span>
        </div>

        <div className="job-command-metrics" aria-label="Job summary">
          <div className="job-command-metric">
            <span>Target price</span>
            <strong>{targetPriceLabel}</strong>
          </div>
          <div className="job-command-metric">
            <span>Cost</span>
            <strong>{costLabel}</strong>
          </div>
          <div className="job-command-metric">
            <span>Margin</span>
            <strong>{marginLabel}</strong>
          </div>
          <div className="job-command-metric">
            <span>Documents</span>
            <strong>{approvedDocs}/{docs.length}</strong>
          </div>
          <div className="job-command-metric">
            <span>Next milestone</span>
            <strong>{nextMilestoneLabel}</strong>
          </div>
        </div>

        <div className="status-pipeline job-command-pipeline">
          {STATUS_ORDER.map((s, i) => (
            <div key={s} className={`status-step ${i < currentIdx ? "done" : i === currentIdx ? "current" : ""}`}>
              <span className="status-step-label">{STATUS_LABEL[s]}</span>
              {i < STATUS_ORDER.length - 1 && <div className="status-step-line" />}
            </div>
          ))}
        </div>

        <div className="job-command-automation">
          <span className="live-dot" aria-hidden />
          <span>Desk status</span>
          <strong>{NEXT_AUTO[job.status]}</strong>
        </div>
      </section>

      {opportunity && (
        <div data-agent-target="strategy">
          <OpportunityScoreCard score={opportunity} />
        </div>
      )}

      <div className="card workbench-card" data-agent-target="timeline">
        <div className="workbench-card-header">
          <div className="workbench-kicker">Deal Timeline</div>
          <div className="workbench-note small">
            {timelineMilestones.filter((m) => m.actualAt).length} of {timelineMilestones.length} confirmed
          </div>
        </div>
        <div className="ms-track">
          {timelineMilestones.map((m, i) => {
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
      <div className="workbench-section">
        <StageEmailPanel
          jobId={job.id}
          status={job.status}
          hints={templatesForStatus(job.status)}
          threads={threadsView}
          defaultRecipient={defaultEmailRecipient}
        />
      </div>

      <div className="workbench-stack">
          {/* Carrier */}
          <CollapsibleCard
            title="Forwarder pricing"
            defaultOpen={false}
            agentTarget="forwarder-pricing"
            meta={receivedQuotes.length > 0
              ? <span>· {receivedQuotes.length} of {carrierQuotes.length} replied</span>
              : null
            }
          >
            <div className="workbench-card-body">
              {!job.inquiry ? (
                <div className="workbench-empty-line">No source RFQ - pricing tracked manually.</div>
              ) : carrierQuotes.length === 0 ? (
                <div className="workbench-empty-line">No forwarder pricing requests sent yet.</div>
              ) : (
                <div className="workbench-row-list">
                  {carrierQuotes.map((q) => {
                    const total = q.total40HC ?? q.total40 ?? q.total20;
                    const isSelected = job.cost && total === job.cost;
                    return (
                      <div key={q.id} className="workbench-row">
                        <div className="workbench-row-main">
                          <div className="workbench-row-title">{q.carrier}</div>
                          <div className="workbench-row-sub">
                            {q.status === "PENDING" ? "Awaiting reply" : `${q.transitDays ? `${q.transitDays}d transit` : "-"}${q.service ? ` - ${q.service}` : ""}`}
                          </div>
                        </div>
                        <div className="workbench-row-side">
                          {q.status === "RECEIVED" && total ? (
                            <span className="workbench-money">${total.toLocaleString()}</span>
                          ) : (
                            <span className="workbench-pending">pending</span>
                          )}
                          {isSelected && (
                            <span className="workbench-selected-badge">SELECTED</span>
                          )}
                          {!isSelected && q.status === "RECEIVED" && (
                            <form action={selectCarrierQuote.bind(null, job.id, q.id)}>
                              <button type="submit" className="btn btn-secondary btn-sm">Select</button>
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
            defaultOpen
            agentTarget="documents"
            meta={<span>· {docs.filter((d) => d.status === "APPROVED").length}/{docs.length} approved</span>}
          >
            <div className="workbench-card-body tight">
              <DocumentReadinessBoard docs={docs} title={`${job.reference} document control`} />
              {docs.map((d) => (
                <div key={d.id} className="workbench-row">
                  <div className={`workbench-doc-icon${d.status === "APPROVED" ? " approved" : ""}`}>
                    {d.status === "APPROVED" ? <Icon name="check" size={11} strokeWidth={2.5} />
                      : d.status === "UPLOADED" ? <Icon name="chevron-up" size={11} strokeWidth={2.5} />
                      : <Icon name="circle" size={9} strokeWidth={1.5} />}
                  </div>
                  <div className="workbench-row-main">
                    <div className="workbench-row-title">{d.name}</div>
                    <div className="workbench-row-sub">{DOC_TYPE_LABEL[d.docType] ?? d.docType} - {d.status.toLowerCase()}</div>
                  </div>
                  <div className="workbench-actions-inline">
                    {d.status === "PENDING" && (
                      <form action={uploadJobDocument.bind(null, d.id)} className="record-upload-form compact">
                        <input
                          type="file"
                          name="file"
                          required
                          accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,application/pdf,image/*"
                        />
                        <button type="submit" className="btn btn-secondary btn-sm">Upload</button>
                      </form>
                    )}
                    {d.status === "UPLOADED" && (
                      <form action={updateDocStatus.bind(null, d.id, "APPROVED")}>
                        <button type="submit" className="btn btn-sm">Approve</button>
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
            agentTarget="financials"
            meta={
              <a href={`/api/jobs/${job.id}/quote-pdf`} target="_blank" className="workbench-link-action">
                <Icon name="external" size={10} /> Quote PDF
              </a>
            }
          >
            <div className="workbench-financial-grid">
              <div>
                <div className="workbench-stat-label">Revenue</div>
                <div className="workbench-stat-value">{job.revenue ? `$${job.revenue.toLocaleString()}` : "-"}</div>
              </div>
              <div>
                <div className="workbench-stat-label">Cost</div>
                <div className="workbench-stat-value">{job.cost ? `$${job.cost.toLocaleString()}` : "-"}</div>
              </div>
              <div>
                <div className="workbench-stat-label">Margin</div>
                <div className="workbench-stat-value">
                  {job.revenue && job.cost ? `${(((job.revenue - job.cost) / job.revenue) * 100).toFixed(1)}%` : "-"}
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

function formatUsd(value: number) {
  return `$${Math.round(value).toLocaleString()}`;
}

function referenceDecisionClass(stage: string) {
  return stage.toLowerCase().replace(/_/g, "-");
}

function ReferenceDealSnapshot({
  summary,
  decisions,
  playbook,
}: {
  summary: ReferenceDealSummary;
  decisions: ReferenceDealDecision[];
  playbook: ReferenceDealOperatorPlaybook;
}) {
  const statusLabels = {
    BOOKED: "Booked",
    PRICING: "Pricing",
    SPECULATION: "Speculation",
    MISSED: "Missed",
  };
  const statusTotal = Math.max(1, Object.values(summary.byStatus).reduce((sum, count) => sum + count, 0));

  return (
    <section className="sheet-snapshot" data-agent-target="reference-deals">
      <div className="sheet-snapshot-header">
        <div>
          <div className="sheet-kicker">Control sheet decision board</div>
          <h2>Where the next RFQ money is</h2>
        </div>
        <div className="sheet-total">
          <strong>{summary.activeRows}</strong>
          <span>active rows</span>
        </div>
      </div>

      <div className="sheet-metrics">
        <div>
          <span>Known contract</span>
          <strong>{formatUsd(summary.knownContractUsd)}</strong>
        </div>
        <div>
          <span>Known profit</span>
          <strong>{formatUsd(summary.knownProfitUsd)}</strong>
        </div>
        <div>
          <span>Monthly rows</span>
          <strong>{summary.monthlyRows}</strong>
        </div>
        <div>
          <span>Bad freight rows</span>
          <strong>{summary.hygiene.incompleteFreightRows}</strong>
        </div>
      </div>

      <div className="sheet-playbook" data-agent-target="reference-deal-playbook">
        <div className="sheet-playbook-main">
          <div className="sheet-section-label">Operator playbook</div>
          <strong>{playbook.headline}</strong>
          <span>{playbook.firstMove}</span>
          <em>{playbook.safetyRule}</em>
        </div>
        <div className="sheet-playbook-counts" aria-label="Control sheet decision counts">
          <div>
            <span>RFQ candidates</span>
            <strong>{playbook.decisionCounts.rfqCandidates}</strong>
          </div>
          <div>
            <span>Need facts</span>
            <strong>{playbook.decisionCounts.blockedForFacts}</strong>
          </div>
          <div>
            <span>Non-RFQ</span>
            <strong>{playbook.decisionCounts.nonRfqContext}</strong>
          </div>
          <div>
            <span>Proof / loss</span>
            <strong>{playbook.decisionCounts.bookedProof + playbook.decisionCounts.lossEvidence}</strong>
          </div>
        </div>
      </div>

      <div className="sheet-status-map">
        {Object.entries(summary.byStatus).map(([status, count]) => (
          <div key={status} className={`sheet-status-row ${status.toLowerCase()}`}>
            <span>{statusLabels[status as keyof typeof statusLabels]}</span>
            <div>
              <i style={{ width: `${Math.max(6, Math.round((count / statusTotal) * 100))}%` }} />
            </div>
            <strong>{count}</strong>
          </div>
        ))}
      </div>

      <div className="sheet-body-grid">
        <div className="sheet-top-list">
          <div className="sheet-section-label">Highest-value decision rows</div>
          {decisions.slice(0, 5).map((deal, index) => {
            const decisionClass = referenceDecisionClass(deal.decision.stage);
            return (
            <div
              key={deal.dealId}
              className={`sheet-deal-row ${decisionClass}`}
              data-agent-target={`reference-deal-row reference-deal-${decisionClass}${index === 0 ? " reference-deal-top" : ""}`}
            >
              <div className="sheet-deal-score">
                {deal.tone === "critical" ? "Critical" : deal.tone === "high" ? "High" : "Normal"}
              </div>
              <div className="sheet-deal-main">
                <strong>{deal.title}</strong>
                <span>{deal.meta}</span>
                <em>{deal.decision.command}</em>
              </div>
              <div className="sheet-deal-side">
                <strong>{deal.decision.stageLabel}</strong>
                <span>{deal.decision.evidenceGaps.length ? deal.decision.evidenceGaps.slice(0, 3).join(", ") : "proof clear"}</span>
                <em>{deal.decision.stopRule}</em>
              </div>
              {deal.decision.canCreateRfq ? (
                <form action={createRfqFromReferenceDeal} className="sheet-deal-action">
                  <input type="hidden" name="dealId" value={deal.dealId} />
                  <button type="submit">{operatorToolLabel("prepare_control_sheet_rfq")}</button>
                </form>
              ) : (
                <div className="sheet-deal-action sheet-deal-action-disabled">
                  <span>{operatorToolLabel("inspect_control_sheet")}</span>
                </div>
              )}
            </div>
            );
          })}
        </div>

        <div className="sheet-contact-list">
          <div className="sheet-section-label">Where the money is clustered</div>
          {summary.byContact.slice(0, 3).map((contact) => (
            <div key={contact.contact} className="sheet-contact-row">
              <strong>{contact.contact}</strong>
              <span>{contact.count} rows</span>
              <em>{formatUsd(contact.knownProfitUsd)}</em>
            </div>
          ))}
          <div className="sheet-hygiene-note">
            {summary.hygiene.missingProfitRows} rows have unknown profit; {summary.hygiene.missingOriginDestinationRows} freight rows lack a full lane.
          </div>
        </div>
      </div>
    </section>
  );
}

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
  const actualStatus = job.status === "CUSTOMS" ? "IN_TRANSIT" : job.status;
  const status = stageOverride ?? actualStatus;
  const isPreview = !!stageOverride && stageOverride !== actualStatus;

  // Header strip + stage-specific content
  const STAGE_TITLES: Record<string, { title: string; sub: string }> = {
    INQUIRY:    { title: "Source RFQ & rate procurement",   sub: "What an inquiry needs: parsed fields, then carrier rate sourcing." },
    QUOTED:     { title: "Sellside quote builder",           sub: "Build the customer-facing quote. Send when ready." },
    BOOKED:     { title: "Booked / waiting cargo",           sub: "Confirm booking details and wait for cargo readiness." },
    IN_TRANSIT: { title: "En route",                         sub: "Use email updates as the source of truth until delivery." },
    DELIVERED:  { title: "Settlement",                       sub: "Final invoice, margin reconciliation." },
  };
  const stage = STAGE_TITLES[status] ?? { title: "Workbench", sub: "" };

  const STAGE_KEYS = ["INQUIRY", "QUOTED", "BOOKED", "IN_TRANSIT", "DELIVERED"] as const;
  return (
    <div className="stage-shell" data-agent-target="stage-workbench">
      <div className="stage-header">
        <div className="stage-heading">
          <div className="stage-eyebrow">
            Stage workbench · {STATUS_LABEL[status] ?? status}
            {isPreview && (
              <span className="stage-preview-pill">
                Preview · job is {STATUS_LABEL[actualStatus] ?? actualStatus}
              </span>
            )}
          </div>
          <div className="stage-title">{stage.title}</div>
          <div className="stage-subtitle">{stage.sub}</div>
        </div>
        <div className="stage-switcher" role="tablist" aria-label="Workbench stage">
          {STAGE_KEYS.map((s) => {
            const isActive = s === status;
            const isReal = s === actualStatus;
            const href = s === actualStatus ? "/dashboard" : `/dashboard?stage=${s}`;
            return (
              <a
                key={s}
                href={href}
                title={isReal ? "Job is at this stage" : `Preview ${STATUS_LABEL[s]} workbench (doesn't change status)`}
                className={`stage-tab${isActive ? " active" : ""}${isReal ? " current" : ""}`}
                role="tab"
                aria-selected={isActive}
              >
                {isReal && (
                  <span className="stage-real-dot" aria-hidden />
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
        {status === "BOOKED" && (
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
    <div className="workbench-stack">
      {laneRates.length > 0 && <LaneRatesPanel laneRates={laneRates} />}
    <div className="workbench-grid-2">
      {/* Source RFQ */}
      <div className="card" data-agent-target="source-rfq">
        <div className="worktable-section-header split">
          <span>Source RFQ</span>
          {job.inquiry && (
            <a href={`/dashboard/rfq/${job.inquiry.id}`} className="workbench-link-action">
              Open RFQ
            </a>
          )}
        </div>
        <div className="workbench-card-body">
          {job.inquiry ? (
            <>
              <div className="stage-source-title">{job.inquiry.subject}</div>
              <div className="stage-source-meta">
                From {job.inquiry.fromEmail ?? job.inquiry.fromCompany ?? "Unknown"} - {new Date(job.inquiry.receivedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </div>
              {job.inquiry.rawEmailBody && (
                <div className="stage-email-raw">
                  {job.inquiry.rawEmailBody}
                </div>
              )}
            </>
          ) : (
            <div className="workbench-empty-line">No source RFQ - this job was created manually.</div>
          )}
        </div>
      </div>

      {/* Carrier rate procurement */}
      <div className="card" data-agent-target="carrier-rates">
        <div className="worktable-section-header split">
          <span>Carrier Rates ({receivedQuotes.length}/{carrierQuotes.length})</span>
          {receivedQuotes.length > 0 && (
            <span className="workbench-note small">
              Best: ${Math.min(...receivedQuotes.map((q: any) => q.total40HC ?? q.total40 ?? q.total20 ?? Infinity)).toLocaleString()}
            </span>
          )}
        </div>
        <div className="workbench-card-body flush">
          {!job.inquiry ? (
            <div className="workbench-card-body">
              No source RFQ is linked to this job yet.
            </div>
          ) : carrierQuotes.length === 0 ? (
            <div className="workbench-card-body">
              <div className="workbench-empty-line quote-empty">
                No carrier replies yet. Add the first received rate here; rate-request drafting lives in the email panel below.
              </div>
              <form action={addCarrierQuote.bind(null, job.inquiry.id)} className="stage-rate-form">
                <input name="carrier" required placeholder="Carrier" />
                <input name="service" placeholder="Service" />
                <input name="total40HC" type="number" placeholder="40HC rate" />
                <input name="transit" type="number" placeholder="Transit days" />
                <input name="validity" placeholder="Validity" />
                <button type="submit" className="btn btn-secondary btn-sm">Add rate</button>
              </form>
            </div>
          ) : (
            <div className="stage-table-wrap">
            <table className="stage-table">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th className="right">20'</th>
                  <th className="right">40'</th>
                  <th className="right">40HC</th>
                  <th className="right">Transit</th>
                  <th className="right">Status</th>
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
                      <tr key={q.id} className={isCheapest ? "recommended" : undefined}>
                        <td className="strong">
                          {q.carrier}
                          {isCheapest && (
                            <span className="workbench-selected-badge inline">
                              BEST
                            </span>
                          )}
                        </td>
                        <td className="right money">{q.total20 ? `$${q.total20.toLocaleString()}` : "-"}</td>
                        <td className="right money">{q.total40 ? `$${q.total40.toLocaleString()}` : "-"}</td>
                        <td className="right money strong">{q.total40HC ? `$${q.total40HC.toLocaleString()}` : "-"}</td>
                        <td className="right muted">{q.transitDays ? `${q.transitDays}d` : "-"}</td>
                        <td className="right">
                          <span className={`workbench-status-badge${q.status === "RECEIVED" ? " received" : ""}`}>
                            {q.status === "RECEIVED" ? "REPLIED" : "PENDING"}
                          </span>
                        </td>
                        <td className="right">
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
            </div>
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
    <div className="workbench-stack">
      {/* Carrier rate aggregation table (same shape as the Lane Prices page) */}
      <div className="card stage-panel" data-agent-target="carrier-rates">
        <div className="worktable-section-header split">
          <div>
            <div className="stage-panel-title">Carrier rates received</div>
            <div className="stage-panel-subtitle">
              Aggregated quotes for this load. Cheapest 40HC flagged. Click Use this rate to seed the customer-facing quote.
            </div>
          </div>
          <div className="workbench-count-row">
            <span className="workbench-count-pill">Pending: {pending.length}</span>
            <span className="workbench-count-pill received">Received: {received.length}</span>
          </div>
        </div>
        {received.length === 0 ? (
          <div className="workbench-card-body center">
            No carrier rate replies on this load yet.
          </div>
        ) : (
          <div className="stage-table-wrap">
            <table className="stage-table">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th>Service</th>
                  <th className="right">20DRY</th>
                  <th className="right">40DRY</th>
                  <th className="right">40HC</th>
                  <th className="center">Transit</th>
                  <th>Validity</th>
                  <th> </th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((q: any) => {
                  const isRec = recommended?.id === q.id;
                  const seedDescription = `Ocean Freight — ${q.carrier}${q.service ? ` (${q.service})` : ""}`;
                  const seedAmount = q.total40HC ?? q.total40 ?? q.total20 ?? 0;
                  return (
                    <tr key={q.id} className={isRec ? "recommended" : undefined}>
                      <td>
                        <div className="stage-carrier-lockup">
                          <div className="stage-carrier-avatar">
                            {initials(q.carrier)}
                          </div>
                          <div>
                            <div className="stage-carrier-name">{q.carrier}</div>
                            {isRec && <div className="stage-best-note">Best 40HC</div>}
                          </div>
                        </div>
                      </td>
                      <td className="muted">{q.service ?? "-"}</td>
                      <td className="right money">{q.total20 ? `$${q.total20.toLocaleString()}` : "-"}</td>
                      <td className="right money">{q.total40 ? `$${q.total40.toLocaleString()}` : "-"}</td>
                      <td className={`right money strong${isRec ? " brand" : ""}`}>{q.total40HC ? `$${q.total40HC.toLocaleString()}` : "-"}</td>
                      <td className="center muted">{q.transitDays ? `${q.transitDays}d` : "-"}</td>
                      <td className="muted">{q.validity ?? "-"}</td>
                      <td>
                        <form action={addQuoteLine.bind(null, job.id)}>
                          <input type="hidden" name="description" value={seedDescription} />
                          <input type="hidden" name="amount" value={seedAmount} />
                          <input type="hidden" name="currency" value="USD" />
                          <button type="submit" className="btn btn-secondary btn-sm stage-nowrap">
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
      <div className="card" data-agent-target="customer-quote">
        <div className="worktable-section-header split">
          <span>Customer quote - {job.reference}</span>
          <div className="workbench-actions-inline">
            <a href={`/api/jobs/${job.id}/quote-pdf`} target="_blank" className="btn btn-secondary btn-sm">
              Preview PDF
            </a>
            <a href="#job-email" className="btn btn-sm">
              Compose customer email
            </a>
          </div>
        </div>
        <div className="workbench-card-body">
          {quoteLines.length === 0 ? (
            <div className="workbench-empty-line quote-empty">
              No line items yet. Click <strong>Use this rate</strong> on a carrier above, or add a line manually below.
            </div>
          ) : (
            <table className="stage-table quote-lines">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="right">Amount</th>
                  <th>Cur</th>
                </tr>
              </thead>
              <tbody>
                {quoteLines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.desc}</td>
                    <td className="right strong">{l.amount.toLocaleString()}</td>
                    <td className="muted">{l.cur}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td className="strong">Total</td>
                  <td className="right strong">{total.toLocaleString()}</td>
                  <td className="muted">{quoteLines[0]?.cur ?? "USD"}</td>
                </tr>
              </tbody>
            </table>
          )}
          <form action={addQuoteLine.bind(null, job.id)} className="stage-quote-form">
            <input name="description" placeholder="Description (e.g. Documentation, customs clearance)" required />
            <input name="amount" type="number" placeholder="Amount" required />
            <select name="currency" defaultValue="USD"><option>USD</option><option>EUR</option><option>TRY</option><option>GBP</option></select>
            <button className="btn btn-secondary btn-sm" type="submit">Add line</button>
          </form>
        </div>
      </div>
    </div>
  );
}

function LaneRatesPanel({ laneRates }: { laneRates: any[] }) {
  return (
    <div className="card" data-agent-target="lane-rates">
      <div className="worktable-section-header split">
        <span>Standard Lane Rates - {laneRates.length} match{laneRates.length === 1 ? "" : "es"} for this lane</span>
        <span className="workbench-note small">From your rate library</span>
      </div>
      <div className="workbench-card-body flush">
        <div className="stage-table-wrap">
        <table className="stage-table">
          <thead>
            <tr>
              <th>Lane</th>
              <th>Mode</th>
              <th className="right">Base rate</th>
              <th className="right">Valid</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {laneRates.map((r) => (
              <tr key={r.id}>
                <td className="strong">{r.origin} to {r.destination}</td>
                <td className="muted">{r.mode}</td>
                <td className="right strong">{r.currency} {r.baseAmount.toLocaleString()}</td>
                <td className="right muted">
                  {new Date(r.validFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                  {r.validTo ? ` - ${new Date(r.validTo).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}` : ""}
                </td>
                <td className="muted">{r.notes ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function DocumentsStage({ job, docs }: { job: any; docs: any[] }) {
  const approved = docs.filter((d) => d.status === "APPROVED").length;
  return (
    <div className="card" data-agent-target="documents">
      <div className="worktable-section-header">
        Documents · {approved}/{docs.length} approved
      </div>
      <DocumentReadinessBoard docs={docs} title={`${job.reference} document control`} />
      <div>
        {docs.map((d) => {
          let flags: string[] = [];
          let keyFields: Record<string, unknown> = {};
          if (d.aiFlags) { try { const x = JSON.parse(d.aiFlags); if (Array.isArray(x)) flags = x.filter((y: unknown) => typeof y === "string") as string[]; } catch {} }
          if (d.aiKeyFields) { try { const x = JSON.parse(d.aiKeyFields); if (x && typeof x === "object") keyFields = x; } catch {} }
          return (
          <div key={d.id} className="document-stage-row">
            <div className="document-stage-top">
              <div className="document-stage-main">
                <div className={`workbench-doc-icon${d.status === "APPROVED" ? " approved" : ""}`}>
                  {d.status === "APPROVED" ? <Icon name="check" size={14} strokeWidth={2.5} />
                    : d.status === "UPLOADED" ? <Icon name="chevron-up" size={13} strokeWidth={2.5} />
                    : <Icon name="circle" size={11} strokeWidth={1.5} />}
                </div>
                <div className="document-stage-copy">
                  <div className="document-stage-title">{d.name}</div>
                  <div className="document-stage-meta">
                    {DOC_TYPE_LABEL[d.docType] ?? d.docType} - {d.status.toLowerCase()}
                    {d.aiAnalyzedAt && <span>AI commented</span>}
                  </div>
                </div>
              </div>
              <div className="workbench-actions-inline">
                {d.url && d.status !== "PENDING" && (
                  <DocumentViewer documentId={d.id} name={d.name} status={d.status} />
                )}
                {d.status === "PENDING" && (
                  <form action={uploadJobDocument.bind(null, d.id)} className="record-upload-form compact">
                    <input
                      type="file"
                      name="file"
                      required
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,application/pdf,image/*"
                    />
                    <button type="submit" className="btn btn-secondary btn-sm">Upload</button>
                  </form>
                )}
                {d.status === "UPLOADED" && (
                  <form action={updateDocStatus.bind(null, d.id, "APPROVED")}>
                    <button type="submit" className="btn btn-sm">Approve</button>
                  </form>
                )}
              </div>
            </div>
            {(d.aiSummary || flags.length > 0) && (
              <div className="document-ai-block">
                {d.aiSummary && (
                  <div className="document-ai-summary">
                    <span>AI</span>
                    {d.aiSummary}
                  </div>
                )}
                {flags.length > 0 && (
                  <div className="document-flag-list">
                    {flags.map((f: string, i: number) => (
                      <div key={i} className="document-flag-row">
                        <Icon name="alert" size={11} /><span>{f}</span>
                      </div>
                    ))}
                  </div>
                )}
                {Object.keys(keyFields).length > 0 && (
                  <details className="document-fields">
                    <summary>
                      Extracted fields ({Object.keys(keyFields).length})
                    </summary>
                    <div className="document-field-grid">
                      {Object.entries(keyFields).map(([k, v]) => (
                        <Fragment key={k}>
                          <span>{k}</span>
                          <strong>{Array.isArray(v) ? v.join(", ") : String(v)}</strong>
                        </Fragment>
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
    <div className="workbench-stack">
      <div className="workbench-grid-2">
        <div className="card" data-agent-target="movement">
          <div className="worktable-section-header">Email-tracked movement</div>
          <div className="stage-detail-grid">
            <span>Carrier</span>
            <span>{selected?.carrier ?? "-"}</span>
            <span>Service</span>
            <span>{selected?.service ?? "-"}</span>
            <span>Transit</span>
            <span>{selected?.transitDays ? `${selected.transitDays} days` : "-"}</span>
            <span>Updates</span>
            <span>Tracked from email threads</span>
          </div>
        </div>
        <div className="card" data-agent-target="carrier-rates">
          <div className="worktable-section-header">Carrier rates received <span className="worktable-header-meta">- {received.length} of {carrierQuotes.length}</span></div>
          <div className="workbench-card-body">
            {received.length === 0 ? (
              <div className="workbench-empty-line">No carrier replies on this load yet.</div>
            ) : (
              <div className="workbench-row-list">
                {received.map((q: any) => {
                  const total = q.total40HC ?? q.total40 ?? q.total20;
                  const isSelected = total === job.cost;
                  return (
                    <div key={q.id} className="workbench-row">
                      <div className="workbench-row-main">
                        <div className="workbench-row-title">{q.carrier}</div>
                        <div className="workbench-row-sub">{q.service ?? "-"}{q.transitDays ? ` - ${q.transitDays}d` : ""}</div>
                      </div>
                      <div className="workbench-row-side">
                        <span className="workbench-money">{total ? `$${total.toLocaleString()}` : "-"}</span>
                        {isSelected && (
                          <span className="workbench-selected-badge">SELECTED</span>
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
    <div className="card" data-agent-target="settlement">
      <div className="worktable-section-header">Final settlement</div>
      <div className="workbench-settlement-grid">
        <div>
          <div className="workbench-stat-label">Revenue billed</div>
          <div className="workbench-stat-value">${totalRev.toLocaleString()}</div>
        </div>
        <div>
          <div className="workbench-stat-label">Carrier cost</div>
          <div className="workbench-stat-value">${(job.cost ?? 0).toLocaleString()}</div>
        </div>
        <div>
          <div className="workbench-stat-label">Gross margin</div>
          <div className="workbench-stat-value">{margin != null ? `$${margin.toLocaleString()}` : "-"}</div>
        </div>
        <div>
          <div className="workbench-stat-label">Margin %</div>
          <div className="workbench-stat-value">{marginPct != null ? `${marginPct.toFixed(1)}%` : "-"}</div>
        </div>
      </div>
    </div>
  );
}
