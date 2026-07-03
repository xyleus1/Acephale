export const CRM_COMPANY_CATEGORIES = [
  "customer",
  "prospect",
  "partner",
  "vendor",
  "investor",
  "advisor",
  "carrier",
  "broker",
  "customs_broker",
  "freight_backend",
  "software_provider",
  "other",
] as const;

export const CRM_COMPANY_STAGES = [
  "new",
  "researching",
  "contacted",
  "active_conversation",
  "customer",
  "dormant",
  "not_fit",
  "archived",
] as const;

export const CRM_OPPORTUNITY_TYPES = [
  "customer_lead",
  "partner_lead",
  "vendor_lead",
  "investor_lead",
  "rfq_related",
  "strategic_relationship",
] as const;

export const CRM_OPPORTUNITY_STAGES = [
  "idea",
  "researching",
  "qualified",
  "contacted",
  "meeting_scheduled",
  "active",
  "won",
  "lost",
  "parked",
] as const;

export const CRM_PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const CRM_RELATIONSHIP_STRENGTHS = ["unknown", "weak", "warm", "strong", "trusted"] as const;

// Priority/leverage columns are plain strings, so DB orderBy sorts alphabetically
// ("high" after "low"); every ranked sort must go through these instead.
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const LEVERAGE_RANK: Record<string, number> = { very_high: 0, high: 1, medium: 2, low: 3 };

export function priorityRank(value: string | null | undefined) {
  return PRIORITY_RANK[value ?? ""] ?? 9;
}

export function leverageRank(value: string | null | undefined) {
  return LEVERAGE_RANK[value ?? ""] ?? 9;
}

export type CrmLayer = "office" | "network";

// Two-layer persona: the freight office book vs the founders' startup network.
export const CRM_OFFICE_CATEGORIES = ["customer", "prospect", "carrier", "broker", "customs_broker", "freight_backend"] as const;
export const CRM_NETWORK_CATEGORIES = ["partner", "vendor", "investor", "advisor", "software_provider", "other"] as const;

export function categoriesForLayer(layer: string | null | undefined): readonly string[] | null {
  if (layer === "office") return CRM_OFFICE_CATEGORIES;
  if (layer === "network") return CRM_NETWORK_CATEGORIES;
  return null;
}

export const CRM_TASK_STATUS_FILTERS = [
  ["", "Open"],
  ["done", "Done"],
  ["all", "All"],
] as const;
export const CRM_CONTACT_TYPES = [
  "buyer",
  "shipper",
  "operator",
  "partner",
  "vendor",
  "investor",
  "advisor",
  "founder_friend",
  "yc_contact",
  "connector",
  "other",
] as const;
export const CRM_LEVERAGE_LEVELS = ["low", "medium", "high", "very_high"] as const;

export type CrmTone = "neutral" | "good" | "warn" | "danger" | "info" | "strong";

const LABELS: Record<string, string> = {
  active_conversation: "Active conversation",
  not_fit: "Not fit",
  customs_broker: "Customs broker",
  freight_backend: "Freight backend",
  software_provider: "Software provider",
  customer_lead: "Customer lead",
  partner_lead: "Partner lead",
  vendor_lead: "Vendor lead",
  investor_lead: "Investor lead",
  rfq_related: "RFQ linked",
  strategic_relationship: "Strategic relationship",
  meeting_scheduled: "Meeting scheduled",
  founder_friend: "Founder friend",
  yc_contact: "YC contact",
  very_high: "Very high",
  web_intel: "Web intel",
  gbrain: "GBrain",
  rfq: "RFQ",
};

export function crmLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  return LABELS[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function priorityTone(value: string | null | undefined): CrmTone {
  if (value === "critical") return "danger";
  if (value === "high") return "warn";
  if (value === "low") return "neutral";
  return "info";
}

export function stageTone(value: string | null | undefined): CrmTone {
  if (value === "customer" || value === "won" || value === "active") return "good";
  if (value === "active_conversation" || value === "meeting_scheduled" || value === "qualified") return "info";
  if (value === "lost" || value === "not_fit" || value === "archived") return "danger";
  if (value === "dormant" || value === "parked") return "warn";
  return "neutral";
}

export function strengthTone(value: string | null | undefined): CrmTone {
  if (value === "trusted" || value === "strong") return "good";
  if (value === "warm") return "info";
  if (value === "weak") return "warn";
  return "neutral";
}

export function sourceTone(value: string | null | undefined): CrmTone {
  if (value === "gbrain" || value === "rfq") return "strong";
  if (value === "gmail" || value === "granola" || value === "web_intel") return "info";
  if (value === "manual") return "neutral";
  return "warn";
}

export function daysUntil(date: Date | null | undefined) {
  if (!date) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export function daysAgo(date: Date | null | undefined) {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export function dateInputValue(date: Date | null | undefined) {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

export function compactMoney(value: number | null | undefined, currency: string | null | undefined = "USD") {
  if (value == null || Number.isNaN(value)) return "No value";
  return `${currency ?? "USD"} ${Math.round(value).toLocaleString()}`;
}
