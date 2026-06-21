import { operatorMetricLabel } from "./operator-action-labels";

export type AgentTracePageCue = {
  target: string;
  label: string;
  detail: string;
  durationMs?: number;
};

function cleanTraceText(value: unknown, fallback: string) {
  const text = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return text.replace(/\s+/g, " ").slice(0, 220);
}

function traceRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function tracePath(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    const record = traceRecord(current);
    if (!record) return null;
    current = record[key];
  }
  return current;
}

function traceString(value: unknown, path: string[]) {
  const target = tracePath(value, path);
  return typeof target === "string" && target.trim() ? target.trim() : null;
}

function firstTraceRecord(value: unknown, paths: string[][]) {
  for (const path of paths) {
    const record = traceRecord(tracePath(value, path));
    if (record) return record;
  }
  return null;
}

function strategyDecisionQuality(result: unknown) {
  return firstTraceRecord(result, [
    ["decision_quality"],
    ["decision_brief", "decisionQuality"],
    ["execution_packet", "brief", "decisionQuality"],
    ["execution_packet", "evidence", "checks", "decision_quality"],
  ]);
}

function strategyDecisionContract(result: unknown) {
  return firstTraceRecord(result, [
    ["decision_contract"],
    ["execution_packet", "contract"],
  ]);
}

function strategyBrief(result: unknown) {
  return firstTraceRecord(result, [
    ["decision_brief"],
    ["execution_packet", "brief"],
  ]);
}

function strategyCommercialPriority(result: unknown) {
  return firstTraceRecord(result, [
    ["commercial_priority"],
    ["commercialPriority"],
    ["execution_packet", "commercialPriority"],
    ["execution_packet", "commercial_priority"],
  ]);
}

function firstChecklistItem(priority: Record<string, unknown> | null) {
  const checklist = tracePath(priority, ["checklist"]);
  return Array.isArray(checklist) ? traceRecord(checklist[0]) : null;
}

function firstRecordInArray(value: unknown) {
  return Array.isArray(value) ? traceRecord(value[0]) : null;
}

function firstProofGap(result: unknown, paths: string[][]) {
  for (const path of paths) {
    const gap = firstRecordInArray(tracePath(result, path));
    if (gap) return gap;
  }
  return null;
}

function proofGapCue(gap: Record<string, unknown> | null): AgentTracePageCue | null {
  if (!gap) return null;
  const target = traceString(gap, ["target"]) ?? "strategy-evidence";
  const label = traceString(gap, ["label"]) ?? "Proof gap";
  const action = traceString(gap, ["action"]);
  const detail = traceString(gap, ["detail"]);
  const metric = traceString(gap, ["metric"]);
  return {
    target,
    label: `Proof gap: ${label}`,
    detail: cleanTraceText(
      [action, metric, detail].filter(Boolean).join(" "),
      "Opening the evidence gap that blocks or weakens this decision.",
    ),
  };
}

function traceStringList(value: unknown, path: string[]) {
  const target = tracePath(value, path);
  return Array.isArray(target)
    ? target.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function traceStrategyToolHint(result: unknown) {
  const brief = strategyBrief(result);
  return traceString(result, ["operator_decision", "toolHint"])
    ?? traceString(result, ["commercial_decision", "toolHint"])
    ?? traceString(brief, ["nextAction", "toolHint"])
    ?? traceString(brief, ["operatorPlaybook", "toolHint"]);
}

function traceStrategyActionText(result: unknown) {
  const brief = strategyBrief(result);
  return traceString(brief, ["operatorPlaybook", "exactAsk"])
    ?? traceString(brief, ["operatorPlaybook", "firstMove"])
    ?? traceString(brief, ["nextCommand"])
    ?? traceString(result, ["operator_decision", "command"])
    ?? traceString(result, ["commercial_decision", "command"])
    ?? traceString(result, ["recommendation"])
    ?? traceString(result, ["action"]);
}

function addCue(cues: AgentTracePageCue[], cue: AgentTracePageCue) {
  if (cues.some((existing) => existing.target === cue.target && existing.label === cue.label)) return;
  cues.push(cue);
}

function contractCueLabel(state: string | null) {
  if (state === "blocked") return "Reading blocked contract";
  if (state === "ready") return "Reading ready contract";
  return "Reading review contract";
}

function decisionQualityFallback(metric: string | null, tone: string | null, suffix: string) {
  return `${operatorMetricLabel(metric, tone)} decision quality ${suffix}`;
}

function toolHintTarget(toolHint: string | null) {
  if (!toolHint) return "pricing-command-queue";
  if (toolHint.includes("missing_info") || toolHint.includes("readiness")) return "blocker-resolution";
  if (toolHint.includes("forwarder") || toolHint.includes("rates")) return "carrier-rates";
  if (toolHint.includes("quote")) return "customer-quote";
  if (toolHint.includes("strategy") || toolHint.includes("price")) return "strategy";
  return "pricing-command-queue";
}

function strategySecondaryTarget(name: string, toolHint: string | null) {
  if (name === "recommend_price") return "target-price";
  if (name === "draft_negotiation_plan") return "financials";
  if (name === "compare_routes") return "movement";
  if (name === "explain_risk") return "strategy-evidence";
  if (name === "plan_next_actions") return toolHintTarget(toolHint);
  return toolHintTarget(toolHint) === "pricing-command-queue" ? "strategy-evidence" : toolHintTarget(toolHint);
}

function strategyPrimaryLabel(name: string) {
  if (name === "inspect_brain") return "Reading commercial brain";
  if (name === "recommend_price") return "Reading price recommendation";
  if (name === "compare_routes") return "Reading route decision";
  if (name === "explain_risk") return "Reading risk evidence";
  if (name === "draft_negotiation_plan") return "Reading negotiation stance";
  if (name === "plan_next_actions") return "Planning next action";
  return "Running commercial brain";
}

function addStrategyToolCues(name: string, result: unknown, cues: AgentTracePageCue[]) {
  const actionText = traceStrategyActionText(result);
  const toolHint = traceStrategyToolHint(result);
  const decisionContract = strategyDecisionContract(result);
  const contractState = traceString(decisionContract, ["state"]);
  const contractTitle = traceString(decisionContract, ["title"]);
  const contractSummary = traceString(decisionContract, ["summary"]);
  const contractAllowed = traceStringList(decisionContract, ["allowedAgentMoves"])[0] ?? null;
  const contractForbidden = traceStringList(decisionContract, ["forbidden"])[0] ?? null;
  const decisionQuality = strategyDecisionQuality(result);
  const decisionQualityTone = traceString(decisionQuality, ["tone"]);
  const decisionQualityMetric = traceString(decisionQuality, ["metric"]);
  const decisionQualityDetail = traceString(decisionQuality, ["detail"]);
  const commercialPriority = strategyCommercialPriority(result);
  const priorityLabel = traceString(commercialPriority, ["label"]);
  const priorityWhy = traceString(commercialPriority, ["whyNow"]);
  const priorityUnlock = traceString(commercialPriority, ["economicUnlock"]);
  const checklistItem = firstChecklistItem(commercialPriority);
  const checklistTarget = traceString(checklistItem, ["target"]);
  const checklistAction = traceString(checklistItem, ["action"]);
  const gapCue = proofGapCue(firstProofGap(result, [
    ["proof_gaps"],
    ["proofGaps"],
    ["execution_packet", "evidence", "gaps"],
    ["execution_packet", "evidence", "proof_gaps"],
  ]));
  const target = strategySecondaryTarget(name, toolHint);

  addCue(cues, {
    target: name === "plan_next_actions" ? "job-summary" : "strategy",
    label: strategyPrimaryLabel(name),
    detail: cleanTraceText(actionText, "Using the commercial strategy brain before recommending the next move."),
  });

  if (decisionContract) {
    addCue(cues, {
      target: "decision-contract",
      label: contractCueLabel(contractState),
      detail: cleanTraceText(
        [contractTitle, contractSummary, contractForbidden ?? contractAllowed].filter(Boolean).join(" "),
        "Checking what the agent is allowed to do and what it must not do.",
      ),
    });
  } else {
    addCue(cues, {
      target: "decision-dossier",
      label: "Opening decision dossier",
      detail: cleanTraceText(actionText, "Checking the gate, weakest proof, document state, and agent boundary together."),
    });
  }

  if (commercialPriority) {
    addCue(cues, {
      target: "commercial-priority",
      label: "Reading commercial priority",
      detail: cleanTraceText(
        [priorityLabel, priorityWhy, priorityUnlock].filter(Boolean).join(" "),
        "Checking why this deal matters, what unlocks it, and which proof is missing.",
      ),
    });
  }

  if (decisionQuality) {
    addCue(cues, {
      target: "decision-quality",
      label: "Checking decision quality",
      detail: cleanTraceText(
        decisionQualityDetail,
        decisionQualityFallback(decisionQualityMetric, decisionQualityTone, "determines whether this recommendation is stable enough to use."),
      ),
    });
  }

  if (gapCue) addCue(cues, gapCue);

  if (checklistTarget && checklistAction) {
    addCue(cues, {
      target: checklistTarget,
      label: "Following operator checklist",
      detail: cleanTraceText(checklistAction, "Highlighting the first safe operator move."),
    });
  }

  if (target !== "strategy" && target !== "pricing-command-queue") {
    addCue(cues, {
      target,
      label: "Opening decision evidence",
      detail: cleanTraceText(actionText, "Highlighting the page evidence that supports or blocks the action."),
    });
  }
}

export function deriveToolPageCues(name: string, result: unknown): AgentTracePageCue[] {
  const cues: AgentTracePageCue[] = [];

  if (name === "list_decision_queue") {
    const action = traceString(result, ["summary", "execution_brief", "action"]);
    const nextStep = traceString(result, ["summary", "execution_brief", "next_step"]);
    const target = traceString(result, ["summary", "execution_brief", "visual_target"]);
    const decisionContract = traceRecord(tracePath(result, ["summary", "execution_brief", "decision_contract"]));
    const contractState = traceString(decisionContract, ["state"]);
    const contractTitle = traceString(decisionContract, ["title"]);
    const contractSummary = traceString(decisionContract, ["summary"]);
    const contractForbidden = traceStringList(decisionContract, ["forbidden"])[0] ?? null;
    const decisionQuality = traceRecord(tracePath(result, ["summary", "execution_brief", "decision_quality"]));
    const decisionQualityMetric = traceString(decisionQuality, ["metric"]);
    const decisionQualityTone = traceString(decisionQuality, ["tone"]);
    const decisionQualityDetail = traceString(decisionQuality, ["detail"]);
    const gapCue = proofGapCue(firstProofGap(result, [
      ["summary", "execution_brief", "proof_gaps"],
      ["summary", "top_move", "proof_gaps"],
    ]));
    cues.push({
      target: "decision-queue",
      label: "Reading first move",
      detail: cleanTraceText(nextStep, action ?? "Using the ranked decision queue before touching records."),
    });
    if (decisionQuality) {
      cues.push({
        target: "decision-quality",
        label: "Checking decision quality",
        detail: cleanTraceText(
          decisionQualityDetail,
          decisionQualityFallback(decisionQualityMetric, decisionQualityTone, "determines whether the queue move is defensible."),
        ),
      });
    }
    if (gapCue) cues.push(gapCue);
    if (decisionContract) {
      cues.push({
        target: "decision-contract",
        label: contractCueLabel(contractState),
        detail: cleanTraceText(
          [contractTitle, contractSummary, contractForbidden].filter(Boolean).join(" "),
          "Checking the desk action boundary before recommending a move.",
        ),
      });
    }
    if (target && target !== "decision-queue") {
      cues.push({
        target,
        label: "Opening target area",
        detail: cleanTraceText(action, "Highlighting the page block selected by the decision brain."),
      });
    }
  }

  if (name === "morning_briefing") {
    const target = traceString(result, ["control_sheet", "operator_playbook", "visualTarget"])
      ?? traceString(result, ["decision_queue_summary", "execution_brief", "visual_target"]);
    const firstMove = traceString(result, ["control_sheet", "operator_playbook", "firstMove"])
      ?? traceString(result, ["decision_queue_summary", "execution_brief", "next_step"]);
    cues.push({
      target: "decision-queue",
      label: "Building desk brief",
      detail: cleanTraceText(firstMove, "Combining queue, inbox, lead, and stuck-job signals."),
    });
    if (target && target !== "decision-queue") {
      cues.push({
        target,
        label: "Checking brief target",
        detail: cleanTraceText(firstMove, "Opening the board area selected by the brief."),
      });
    }
  }

  if (name === "inspect_control_sheet") {
    const target = traceString(result, ["operator_playbook", "visualTarget"]);
    const firstMove = traceString(result, ["operator_playbook", "firstMove"]);
    cues.push({
      target: "reference-deal-playbook",
      label: "Reading sheet playbook",
      detail: cleanTraceText(firstMove, "Checking the first move and stop rule before touching rows."),
    });
    if (target && target !== "reference-deal-playbook") {
      cues.push({
        target,
        label: "Opening sheet decision",
        detail: cleanTraceText(firstMove, "Highlighting the row selected by the sheet playbook."),
      });
    }
  }

  if (name === "list_pricing_commands") {
    const brief = traceRecord(tracePath(result, ["summary", "execution_brief"]));
    const exactAsk = traceString(brief, ["exact_ask"]);
    const firstMove = traceString(brief, ["first_move"]);
    const objective = traceString(brief, ["objective"]);
    const toolHint = traceString(brief, ["tool_hint"]);
    const decisionContract = traceRecord(tracePath(brief, ["decision_contract"]));
    const contractState = traceString(decisionContract, ["state"]);
    const contractTitle = traceString(decisionContract, ["title"]);
    const contractSummary = traceString(decisionContract, ["summary"]);
    const decisionQuality = traceRecord(tracePath(brief, ["decision_quality"]));
    const decisionQualityTone = traceString(decisionQuality, ["tone"]);
    const decisionQualityMetric = traceString(decisionQuality, ["metric"]);
    const decisionQualityDetail = traceString(decisionQuality, ["detail"]);
    const gapCue = proofGapCue(firstProofGap(result, [
      ["summary", "execution_brief", "proof_gaps"],
      ["summary", "top_command", "proof_gaps"],
      ["summary", "proof_gaps"],
    ]));
    const commercialPriority = traceRecord(tracePath(brief, ["commercial_priority"]))
      ?? traceRecord(tracePath(brief, ["commercialPriority"]))
      ?? traceRecord(tracePath(result, ["summary", "commercial_priority"]));
    const priorityLabel = traceString(commercialPriority, ["label"]);
    const priorityWhy = traceString(commercialPriority, ["whyNow"]);
    const priorityUnlock = traceString(commercialPriority, ["economicUnlock"]);
    const checklistItem = firstChecklistItem(commercialPriority);
    const checklistTarget = traceString(checklistItem, ["target"]);
    const checklistAction = traceString(checklistItem, ["action"]);
    const target = toolHintTarget(toolHint);
    cues.push({
      target: "pricing-command-queue",
      label: "Reading pricing command",
      detail: cleanTraceText(objective ?? firstMove ?? exactAsk, "Ranking RFQs by maturity, margin, target, urgency, and coverage."),
    });
    if (decisionContract) {
      cues.push({
        target: "decision-contract",
        label: contractCueLabel(contractState),
        detail: cleanTraceText(
          [contractTitle, contractSummary].filter(Boolean).join(" "),
          "Checking what the top pricing command allows and forbids.",
        ),
      });
    }
    if (commercialPriority) {
      cues.push({
        target: "commercial-priority",
        label: "Reading commercial priority",
        detail: cleanTraceText(
          [priorityLabel, priorityWhy, priorityUnlock].filter(Boolean).join(" "),
          "Checking the priority brief before acting on the pricing queue.",
        ),
      });
    }
    if (decisionQuality) {
      cues.push({
        target: "decision-quality",
        label: "Checking decision quality",
        detail: cleanTraceText(
          decisionQualityDetail,
          decisionQualityFallback(decisionQualityMetric, decisionQualityTone, "determines how safe the recommendation is."),
        ),
      });
    }
    if (gapCue) cues.push(gapCue);
    if (target !== "pricing-command-queue") {
      cues.push({
        target,
        label: "Checking pricing target",
        detail: cleanTraceText(exactAsk ?? firstMove, "Opening the pricing area selected by the commercial brain."),
      });
    }
    if (checklistTarget && checklistAction) {
      cues.push({
        target: checklistTarget,
        label: "Following operator checklist",
        detail: cleanTraceText(checklistAction, "Highlighting the first safe checklist move."),
      });
    }
  }

  if ([
    "inspect_brain",
    "plan_next_actions",
    "assess_strategy",
    "recommend_price",
    "compare_routes",
    "explain_risk",
    "draft_negotiation_plan",
  ].includes(name)) {
    addStrategyToolCues(name, result, cues);
  }

  return cues.slice(0, 5);
}
