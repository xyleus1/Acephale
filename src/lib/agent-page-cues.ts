import type { AgentPageCueDetail } from "@/lib/agent-page-presence";

export type AgentPageCue = AgentPageCueDetail;

export type AgentTraceForCues = {
  name: string;
  ok: boolean;
  error?: string | null;
  pageCues?: AgentPageCue[];
};

export const TOOL_PAGE_CUES: Record<string, readonly AgentPageCue[]> = {
  list_decision_queue: [
    { target: "decision-flow", label: "Reading decision queue", detail: "Ranking lead, RFQ, pricing, quote, reply, risk, and agent-review work." },
    { target: "reference-deal-playbook", label: "Reading sheet playbook", detail: "Checking the first move, safety rule, and decision counts before touching rows." },
    { target: "reference-deal-top", label: "Checking top sheet decision", detail: "Reading the row command, stop rule, and whether RFQ creation is actually allowed." },
  ],
  morning_briefing: [
    { target: "decision-flow", label: "Building desk brief", detail: "Combining queue, inbox, lead, and stuck-job signals." },
    { target: "email", label: "Checking reply pressure", detail: "Looking for inbound threads and stale follow-ups." },
    { target: "timeline", label: "Checking timing", detail: "Comparing current work against milestone pressure." },
  ],
  list_pricing_commands: [
    { target: "pricing-command-queue", label: "Reading pricing queue", detail: "Ranking RFQs by maturity, target price, margin room, customer quality, urgency, and coverage." },
    { target: "decision-contract", label: "Checking decision contract", detail: "Confirming the allowed move, forbidden action, and stop condition before pricing work." },
    { target: "pricing-command", label: "Opening top command", detail: "Checking the operator playbook and the first safe pricing move." },
    { target: "decision-quality", label: "Checking decision quality", detail: "Looking for the fragile input that could change the recommendation." },
    { target: "blocker-resolution", label: "Checking blockers", detail: "Confirming what must be resolved before forwarders or customer quote work." },
  ],
  inspect_brain: [
    { target: "decision-contract", label: "Reading brain contract", detail: "Checking the allowed move, forbidden move, and stop condition before answering." },
    { target: "decision-dossier", label: "Reading decision dossier", detail: "Combining quote gate, proof gaps, route, risk, target, and agent boundaries." },
    { target: "decision-quality", label: "Checking decision quality", detail: "Finding the fragile input that could change the recommendation." },
    { target: "commercial-priority", label: "Checking commercial priority", detail: "Confirming why this deal matters and what unlocks the next move." },
    { target: "strategy-evidence", label: "Checking proof gap", detail: "Looking for the weakest proof before recommending action." },
  ],
  inspect_control_sheet: [
    { target: "reference-deals", label: "Reading lead board", detail: "Separating RFQ candidates, non-RFQ context, proof rows, and loss evidence." },
    { target: "reference-deal-playbook", label: "Reading sheet playbook", detail: "Checking the first move, safety rule, and decision counts before touching rows." },
    { target: "reference-deal-top", label: "Opening top decision row", detail: "Checking the first command, evidence gaps, economics posture, and stop rule." },
  ],
  prepare_control_sheet_rfq: [
    { target: "reference-deal-playbook", label: "Checking sheet stop rule", detail: "Confirming the board allows an RFQ draft path for the selected row." },
    { target: "reference-deal-top", label: "Mapping sheet decision", detail: "Confirming this row is allowed to become an RFQ before drafting anything." },
    { target: "source-rfq", label: "Checking RFQ maturity", detail: "Separating known cargo facts from fields that still need customer confirmation." },
  ],
  inspect_job_readiness: [
    { target: "source-rfq", label: "Auditing RFQ facts", detail: "Checking origin, destination, mode, cargo, DG, customs, and target-price state." },
    { target: "documents", label: "Checking proof pack", detail: "Looking for document issues that block customer-safe movement." },
    { target: "email", label: "Checking communication", detail: "Finding whether the next move is on us or the counterparty." },
  ],
  plan_next_actions: [
    { target: "job-summary", label: "Planning next action", detail: "Starting from current status, blocker count, and commercial stage." },
    { target: "decision-contract", label: "Checking decision contract", detail: "Reading what the agent can prepare and what it must not send." },
    { target: "strategy", label: "Checking strategy", detail: "Using margin, risk, and coverage before recommending action." },
    { target: "email", label: "Preparing communication", detail: "Matching the next move to the current thread state." },
  ],
  assess_strategy: [
    { target: "strategy", label: "Running commercial brain", detail: "Scoring maturity, price power, route quality, risk, customer value, and confidence." },
    { target: "decision-contract", label: "Checking decision contract", detail: "Reading the hard boundary for allowed agent work and forbidden external actions." },
    { target: "decision-quality", label: "Checking decision quality", detail: "Separating a defensible decision from a fragile score." },
    { target: "decision-reasons", label: "Reading decision reasons", detail: "Explaining the commercial stance from the visible rationale stack." },
    { target: "strategy-evidence", label: "Checking evidence", detail: "Separating strong evidence from assumptions and missing facts." },
  ],
  recommend_price: [
    { target: "decision-contract", label: "Checking decision contract", detail: "Confirming whether price work is blocked, review-only, or ready before showing a number." },
    { target: "target-price", label: "Checking target memory", detail: "Reading the latest target, source, and historical target signals." },
    { target: "decision-quality", label: "Checking decision quality", detail: "Verifying whether price advice is stable enough to use." },
    { target: "strategy", label: "Checking price guardrails", detail: "Comparing buy cost, floor, target, recommended price, and walk-away." },
    { target: "carrier-rates", label: "Checking market cost", detail: "Using received forwarder rates before quoting the customer." },
    { target: "financials", label: "Checking margin", detail: "Verifying job-level revenue, cost, and gross margin." },
  ],
  simulate_pricing_scenario: [
    { target: "pricing-scenario", label: "Running what-if", detail: "Testing the target and buy-cost scenario without writing anything." },
    { target: "financials", label: "Checking margin math", detail: "Comparing simulated revenue, cost, margin, and walk-away pressure." },
    { target: "target-price", label: "Checking target context", detail: "Keeping the what-if separate from recorded target history." },
  ],
  compare_routes: [
    { target: "strategy", label: "Comparing route options", detail: "Looking at cost, coverage, transit, and route tradeoffs." },
    { target: "decision-contract", label: "Checking decision contract", detail: "Confirming whether route advice can be used or only reviewed." },
    { target: "movement", label: "Checking movement stage", detail: "Matching route advice to shipment progress." },
  ],
  explain_risk: [
    { target: "strategy", label: "Explaining risk", detail: "Finding commercial, cargo, route, timing, and confidence risks." },
    { target: "decision-contract", label: "Checking decision contract", detail: "Reading what the current risk posture forbids the agent from doing." },
    { target: "strategy-evidence", label: "Checking risk evidence", detail: "Showing which visible facts support the warning." },
  ],
  draft_negotiation_plan: [
    { target: "decision-contract", label: "Checking decision contract", detail: "Confirming negotiation output is review-only before drafting language." },
    { target: "financials", label: "Building negotiation stance", detail: "Using floor, target, win odds, route tradeoffs, and top risk." },
    { target: "decision-reasons", label: "Checking leverage", detail: "Turning guardrails into customer and forwarder language." },
  ],
  draft_missing_info_request: [
    { target: "target-price", label: "Checking target answer", detail: "Verifying whether the customer gave a target or explicitly has no target." },
    { target: "blocker-resolution", label: "Finding missing fields", detail: "Asking only for facts that are required for a mature RFQ." },
    { target: "source-rfq", label: "Reading source RFQ", detail: "Keeping the customer ask grounded in explicit source facts." },
  ],
  create_forwarder_drafts: [
    { target: "decision-contract", label: "Checking forwarder gate", detail: "Confirming mature RFQ permission and review-only boundaries before drafts." },
    { target: "carrier-rates", label: "Preparing forwarder drafts", detail: "Checking mature RFQ facts before creating reviewed outbound requests." },
    { target: "blocker-resolution", label: "Checking send gate", detail: "Stopping if the RFQ is not mature enough for forwarders." },
  ],
  edit_job: [
    { target: "proposal-dossier", label: "Reviewing proposed job update", detail: "Checking how the pasted or agent-proposed fields change the commercial gate before anything is applied." },
    { target: "decision-dossier", label: "Comparing current dossier", detail: "Keeping the pending proposal tied to the live gate, proof, data, and agent boundary." },
  ],
  paste_rfq_update: [
    { target: "proposal-dossier", label: "Reviewing pasted RFQ proposal", detail: "Checking how pasted facts change maturity, gate, target, and the next safe agent action." },
    { target: "decision-dossier", label: "Comparing current dossier", detail: "Keeping the proposed diff tied to the live commercial gate and weakest evidence." },
    { target: "blocker-resolution", label: "Checking remaining blockers", detail: "Confirming what is still missing after the proposed paste update." },
  ],
  paste_rfq_no_change: [
    { target: "decision-dossier", label: "Checking current dossier", detail: "The paste did not create a reviewable field change, so the live decision dossier remains authoritative." },
    { target: "source-rfq", label: "Checking pasted facts", detail: "No empty job fields were safely filled from the paste." },
  ],
  paste_rfq_parse: [
    { target: "source-rfq", label: "Reading pasted RFQ facts", detail: "Separating explicit pasted facts from missing or conflicting RFQ data." },
    { target: "blocker-resolution", label: "Checking missing fields", detail: "Showing what must be asked before the RFQ is mature." },
  ],
  edit_inquiry: [
    { target: "proposal-dossier", label: "Reviewing proposed RFQ update", detail: "Checking the maturity and decision impact before accepting pasted RFQ facts." },
    { target: "blocker-resolution", label: "Checking remaining blockers", detail: "Confirming whether the proposal clears the missing customer facts." },
  ],
  move_job_stage: [
    { target: "proposal-dossier", label: "Reviewing stage proposal", detail: "Checking whether the proposed stage change matches the commercial gate and stop rules." },
    { target: "decision-dossier", label: "Checking gate before stage move", detail: "The agent should not move the load beyond the visible decision evidence." },
  ],
  set_revenue: [
    { target: "proposal-dossier", label: "Reviewing revenue proposal", detail: "Checking how the customer price changes margin, guardrails, and next safe action." },
    { target: "financials", label: "Checking quote economics", detail: "Comparing proposed revenue against cost, margin, and target pressure." },
  ],
  set_cost: [
    { target: "proposal-dossier", label: "Reviewing cost proposal", detail: "Checking how the buy cost changes floor, guardrail, and quote readiness." },
    { target: "carrier-rates", label: "Checking market cost", detail: "Keeping cost updates tied to forwarder evidence." },
  ],
  add_quote_line: [
    { target: "proposal-dossier", label: "Reviewing quote-line proposal", detail: "Checking whether the line item is safe against the current commercial gate." },
    { target: "financials", label: "Checking quote output", detail: "Keeping quote edits tied to visible economics." },
  ],
  draft_customer_quote: [
    { target: "decision-contract", label: "Checking quote contract", detail: "Confirming the quote can only become a reviewed draft unless approved." },
    { target: "customer-quote", label: "Drafting customer quote", detail: "Preparing reviewed quote text without sending or recording a final quote." },
    { target: "financials", label: "Checking quote economics", detail: "Verifying cost, revenue, margin, and target pressure." },
  ],
  find_follow_up_targets: [
    { target: "email", label: "Scanning follow-ups", detail: "Finding stale inbound and outbound threads by age and ownership." },
    { target: "timeline", label: "Checking urgency", detail: "Using stage and timing to prioritize replies." },
  ],
  draft_customer_update: [
    { target: "job-summary", label: "Reading customer-safe facts", detail: "Pulling route, status, schedule, blocker, and portal context." },
    { target: "email", label: "Drafting update", detail: "Preparing a customer message without sending it." },
  ],
  summarize_carrier_rates: [
    { target: "carrier-rates", label: "Reading forwarder rates", detail: "Comparing received rates, pending replies, and selected cost." },
    { target: "strategy", label: "Checking quote readiness", detail: "Making sure pricing advice has enough market coverage." },
  ],
  summarize_supplier_offers: [
    { target: "carrier-rates", label: "Reading supplier offers", detail: "Comparing supplier replies for sourcing-style work." },
    { target: "strategy", label: "Checking commercial posture", detail: "Separating supplier cost from customer quote strategy." },
  ],
  search_email_threads: [
    { target: "email", label: "Searching inbox", detail: "Looking for matching customer, forwarder, or supplier threads." },
  ],
  list_threads_awaiting_reply: [
    { target: "email", label: "Checking replies due", detail: "Finding threads where the latest message is inbound." },
  ],
  get_job: [
    { target: "job-summary", label: "Reading focused load", detail: "Opening the current job state before answering." },
  ],
};

type CueSurface = "global" | "job";

export function inferPageCues(text: string, surface: CueSurface = "global"): readonly AgentPageCue[] {
  const lower = text.toLowerCase();
  if (lower.includes("control sheet") || lower.includes("sheet lead") || lower.includes("lead board") || lower.includes("where is the money")) {
    return TOOL_PAGE_CUES.inspect_control_sheet;
  }
  if (lower.includes("pricing queue") || lower.includes("pricing brain") || lower.includes("rfqs to price")) {
    return TOOL_PAGE_CUES.list_pricing_commands;
  }
  if (lower.includes("brain") || lower.includes("decision contract") || lower.includes("proof") || lower.includes("evidence") || lower.includes("what next") || lower.includes("next move")) {
    return TOOL_PAGE_CUES.inspect_brain;
  }
  if (lower.includes("decision queue") || lower.includes("run desk") || lower.includes("run the desk") || lower.includes("what should i work on")) {
    return surface === "job"
      ? [
        ...TOOL_PAGE_CUES.list_decision_queue,
        { target: "job-summary", label: "Checking focused load", detail: "Comparing queue priority against the active job." },
      ]
      : TOOL_PAGE_CUES.list_decision_queue;
  }
  if (lower.includes("what if") || lower.includes("simulate") || lower.includes("buy cost")) {
    return TOOL_PAGE_CUES.simulate_pricing_scenario;
  }
  if (lower.includes("price") || lower.includes("pricing") || lower.includes("margin") || lower.includes("target")) {
    return TOOL_PAGE_CUES.recommend_price;
  }
  if (lower.includes("stale") || lower.includes("follow") || lower.includes("reply") || lower.includes("thread")) {
    return TOOL_PAGE_CUES.find_follow_up_targets;
  }
  if (lower.includes("draft") || lower.includes("customer") || lower.includes("email")) {
    return TOOL_PAGE_CUES.draft_customer_update;
  }
  if (lower.includes("missing") || lower.includes("readiness") || lower.includes("qualify") || lower.includes("rfq")) {
    return surface === "job"
      ? [
        { target: "target-price", label: "Checking target answer", detail: "Confirming target price or no-target state as part of RFQ maturity." },
        ...TOOL_PAGE_CUES.inspect_job_readiness,
      ]
      : TOOL_PAGE_CUES.inspect_job_readiness;
  }
  return surface === "job"
    ? [
      { target: "job-brief", label: "Reading the load brief", detail: "Starting from the main RFQ desk context." },
      { target: "stage-workbench", label: "Checking the current workbench", detail: "Looking at the active stage and available actions." },
      { target: "email", label: "Checking communication", detail: "Reviewing email context before answering." },
    ]
    : [
      { target: "job-brief", label: "Reading load brief", detail: "Starting from the main RFQ desk context." },
      { target: "pricing-command-queue", label: "Checking pricing queue", detail: "Looking for active commercial commands." },
      { target: "email", label: "Checking communication", detail: "Reviewing inbox context before answering." },
    ];
}

export function cuesForToolTrace(
  trace: readonly AgentTraceForCues[] | undefined,
  fallbackTarget = "pricing-command-queue",
): readonly AgentPageCue[] {
  if (!trace?.length) return [];
  const cues: AgentPageCue[] = [];
  const seen = new Set<string>();

  for (const tool of trace) {
    const mapped = tool.ok && tool.pageCues?.length ? tool.pageCues : TOOL_PAGE_CUES[tool.name] ?? [
      {
        target: fallbackTarget,
        label: `Ran ${prettyToolName(tool.name)}`,
        detail: tool.ok ? "The agent used live product data for this answer." : (tool.error ?? "The tool failed."),
      },
    ];

    for (const cue of mapped) {
      const key = `${cue.target}:${cue.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cues.push(tool.ok ? cue : {
        target: cue.target,
        label: `${cue.label} failed`,
        detail: tool.error ?? "The tool failed before returning usable data.",
      });
    }
  }

  return cues.slice(0, 5);
}

export function prettyToolName(name: string) {
  return name
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
}
