import type { DecisionQueueBlocker, DecisionQueueGateCheck, DecisionQueueItem, DecisionQueuePriorityFactor } from "./decision-queue";
import { operatorMetricLabel, operatorToolLabel } from "./operator-action-labels";

type DecisionQueueCategory = DecisionQueueItem["category"];

const CATEGORY_LABEL: Record<DecisionQueueCategory, string> = {
  LEAD: "Lead intake",
  RFQ: "RFQ maturity",
  PRICING: "Pricing desk",
  OUTCOME: "Quote outcomes",
  REPLY: "Inbox replies",
  RISK: "Risk control",
  AGENT: "Agent review",
};

const CATEGORY_MODE: Record<DecisionQueueCategory, string> = {
  LEAD: "Turn qualified sheet leads into RFQs before inbox noise eats the day.",
  RFQ: "Mature the RFQ first. Pricing incomplete freight facts is theatre.",
  PRICING: "Get market coverage, protect the floor, then quote.",
  OUTCOME: "Close pending customer quotes so follow-up and win/loss learning are not imaginary.",
  REPLY: "Clear the latest inbound replies so deals do not stall in silence.",
  RISK: "Pause commercial movement until the top risk is understood.",
  AGENT: "Review pending agent diffs before letting automation mutate records.",
};

type DecisionQueueProofGap = NonNullable<DecisionQueueItem["proofGaps"]>[number];

export type DecisionQueueBrief = {
  total: number;
  critical: number;
  high: number;
  operator_summary: string | null;
  top_priority_factors: string | null;
  execution_brief: {
    headline: string;
    entity_type: DecisionQueueItem["entityType"];
    entity_id: string | null;
    next_step: string;
    why_now: string;
    action: string;
    safe_action_label: string;
    href: string;
    safety: string;
    evidence: NonNullable<DecisionQueueItem["priorityFactors"]>;
    gate_checks: NonNullable<DecisionQueueItem["gateChecks"]>;
    rank_reasons: NonNullable<DecisionQueueItem["rankReasons"]>;
    blockers: NonNullable<DecisionQueueItem["blockers"]>;
    decision_quality: {
      label: string;
      tone: "ready" | "review" | "blocked" | "info";
      metric: string;
      detail: string;
    } | null;
    decision_move: DecisionQueueItem["decisionMove"] | null;
    decision_contract: DecisionQueueItem["decisionContract"] | null;
    command_ledger: NonNullable<DecisionQueueItem["commandLedger"]>;
    proof_gaps: NonNullable<DecisionQueueItem["proofGaps"]>;
    visual_target: string | null;
    visual_target_label: string | null;
  } | null;
  categories: Record<string, number>;
  categoryBreakdown: Array<{
    category: DecisionQueueCategory;
    label: string;
    count: number;
    topScore: number;
    critical: number;
    high: number;
  }>;
  focus: {
    category: DecisionQueueCategory;
    label: string;
    count: number;
    tone: DecisionQueueItem["tone"];
    operator_mode: string;
    reason: string;
  } | null;
  top_action: string | null;
  top_reason: string | null;
  top_move: {
    key: string;
    title: string;
    action: string;
    category: DecisionQueueCategory;
    entity_type: DecisionQueueItem["entityType"];
    entity_id: string | null;
    href: string;
    score: number;
    priority_label: string;
    reason: string;
    safe_action_label: string;
    priority_factors: DecisionQueueItem["priorityFactors"];
    gate_checks: DecisionQueueItem["gateChecks"];
    rank_reasons: DecisionQueueItem["rankReasons"];
    blockers: DecisionQueueItem["blockers"];
    decision_move: DecisionQueueItem["decisionMove"] | null;
    decision_contract: DecisionQueueItem["decisionContract"] | null;
    command_ledger: DecisionQueueItem["commandLedger"];
    proof_gaps: DecisionQueueItem["proofGaps"];
    visual_target: string | null;
    visual_target_label: string | null;
  } | null;
  next_moves: Array<{
    key: string;
    title: string;
    action: string;
    category: DecisionQueueCategory;
    entity_type: DecisionQueueItem["entityType"];
    entity_id: string | null;
    href: string;
    score: number;
    priority_label: string;
    reason: string;
    safe_action_label: string;
    priority_factors: DecisionQueueItem["priorityFactors"];
    gate_checks: DecisionQueueItem["gateChecks"];
    rank_reasons: DecisionQueueItem["rankReasons"];
    blockers: DecisionQueueItem["blockers"];
    decision_move: DecisionQueueItem["decisionMove"] | null;
    decision_contract: DecisionQueueItem["decisionContract"] | null;
    command_ledger: DecisionQueueItem["commandLedger"];
    proof_gaps: DecisionQueueItem["proofGaps"];
    visual_target: string | null;
    visual_target_label: string | null;
  }>;
  quick_actions: Array<{
    key: string;
    entity_type: DecisionQueueItem["entityType"];
    entity_id: string | null;
    action: string;
    title: string;
    href: string;
    safe_action_label: string;
    requires_human_approval: boolean;
  }>;
};

function factorSummary(item: DecisionQueueItem | null) {
  if (!item?.priorityFactors?.length) return null;
  return normalizedPriorityFactors(item.priorityFactors)
    .slice(0, 5)
    .map((factor) => `${factor.label}: ${factor.value}`)
    .join("; ");
}

const STATE_METRICS = new Set(["Blocked", "Needs proof", "Needs rates", "Proven", "Context"]);

function shouldNormalizeMetric(label: string) {
  return label === "Decision quality" || label === "Maturity";
}

function normalizedPriorityFactor(factor: DecisionQueuePriorityFactor): DecisionQueuePriorityFactor {
  if (!shouldNormalizeMetric(factor.label)) return factor;
  return {
    ...factor,
    value: operatorMetricLabel(factor.value, factor.tone),
  };
}

function normalizedPriorityFactors(factors: DecisionQueueItem["priorityFactors"]): DecisionQueuePriorityFactor[] {
  return (factors ?? []).map(normalizedPriorityFactor);
}

function normalizedGateCheck(check: DecisionQueueGateCheck): DecisionQueueGateCheck {
  if (!shouldNormalizeMetric(check.label)) return check;
  return {
    ...check,
    metric: operatorMetricLabel(check.metric, check.status),
  };
}

function normalizedGateChecks(checks: DecisionQueueItem["gateChecks"]): DecisionQueueGateCheck[] {
  return (checks ?? []).map(normalizedGateCheck);
}

function decisionQualitySummary(item: DecisionQueueItem | null) {
  if (!item) return null;
  const factor = normalizedPriorityFactors(item.priorityFactors).find((entry) => entry.label === "Decision quality") ?? null;
  const gate = normalizedGateChecks(item.gateChecks).find((entry) => entry.label === "Decision quality") ?? null;
  if (!factor && !gate) return null;
  const tone = gate?.status ?? (factor?.tone === "strong" ? "ready" : factor?.tone === "watch" ? "review" : factor?.tone === "weak" ? "blocked" : null);
  const metric = gate?.metric ?? factor?.value ?? null;
  if (!metric) return null;
  const detail = gate?.detail ? `: ${sentenceFragment(gate.detail)}` : "";
  const toneLabel = tone && !STATE_METRICS.has(metric) ? ` ${tone}` : "";
  return `Decision quality ${metric}${toneLabel}${detail}`;
}

function decisionQualityBrief(item: DecisionQueueItem | null): NonNullable<DecisionQueueBrief["execution_brief"]>["decision_quality"] {
  if (!item) return null;
  const gate = normalizedGateChecks(item.gateChecks).find((entry) => entry.label === "Decision quality") ?? null;
  if (gate) {
    return {
      label: gate.label,
      tone: gate.status,
      metric: gate.metric,
      detail: gate.detail,
    };
  }

  const factor = normalizedPriorityFactors(item.priorityFactors).find((entry) => entry.label === "Decision quality") ?? null;
  if (!factor) return null;
  return {
    label: factor.label,
    tone: factor.tone === "strong" ? "ready" : factor.tone === "watch" ? "review" : "blocked",
    metric: factor.value,
    detail: "Decision quality came from priority factors; no detailed evidence check was attached to this queue item.",
  };
}

function sentenceFragment(text: string) {
  return text.trim().replace(/[.!?]+$/, "");
}

function moveSummary(item: DecisionQueueItem | null) {
  if (!item?.decisionMove) return null;
  return `${item.decisionMove.label}: ${sentenceFragment(item.decisionMove.command)}`;
}

function gateSummary(item: DecisionQueueItem | null) {
  const gates = normalizedGateChecks(item?.gateChecks);
  const gate = gates.find((check) => check.status === "blocked" || check.status === "review")
    ?? gates[0]
    ?? null;
  if (!gate) return null;
  return `${gate.label}: ${gate.metric}`;
}

function rankSummary(item: DecisionQueueItem | null) {
  const reason = item?.rankReasons?.find((entry) => entry.tone === "blocker" || entry.tone === "review")
    ?? item?.rankReasons?.[0]
    ?? null;
  if (!reason) return null;
  return `${reason.label}: ${reason.summary}`;
}

function proofGapKeyFromLabel(label: string): DecisionQueueProofGap["key"] {
  const lower = label.toLowerCase();
  if (lower.includes("document")) return "documents";
  if (lower.includes("target")) return "target";
  if (lower.includes("rate") || lower.includes("fresh")) return "rate_freshness";
  if (lower.includes("coverage") || lower.includes("market") || lower.includes("forwarder")) return "coverage";
  if (lower.includes("economics") || lower.includes("margin") || lower.includes("floor") || lower.includes("cost")) return "economics";
  if (lower.includes("risk")) return "risk";
  if (lower.includes("cargo")) return "cargo";
  if (lower.includes("rfq") || lower.includes("lead") || lower.includes("maturity") || lower.includes("fact")) return "rfq";
  return "decision_quality";
}

function proofGapTargetFromLabel(label: string): DecisionQueueProofGap["target"] {
  const lower = label.toLowerCase();
  if (lower.includes("document")) return "documents";
  if (lower.includes("target")) return "target-price";
  if (lower.includes("rate") || lower.includes("fresh")) return "movement";
  if (lower.includes("coverage") || lower.includes("market") || lower.includes("forwarder")) return "carrier-rates";
  if (lower.includes("economics") || lower.includes("margin") || lower.includes("floor") || lower.includes("cost")) return "financials";
  if (lower.includes("risk") || lower.includes("quality")) return "decision-quality";
  if (lower.includes("rfq") || lower.includes("lead") || lower.includes("maturity") || lower.includes("cargo") || lower.includes("fact")) return "blocker-resolution";
  return "strategy-evidence";
}

function proofGapOwnerFromTarget(target: DecisionQueueProofGap["target"], blockerOwner?: DecisionQueueBlocker["owner"]): DecisionQueueProofGap["owner"] {
  if (blockerOwner === "CUSTOMER" || blockerOwner === "FORWARDER" || blockerOwner === "INTERNAL") return blockerOwner;
  if (target === "carrier-rates" || target === "movement") return "FORWARDER";
  if (target === "blocker-resolution" || target === "target-price") return "CUSTOMER";
  return "INTERNAL";
}

function fallbackProofGapAction(gate: DecisionQueueGateCheck, blocker?: DecisionQueueBlocker | null) {
  if (blocker?.ask) return blocker.ask;
  if (gate.status === "blocked") return `Clear ${gate.label.toLowerCase()} before the next external-facing move.`;
  if (gate.status === "review") return `Review ${gate.label.toLowerCase()} before using this queue move with a customer or forwarder.`;
  return `Record the missing context behind ${gate.label.toLowerCase()} before treating the queue move as ready.`;
}

function proofGapsForItem(item: DecisionQueueItem | null): NonNullable<DecisionQueueItem["proofGaps"]> {
  if (!item) return [];
  if (item.proofGaps?.length) return item.proofGaps.slice(0, 5);

  const blockers = item.blockers ?? [];
  const weakGates = normalizedGateChecks(item.gateChecks)
    .filter((gate) => gate.status !== "ready")
    .slice(0, 5);
  const fromGates = weakGates.map<DecisionQueueProofGap>((gate, index) => {
    const blocker = blockers[index] ?? blockers.find((entry) => gate.detail.includes(entry.ask)) ?? null;
    const target = proofGapTargetFromLabel(gate.label);
    return {
      key: proofGapKeyFromLabel(gate.label),
      label: gate.label,
      tone: gate.status,
      metric: gate.metric,
      detail: gate.detail,
      action: fallbackProofGapAction(gate, blocker),
      owner: proofGapOwnerFromTarget(target, blocker?.owner),
      target,
    };
  });

  const fromBlockers = blockers.slice(0, 5).map<DecisionQueueProofGap>((blocker) => {
    const target = proofGapTargetFromLabel(blocker.label);
    return {
      key: proofGapKeyFromLabel(blocker.label),
      label: blocker.label,
      tone: blocker.priority === "critical" ? "blocked" : "review",
      metric: blocker.priority,
      detail: blocker.ask,
      action: blocker.ask,
      owner: proofGapOwnerFromTarget(target, blocker.owner),
      target,
    };
  });

  const seen = new Set<string>();
  return [...fromGates, ...fromBlockers].filter((gap) => {
    const key = `${gap.key}:${gap.target}:${gap.action}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

function proofGapSummary(item: DecisionQueueItem | null) {
  const gap = proofGapsForItem(item)[0] ?? null;
  if (!gap) return null;
  return `${gap.label}: ${gap.action}`;
}

function priorityLabel(item: DecisionQueueItem) {
  if (item.tone === "critical") return "critical";
  if (item.tone === "high") return "high priority";
  return "normal";
}

function safeActionLabel(item: DecisionQueueItem) {
  const toolHint = item.decisionMove?.toolHint;
  if (toolHint && toolHint !== "none") return operatorToolLabel(toolHint);
  return item.actionLabel;
}

function reviewedArtifactInstruction(item: DecisionQueueItem) {
  const toolHint = item.decisionMove?.toolHint;
  switch (toolHint) {
    case "prepare_control_sheet_rfq":
      return "Create a reviewed RFQ draft from this sheet row.";
    case "inspect_control_sheet":
      return "Open the sheet row as commercial context before creating any RFQ.";
    case "draft_missing_info_request":
      return "Draft the missing-info request and keep it approval-first.";
    case "create_forwarder_drafts":
      return "Create reviewed forwarder drafts only after maturity clears.";
    case "draft_customer_quote":
      return "Draft the customer quote and keep the send step under human approval.";
    case "draft_negotiation_plan":
      return "Prepare the negotiation plan as an internal recommendation.";
    case "recommend_price":
      return "Review the price recommendation against target and floor.";
    case "assess_strategy":
      return "Review the strategy assessment before any commercial commitment.";
    default:
      return `Prepare ${safeActionLabel(item).toLowerCase()} as a reviewed artifact.`;
  }
}

function fallbackCommandLedger(item: DecisionQueueItem): NonNullable<DecisionQueueItem["commandLedger"]> {
  const gates = normalizedGateChecks(item.gateChecks);
  const gate = gates.find((check) => check.status === "blocked" || check.status === "review")
    ?? gates[0]
    ?? null;
  const tone = gate?.status === "blocked"
    ? "blocked"
    : gate?.status === "review"
      ? "review"
      : "ready";
  return [{
    key: "agent_artifact",
    label: gate?.label ?? "Queue move",
    owner: item.decisionMove?.owner === "CUSTOMER" || item.decisionMove?.owner === "FORWARDER"
      ? item.decisionMove.owner
      : "INTERNAL",
    priority: tone === "blocked" ? "critical" : tone === "review" ? "high" : "medium",
    tone,
    command: item.decisionMove?.command ?? item.actionLabel,
    evidence: gate ? `${gate.metric}. ${gate.detail}` : item.reason,
    stopRule: "Keep the action review-only until a human confirms the next record change or external send.",
  }];
}

function fallbackDecisionContract(item: DecisionQueueItem): NonNullable<DecisionQueueItem["decisionContract"]> {
  const gates = normalizedGateChecks(item.gateChecks);
  const priorityFactors = normalizedPriorityFactors(item.priorityFactors);
  const blockingGate = gates.find((check) => check.status === "blocked")
    ?? null;
  const reviewGate = gates.find((check) => check.status === "review")
    ?? null;
  const firstGate = blockingGate ?? reviewGate ?? gates[0] ?? null;
  const firstBlocker = item.blockers?.[0] ?? null;
  const state: NonNullable<DecisionQueueItem["decisionContract"]>["state"] = blockingGate || firstBlocker?.priority === "critical"
    ? "blocked"
    : reviewGate || item.decisionMove?.requiresApproval !== false
      ? "review"
      : "ready";
  const allowedAgentMoves = item.decisionMove?.canRunNow
    ? [
      reviewedArtifactInstruction(item),
      "Stop before any external send or record mutation until approval is recorded.",
    ]
    : [
      `Open the scoped record and clear ${firstBlocker?.label ?? firstGate?.label ?? "the listed blocker"} before agent execution.`,
    ];
  const proven = [
    firstGate
      ? {
        key: "queue_gate",
        label: firstGate.label,
        value: firstGate.metric,
        detail: firstGate.detail,
        tone: firstGate.status,
      }
      : {
        key: "queue_rank",
        label: "Queue rank",
        value: item.category,
        detail: item.reason,
        tone: "review" as const,
      },
    ...priorityFactors.slice(0, 2).map((factor, index) => ({
      key: `priority_${index}`,
      label: factor.label,
      value: factor.value,
      detail: "This priority factor helped rank the desk move.",
      tone: factor.tone === "strong" ? "ready" as const : factor.tone === "watch" ? "review" as const : "blocked" as const,
    })),
  ].slice(0, 4);
  const assumptions = firstBlocker
    ? [{
      key: "first_blocker",
      label: firstBlocker.label,
      value: firstBlocker.priority,
      detail: firstBlocker.ask,
      tone: firstBlocker.priority === "critical" ? "blocked" as const : "review" as const,
    }]
    : [{
      key: "human_approval",
      label: "Human approval",
      value: item.decisionMove?.requiresApproval === false ? "not required" : "required",
      detail: "Desk actions stay review-first unless the scoped workflow explicitly records approval.",
      tone: item.decisionMove?.requiresApproval === false ? "info" as const : "review" as const,
    }];

  return {
    state,
    title: item.decisionMove ? `${item.decisionMove.label} boundary` : "Review-only desk move",
    summary: item.reason,
    proven,
    assumptions,
    allowedAgentMoves,
    forbidden: [
      "No external send, quote, or record mutation without human approval.",
      firstBlocker ? `Do not bypass blocker: ${firstBlocker.ask}` : "Do not invent missing facts to make the action look ready.",
    ],
    nextHumanQuestion: firstBlocker?.ask ?? firstGate?.detail ?? null,
  };
}

function visualTarget(item: DecisionQueueItem | null) {
  if (!item) return null;
  if (item.visualTarget) return item.visualTarget;

  switch (item.category) {
    case "LEAD":
      return "reference-deal-top";
    case "RFQ":
      return "source-rfq";
    case "PRICING":
      return "pricing-command-queue";
    case "OUTCOME":
      return "customer-quote";
    case "REPLY":
      return "email";
    case "RISK":
      return "strategy";
    case "AGENT":
      return "decision-queue";
    default:
      return "decision-queue";
  }
}

function visualTargetLabel(target: string | null) {
  switch (target) {
    case "reference-deal-top":
      return "Lead row";
    case "source-rfq":
      return "RFQ facts";
    case "pricing-command-queue":
      return "Pricing command queue";
    case "customer-quote":
      return "Customer quote";
    case "email":
      return "Inbox thread";
    case "strategy":
      return "Strategy panel";
    case "decision-queue":
      return "Decision queue";
    default:
      return target ? "Scoped page area" : null;
  }
}

function executionBrief(item: DecisionQueueItem | null): DecisionQueueBrief["execution_brief"] {
  if (!item) return null;
  const target = visualTarget(item);

  const base = {
    headline: item.title,
    entity_type: item.entityType,
    entity_id: item.entityId,
    why_now: item.reason,
    action: item.actionLabel,
    safe_action_label: safeActionLabel(item),
    href: item.href,
    evidence: normalizedPriorityFactors(item.priorityFactors).slice(0, 5),
    gate_checks: normalizedGateChecks(item.gateChecks).slice(0, 4),
    rank_reasons: item.rankReasons?.slice(0, 4) ?? [],
    blockers: item.blockers?.slice(0, 3) ?? [],
    decision_quality: decisionQualityBrief(item),
    decision_move: item.decisionMove ?? null,
    decision_contract: item.decisionContract ?? fallbackDecisionContract(item),
    command_ledger: item.commandLedger ?? fallbackCommandLedger(item),
    proof_gaps: proofGapsForItem(item),
    visual_target: target,
    visual_target_label: visualTargetLabel(target),
  };

  switch (item.category) {
    case "LEAD":
      const leadDecisionGate = base.gate_checks.find((check) => check.label === "Lead decision");
      return {
        ...base,
        next_step: item.decisionMove?.command
          ?? "Turn the lead into an RFQ, then clear any missing lane/product/economics fields before pricing.",
        safety: leadDecisionGate?.detail
          ?? "Sheet value is context only; do not treat it as a customer target price until confirmed.",
      };
    case "RFQ":
      return {
        ...base,
        next_step: "Open the RFQ and draft the missing-info request. Do not ask forwarders until maturity blockers are cleared.",
        safety: "No forwarder send is allowed while the RFQ gate is blocked.",
      };
    case "PRICING":
      return {
        ...base,
        next_step: "Open pricing, review the rate/draft state, and move the market request or customer quote forward.",
        safety: "Drafts and quotes stay review-only until the operator approves them.",
      };
    case "OUTCOME":
      return {
        ...base,
        next_step: "Resolve the pending customer quote: follow up if still live, or mark won/lost so the pricing brain learns.",
        safety: "Do not mark an outcome without customer evidence.",
      };
    case "REPLY":
      return {
        ...base,
        next_step: "Open the inbox thread, answer the inbound message, then link or hide it so the queue stays clean.",
        safety: "Keep unrelated mail out of active RFQ views.",
      };
    case "RISK":
      return {
        ...base,
        next_step: "Review the risk before pricing or execution moves. Escalate if the risk changes commercial commitment.",
        safety: "Risk review is a pause signal, not a reason to invent missing facts.",
      };
    case "AGENT":
      return {
        ...base,
        next_step: "Review the pending agent diff and accept or reject it. Do not leave proposed mutations hanging.",
        safety: "Agent proposals are not applied until a human approves them.",
      };
    default:
      return {
        ...base,
        next_step: "Open the linked record and take the queued action.",
        safety: "Keep human approval on record-changing actions.",
      };
  }
}

function toMove(item: DecisionQueueItem) {
  const target = visualTarget(item);
  return {
    key: item.key,
    title: item.title,
    action: item.actionLabel,
    category: item.category,
    entity_type: item.entityType,
    entity_id: item.entityId,
    href: item.href,
    score: Math.round(item.score),
    priority_label: priorityLabel(item),
    reason: item.reason,
    safe_action_label: safeActionLabel(item),
    priority_factors: normalizedPriorityFactors(item.priorityFactors),
    gate_checks: normalizedGateChecks(item.gateChecks),
    rank_reasons: item.rankReasons ?? [],
    blockers: item.blockers ?? [],
    decision_move: item.decisionMove ?? null,
    decision_contract: item.decisionContract ?? fallbackDecisionContract(item),
    command_ledger: item.commandLedger ?? fallbackCommandLedger(item),
    proof_gaps: proofGapsForItem(item),
    visual_target: target,
    visual_target_label: visualTargetLabel(target),
  };
}

export function buildDecisionQueueBrief(items: DecisionQueueItem[]): DecisionQueueBrief {
  const categories = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1;
    return acc;
  }, {});

  const categoryStats = new Map<DecisionQueueCategory, {
    category: DecisionQueueCategory;
    label: string;
    count: number;
    topScore: number;
    critical: number;
    high: number;
  }>();

  for (const item of items) {
    const current = categoryStats.get(item.category) ?? {
      category: item.category,
      label: CATEGORY_LABEL[item.category],
      count: 0,
      topScore: 0,
      critical: 0,
      high: 0,
    };
    current.count += 1;
    current.topScore = Math.max(current.topScore, Math.round(item.score));
    if (item.tone === "critical") current.critical += 1;
    if (item.tone === "high") current.high += 1;
    categoryStats.set(item.category, current);
  }

  const categoryBreakdown = Array.from(categoryStats.values())
    .sort((a, b) => b.topScore - a.topScore || b.count - a.count || a.label.localeCompare(b.label));

  const top = items[0] ?? null;
  const topMove = top ? toMove(top) : null;
  const focusStat = top ? categoryStats.get(top.category) : null;
  const topFactors = factorSummary(top);
  const topMoveSummary = moveSummary(top);
  const topQualitySummary = decisionQualitySummary(top);
  const topGateSummary = gateSummary(top);
  const topRankSummary = rankSummary(top);
  const topProofGapSummary = proofGapSummary(top);

  return {
    total: items.length,
    critical: items.filter((item) => item.tone === "critical").length,
    high: items.filter((item) => item.tone === "high").length,
    operator_summary: top
      ? `Start with ${safeActionLabel(top)}: ${top.title}. ${top.reason}${topProofGapSummary ? ` Proof gap: ${topProofGapSummary}.` : ""}${topQualitySummary ? ` ${topQualitySummary}.` : ""}${topMoveSummary ? ` Move: ${topMoveSummary}.` : ""}${topGateSummary ? ` Gate: ${topGateSummary}.` : ""}${topRankSummary ? ` Ranked because: ${topRankSummary}.` : ""}${topFactors ? ` Priority factors: ${topFactors}.` : ""}`
      : null,
    top_priority_factors: topFactors,
    execution_brief: executionBrief(top),
    categories,
    categoryBreakdown,
    focus: top && focusStat ? {
      category: top.category,
      label: CATEGORY_LABEL[top.category],
      count: focusStat.count,
      tone: top.tone,
      operator_mode: CATEGORY_MODE[top.category],
      reason: top.reason,
    } : null,
    top_action: top ? safeActionLabel(top) : null,
    top_reason: top?.reason ?? null,
    top_move: topMove,
    next_moves: items.slice(0, 5).map(toMove),
    quick_actions: items
      .filter((item) => item.entityId || item.href)
      .slice(0, 5)
      .map((item) => ({
        key: item.key,
        entity_type: item.entityType,
        entity_id: item.entityId,
        action: safeActionLabel(item),
        title: item.title,
        href: item.href,
        safe_action_label: safeActionLabel(item),
        requires_human_approval: true,
      })),
  };
}
