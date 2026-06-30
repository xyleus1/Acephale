import type { StrategyCommercialChecklistItem } from "@/lib/commercial-strategy";

export type CommercialChecklistActionKind = "missing-info" | "forwarder-drafts" | "negotiation-plan" | "customer-quote";

export type CommercialChecklistItemWithAction = {
  item: StrategyCommercialChecklistItem;
  actionKind: CommercialChecklistActionKind | null;
};

export function commercialChecklistActionKind(key: StrategyCommercialChecklistItem["key"]): CommercialChecklistActionKind | null {
  if (key === "qualify" || key === "target") return "missing-info";
  if (key === "rates") return "forwarder-drafts";
  if (key === "economics" || key === "approval") return "negotiation-plan";
  if (key === "quote") return "customer-quote";
  return null;
}

export function commercialChecklistItemsWithActions(
  checklist: StrategyCommercialChecklistItem[],
  options: { limit?: number } = {}
): CommercialChecklistItemWithAction[] {
  const seen = new Set<CommercialChecklistActionKind>();
  const items = options.limit == null ? checklist : checklist.slice(0, options.limit);
  return items.map((item) => {
    const kind = commercialChecklistActionKind(item.key);
    const showAction = kind != null && !seen.has(kind);
    if (kind) seen.add(kind);
    return { item, actionKind: showAction ? kind : null };
  });
}
