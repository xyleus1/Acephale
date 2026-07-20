// Deterministic quality triage for Meta ad leads: is this lead worth the
// desk's time? Scores only what the lead form actually gives us (contact,
// lane, commercial intent, load size, timing, budget) — no LLM, so the sheet
// can explain exactly why a lead ranked where it did and the desk can argue
// with the rules instead of a vibe.
//
// Tiers: GOOD  — work it now (real load shape + a way to contact them)
//        REVIEW — plausible but thin; skim before spending time
//        WEAK  — junk or unreachable; only visible under "All"
//
// Desk rule (Mert, 2026-07-18): an explicitly commercial shipment is always
// GOOD — timing/size/budget can't demote it. The contact/lane gates still
// apply: a "commercial" row with no way to reach the lead or no usable lane
// isn't a workable load at all.

export type LeadQualityTier = "GOOD" | "REVIEW" | "WEAK";

export type LeadQuality = {
  tier: LeadQualityTier;
  score: number;
  // Short human phrases ("commercial shipment", "just researching") shown in
  // the sheet tooltip and the expanded row.
  reasons: string[];
};

export type LeadQualityInput = {
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  fromEmail: string | null;
  // The sync stores the form's company answer here (falling back to the
  // person's name when the form had none).
  fromCompany: string | null;
  // Sanity-bounded USD amount the sync parsed from the budget answer.
  targetPrice: number | null;
  parsedData: string | null;
};

const GOOD_MIN = 8;
const REVIEW_MIN = 4;

// Non-answers people type into the origin/destination boxes.
const JUNK_PLACE = new Set([
  "idk", "isk", "n/a", "na", "none", "no", "unknown", "not sure", "unsure",
  "tbd", "?", "-", ".", "..", "...", "x", "xx", "test", "asap", "any", "all",
]);

// "Company" answers that mean there is no company.
const JUNK_COMPANY = new Set([
  "no", "none", "na", "n/a", "-", ".", "self", "self-employed", "self employed",
  "self-employed.", "home", "me", "my home", "personal", "individual", "retired",
  "unemployed", "not yet", "nobe", "yes",
]);

function s(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function norm(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

function parsedOf(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Same shape rfq-mail enforces before an SMTP send (kept local: rfq-mail is
// server-only and this module must stay importable in plain unit tests).
function looksLikeEmail(value: string | null): boolean {
  return Boolean(value && /^[^\s@,;:"<>()[\]]+@[^\s@,;:"<>()[\]]+\.[A-Za-z]{2,}$/.test(value.trim()));
}

function looksLikePhone(value: string | null): boolean {
  return Boolean(value && value.replace(/\D/g, "").length >= 10);
}

function realPlace(value: string | null): boolean {
  if (!value) return false;
  const n = norm(value);
  if (JUNK_PLACE.has(n)) return false;
  if (n.includes("national and international")) return false;
  return true;
}

export function assessLeadQuality(inq: LeadQualityInput): LeadQuality {
  const parsed = parsedOf(inq.parsedData);
  const answers = (parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)
    ? parsed.answers
    : {}) as Record<string, unknown>;

  const reasons: string[] = [];
  let score = 0;

  // ── Gates: without a contact channel or any usable lane the rest is moot ──
  const emailOk = looksLikeEmail(inq.fromEmail);
  const phoneOk = looksLikePhone(s(parsed.phone));
  if (!emailOk && !phoneOk) {
    return { tier: "WEAK", score: 0, reasons: ["no usable email or phone"] };
  }
  const originOk = realPlace(inq.origin);
  const destinationOk = realPlace(inq.destination);
  if (!originOk && !destinationOk) {
    return { tier: "WEAK", score: 0, reasons: ["no usable origin or destination"] };
  }

  if (emailOk && phoneOk) score += 1;
  if (originOk && destinationOk) {
    score += 1;
    reasons.push("full lane");
  }

  // ── Commercial intent ("yes, commercial shipment." / "evet, ticari …") ──
  const commercial = norm(s(answers.commercial) ?? "");
  const commercialYes = commercial.startsWith("yes") || commercial.startsWith("evet");
  if (commercialYes) {
    score += 3;
    reasons.push("commercial shipment");
  } else if (commercial.includes("not sure") || commercial.includes("emin değil")) {
    score += 1;
  }

  // ── Load size (best signal across the two size answers) ──
  const sizeText = norm([s(answers.shipmentType), s(answers.loadInfo)].filter(Boolean).join(" · "));
  let sizeScore = 0;
  let sizeReason: string | null = null;
  if (sizeText.includes("container")) {
    sizeScore = 3;
    sizeReason = "container-sized load";
  } else if (/(?:4|10)\s*[+–-]|4[–-]10|10\+/.test(sizeText) && sizeText.includes("pallet")) {
    sizeScore = 3;
    sizeReason = "multi-pallet load";
  } else if (sizeText.includes("pallet")) {
    sizeScore = 2;
    sizeReason = "palletized load";
  } else if (sizeText.includes("partial")) {
    sizeScore = 2;
    sizeReason = "partial load";
  } else if (sizeText.includes("regular")) {
    sizeScore = 1;
  } else if (sizeText.includes("box") || sizeText.includes("sample") || sizeText.includes("small package")) {
    sizeScore = -1;
    reasons.push("single box / sample");
  }
  score += sizeScore;
  if (sizeReason) reasons.push(sizeReason);

  // ── Timing ──
  const timing = norm(s(answers.timing) ?? "");
  if (timing.includes("0-2") || timing.includes("2-4")) {
    score += 2;
    reasons.push(`ships ${timing.replace("within ", "in ")}`);
  } else if (timing.includes("1-3 month")) {
    score += 1;
  } else if (timing.includes("research")) {
    score -= 2;
    reasons.push("just researching prices");
  }

  // ── Budget (already sanity-bounded by the sheet sync) ──
  if (inq.targetPrice != null && inq.targetPrice >= 2000) {
    score += 2;
    reasons.push(`budget ~USD ${Math.round(inq.targetPrice).toLocaleString("en-US")}`);
  } else if (inq.targetPrice != null && inq.targetPrice >= 400) {
    score += 1;
  }

  // ── Softer signals ──
  // fromCompany falls back to the person's name when the form had no company
  // — that fallback is not a company signal.
  const company = s(inq.fromCompany);
  if (company && company !== s(parsed.fullName) && !JUNK_COMPANY.has(norm(company))) score += 1;
  if (s(inq.commodity)) score += 1;

  // Commercial shipments are always worth working (desk rule) — the score
  // still orders them and feeds the tooltip.
  const tier: LeadQualityTier = commercialYes
    ? "GOOD"
    : score >= GOOD_MIN ? "GOOD" : score >= REVIEW_MIN ? "REVIEW" : "WEAK";
  if (tier === "WEAK" && reasons.length === 0) reasons.push("too little to price");
  return { tier, score, reasons };
}

export const LEAD_QUALITY_LABELS: Record<LeadQualityTier, string> = {
  GOOD: "Good",
  REVIEW: "Review",
  WEAK: "Weak",
};

// "Good (9) — commercial shipment, container-sized load, ships in 0-2 weeks"
export function leadQualitySummary(q: LeadQuality): string {
  const base = `${LEAD_QUALITY_LABELS[q.tier]} (${q.score})`;
  return q.reasons.length > 0 ? `${base} — ${q.reasons.join(", ")}` : base;
}
