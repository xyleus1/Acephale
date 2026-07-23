import "server-only";
import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { deriveInquirySource } from "./inquiry-source";
import { openInquiryStatusFilter } from "./inquiry-status";
import { buildLeadCustomerEmailContent, buildLeadScopeFollowUpContent } from "./lead-emails";
import { assessLeadQuality } from "./lead-quality";
import { buildLeadFollowUpContent, leadQualifierQuestions } from "./lead-outreach";
import { stripEmDashes } from "./no-em-dash";

// Outbound RFQ mail from the rfq@usederya.com desk address. This account is
// not OAuth-connected (no refresh token), so delivery goes over Gmail SMTP
// with an app password. Nothing sends automatically - every send sits behind
// an explicit operator button with a preview.

const DEFAULT_MAIL_USER = "rfq@usederya.com";
const DEFAULT_FORWARD_TO = "oguzhan@usederya.com";
const DEFAULT_FORWARD_CC = "gozde.sen@andelog.com,nazli.bagcicek@andelog.com";
const DEFAULT_REPLY_TO = "oguzhan@usederya.com";
const DEFAULT_LEAD_CC = "mert@usederya.com";

// Customer-facing lead copy (confirmation / missing-info request, per the
// lead's ad market language) lives in src/lib/lead-emails.ts so it stays
// unit-testable; this module wraps it with the SMTP desk config.

export function rfqMailConfig() {
  return {
    user: process.env.RFQ_MAIL_USER ?? DEFAULT_MAIL_USER,
    appPassword: (process.env.RFQ_MAIL_APP_PASSWORD ?? "").replace(/\s+/g, ""),
    forwardTo: process.env.RFQ_FORWARD_TO ?? DEFAULT_FORWARD_TO,
    forwardCc: (process.env.RFQ_FORWARD_CC ?? DEFAULT_FORWARD_CC)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    replyTo: process.env.RFQ_MAIL_REPLY_TO ?? DEFAULT_REPLY_TO,
    // Every customer-facing lead email (auto or one-click) cc's Mert so the
    // outbound side of the funnel is visible without opening the CRM.
    leadCc: (process.env.RFQ_LEAD_CC ?? DEFAULT_LEAD_CC)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function rfqMailConfigured(): boolean {
  return rfqMailConfig().appPassword.length >= 8;
}

// One strict RFC-ish address. Nodemailer splits comma-separated strings into
// multiple SMTP recipients, so lead-supplied fromEmail must never smuggle a
// list through the confirmation send.
export function isSingleEmailAddress(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^[^\s@,;:"<>()[\]]+@[^\s@,;:"<>()[\]]+\.[A-Za-z]{2,}$/.test(value.trim());
}

type InquiryForMail = {
  id: string;
  subject: string;
  status: string;
  fromEmail: string | null;
  fromCompany: string | null;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  commodity: string | null;
  incoterms: string | null;
  containerCount: number | null;
  containerType: string | null;
  packages: number | null;
  weight: number | null;
  volume: number | null;
  dimensions: string | null;
  stackable: string | null;
  dangerousGoods: string | null;
  customsBy: string | null;
  cargoReadyDate: Date | null;
  targetPrice: number | null;
  targetCurrency: string | null;
  targetPriceStatus: string | null;
  rawEmailBody: string | null;
  parsedData: string | null;
  notes: string | null;
  receivedAt: Date;
  company?: { name: string } | null;
  emailThreads?: Array<{ messages: Array<{ account: { email: string; provider: string } | null }> }>;
};

function parsedOf(inq: { parsedData: string | null }): Record<string, unknown> {
  if (!inq.parsedData) return {};
  try {
    const value = JSON.parse(inq.parsedData);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function s(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function line(label: string, value: string | null | undefined): string | null {
  return value ? `${label}: ${value}` : null;
}

export function buildDeskForwardEmail(inq: InquiryForMail) {
  const config = rfqMailConfig();
  const parsed = parsedOf(inq);
  const isLead = parsed.source === "meta-leads";
  const answers = (parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)
    ? parsed.answers
    : {}) as Record<string, unknown>;
  const source = deriveInquirySource(inq);

  const lane = [inq.origin, inq.destination].filter(Boolean).join(" → ");
  const subject = `[Derya RFQ] ${inq.commodity ?? inq.subject}${lane ? ` - ${lane}` : ""}`.slice(0, 180);

  const target = inq.targetPrice != null
    ? `${inq.targetCurrency ?? "USD"} ${inq.targetPrice.toLocaleString("en-GB")}`
    : null;

  const sections: string[] = [];

  sections.push(
    [
      line("Source", source.label + (source.detail ? ` (${source.detail})` : "")),
      line("Received", inq.receivedAt.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })),
      line("Status", inq.status),
    ].filter(Boolean).join("\n"),
  );

  sections.push(
    ["- Contact -",
      line("Name", s(parsed.fullName)),
      line("Job title", s(parsed.jobTitle)),
      line("Company", inq.fromCompany ?? inq.company?.name ?? null),
      line("Email", inq.fromEmail),
      line("Phone", s(parsed.phone)),
    ].filter(Boolean).join("\n"),
  );

  sections.push(
    ["- Load -",
      line("Lane", lane || null),
      line("Mode", inq.mode),
      line("Commodity", inq.commodity),
      line("Equipment", inq.containerType ? `${inq.containerCount ?? 1} × ${inq.containerType}` : null),
      line("Packages", inq.packages != null ? String(inq.packages) : null),
      line("Weight", inq.weight != null ? `${inq.weight.toLocaleString("en-GB")} kg` : null),
      line("Volume", inq.volume != null ? `${inq.volume.toLocaleString("en-GB")} cbm` : null),
      line("Incoterms", inq.incoterms),
      line("Cargo ready", inq.cargoReadyDate ? inq.cargoReadyDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null),
      line("Target price", target),
    ].filter(Boolean).join("\n"),
  );

  if (isLead) {
    sections.push(
      ["- Lead form answers -",
        line("Commercial shipment", s(answers.commercial)),
        line("Shipment type", s(answers.shipmentType)),
        line("Load info", s(answers.loadInfo)),
        line("Timing", s(answers.timing)),
        line("Transport preference", s(answers.transportPref)),
        line("Existing quote", s(answers.existingQuote)),
        line("Budget (as written)", s(parsed.budget)),
      ].filter(Boolean).join("\n"),
    );
  } else if (inq.notes ?? inq.rawEmailBody) {
    const raw = (inq.notes ?? inq.rawEmailBody ?? "").trim();
    sections.push(`- Notes -\n${raw.slice(0, 1500)}${raw.length > 1500 ? "…" : ""}`);
  }

  sections.push(`Open in Derya: https://www.derya.ai/dashboard/rfq/${inq.id}`);

  return {
    from: config.user,
    to: config.forwardTo,
    cc: config.forwardCc,
    replyTo: null as string | null,
    subject,
    text: sections.join("\n\n"),
  };
}

// Review-tier leads get the qualifier questions ("is this commercial?" /
// company name) prepended to whatever else the email asks - one place, so
// the sheet preview, the manual button and the auto-sequence all send the
// same email. Non-lead rows and other tiers get no extras.
function qualifierQuestionsFor(inq: InquiryForMail): string[] {
  if (parsedOf(inq).source !== "meta-leads") return [];
  return leadQualifierQuestions(inq, assessLeadQuality(inq).tier);
}

// The one customer email a lead row sends: a confirmation when the form gave
// the desk everything, a missing-info request (listing the exact questions,
// same set as the WhatsApp draft) when it didn't.
export function buildLeadCustomerEmail(inq: InquiryForMail) {
  const config = rfqMailConfig();
  const content = buildLeadCustomerEmailContent(inq, qualifierQuestionsFor(inq));
  return {
    kind: content.kind,
    missing: content.missing,
    from: config.user,
    to: inq.fromEmail,
    cc: config.leadCc,
    replyTo: config.replyTo,
    subject: content.subject,
    text: content.text,
  };
}

// Follow-up 2/3/4 of the outreach sequence, threaded onto the first email
// via the remembered Message-ID (leadLastMsgId).
export function buildLeadFollowUpEmail(inq: InquiryForMail, step: 2 | 3 | 4) {
  const config = rfqMailConfig();
  const tier = parsedOf(inq).source === "meta-leads" ? assessLeadQuality(inq).tier : null;
  const content = buildLeadFollowUpContent(inq, tier, step);
  const lastMsgId = s(parsedOf(inq).leadLastMsgId);
  return {
    step,
    from: config.user,
    to: inq.fromEmail,
    cc: config.leadCc,
    replyTo: config.replyTo,
    subject: content.subject,
    text: content.text,
    inReplyTo: lastMsgId,
  };
}

// Scope/customs follow-up for leads emailed before those questions existed.
export function buildLeadScopeFollowUpEmail(inq: InquiryForMail) {
  const config = rfqMailConfig();
  const content = buildLeadScopeFollowUpContent(inq);
  return {
    from: config.user,
    to: inq.fromEmail,
    cc: config.leadCc,
    replyTo: config.replyTo,
    subject: content.subject,
    text: content.text,
  };
}

export async function sendRfqMail(args: {
  officeId: string;
  inquiryId: string;
  to: string;
  cc: string[];
  replyTo: string | null;
  subject: string;
  text: string;
  // Threads the send onto an earlier outbound (outreach follow-ups) so the
  // lead sees one conversation, not four separate emails.
  inReplyTo?: string | null;
  // Remember this send's Message-ID on the inquiry (leadLastMsgId) so the
  // next follow-up can thread onto it. Lead-facing sends only.
  rememberLeadMessageId?: boolean;
}): Promise<{ ok: true; messageId: string | null } | { error: string }> {
  const config = rfqMailConfig();
  if (!rfqMailConfigured()) {
    return { error: "RFQ mail is not configured (set RFQ_MAIL_APP_PASSWORD)." };
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
  });

  let messageId: string | null = null;
  try {
    const info = await transporter.sendMail({
      from: config.user,
      to: args.to,
      cc: args.cc.length > 0 ? args.cc : undefined,
      replyTo: args.replyTo ?? undefined,
      subject: stripEmDashes(args.subject),
      text: stripEmDashes(args.text),
      inReplyTo: args.inReplyTo ?? undefined,
      references: args.inReplyTo ? [args.inReplyTo] : undefined,
    });
    messageId = typeof info.messageId === "string" ? info.messageId : null;
  } catch (e) {
    return { error: `Send failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (args.rememberLeadMessageId && messageId) {
    await mergeInquiryParsedData(args.officeId, args.inquiryId, { leadLastMsgId: messageId }).catch(() => null);
  }

  // Log the send into the inbox so the thread history is visible in-app.
  // The rfq@ account row exists even though it is not OAuth-connected.
  try {
    const account = await prisma.emailAccount.findFirst({
      where: { officeId: args.officeId, email: config.user },
      select: { id: true },
    });
    const now = new Date();
    const thread = await prisma.emailThread.create({
      data: {
        officeId: args.officeId,
        inquiryId: args.inquiryId,
        subject: args.subject,
        participants: JSON.stringify([config.user, args.to, ...args.cc]),
        lastMessageAt: now,
        messageCount: 1,
      },
    });
    await prisma.emailMessage.create({
      data: {
        threadId: thread.id,
        accountId: account?.id ?? null,
        direction: "OUTBOUND",
        fromEmail: config.user,
        toEmails: JSON.stringify([args.to]),
        ccEmails: args.cc.length > 0 ? JSON.stringify(args.cc) : null,
        subject: args.subject,
        bodyText: args.text,
        sentAt: now,
      },
    });
  } catch {
    // Logging must never turn a delivered email into a reported failure.
  }

  return { ok: true, messageId };
}

// followUp*/leadReplied/leadDropped/sequenceStopped drive the outreach
// sequence (src/lib/lead-outreach.ts); the rest are one-shot send markers.
export type SendStampKey =
  | "deskForwardedAt" | "confirmationSentAt" | "infoRequestSentAt" | "whatsappSentAt"
  | "autoRepliedAt" | "scopeAskedAt"
  | "followUp2SentAt" | "followUp3SentAt" | "followUp4SentAt"
  | "leadRepliedAt" | "leadDroppedAt" | "sequenceStoppedAt";

// Every parsedData key the app writes onto a lead after the sheet sync
// created it. The Meta-leads resync rewrites parsedData from the sheet row -
// anything not in this list is lost on the next hourly sync.
export const RESYNC_PRESERVED_PARSED_KEYS = [
  "deskForwardedAt", "confirmationSentAt", "infoRequestSentAt", "whatsappSentAt",
  "autoRepliedAt", "scopeAskedAt",
  "followUp2SentAt", "followUp3SentAt", "followUp4SentAt",
  "leadRepliedAt", "leadDroppedAt", "sequenceStoppedAt",
  "leadLastMsgId",
] as const;

// Legacy rows can hold non-JSON (or JSON-array) parsedData. Stamping those
// would replace the stored parser output with just the stamp, so we refuse
// to write rather than destroy data - the send still happened, it just won't
// show as sent after reload.
function parseForStamp(raw: string | null): Record<string, unknown> | "legacy" {
  if (!raw || !raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : "legacy";
  } catch {
    return "legacy";
  }
}

// Stamp a send timestamp into parsedData so the list shows sent state.
// Compare-and-swap on the exact previous value: concurrent stamps of the
// same key resolve to "already" instead of double-writing.
// The Meta-leads resync preserves these keys when it rewrites parsedData.
export async function claimInquirySendStamp(
  inquiryId: string,
  key: SendStampKey,
): Promise<"claimed" | "already" | "legacy" | "conflict"> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const inq = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: { parsedData: true },
    });
    if (!inq) return "conflict";
    const parsed = parseForStamp(inq.parsedData);
    if (parsed === "legacy") return "legacy";
    if (parsed[key]) return "already";
    const next = JSON.stringify({ ...parsed, [key]: new Date().toISOString() });
    const res = await prisma.inquiry.updateMany({
      where: { id: inquiryId, parsedData: inq.parsedData },
      data: { parsedData: next },
    });
    if (res.count === 1) return "claimed";
  }
  return "conflict";
}

// CAS-merge arbitrary keys into parsedData (non-claim writes like the
// remembered outbound Message-ID, which overwrites on every send). Refuses
// legacy non-object parsedData, same as the stamps.
export async function mergeInquiryParsedData(
  officeId: string,
  inquiryId: string,
  patch: Record<string, unknown>,
): Promise<"merged" | "legacy" | "conflict"> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const inq = await prisma.inquiry.findFirst({
      where: { id: inquiryId, officeId },
      select: { parsedData: true },
    });
    if (!inq) return "conflict";
    const parsed = parseForStamp(inq.parsedData);
    if (parsed === "legacy") return "legacy";
    const res = await prisma.inquiry.updateMany({
      where: { id: inquiryId, officeId, parsedData: inq.parsedData },
      data: { parsedData: JSON.stringify({ ...parsed, ...patch }) },
    });
    if (res.count === 1) return "merged";
  }
  return "conflict";
}

// Best-effort rollback when a claimed send fails, so the row stays retriable.
export async function clearInquirySendStamp(inquiryId: string, key: SendStampKey): Promise<void> {
  try {
    const inq = await prisma.inquiry.findUnique({
      where: { id: inquiryId },
      select: { parsedData: true },
    });
    if (!inq) return;
    const parsed = parseForStamp(inq.parsedData);
    if (parsed === "legacy" || !parsed[key]) return;
    const { [key]: _removed, ...rest } = parsed;
    await prisma.inquiry.updateMany({
      where: { id: inquiryId, parsedData: inq.parsedData },
      data: { parsedData: JSON.stringify(rest) },
    });
  } catch {
    // Rollback is advisory; a stale stamp only hides the retry button.
  }
}

// The office-wide set Send-all operates on. The page count and the action
// MUST share this exact predicate, or the confirm dialog lies about what
// is about to be emailed.
export function pendingDeskForwardWhere(officeId: string) {
  return {
    officeId,
    parsedData: { contains: '"source":"meta-leads"' },
    // Booked/missed/ignored leads must not be desk-forwarded by Send-all.
    status: openInquiryStatusFilter(),
  };
}

export function isUnforwarded(row: { parsedData: string | null }): boolean {
  const parsed = parseForStamp(row.parsedData);
  return parsed !== "legacy" && !parsed.deskForwardedAt;
}

export async function countPendingDeskForwards(officeId: string): Promise<number> {
  const rows = await prisma.inquiry.findMany({
    where: pendingDeskForwardWhere(officeId),
    select: { parsedData: true },
    take: 500,
  });
  return rows.filter(isUnforwarded).length;
}
