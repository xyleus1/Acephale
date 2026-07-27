// Lead-board rows for the desk assistant: the same Meta-lead cards the
// Incoming RFQs page renders (market, quality tier, outreach sequence state,
// live replies), derived with the exact page rules so the agent sees what the
// operator sees instead of reaching for job tools and answering about a
// different load.
//
// Pure module (no prisma, no server-only imports): stage mapping, filtering,
// and row shaping are unit-testable; lead-board-query.ts wires it to the
// database.

import {
  deriveOutreachState,
  replyExcerpt,
  stampDate,
  OUTREACH_TOTAL_TOUCHES,
  type OutreachStageKey,
  type OutreachState,
} from "./lead-outreach";
import { canonicalInquiryStatus } from "./inquiry-status";
import { metaLeadMarketOf, type MetaLeadMarket } from "./meta-leads";
import { assessLeadQuality, leadQualitySummary, type LeadQuality, type LeadQualityTier } from "./lead-quality";

const DAY_MS = 24 * 60 * 60 * 1000;

// The coarse stage chips on the US lead board, plus "desk" (which the page
// shows only under "All stages"). One chip groups several sequence states.
export type LeadBoardStage = "replied" | "waiting" | "new" | "dropped" | "desk";

export const LEAD_BOARD_STAGES: LeadBoardStage[] = ["replied", "waiting", "new", "dropped", "desk"];

export const LEAD_BOARD_STAGE_LABELS: Record<LeadBoardStage, string> = {
  replied: "Replied - needs desk action",
  waiting: "Emailed - waiting on the lead",
  new: "Not emailed yet",
  dropped: "Dropped / closed",
  desk: "With the desk",
};

// Same grouping as the board's stage chips (stageFilterOf on the page).
export function leadBoardStageOf(key: OutreachStageKey): LeadBoardStage {
  switch (key) {
    case "replied": return "replied";
    case "awaiting":
    case "final_sent":
    case "stopped": return "waiting";
    case "dropped":
    case "closed": return "dropped";
    case "desk": return "desk";
    default: return "new"; // excluded / not_started
  }
}

// The Inquiry columns the board derivation needs; the page reads the same.
export type LeadBoardInquiry = {
  id: string;
  reference: string | null;
  subject: string;
  status: string;
  receivedAt: Date;
  fromEmail: string | null;
  fromCompany: string | null;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  mode: string | null;
  targetPrice: number | null;
  targetCurrency: string | null;
  targetPriceStatus: string | null;
  parsedData: string | null;
};

export type LeadLiveReply = { sentAt: Date; bodyText: string | null };

export type LeadBoardRow = {
  id: string;
  reference: string | null;
  subject: string;
  status: string; // canonical
  receivedAt: Date;
  ageDays: number;
  market: MetaLeadMarket;
  quality: LeadQuality;
  contactName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  mode: string | null;
  target: string;
  stage: LeadBoardStage;
  outreach: OutreachState;
  repliedAt: Date | null;
  replyExcerpt: string | null;
};

function s(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

// Same shape rfq-mail's isSingleEmailAddress enforces before an SMTP send
// (kept local: rfq-mail is server-only and this module must stay importable
// in plain unit tests).
export function leadHasSingleEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[^\s@,;:"<>()[\]]+@[^\s@,;:"<>()[\]]+\.[A-Za-z]{2,}$/.test(value.trim());
}

// One board row from a raw inquiry. Returns null for non-lead inquiries
// (manual/email RFQs) so callers can map-and-filter a mixed result set.
export function deriveLeadBoardRow(
  inq: LeadBoardInquiry,
  now: Date,
  liveReply?: LeadLiveReply | null,
): LeadBoardRow | null {
  const parsed = parsedOf(inq.parsedData);
  if (parsed.source !== "meta-leads") return null;

  const quality = assessLeadQuality(inq);
  const hasValidEmail = leadHasSingleEmail(inq.fromEmail);
  // A live inbound only counts as a reply when it landed after our first
  // outbound touch - older mail from the same address is unrelated history
  // (same rule as the outreach engine and the US lead cards).
  const firstOutAt = stampDate(parsed.infoRequestSentAt) ?? stampDate(parsed.confirmationSentAt);
  const liveRepliedAt = firstOutAt && liveReply && liveReply.sentAt > firstOutAt ? liveReply.sentAt : null;
  const status = canonicalInquiryStatus(inq.status);
  const outreach = deriveOutreachState({
    parsed,
    tier: quality.tier,
    status,
    hasValidEmail,
    now,
    repliedAt: liveRepliedAt,
  });

  const target = inq.targetPrice != null
    ? `${inq.targetCurrency ?? "USD"} ${inq.targetPrice.toLocaleString("en-GB")}`
    : inq.targetPriceStatus === "NO_TARGET" ? "no target" : "ask";

  return {
    id: inq.id,
    reference: inq.reference,
    subject: inq.subject,
    status,
    receivedAt: inq.receivedAt,
    ageDays: Math.max(0, Math.floor((now.getTime() - new Date(inq.receivedAt).getTime()) / DAY_MS)),
    market: metaLeadMarketOf(parsed),
    quality,
    contactName: s(parsed.fullName),
    company: inq.fromCompany,
    email: inq.fromEmail,
    phone: s(parsed.phone),
    origin: inq.origin,
    destination: inq.destination,
    commodity: inq.commodity,
    mode: inq.mode,
    target,
    stage: leadBoardStageOf(outreach.key),
    outreach,
    repliedAt: outreach.repliedAt,
    replyExcerpt: outreach.key === "replied" ? replyExcerpt(liveReply?.bodyText ?? null) : null,
  };
}

export type LeadBoardFilter = {
  market?: MetaLeadMarket;
  stage?: LeadBoardStage;
  quality?: LeadQualityTier;
  arrivedWithinDays?: number;
  repliedWithinDays?: number;
};

export function matchesLeadBoardFilter(row: LeadBoardRow, filter: LeadBoardFilter, now: Date): boolean {
  if (filter.market && row.market !== filter.market) return false;
  if (filter.quality && row.quality.tier !== filter.quality) return false;
  if (filter.stage && row.stage !== filter.stage) return false;
  // Non-finite day windows (a model passing garbage) degrade to "no filter"
  // rather than silently matching nothing.
  if (Number.isFinite(filter.arrivedWithinDays)
    && row.receivedAt.getTime() < now.getTime() - (filter.arrivedWithinDays as number) * DAY_MS) return false;
  if (Number.isFinite(filter.repliedWithinDays)
    && (row.repliedAt == null || row.repliedAt.getTime() < now.getTime() - (filter.repliedWithinDays as number) * DAY_MS)) return false;
  return true;
}

export type LeadBoardCounts = {
  total: number;
  byStage: Record<LeadBoardStage, number>;
  byQuality: Record<LeadQualityTier, number>;
};

export function summarizeLeadBoard(rows: LeadBoardRow[]): LeadBoardCounts {
  const byStage: Record<LeadBoardStage, number> = { replied: 0, waiting: 0, new: 0, dropped: 0, desk: 0 };
  const byQuality: Record<LeadQualityTier, number> = { GOOD: 0, REVIEW: 0, WEAK: 0 };
  for (const row of rows) {
    byStage[row.stage] += 1;
    byQuality[row.quality.tier] += 1;
  }
  return { total: rows.length, byStage, byQuality };
}

function iso(date: Date | null | undefined): string | null {
  return date ? new Date(date).toISOString() : null;
}

function contactLine(row: LeadBoardRow): string {
  const name = row.contactName ?? "?";
  const company = row.company && row.company !== row.contactName ? ` (${row.company})` : "";
  const email = row.email ? ` <${row.email}>` : "";
  const phone = row.phone ? ` ${row.phone}` : "";
  return `${name}${company}${email}${phone}`.trim();
}

// Compact tool-result shape. Keeps the reference and review URL first so the
// agent cites the card the operator actually sees.
export function leadBoardRowForAgent(row: LeadBoardRow) {
  return {
    reference: row.reference,
    inquiry_id: row.id,
    review_url: `/dashboard/rfq/${row.id}`,
    market: row.market,
    status: row.status,
    received_at: iso(row.receivedAt),
    age_days: row.ageDays,
    quality: leadQualitySummary(row.quality),
    contact: contactLine(row),
    route: `${row.origin ?? "?"} -> ${row.destination ?? "?"}`,
    commodity: row.commodity,
    mode: row.mode,
    target_price: row.target,
    stage: row.stage,
    outreach: row.outreach.detail ? `${row.outreach.label} (${row.outreach.detail})` : row.outreach.label,
    touches_sent: `${row.outreach.step}/${OUTREACH_TOTAL_TOUCHES}`,
    next_outreach_due_at: iso(row.outreach.nextDueAt),
    replied_at: iso(row.repliedAt),
    reply_excerpt: row.replyExcerpt,
  };
}

// One line per card for the system-prompt board snapshot.
export function leadBoardPromptLine(row: LeadBoardRow): string {
  const replied = row.repliedAt
    ? ` | replied ${new Date(row.repliedAt).toISOString().slice(0, 10)}`
    : "";
  return `- ${row.reference ?? row.subject} | ${row.quality.tier} | ${row.outreach.label}${row.outreach.detail ? ` (${row.outreach.detail})` : ""}${replied} | ${row.origin ?? "?"} -> ${row.destination ?? "?"} | ${row.commodity ?? "-"} | ${contactLine(row)} | arrived ${row.ageDays === 0 ? "today" : `${row.ageDays}d ago`}`;
}
