// Shared vocabulary for RFQ (Inquiry) statuses — client + server safe, no runtime deps.
//
// Canonical set (mert's control-sheet lingo): BOOKED / PRICING / MISSED / RECEIVED / IGNORED.
// Inquiry.status is a free string, so offices can also add custom statuses on the fly
// from the RFQ sheet; those simply live as their raw value. Legacy pipeline values
// (INGESTED/PARSED/PRICED/QUOTED/WON/LOST) are still written by older flows and old
// rows — they alias onto the canonical set for display and filtering, so nothing
// needs a data backfill.

export const INQUIRY_STATUSES = [
  ["BOOKED", "Booked"],
  ["PRICING", "Pricing"],
  ["MISSED", "Missed ($)"],
  ["RECEIVED", "Received"],
  ["IGNORED", "Ignored"],
] as const;

export const INQUIRY_STATUS_VALUES = INQUIRY_STATUSES.map(([value]) => value) as string[];

// Legacy stored values → canonical value.
const LEGACY_TO_CANONICAL: Record<string, string> = {
  INGESTED: "RECEIVED",
  PARSED: "RECEIVED",
  PRICED: "PRICING",
  QUOTED: "PRICING",
  WON: "BOOKED",
  LOST: "MISSED",
};

export function canonicalInquiryStatus(raw: string): string {
  return LEGACY_TO_CANONICAL[raw] ?? raw;
}

// Stored values that fall under one canonical status (for tab/status filtering).
export function inquiryStatusValuesFor(canonical: string): string[] {
  return [
    canonical,
    ...Object.keys(LEGACY_TO_CANONICAL).filter((legacy) => LEGACY_TO_CANONICAL[legacy] === canonical),
  ];
}

// A closed RFQ has an outcome (booked/missed) or was deliberately archived (ignored).
// Everything else — canonical, legacy or custom — counts as open.
export const CLOSED_INQUIRY_STATUSES = [
  "BOOKED",
  "MISSED",
  "IGNORED",
  "WON",
  "LOST",
];

// Prisma `where.status` fragment for open RFQs; matches the default "Open" tab
// on /dashboard/rfq. Custom statuses are treated as open.
export function openInquiryStatusFilter(): { notIn: string[] } {
  return { notIn: CLOSED_INQUIRY_STATUSES };
}

export function inquiryStatusLabel(raw: string): string {
  const canonical = canonicalInquiryStatus(raw);
  return INQUIRY_STATUSES.find(([value]) => value === canonical)?.[1] ?? raw;
}

const STATUS_BADGE_CLS: Record<string, string> = {
  BOOKED: "badge-good",
  PRICING: "badge-warn",
  MISSED: "badge-danger",
  RECEIVED: "badge-info",
  IGNORED: "badge-neutral",
};

export function inquiryStatusBadgeCls(raw: string): string {
  return STATUS_BADGE_CLS[canonicalInquiryStatus(raw)] ?? "badge-neutral";
}

// Normalize an operator-entered status: known values (canonical, legacy, or a
// canonical label like "missed ($)") collapse onto the canonical value; anything
// else is kept as a custom status, trimmed.
export function normalizeInquiryStatusInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (LEGACY_TO_CANONICAL[upper]) return LEGACY_TO_CANONICAL[upper];
  if (INQUIRY_STATUS_VALUES.includes(upper)) return upper;
  const byLabel = INQUIRY_STATUSES.find(([, label]) => label.toUpperCase() === upper);
  if (byLabel) return byLabel[0];
  return trimmed;
}

// Default transport modes offered on the RFQ sheet; offices can add custom ones
// on the fly (Inquiry.mode is a free string too).
export const INQUIRY_MODES = [
  ["AIR", "AIR"],
  ["SEA-FCL", "SEA-FCL"],
  ["SEA-LCL", "SEA-LCL"],
  ["ROAD", "ROAD"],
  ["COURIER", "COURIER"],
] as const;

export const INQUIRY_MODE_VALUES = INQUIRY_MODES.map(([value]) => value) as string[];
