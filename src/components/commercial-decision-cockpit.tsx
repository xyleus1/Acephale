import { Icon } from "./icon";
import { CommercialChecklistAction } from "@/components/commercial-checklist-action";
import { CommercialChecklistRow } from "@/components/commercial-checklist-row";
import { buildStrategyExecutionPacket, buildStrategyRouteDecision, type CommercialStrategy, type StrategyQuoteGate, type StrategyRouteDecisionRow } from "@/lib/commercial-strategy";
import { commercialChecklistItemsWithActions } from "@/lib/commercial-checklist-actions";
import { CustomerQuoteDraftButton } from "@/components/customer-quote-draft-button";
import { ForwarderDraftsButton } from "@/components/forwarder-drafts-button";
import { MissingInfoDraftButton } from "@/components/missing-info-draft-button";
import { NegotiationPlanDraftButton } from "@/components/negotiation-plan-draft-button";
import { PricingScenarioSandbox } from "@/components/pricing-scenario-sandbox";
import { buildDocumentReadiness } from "@/lib/document-readiness";
import { operatorPhaseLabel, operatorSurfaceLabel, operatorToolLabel } from "@/lib/operator-action-labels";

type DecisionDoc = {
  id: string;
  name: string;
  status: string;
  aiSummary?: string | null;
  aiFlags?: string | null;
  aiKeyFields?: string | null;
};

type RecentDraftState = {
  label: string;
  status: string;
  occurredAt: string;
  summary: string;
  detail: string;
  reviewUrl?: string | null;
  tone: "ready" | "review" | "blocked";
  isStale: boolean;
  staleReason?: string | null;
};

type AuditDraftHealth = {
  total: number;
  current: number;
  stale: number;
  legacy: number;
};

function money(value: number | null | undefined, currency: string) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${currency} ${Math.round(value).toLocaleString()}`;
}

function quoteGateTone(status: StrategyQuoteGate["status"]) {
  if (status === "READY_TO_QUOTE") return "ready";
  if (status === "REVIEW_REQUIRED") return "review";
  if (status === "NEEDS_RATES") return "rates";
  return "blocked";
}

function guardrailTone(status: CommercialStrategy["price"]["guardrailStatus"]) {
  if (status === "PASS") return "ready";
  if (status === "REVIEW" || status === "NEEDS_COST") return "review";
  return "blocked";
}

function routeDecisionTone(row: StrategyRouteDecisionRow) {
  if (row.rateReliable === false) return "blocked";
  if (row.confidence === "high" && row.rateReliable === true) return "ready";
  if (row.confidence === "medium") return "review";
  return "rates";
}

function evidenceStateLabel(tone: string | null | undefined) {
  if (tone === "blocked") return "Blocked";
  if (tone === "review") return "Needs proof";
  if (tone === "rates") return "Needs rates";
  if (tone === "ready") return "Proven";
  return "Context";
}

function evidenceMetricLabel(metric: string | null | undefined, tone: string | null | undefined) {
  if (!metric) return evidenceStateLabel(tone);
  if (/^\d+\/100$/.test(metric.trim())) return evidenceStateLabel(tone);
  return metric;
}

function maturityStateLabel(hasMissing: boolean) {
  return hasMissing ? "Blocked" : "Ready";
}

function riskStateLabel(score: number | null | undefined) {
  if (score == null) return "Low risk";
  if (score >= 82) return "Critical risk";
  if (score >= 62) return "High risk";
  if (score >= 36) return "Medium risk";
  return "Low risk";
}

function routeFreshnessLabel(row: StrategyRouteDecisionRow) {
  if (row.rateFreshnessStatus) return row.rateFreshnessStatus.replace(/_/g, " ");
  if (row.source === "LANE_RATE") return "benchmark";
  if (row.source === "HISTORY") return "history";
  return "unverified";
}

function evidenceIcon(key: string): Parameters<typeof Icon>[0]["name"] {
  switch (key) {
    case "rfq":
      return "list";
    case "cargo":
      return "box";
    case "target":
      return "tag";
    case "target_trail":
      return "trending-up";
    case "coverage":
      return "users";
    case "rate_freshness":
      return "clock";
    case "economics":
      return "dollar";
    case "risk":
      return "shield";
    case "decision_quality":
      return "bar-chart";
    case "documents":
      return "file-check";
    default:
      return "info";
  }
}

function priorityRowTarget(key: string) {
  switch (key) {
    case "value":
    case "margin":
      return "financials";
    case "target":
      return "target-price";
    case "route":
      return "movement";
    case "risk":
      return "decision-reasons";
    default:
      return "strategy-evidence";
  }
}

export function CommercialDecisionCockpit({
  strategy,
  docs,
  jobReference,
  jobId,
  inquiryId,
  recentDraft,
  auditDraftHealth,
}: {
  strategy: CommercialStrategy;
  docs: DecisionDoc[];
  jobReference: string;
  jobId: string;
  inquiryId?: string | null;
  recentDraft?: RecentDraftState | null;
  auditDraftHealth?: AuditDraftHealth | null;
}) {
  const documentReadiness = buildDocumentReadiness(docs);
  const totalDocs = documentReadiness.total;
  const approvedDocs = documentReadiness.approved;
  const uploadedDocs = documentReadiness.uploaded;
  const analyzedDocs = documentReadiness.analyzed;
  const extractedFields = documentReadiness.extractedFields;
  const documentFlags = documentReadiness.flags;
  const docTone = documentReadiness.tone === "info" ? "rates" : documentReadiness.tone;
  const gateTone = quoteGateTone(strategy.quoteGate.status);
  const economicsTone = guardrailTone(strategy.price.guardrailStatus);
  const topRisk = strategy.riskAssessments[0] ?? null;
  const route = strategy.recommendedRoute;
  const coverage = strategy.evidence.coveragePosture;
  const maturityChecks = (strategy.maturityChecks ?? []).filter((check) => check.status !== "not_applicable");
  const readyMaturityChecks = maturityChecks.filter((check) => check.status === "ready");
  const missingMaturityChecks = maturityChecks.filter((check) => check.status === "missing");
  const orderedMaturityChecks = [...missingMaturityChecks, ...readyMaturityChecks];
  const blockerQueue = strategy.blockerResolutionPlan ?? [];
  const firstBlockerAsk = blockerQueue[0] ?? null;
  const agentTone = strategy.operatorDecision.canRunNow && strategy.operatorDecision.blockers.length === 0 ? "ready" : "blocked";
  const toolHint = strategy.operatorDecision.toolHint;
  const missing = strategy.quoteGate.blockers.length > 0 ? strategy.quoteGate.blockers : strategy.missing;
  const decisionReasons = strategy.decisionReasons ?? [];
  const executionPacket = buildStrategyExecutionPacket(strategy);
  const routeDecision = buildStrategyRouteDecision(strategy);
  const routeDecisionRows = [
    routeDecision.selected,
    ...routeDecision.alternatives,
  ].filter((item): item is StrategyRouteDecisionRow => Boolean(item)).slice(0, 4);
  const evidenceChecks = executionPacket.evidence.checks;
  const proofGaps = executionPacket.evidence.gaps;
  const weakestEvidence = executionPacket.evidence.weakest;
  const decisionQuality = evidenceChecks.find((check) => check.key === "decision_quality") ?? null;
  const decisionBrief = executionPacket.brief;
  const commercialPriority = executionPacket.commercialPriority;
  const checklistItems = commercialChecklistItemsWithActions(commercialPriority.checklist);
  const runway = executionPacket.runway;
  const commandLedger = executionPacket.commandLedger;
  const decisionContract = executionPacket.contract;
  const contractProven = decisionContract.proven.slice(0, 1);
  const contractAssumptions = decisionContract.assumptions.slice(0, 1);
  const contractForbidden = decisionContract.forbidden.slice(0, 1);
  const contractTone = decisionContract.state === "ready" ? "ready" : decisionContract.state === "review" ? "review" : "blocked";
  const blockerCopy = strategy.operatorDecision.blockers.length > 0
    ? strategy.operatorDecision.blockers.slice(0, 2).join(", ")
    : strategy.quoteGate.blockers.slice(0, 2).join(", ");
  const dossierRows = [
    {
      key: "gate",
      tone: gateTone,
      label: "Commercial gate",
      value: strategy.quoteGate.label,
      detail: strategy.quoteGate.decision,
    },
    {
      key: "proof",
      tone: weakestEvidence?.tone ?? "ready",
      label: "Weakest proof",
      value: weakestEvidence ? `${weakestEvidence.label} · ${evidenceMetricLabel(weakestEvidence.metric, weakestEvidence.tone)}` : "Inputs covered",
      detail: weakestEvidence?.detail ?? "No blocked evidence is currently holding the next commercial move.",
    },
    {
      key: "data",
      tone: docTone,
      label: "Data room",
      value: `${approvedDocs}/${totalDocs} docs approved`,
      detail: `${analyzedDocs} analyzed, ${extractedFields} extracted fields, ${documentFlags} flags.`,
    },
    {
      key: "agent",
      tone: agentTone,
      label: "Agent boundary",
      value: strategy.operatorDecision.canRunNow ? strategy.operatorDecision.ctaLabel : "Blocked",
      detail: strategy.operatorDecision.canRunNow
        ? `May prepare ${operatorToolLabel(strategy.operatorDecision.toolHint).toLowerCase()}; sending still needs review.`
        : `Do not run execution. Clear ${blockerCopy || "the visible blocker"} first.`,
    },
  ];
  const auditHealthHeadline = auditDraftHealth
    ? auditDraftHealth.stale > 0
      ? `${auditDraftHealth.stale} stale`
      : auditDraftHealth.current > 0
        ? `${auditDraftHealth.current} current`
        : `${auditDraftHealth.legacy} legacy`
    : "";
  const auditHealthDetail = auditDraftHealth
    ? auditDraftHealth.stale > 0
      ? "Rerun stale draft rows before sending."
      : auditDraftHealth.legacy > 0
        ? `${auditDraftHealth.total} checks tracked; legacy rows use timestamp inference.`
        : `${auditDraftHealth.total} checks tracked against current job inputs.`
    : "";
  const flow = [
    {
      key: "rfq",
      target: "source-rfq",
      icon: "list" as const,
      label: "RFQ maturity",
      value: maturityStateLabel(missing.length > 0),
      tone: missing.length > 0 ? "blocked" : "ready",
      detail: missing.length > 0 ? `${missing.length} blocker${missing.length === 1 ? "" : "s"}` : "mature enough",
    },
    {
      key: "docs",
      target: "documents",
      icon: "file-check" as const,
      label: "Docs and data",
      value: `${approvedDocs}/${totalDocs}`,
      tone: docTone,
      detail: `${extractedFields} fields, ${documentFlags} flags`,
    },
    {
      key: "coverage",
      target: "carrier-rates",
      icon: "users" as const,
      label: "Forwarder coverage",
      value: coverage.receivedQuotes,
      suffix: " live",
      tone: coverage.receivedQuotes >= 3 ? "ready" : coverage.receivedQuotes > 0 ? "review" : "rates",
      detail: coverage.label,
    },
    {
      key: "economics",
      target: "financials",
      icon: "dollar" as const,
      label: "Economics",
      value: strategy.price.guardrailStatus.toLowerCase().replace("_", " "),
      tone: economicsTone,
      detail: money(strategy.price.recommendedPrice, strategy.price.currency),
    },
    {
      key: "route",
      target: "movement",
      icon: "ship" as const,
      label: "Route risk",
      value: topRisk ? riskStateLabel(topRisk.score) : route ? route.confidence : "Low risk",
      tone: topRisk && topRisk.score >= 70 ? "blocked" : topRisk && topRisk.score >= 45 ? "review" : "ready",
      detail: topRisk ? topRisk.level.toLowerCase() : "no major risk",
    },
    {
      key: "agent",
      target: "agent-action",
      icon: "sparkles" as const,
      label: "Agent handoff",
      value: strategy.operatorDecision.ctaLabel,
      tone: agentTone,
      detail: operatorToolLabel(strategy.operatorDecision.toolHint),
    },
  ];

  return (
    <section className={`commercial-cockpit ${gateTone}`} data-agent-target="strategy">
      <div className="commercial-cockpit-head">
        <div>
          <div className="commercial-cockpit-kicker">Decision cockpit</div>
          <h2>{strategy.operatorDecision.title}</h2>
          <p>{strategy.operatorDecision.command}</p>
        </div>
        <div className={`commercial-cockpit-verdict ${gateTone}`}>
          <strong>{strategy.quoteGate.label}</strong>
          <span>{jobReference}</span>
        </div>
      </div>

      <div className="commercial-cockpit-brief" aria-label="Commercial decision brief">
        <div className="commercial-cockpit-brief-main">
          <span>Operator mode</span>
          <strong>{operatorPhaseLabel(decisionBrief.phase)}</strong>
          <em>{decisionBrief.nextCommand}</em>
        </div>
        <div>
          <span>Weakest input</span>
          <strong>{decisionBrief.weakestEvidence?.label ?? "Inputs covered"}</strong>
          <em>{decisionBrief.weakestEvidence?.detail ?? "No blocked evidence is holding the next action."}</em>
        </div>
        <div data-agent-target="decision-quality">
          <span>Decision quality</span>
          <strong>{evidenceStateLabel(decisionQuality?.tone)}</strong>
          <em>{decisionQuality?.detail ?? "Confidence score exists, but no decision-quality audit was produced."}</em>
        </div>
        <div>
          <span>Handoff</span>
          <strong>{decisionBrief.nextAction.label}</strong>
          <em>
            {decisionBrief.nextAction.canRunNow
              ? decisionBrief.nextAction.requiresApproval ? "Prepare, then wait for approval." : "Safe to prepare review output."
              : `${decisionBrief.blockerCount} blocker${decisionBrief.blockerCount === 1 ? "" : "s"} before this can run.`}
          </em>
        </div>
        <div className="commercial-cockpit-brief-playbook">
          <span>Operator playbook</span>
          <strong>{decisionBrief.operatorPlaybook.exactAsk ?? decisionBrief.operatorPlaybook.firstMove}</strong>
          <em>{decisionBrief.operatorPlaybook.safetyRule}</em>
        </div>
      </div>

      <div className={`commercial-cockpit-priority ${commercialPriority.tone}`} data-agent-target="commercial-priority" aria-label="Commercial priority brief">
        <div className="commercial-cockpit-priority-head">
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
        <div className="commercial-cockpit-priority-grid">
          {commercialPriority.rows.map((row) => (
            <div key={row.key} className={`commercial-cockpit-priority-row ${row.tone}`} data-agent-target={priorityRowTarget(row.key)}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
              <em>{row.detail}</em>
            </div>
          ))}
        </div>
        <div className="commercial-cockpit-priority-checklist" data-agent-target="agent-action" aria-label="Commercial operator checklist">
          <div className="commercial-cockpit-priority-checklist-head">
            <span>Operator checklist</span>
            <strong>Next safe moves</strong>
          </div>
          {checklistItems.map(({ item, actionKind }, index) => (
            <CommercialChecklistRow
              key={`${item.key}-${item.target}-${index}`}
              item={item}
              index={index}
              className="commercial-cockpit-priority-check"
              actionSlot={actionKind && (
                <CommercialChecklistAction
                  kind={actionKind}
                  inquiryId={inquiryId}
                  jobId={jobId}
                  quoteReady={strategy.quoteGate.canQuoteCustomer}
                  className="commercial-cockpit-priority-check-action"
                  noteClassName="commercial-cockpit-action-note"
                />
              )}
            />
          ))}
        </div>
        <p>{commercialPriority.nextProof}</p>
      </div>

      <div className="commercial-cockpit-dossier" data-agent-target="decision-dossier" aria-label="Decision dossier">
        <div className="commercial-cockpit-dossier-head">
          <span>Decision dossier</span>
          <strong>{decisionBrief.nextAction.label}</strong>
          <em>{executionPacket.safety.rule}</em>
        </div>
        <div className="commercial-cockpit-dossier-grid">
          {dossierRows.map((row) => (
            <div key={row.key} className={`commercial-cockpit-dossier-row ${row.tone}`}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
              <em>{row.detail}</em>
            </div>
          ))}
        </div>
      </div>

      <div className={`commercial-cockpit-contract ${contractTone}`} data-agent-target="decision-contract" aria-label="Decision contract">
        <div className="commercial-cockpit-contract-head">
          <div>
            <span>Decision contract</span>
            <strong>{decisionContract.title}</strong>
            <em>{decisionContract.summary}</em>
          </div>
          <b>{decisionContract.state}</b>
        </div>
        <div className="commercial-cockpit-contract-grid">
          <div>
            <span>Proven now</span>
            {contractProven.map((item) => (
              <p key={`proven-${item.key}`}>
                <strong>{item.label}: {item.value}</strong>
                <em>{item.detail}</em>
              </p>
            ))}
            {decisionContract.proven.length > contractProven.length && (
              <small>{decisionContract.proven.length - contractProven.length} more proof item{decisionContract.proven.length - contractProven.length === 1 ? "" : "s"}.</small>
            )}
          </div>
          <div>
            <span>Assumptions to watch</span>
            {contractAssumptions.map((item) => (
              <p key={`assumption-${item.key}`} className={item.tone}>
                <strong>{item.label}: {item.value}</strong>
                <em>{item.detail}</em>
              </p>
            ))}
            {decisionContract.assumptions.length > contractAssumptions.length && (
              <small>{decisionContract.assumptions.length - contractAssumptions.length} more watch item{decisionContract.assumptions.length - contractAssumptions.length === 1 ? "" : "s"}.</small>
            )}
          </div>
          <div>
            <span>Agent may</span>
            {decisionContract.allowedAgentMoves.map((move) => (
              <p key={move}>
                <strong>{move}</strong>
              </p>
            ))}
            {decisionContract.nextHumanQuestion && (
              <p className="review">
                <strong>Next human question</strong>
                <em>{decisionContract.nextHumanQuestion}</em>
              </p>
            )}
          </div>
          <div>
            <span>Forbidden</span>
            {decisionContract.forbidden.length > 0 ? contractForbidden.map((rule) => (
              <p key={rule} className="blocked">
                <strong>{rule}</strong>
              </p>
            )) : (
              <p>
                <strong>No extra hard stop beyond review-only sending policy.</strong>
              </p>
            )}
            {decisionContract.forbidden.length > contractForbidden.length && (
              <small>{decisionContract.forbidden.length - contractForbidden.length} more stop rule{decisionContract.forbidden.length - contractForbidden.length === 1 ? "" : "s"}.</small>
            )}
          </div>
        </div>
      </div>

      <div className="commercial-cockpit-runway" aria-label="Evidence to decision to agent flow">
        {runway.map((item) => (
          <div key={item.key} className={`commercial-cockpit-runway-step ${item.tone}`}>
            <span>{item.label}</span>
            <strong>{item.title}</strong>
            <em>{item.detail}</em>
          </div>
        ))}
      </div>

      <div className="commercial-cockpit-command-ledger" aria-label="Strategy command ledger">
        <div className="commercial-cockpit-command-ledger-head">
          <span>Command ledger</span>
          <strong>Decision chain the agent must obey</strong>
          <em>Current operating constraints by owner, evidence, and stop rule.</em>
        </div>
        <div className="commercial-cockpit-command-list">
          {commandLedger.map((item, index) => (
            <div key={item.key} className={`commercial-cockpit-command-row ${item.tone}`}>
              <span className="commercial-cockpit-command-index">{index + 1}</span>
              <div className="commercial-cockpit-command-main">
                <span>{item.label} · {item.owner.toLowerCase()} · {item.priority}</span>
                <strong>{item.command}</strong>
                <em>{item.evidence}</em>
              </div>
              <div className="commercial-cockpit-command-stop">
                <span>{item.toolHint ? operatorToolLabel(item.toolHint) : item.tone}</span>
                <strong>{item.stopRule}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="commercial-cockpit-grid">
        <div className="commercial-cockpit-primary">
          <span>Next command</span>
          <strong>{strategy.operatorDecision.ctaLabel}</strong>
          <em>{strategy.operatorDecision.rationale}</em>
        </div>
        <div>
          <span>Recommended quote</span>
          <strong>{money(strategy.price.recommendedPrice, strategy.price.currency)}</strong>
          <em>Floor {money(strategy.price.floorPrice, strategy.price.currency)}</em>
        </div>
        <div>
          <span>Target posture</span>
          <strong>{strategy.evidence.targetPosture.label}</strong>
          <em>{strategy.evidence.targetPosture.target == null ? "No customer target captured" : money(strategy.evidence.targetPosture.target, strategy.evidence.targetPosture.currency)}</em>
        </div>
        <div>
          <span>Route pick</span>
          <strong>{route?.label ?? "No priced route yet"}</strong>
          <em>{route?.tradeoff ?? "Get live rates before pretending this route is priced."}</em>
        </div>
      </div>

      {routeDecisionRows.length > 0 && (
        <div className={`commercial-cockpit-route-decision ${routeDecision.canQuoteCustomer ? "ready" : "review"}`} data-agent-target="movement" aria-label="Route decision table">
          <div className="commercial-cockpit-route-head">
            <div>
              <span>Route decision</span>
              <strong>{routeDecision.selected?.label ?? "No selected route"}</strong>
            </div>
            <em>{routeDecision.summary}</em>
          </div>
          <div className="commercial-cockpit-route-list">
            {routeDecisionRows.map((row) => (
              <div key={`${row.rank}-${row.label}-${row.source}`} className={`commercial-cockpit-route-row ${row.rank === 1 ? "selected" : ""} ${routeDecisionTone(row)}`}>
                <span>{row.rank}</span>
                <div>
                  <strong>{row.label}</strong>
                  <em>{row.provider ?? row.source.toLowerCase().replace(/_/g, " ")} · {routeFreshnessLabel(row)}</em>
                </div>
                <b>{row.costLabel}</b>
                <small>{row.confidence} confidence · {riskStateLabel(row.riskScore)}</small>
              </div>
            ))}
          </div>
          <p>{routeDecision.selectionRule}</p>
        </div>
      )}

      <PricingScenarioSandbox
        jobId={jobId}
        defaultTargetPrice={strategy.evidence.targetPosture.target}
        defaultBuyCost={strategy.price.buyCost}
        currency={strategy.price.currency}
      />

      {maturityChecks.length > 0 && (
        <div className={`commercial-cockpit-maturity-ledger ${missingMaturityChecks.length > 0 ? "blocked" : "ready"}`} aria-label="RFQ maturity checklist">
          <div className="commercial-cockpit-maturity-head">
            <span>Maturity ledger</span>
            <strong>{readyMaturityChecks.length}/{maturityChecks.length} ready</strong>
            <em>
              {missingMaturityChecks.length > 0
                ? `${missingMaturityChecks.length} blocker${missingMaturityChecks.length === 1 ? "" : "s"} before forwarders.`
                : "RFQ facts are ready for the next commercial action."}
            </em>
          </div>
          <div className="commercial-cockpit-maturity-list">
            {orderedMaturityChecks.map((check) => (
              <div key={check.key} className={`commercial-cockpit-maturity-check ${check.status}`}>
                <span>{check.label}</span>
                <strong>{check.status === "ready" ? "Ready" : "Missing"}</strong>
                <em>{check.detail}</em>
              </div>
            ))}
          </div>
          {blockerQueue.length > 0 && (
            <div className="commercial-cockpit-blocker-queue" data-agent-target="blocker-resolution">
              <div className="commercial-cockpit-blocker-head">
                <span>Clear next</span>
                <strong>{blockerQueue[0]?.label}</strong>
              </div>
              {blockerQueue.slice(0, 3).map((item, index) => (
                <div key={item.key} className={`commercial-cockpit-blocker-item ${item.priority}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.ask}</strong>
                    <em>{item.why}</em>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {decisionReasons.length > 0 && (
        <div className="commercial-cockpit-reasons" data-agent-target="decision-reasons" aria-label="Decision rationale stack">
          <div className="commercial-cockpit-reasons-head">
            <span>Reason stack</span>
            <strong>Why this action now</strong>
          </div>
          {decisionReasons.slice(0, 4).map((reason, index) => (
            <div key={`${reason.key}-${reason.summary}`} className={`commercial-cockpit-reason ${reason.tone}`}>
              <span>#{index + 1} {reason.label}</span>
              <strong>{reason.summary}</strong>
              <em>{reason.detail}</em>
            </div>
          ))}
        </div>
      )}

      <div className="commercial-cockpit-evidence-map" data-agent-target="strategy-evidence" aria-label="Decision evidence map">
        <div className="commercial-cockpit-evidence-map-head">
          <span>Evidence map</span>
          <strong>{weakestEvidence ? `Weakest input: ${weakestEvidence.label}` : "Primary inputs covered"}</strong>
          <em>The agent can only act from these facts. Weak inputs stay visible instead of being hidden inside the score.</em>
        </div>
        <div className="commercial-cockpit-proof-gaps" data-agent-target="strategy-evidence" aria-label="Commercial proof gap queue">
          <div className="commercial-cockpit-proof-gaps-head">
            <span>Proof gap queue</span>
            <strong>{proofGaps.length > 0 ? `${proofGaps.length} input${proofGaps.length === 1 ? "" : "s"} to clear` : "Proof queue clear"}</strong>
            <em>{proofGaps[0]?.detail ?? "No blocked or review evidence is holding this commercial move."}</em>
          </div>
          {proofGaps.length > 0 && (
            <div className="commercial-cockpit-proof-gaps-list">
              {proofGaps.slice(0, 4).map((gap, index) => (
                <div key={`${gap.key}-${index}`} className={`commercial-cockpit-proof-gap ${gap.tone}`} data-agent-target={gap.target}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{gap.label} · {gap.owner.toLowerCase()}</strong>
                    <em>{gap.action}</em>
                    <small>{gap.metric} · {gap.detail}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="commercial-cockpit-evidence-list">
          {evidenceChecks.map((check) => (
            <div
              key={check.key}
              className={`commercial-cockpit-evidence-check ${check.tone}`}
              data-agent-target={check.key === "decision_quality" ? "decision-quality" : undefined}
            >
              <div className="commercial-cockpit-evidence-icon">
                <Icon name={evidenceIcon(check.key)} size={14} />
              </div>
              <div>
                <span>{check.label}</span>
                <strong title={evidenceMetricLabel(check.metric, check.tone)}>{evidenceMetricLabel(check.metric, check.tone)}</strong>
                <em>{check.detail}</em>
              </div>
              <b>{check.tone}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="commercial-cockpit-flow" aria-label="Commercial decision flow">
        {flow.map((item) => (
          <div key={item.key} className={`commercial-cockpit-step ${item.tone}`} data-agent-target={item.target}>
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <em>{item.detail}</em>
          </div>
        ))}
      </div>

      <div className="commercial-cockpit-lower">
        <div className="commercial-cockpit-evidence">
          <span>Evidence ledger</span>
          <strong>{analyzedDocs}/{totalDocs} docs analyzed - {coverage.primaryEvidence.toLowerCase().replace("_", " ")}</strong>
          <em>{uploadedDocs} uploaded docs waiting, {strategy.evidence.pendingQuotes} pending forwarder replies.</em>
        </div>
        <div className={`commercial-cockpit-agent ${agentTone}`}>
          <span>Agent route</span>
          <strong>{operatorSurfaceLabel(strategy.operatorDecision.surfaceHint)}</strong>
          <em>{strategy.operatorDecision.requiresApproval ? "Approval required before execution" : "Safe to prepare draft output"}</em>
        </div>
      </div>

      {recentDraft && (
        <div className={`commercial-cockpit-recent ${recentDraft.isStale ? "stale" : recentDraft.tone}`}>
          <div>
            <span>{recentDraft.isStale ? "Stale agent work" : "Recent agent work"}</span>
            <strong>{recentDraft.label}</strong>
            <em>{recentDraft.occurredAt} - {recentDraft.summary}</em>
          </div>
          <div>
            <span>Status</span>
            <strong>{recentDraft.isStale ? "stale" : recentDraft.status.toLowerCase().replace(/_/g, " ")}</strong>
            <em>{recentDraft.isStale ? recentDraft.staleReason ?? "Job facts changed after this draft." : recentDraft.detail}</em>
            {recentDraft.reviewUrl && <a href={recentDraft.reviewUrl}>Review draft</a>}
          </div>
          {auditDraftHealth && auditDraftHealth.total > 0 && (
            <div className={`commercial-cockpit-audit-health ${auditDraftHealth.stale > 0 ? "stale" : "fresh"}`}>
              <div>
                <span>Audit health</span>
                <strong>{auditHealthHeadline}</strong>
                <em>{auditHealthDetail}</em>
              </div>
              <div className="commercial-cockpit-audit-pills" aria-label="Draft audit freshness">
                <span className="fresh">{auditDraftHealth.current} current</span>
                {auditDraftHealth.stale > 0 && <span className="stale">{auditDraftHealth.stale} stale</span>}
                {auditDraftHealth.legacy > 0 && <span className="legacy">{auditDraftHealth.legacy} legacy</span>}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="commercial-cockpit-actions" data-agent-target="agent-action">
        <div>
          <span>Run from here</span>
          <strong>{strategy.operatorDecision.ctaLabel}</strong>
          <em>
            {auditDraftHealth?.stale
              ? "Some agent outputs were created before the current job facts. Rerun stale rows before using them."
              : recentDraft?.isStale
              ? "The previous draft is stale. Rerun before using it."
              : recentDraft
              ? "A recent review-only draft exists. Rerun only if the RFQ facts changed."
              : "These controls create reviewable drafts or blockers only. They do not send customer or forwarder messages."}
          </em>
          <div className="commercial-cockpit-safety">
            <span>Safety</span>
            <strong>{executionPacket.safety.rule}</strong>
            {executionPacket.safety.forbidden.length > 0 && (
              <em>{executionPacket.safety.forbidden.slice(0, 2).join(" ")}</em>
            )}
          </div>
          {toolHint === "draft_missing_info_request" && firstBlockerAsk && (
            <div className="commercial-cockpit-next-ask">
              <span>First customer ask</span>
              <strong>{firstBlockerAsk.ask}</strong>
              <em>{firstBlockerAsk.why}</em>
            </div>
          )}
        </div>
        <div className="commercial-cockpit-action-buttons">
          {toolHint === "draft_missing_info_request" && inquiryId && (
            <MissingInfoDraftButton inquiryId={inquiryId} jobId={jobId} />
          )}
          {toolHint === "draft_missing_info_request" && !inquiryId && (
            <MissingInfoDraftButton jobId={jobId} />
          )}
          {toolHint === "create_forwarder_drafts" && (
            <ForwarderDraftsButton jobId={jobId} />
          )}
          {toolHint === "draft_customer_quote" && (
            <CustomerQuoteDraftButton jobId={jobId} quoteReady={strategy.quoteGate.canQuoteCustomer} />
          )}
          {toolHint === "draft_negotiation_plan" && (
            <NegotiationPlanDraftButton jobId={jobId} />
          )}
          {["recommend_price", "assess_strategy", "none"].includes(toolHint) && (
            <span className="commercial-cockpit-action-note">No direct action is safe yet; inspect the strategy audit below.</span>
          )}
        </div>
      </div>
    </section>
  );
}
