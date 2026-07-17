// Shared vocabulary + deterministic tier logic for high-value tech freight
// (client + server safe, no runtime deps). The tier drives the per-load
// security SOP checklist; the derivation is a visible, overridable suggestion
// — never a silent write over an operator's choice.

export const COMMODITY_CATEGORIES = [
  ["servers_gpu", "Servers / GPUs"],
  ["semicap_tools", "Semiconductor equipment"],
  ["networking", "Networking equipment"],
  ["batteries_un3480", "Lithium batteries — UN3480 (standalone)"],
  ["batteries_un3481", "Lithium batteries — UN3481 (in equipment)"],
  ["robotics", "Robotics"],
  ["test_instruments", "Test & lab instruments"],
  ["medical_devices", "Medical devices"],
  ["consumer_electronics", "Consumer electronics"],
  ["other_tech", "Other tech"],
  ["non_tech", "Non-tech"],
] as const;

export const SECURITY_TIERS = [
  ["standard", "Standard"],
  ["elevated", "Elevated"],
  ["high_value", "High value"],
  ["critical", "Critical"],
] as const;

export const TRACKING_TYPES = [
  ["none", "None"],
  ["phone_check", "Phone check calls"],
  ["eld_app", "ELD / tracking app"],
  ["gps_device", "GPS device on freight"],
  ["escort", "Escort / team watch"],
] as const;

export type CommodityCategory = (typeof COMMODITY_CATEGORIES)[number][0];
export type SecurityTier = (typeof SECURITY_TIERS)[number][0];
export type TrackingType = (typeof TRACKING_TYPES)[number][0];

export const COMMODITY_CATEGORY_VALUES = COMMODITY_CATEGORIES.map(([value]) => value);
export const SECURITY_TIER_VALUES = SECURITY_TIERS.map(([value]) => value);
export const TRACKING_TYPE_VALUES = TRACKING_TYPES.map(([value]) => value);

export function securityTierLabel(value: string | null): string {
  return SECURITY_TIERS.find(([v]) => v === value)?.[1] ?? (value ?? "");
}

export function commodityCategoryLabel(value: string | null): string {
  return COMMODITY_CATEGORIES.find(([v]) => v === value)?.[1] ?? (value ?? "");
}

const TIER_RANK: Record<SecurityTier, number> = {
  standard: 0,
  elevated: 1,
  high_value: 2,
  critical: 3,
};

export function tierRank(tier: string | null | undefined): number {
  return tier && tier in TIER_RANK ? TIER_RANK[tier as SecurityTier] : -1;
}

// Category floors: what a load of this commodity warrants regardless of value.
// Everything electronics-shaped starts at "elevated" — electronics is the #1
// stolen commodity and CA is the theft epicenter. Batteries carry DG handling
// risk on top of theft risk.
const CATEGORY_FLOOR: Record<CommodityCategory, SecurityTier> = {
  servers_gpu: "elevated",
  semicap_tools: "elevated",
  networking: "elevated",
  batteries_un3480: "elevated",
  batteries_un3481: "elevated",
  robotics: "elevated",
  test_instruments: "elevated",
  medical_devices: "elevated",
  consumer_electronics: "elevated",
  other_tech: "standard",
  non_tech: "standard",
};

function valueTier(declaredValue: number): SecurityTier {
  if (declaredValue >= 500_000) return "critical";
  if (declaredValue >= 100_000) return "high_value";
  if (declaredValue >= 25_000) return "elevated";
  return "standard";
}

// Deterministic suggestion: max(value ladder, category floor).
// Returns null when there is no signal at all — no suggestion beats a wrong one.
export function deriveSecurityTier(input: {
  declaredValue?: number | null;
  commodityCategory?: string | null;
}): SecurityTier | null {
  const category = COMMODITY_CATEGORY_VALUES.includes(input.commodityCategory as CommodityCategory)
    ? (input.commodityCategory as CommodityCategory)
    : null;
  const value = typeof input.declaredValue === "number" && input.declaredValue > 0 ? input.declaredValue : null;
  if (!category && value === null) return null;

  const fromValue = value !== null ? valueTier(value) : "standard";
  const fromCategory = category ? CATEGORY_FLOOR[category] : "standard";
  return TIER_RANK[fromValue] >= TIER_RANK[fromCategory] ? fromValue : fromCategory;
}

export const LOAD_SECURITY_CHECK_STATUSES = [
  ["pending", "Pending"],
  ["done", "Done"],
  ["na", "N/A"],
  ["flagged", "Flagged"],
] as const;

export const LOAD_SECURITY_CHECK_STATUS_VALUES = LOAD_SECURITY_CHECK_STATUSES.map(([value]) => value);

export type SecurityChecklistItem = {
  key: string;
  label: string;
  // The lowest tier that requires this item; higher tiers inherit everything below.
  minTier: Exclude<SecurityTier, "standard">;
  hint?: string;
};

// The SOP encodes the anti-deceptive-pickup playbook: verify the carrier and
// driver against bench records before freight moves, keep custody visible,
// and document the chain at pickup and delivery.
export const LOAD_SECURITY_CHECKLIST: SecurityChecklistItem[] = [
  {
    key: "identity_reverified",
    label: "Carrier identity re-verified against the bench record",
    minTier: "elevated",
    hint: "Same MC, same domain, same factoring as the vetted record — mismatches mean stop.",
  },
  {
    key: "verified_phone_dispatch",
    label: "Dispatch confirmed via the verified callback phone",
    minTier: "elevated",
    hint: "Call the number on the carrier's bench record, never the number on the reply.",
  },
  {
    key: "driver_info_advance",
    label: "Driver name + truck/trailer plates collected in advance",
    minTier: "elevated",
    hint: "Shipper confirms the same driver and plates at pickup.",
  },
  {
    key: "tracking_active",
    label: "Tracking live before pickup",
    minTier: "elevated",
    hint: "Per the load's trackingType — no tracking, no dispatch.",
  },
  {
    key: "receiver_confirmed",
    label: "Receiver + delivery window confirmed with the customer",
    minTier: "elevated",
  },
  {
    key: "cdl_photo",
    label: "Driver CDL photographed at pickup",
    minTier: "high_value",
  },
  {
    key: "seal_applied",
    label: "High-security seal applied and number recorded",
    minTier: "high_value",
  },
  {
    key: "no_drop_clause",
    label: "No-rebroker / no-drop-yard acknowledged on the rate con",
    minTier: "high_value",
    hint: "Unattended drop yards and re-brokered loads are the two dominant loss patterns.",
  },
  {
    key: "pod_seal_photo",
    label: "POD includes seal-intact photo",
    minTier: "high_value",
  },
  {
    key: "team_or_escort",
    label: "Team drivers or escort confirmed",
    minTier: "critical",
  },
  {
    key: "covert_tracker",
    label: "Covert GPS device placed on the freight",
    minTier: "critical",
  },
  {
    key: "route_plan",
    label: "Route/stop plan agreed (no stops in the first 200 miles)",
    minTier: "critical",
    hint: "Most strategic thefts happen at the first stop after pickup.",
  },
];

// Items required for a given tier. Standard (or unknown) tiers get no
// checklist — SOP noise on ordinary loads erodes the habit on the ones
// that matter.
export function securityChecklistTemplate(tier: string | null | undefined): SecurityChecklistItem[] {
  const rank = tierRank(tier);
  if (rank < TIER_RANK.elevated) return [];
  return LOAD_SECURITY_CHECKLIST.filter((item) => rank >= TIER_RANK[item.minTier]);
}
