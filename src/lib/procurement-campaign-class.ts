export type CampaignClassKey = "narrow-high-value" | "specialist" | "broad-commodity";

export type CampaignPlan = {
  classKey: CampaignClassKey;
  label: string;
  targetGoodCompanies: number;
  contactsPerCompany: number;
  quoteGoal: number;
  reasons: string[];
};

export const CAMPAIGN_CLASS_DEFAULTS: Record<
  CampaignClassKey,
  Omit<CampaignPlan, "reasons" | "classKey" | "label">
> = {
  "narrow-high-value": {
    targetGoodCompanies: 75,
    contactsPerCompany: 4,
    quoteGoal: 5,
  },
  specialist: {
    targetGoodCompanies: 200,
    contactsPerCompany: 2,
    quoteGoal: 8,
  },
  "broad-commodity": {
    targetGoodCompanies: 500,
    contactsPerCompany: 1,
    quoteGoal: 12,
  },
};

export const CAMPAIGN_TARGET_MIN = 20;
export const CAMPAIGN_TARGET_MAX = 1_000;

const CLASS_LABELS: Record<CampaignClassKey, string> = {
  "narrow-high-value": "Narrow, high value",
  specialist: "Specialist",
  "broad-commodity": "Broad commodity",
};

const NARROW_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /iso\s?13485/i, label: "ISO 13485" },
  { pattern: /as9100/i, label: "AS9100" },
  { pattern: /\bitar\b/i, label: "ITAR" },
  { pattern: /\biatf\b/i, label: "IATF" },
  { pattern: /\bnadcap\b/i, label: "NADCAP" },
  { pattern: /\bul\s?listed\b/i, label: "UL listed" },
  { pattern: /\bfda\b/i, label: "FDA" },
  { pattern: /\bce\s?mark\b/i, label: "CE mark" },
  { pattern: /\bmil-?spec\b/i, label: "MIL-SPEC" },
  { pattern: /\bmedical\b/i, label: "Medical" },
  { pattern: /\baerospace\b/i, label: "Aerospace" },
  { pattern: /\bdefen[cs]e\b/i, label: "Defense" },
  { pattern: /\bautomotive grade\b/i, label: "Automotive grade" },
  { pattern: /\bclass\s?[123]\b/i, label: "Class 1, 2, or 3" },
  { pattern: /±\s?0\.0\d/i, label: "Tight tolerance" },
  { pattern: /\+\/-\s?0\.0\d/i, label: "Tight tolerance" },
  { pattern: /\bmicron\b/i, label: "Micron tolerance" },
  { pattern: /\bµm\b/i, label: "Micron tolerance" },
];

const BROAD_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bcarton\b/i, label: "Carton" },
  { pattern: /\bcorrugated\b/i, label: "Corrugated" },
  { pattern: /\bpackaging\b/i, label: "Packaging" },
  { pattern: /\bpoly\s?bag\b/i, label: "Poly bag" },
  { pattern: /\bpallet\b/i, label: "Pallet" },
  { pattern: /\bstandard fastener\b/i, label: "Standard fastener" },
  { pattern: /\bbolt\b/i, label: "Bolt" },
  { pattern: /\bscrew\b/i, label: "Screw" },
  { pattern: /\boff[- ]the[- ]shelf\b/i, label: "Off-the-shelf" },
  { pattern: /\bcatalog(?:ue)? part\b/i, label: "Catalogue part" },
  { pattern: /\bgeneric\b/i, label: "Generic" },
  { pattern: /\bbulk\b/i, label: "Bulk" },
  { pattern: /\bcoffee\b/i, label: "Coffee" },
  { pattern: /\bcafe\b/i, label: "Cafe" },
  { pattern: /\brestaurant\b/i, label: "Restaurant" },
  { pattern: /\bretail\b/i, label: "Retail" },
];

function firstQuantity(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
}

function finiteInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

export function classifyCampaign(input: {
  material: string;
  specification?: string | null;
  notes?: string | null;
  quantity?: string | number | null;
}): CampaignPlan {
  const material = typeof input.material === "string" ? input.material : "";
  const specification = typeof input.specification === "string" ? input.specification : "";
  const notes = typeof input.notes === "string" ? input.notes : "";
  const text = `${material} ${specification} ${notes}`;
  const quantity = firstQuantity(input.quantity);
  const narrowReasons = NARROW_SIGNALS
    .filter((signal) => signal.pattern.test(text))
    .map((signal) => signal.label);
  const broadReasons = BROAD_SIGNALS
    .filter((signal) => signal.pattern.test(text))
    .map((signal) => signal.label);

  let narrowScore = narrowReasons.length;
  let broadScore = broadReasons.length;
  if (specification.length >= 1_500) {
    narrowReasons.push("Specification length");
    narrowScore += 1;
  }
  if (quantity !== null && quantity < 100) {
    narrowReasons.push("Quantity under 100");
    narrowScore += 1;
  }
  if (quantity !== null && quantity >= 10_000) {
    broadReasons.push("Quantity of 10,000 or more");
    broadScore += 1;
  }
  if (!specification.trim() || specification.length < 200) {
    broadReasons.push("Short or missing specification");
    broadScore += 1;
  }

  const classKey: CampaignClassKey = narrowScore >= 2 && narrowScore > broadScore
    ? "narrow-high-value"
    : broadScore >= 2 && broadScore > narrowScore
      ? "broad-commodity"
      : "specialist";
  const defaults = CAMPAIGN_CLASS_DEFAULTS[classKey];
  const reasons = [...narrowReasons, ...broadReasons].slice(0, 6);
  return {
    classKey,
    label: CLASS_LABELS[classKey],
    ...defaults,
    reasons: reasons.length
      ? reasons
      : ["No strong class signals, using the specialist defaults."],
  };
}

export function applyCampaignOverrides(
  plan: CampaignPlan,
  override: { targetGoodCompanies?: number | null; quoteGoal?: number | null },
): CampaignPlan {
  const target = finiteInteger(override.targetGoodCompanies);
  const quoteGoal = finiteInteger(override.quoteGoal);
  return {
    ...plan,
    targetGoodCompanies: target === null
      ? plan.targetGoodCompanies
      : Math.min(CAMPAIGN_TARGET_MAX, Math.max(CAMPAIGN_TARGET_MIN, target)),
    quoteGoal: quoteGoal === null ? plan.quoteGoal : Math.min(50, Math.max(1, quoteGoal)),
    reasons: [...plan.reasons],
  };
}

function isCampaignClassKey(value: unknown): value is CampaignClassKey {
  return value === "narrow-high-value" || value === "specialist" || value === "broad-commodity";
}

export function readCampaignPlan(value: unknown): CampaignPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const classKey = row.classKey;
  const label = row.label;
  const targetGoodCompanies = row.targetGoodCompanies;
  const contactsPerCompany = row.contactsPerCompany;
  const quoteGoal = row.quoteGoal;
  const reasons = row.reasons;
  if (
    !isCampaignClassKey(classKey)
    || typeof label !== "string"
    || label !== CLASS_LABELS[classKey]
    || typeof targetGoodCompanies !== "number"
    || !Number.isInteger(targetGoodCompanies)
    || targetGoodCompanies < CAMPAIGN_TARGET_MIN
    || targetGoodCompanies > CAMPAIGN_TARGET_MAX
    || typeof contactsPerCompany !== "number"
    || !Number.isInteger(contactsPerCompany)
    || contactsPerCompany < 1
    || typeof quoteGoal !== "number"
    || !Number.isInteger(quoteGoal)
    || quoteGoal < 1
    || quoteGoal > 50
    || !Array.isArray(reasons)
    || reasons.length < 1
    || reasons.length > 6
    || reasons.some((reason) => typeof reason !== "string" || !reason.trim())
  ) return null;
  return {
    classKey,
    label,
    targetGoodCompanies,
    contactsPerCompany,
    quoteGoal,
    reasons: [...reasons] as string[],
  };
}
