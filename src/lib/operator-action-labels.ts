const TOOL_LABELS: Record<string, string> = {
  draft_missing_info_request: "Draft missing-info request",
  create_forwarder_drafts: "Create forwarder drafts",
  draft_customer_quote: "Draft customer quote",
  draft_negotiation_plan: "Draft negotiation plan",
  recommend_price: "Review price recommendation",
  assess_strategy: "Review strategy",
  prepare_control_sheet_rfq: "Create RFQ from sheet lead",
  inspect_control_sheet: "Inspect sheet lead",
  find_follow_up_targets: "Find stale follow-ups",
  search_email_threads: "Open inbox thread",
  none: "Open scoped record",
};

const SURFACE_LABELS: Record<string, string> = {
  rfq_missing_info: "RFQ maturity",
  pricing_forwarder_drafts: "Forwarder pricing",
  pricing_review: "Pricing review",
  customer_quote: "Customer quote",
  deal_parking: "Parked deal",
};

export function operatorToolLabel(toolHint: string | null | undefined) {
  if (!toolHint) return TOOL_LABELS.none;
  return TOOL_LABELS[toolHint] ?? toolHint.split("_").filter(Boolean).map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
  )).join(" ");
}

export function operatorSurfaceLabel(surface: string | null | undefined) {
  if (!surface) return "Decision surface";
  return SURFACE_LABELS[surface] ?? surface.split("_").filter(Boolean).map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
  )).join(" ");
}

export function operatorPhaseLabel(phase: string | null | undefined) {
  if (!phase) return "Decision";
  return phase.split("_").filter(Boolean).map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
  )).join(" ");
}

export function operatorEvidenceStateLabel(tone: string | null | undefined) {
  if (tone === "blocked" || tone === "weak") return "Blocked";
  if (tone === "review" || tone === "watch") return "Needs proof";
  if (tone === "rates") return "Needs rates";
  if (tone === "ready" || tone === "strong") return "Proven";
  return "Context";
}

export function operatorMetricLabel(metric: string | null | undefined, tone: string | null | undefined) {
  if (!metric) return operatorEvidenceStateLabel(tone);
  if (/^\d+\/100$/.test(metric.trim())) return operatorEvidenceStateLabel(tone);
  return metric;
}

export function operatorMaturityLabel(hasBlockers: boolean, maturity: number | null | undefined) {
  if (hasBlockers) return "Blocked";
  if (maturity != null && maturity < 80) return "Needs proof";
  return "Ready";
}
