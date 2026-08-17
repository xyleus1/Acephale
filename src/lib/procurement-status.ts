export const PROCUREMENT_ACTIVE_STATUSES = new Set(["new", "researching", "sourcing"]);

export const PROCUREMENT_APPROVAL_STATUSES = new Set([
  "awaiting_shortlist_approval",
  "awaiting_order_approval",
]);

export const PROCUREMENT_STATUS_LABELS: Record<string, string> = {
  new: "Queued",
  researching: "Supplier research",
  awaiting_shortlist_approval: "Shortlist approval",
  sourcing: "RFQs and replies",
  awaiting_order_approval: "Final approval",
  ordered: "Completed",
  needs_attention: "Needs attention",
  cancelled: "Canceled",
};
