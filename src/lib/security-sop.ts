import {
  tierRank,
  type SecurityTier,
} from "@/lib/intel";

export {
  COMMODITY_CATEGORIES,
  COMMODITY_CATEGORY_VALUES,
  SECURITY_TIERS,
  SECURITY_TIER_VALUES,
  commodityCategoryLabel,
  deriveSecurityTier,
  securityTierLabel,
  tierRank,
  type CommodityCategory,
  type SecurityTier,
} from "@/lib/intel";

export const TRACKING_TYPES = [
  ["none", "None"],
  ["phone_check", "Phone check calls"],
  ["eld_app", "ELD / tracking app"],
  ["gps_device", "GPS device on freight"],
  ["escort", "Escort / team watch"],
] as const;

export type TrackingType = (typeof TRACKING_TYPES)[number][0];

export const TRACKING_TYPE_VALUES = TRACKING_TYPES.map(([value]) => value);

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
    hint: "Same MC, same domain, same factoring as the vetted record - mismatches mean stop.",
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
    hint: "Per the load's trackingType - no tracking, no dispatch.",
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
// checklist - SOP noise on ordinary loads erodes the habit on the ones
// that matter.
export function securityChecklistTemplate(tier: string | null | undefined): SecurityChecklistItem[] {
  const rank = tierRank(tier);
  if (rank < tierRank("elevated")) return [];
  return LOAD_SECURITY_CHECKLIST.filter((item) => rank >= tierRank(item.minTier));
}
