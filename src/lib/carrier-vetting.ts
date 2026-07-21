// Shared vocabulary + deterministic gate logic for the vetted carrier bench
// (client + server safe, no runtime deps). The checklist encodes the
// deceptive-pickup / carrier-impersonation defenses: every identity check runs
// against independently sourced records (FMCSA, the insurance producer), never
// against contact details the carrier itself supplied.

export const CARRIER_VETTING_STATUSES = [
  ["prospect", "Prospect"],
  ["docs_requested", "Docs requested"],
  ["in_review", "In review"],
  ["approved", "Approved"],
  ["conditional", "Conditional"],
  ["rejected", "Rejected"],
  ["suspended", "Suspended"],
] as const;

export const CARRIER_CHECKLIST_STATUSES = [
  ["pending", "Pending"],
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["waived", "Waived"],
] as const;

export const CARRIER_AUTHORITY_STATUSES = [
  ["active", "Active"],
  ["inactive", "Inactive"],
  ["revoked", "Revoked"],
  ["unknown", "Unknown"],
] as const;

// Mirrors DomesticEquipmentType in src/lib/domestic-trucking-pricing.ts -
// kept as a local list so client components don't import the pricing engine.
export const CARRIER_EQUIPMENT_TYPES = [
  ["DRY_VAN", "Dry van"],
  ["REEFER", "Reefer"],
  ["FLATBED", "Flatbed"],
  ["STEP_DECK", "Step deck"],
  ["BOX_TRUCK", "Box truck"],
  ["CONTAINER_DRAYAGE", "Container drayage"],
] as const;

export const CARRIER_SECURITY_FEATURES = [
  ["high_security_locks", "High-security locks"],
  ["covert_gps", "Covert GPS"],
  ["geofencing", "Geofencing"],
  ["dashcam", "Dashcam"],
  ["team_only", "Team-only dispatch"],
  ["tsa_known_shipper", "TSA known shipper"],
] as const;

export type CarrierVettingStatus = (typeof CARRIER_VETTING_STATUSES)[number][0];
export type CarrierChecklistStatus = (typeof CARRIER_CHECKLIST_STATUSES)[number][0];

export const CARRIER_VETTING_STATUS_VALUES = CARRIER_VETTING_STATUSES.map(([value]) => value);
export const CARRIER_CHECKLIST_STATUS_VALUES = CARRIER_CHECKLIST_STATUSES.map(([value]) => value);
export const CARRIER_AUTHORITY_STATUS_VALUES = CARRIER_AUTHORITY_STATUSES.map(([value]) => value);

export function vettingStatusLabel(value: string | null): string {
  return CARRIER_VETTING_STATUSES.find(([v]) => v === value)?.[1] ?? (value ?? "");
}

export type CarrierCapabilityFlags = {
  lithiumCapable?: boolean;
  hazmatCertified?: boolean;
};

export type ChecklistTemplateItem = {
  key: string;
  label: string;
  // Required items must be passed (or waived with a note) before approval.
  required: boolean;
  // Conditional items only apply when the carrier claims the capability.
  appliesWhen?: keyof CarrierCapabilityFlags;
  // Why the item exists - shown as the row hint in the vetting UI.
  hint?: string;
};

export const CARRIER_VETTING_CHECKLIST: ChecklistTemplateItem[] = [
  {
    key: "authority_verified",
    label: "FMCSA authority active (checked on SAFER)",
    required: true,
    hint: "Look up the MC/DOT on safer.fmcsa.dot.gov yourself - active, not revoked, names match.",
  },
  {
    key: "authority_age",
    label: "Authority active for 6+ months",
    required: false,
    hint: "Young authority is the top deceptive-pickup signal. Under 6 months = extra scrutiny, not auto-reject.",
  },
  {
    key: "coi_direct",
    label: "COI received direct from the insurance producer",
    required: true,
    hint: "Call the producer listed on the certificate. Never accept a COI attachment from the carrier's own email.",
  },
  {
    key: "cargo_limit",
    label: "Cargo insurance limit meets the load threshold",
    required: true,
    hint: "Baseline $100k; high-value tech loads need the carrier's highValueApprovedLimit set explicitly.",
  },
  {
    key: "phone_verified",
    label: "Callback phone matches the FMCSA record",
    required: true,
    hint: "Call the number FMCSA lists, not the number that called you. Record it as verifiedPhone.",
  },
  {
    key: "email_domain",
    label: "Dispatch email domain matches FMCSA/website",
    required: true,
    hint: "Freemail or lookalike domains are how loads get stolen. Record the expected domain on the carrier.",
  },
  {
    key: "factoring_confirmed",
    label: "Factoring company confirmed",
    required: false,
    hint: "A factoring mismatch mid-relationship is a hijacked-identity signal.",
  },
  { key: "w9", label: "W-9 on file", required: true },
  {
    key: "agreement_signed",
    label: "Carrier agreement signed (no-rebroker + no-drop-yard)",
    required: true,
    hint: "Double-brokering and unattended drop yards are the two loss patterns the agreement must exclude.",
  },
  { key: "references", label: "Two broker/shipper references checked", required: false },
  {
    key: "lithium_certs",
    label: "Lithium battery (UN3480/3481) handling docs on file",
    required: true,
    appliesWhen: "lithiumCapable",
  },
  {
    key: "hazmat_certs",
    label: "Hazmat certification on file",
    required: true,
    appliesWhen: "hazmatCertified",
  },
];

export function checklistTemplateForCarrier(flags: CarrierCapabilityFlags): ChecklistTemplateItem[] {
  return CARRIER_VETTING_CHECKLIST.filter((item) => !item.appliesWhen || Boolean(flags[item.appliesWhen]));
}

export type ChecklistItemState = {
  key: string;
  status: string;
};

export type VettingGateResult = {
  canApprove: boolean;
  // Required items that are not passed/waived yet (includes items with no row).
  missing: string[];
  // Items recorded as failed - any failed item blocks approval, required or not.
  failed: string[];
};

// Deterministic approval gate: vettingStatus may only move to "approved" when
// this returns canApprove. Pure domain logic - no LLM, no DB.
export function carrierVettingGate(
  carrier: CarrierCapabilityFlags,
  items: ChecklistItemState[],
): VettingGateResult {
  const byKey = new Map(items.map((item) => [item.key, item.status]));
  const template = checklistTemplateForCarrier(carrier);
  const missing: string[] = [];
  const failed: string[] = [];

  for (const item of template) {
    const status = byKey.get(item.key);
    if (status === "failed") {
      failed.push(item.key);
      continue;
    }
    if (!item.required) continue;
    if (status !== "passed" && status !== "waived") missing.push(item.key);
  }

  return { canApprove: missing.length === 0 && failed.length === 0, missing, failed };
}

export type InsuranceExpiryState = "unknown" | "expired" | "expiring_soon" | "ok";

export const INSURANCE_EXPIRY_SOON_DAYS = 30;

// `now` is injected so the sheet and tests stay deterministic.
export function insuranceExpiryState(expiry: Date | string | null | undefined, now: Date): InsuranceExpiryState {
  if (!expiry) return "unknown";
  const at = typeof expiry === "string" ? new Date(expiry) : expiry;
  if (Number.isNaN(at.getTime())) return "unknown";
  const msLeft = at.getTime() - now.getTime();
  if (msLeft < 0) return "expired";
  if (msLeft < INSURANCE_EXPIRY_SOON_DAYS * 86_400_000) return "expiring_soon";
  return "ok";
}
