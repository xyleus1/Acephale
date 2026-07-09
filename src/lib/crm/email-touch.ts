// Inbox → CRM touch: resolve every inbound/outbound email to a CRM company
// (and contact when possible), log it as an EMAIL Activity on the company
// timeline, and bump Company/Contact lastTouchAt so the "stale relationships"
// panel reflects reality.
//
// NOTE: intentionally no "server-only" import — this module is also consumed
// by tsx scripts (scripts/backfill-crm-email-touch.ts), mirroring how
// gmail-sync.ts style libs stay importable outside the Next.js server graph.
// Never call it from client components.

import { prisma } from "@/lib/prisma";
import { waPhoneDigits } from "@/lib/rfq-whatsapp";
import { whatsAppPartyLabel } from "@/lib/whatsapp-display";

// Personal/free mailbox providers — a shared domain never identifies a
// company, so domain-based resolution must skip these.
export const FREEMAIL_DOMAINS = new Set<string>([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "outlook.com.tr",
  "hotmail.com",
  "hotmail.co.uk",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.uk",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "yandex.com",
  "yandex.ru",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "aol.com",
  "mail.com",
  "mail.ru",
  "qq.com",
  "163.com",
  "126.com",
]);

const EMAIL_PATTERN = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// How many messages a relink/backfill pass will walk per thread.
const RELINK_MESSAGE_LIMIT = 50;

const ACTIVITY_BODY_MAX = 280;

export type EmailTouchDirection = "INBOUND" | "OUTBOUND";

export type CounterpartyResolution = {
  companyId: string;
  contactId: string | null;
  method: "contact_email" | "contact_phone" | "inquiry_link" | "job_link" | "company_domain";
};

export type LogEmailTouchInput = {
  officeId: string;
  threadId: string;
  messageId: string;
  direction: EmailTouchDirection;
  fromEmail: string;
  toEmails: string[]; // raw header entries are fine; addresses are extracted
  subject?: string | null;
  snippet?: string | null;
  sentAt: Date;
};

export type EmailTouchResult =
  | { status: "created"; companyId: string; contactId: string | null }
  | { status: "duplicate" }
  | { status: "unresolved" }
  | { status: "skipped" }
  | { status: "error" };

// ── Pure helpers (unit-tested without a DB) ─────────────────────────────────

// Pull bare, lowercased email addresses out of a raw header value like
// `"Doe, Jane" <jane@acme.com>, ops@acme.com`. Deduplicates, keeps order.
export function extractEmailAddresses(raw: string): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const match of raw.match(EMAIL_PATTERN) ?? []) {
    const email = match.toLowerCase();
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

export function extractDomain(email: string): string | null {
  const normalized = extractEmailAddresses(email)[0];
  if (!normalized) return null;
  const at = normalized.lastIndexOf("@");
  if (at < 0 || at === normalized.length - 1) return null;
  return normalized.slice(at + 1);
}

export function isFreemailDomain(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.trim().toLowerCase());
}

// "whatsapp:905321112233" (any formatting noise stripped) or null.
export function normalizeWhatsAppCounterparty(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase() ?? "";
  if (!trimmed.startsWith("whatsapp:")) return null;
  const digits = trimmed.slice("whatsapp:".length).replace(/\D/g, "");
  return digits.length >= 8 ? `whatsapp:${digits}` : null;
}

// Does a free-text CRM phone ("0532 111 22 33", "+90 532…") denote the same
// number as WhatsApp counterparty digits? Exact match after normalization; a
// suffix fallback exists ONLY for bare national formats (10 digits, or 11
// with a leading 0) whose country code the operator omitted. Full-length
// international numbers must match exactly — a loose last-10 suffix on those
// could attribute a sender to a different country's contact.
export function phoneMatchesWaDigits(contactPhone: string | null | undefined, waDigits: string): boolean {
  if (!contactPhone || waDigits.length < 10) return false;
  const normalized = waPhoneDigits(contactPhone);
  if (normalized && normalized === waDigits) return true;
  const rawDigits = contactPhone.replace(/\D/g, "");
  const national = rawDigits.length === 11 && rawDigits.startsWith("0") ? rawDigits.slice(1) : rawDigits;
  return national.length === 10 && waDigits.endsWith(national);
}

// The addresses on the other side of a message. INBOUND → the sender;
// OUTBOUND → the recipients. Our own inbox/channel addresses are excluded in
// both directions so self/internal mail never counts as a relationship touch.
// WhatsApp counterparties come through as "whatsapp:<digits>" entries.
export function selectCounterpartyEmails(input: {
  direction: EmailTouchDirection;
  fromEmail: string;
  toEmails: string[];
  officeEmails: Iterable<string>;
}): string[] {
  const own = new Set<string>();
  for (const email of input.officeEmails) own.add(email.toLowerCase());

  const rawEntries = input.direction === "INBOUND" ? [input.fromEmail] : input.toEmails;
  const out: string[] = [];
  for (const entry of rawEntries) {
    const wa = normalizeWhatsAppCounterparty(entry);
    if (wa) {
      if (!own.has(wa) && !out.includes(wa)) out.push(wa);
      continue;
    }
    for (const email of extractEmailAddresses(entry ?? "")) {
      if (own.has(email)) continue;
      if (!out.includes(email)) out.push(email);
    }
  }
  return out;
}

// EmailMessage.toEmails is stored as a JSON string array.
export function parseStoredEmailList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [raw];
  }
}

// ── Resolution ───────────────────────────────────────────────────────────────

// Resolve who a set of counterparty addresses belongs to inside one office.
// Order: exact contact email → contact phone (WhatsApp) → inquiry's company →
// job's company → company domain (non-freemail only). Null when nothing matches.
export async function resolveEmailCounterparty(
  officeId: string,
  opts: { counterpartyEmails: string[]; inquiryId?: string | null; jobId?: string | null },
): Promise<CounterpartyResolution | null> {
  for (const email of opts.counterpartyEmails) {
    if (email.startsWith("whatsapp:")) continue;
    const contact = await prisma.contact.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, company: { officeId } },
      select: { id: true, companyId: true },
    });
    if (contact) return { companyId: contact.companyId, contactId: contact.id, method: "contact_email" };
  }

  // WhatsApp senders resolve by phone. Contact.phone is free text in every
  // format operators type, so match in JS over the office's contacts.
  const waDigits = opts.counterpartyEmails
    .filter((e) => e.startsWith("whatsapp:"))
    .map((e) => e.slice("whatsapp:".length))
    .filter((d) => d.length >= 10);
  if (waDigits.length > 0) {
    const contacts = await prisma.contact.findMany({
      where: { phone: { not: null }, company: { officeId } },
      select: { id: true, companyId: true, phone: true },
      orderBy: { createdAt: "asc" },
      take: 2000,
    });
    for (const digits of waDigits) {
      const match = contacts.find((c) => phoneMatchesWaDigits(c.phone, digits));
      if (match) return { companyId: match.companyId, contactId: match.id, method: "contact_phone" };
    }
  }

  if (opts.inquiryId) {
    const inquiry = await prisma.inquiry.findFirst({
      where: { id: opts.inquiryId, officeId },
      select: { companyId: true },
    });
    if (inquiry?.companyId) return { companyId: inquiry.companyId, contactId: null, method: "inquiry_link" };
  }

  if (opts.jobId) {
    const job = await prisma.job.findFirst({
      where: { id: opts.jobId, officeId },
      select: { companyId: true },
    });
    if (job?.companyId) return { companyId: job.companyId, contactId: null, method: "job_link" };
  }

  for (const email of opts.counterpartyEmails) {
    const domain = extractDomain(email);
    if (!domain || isFreemailDomain(domain)) continue;
    const company = await prisma.company.findFirst({
      where: { officeId, domain: { equals: domain, mode: "insensitive" } },
      select: { id: true },
    });
    if (company) return { companyId: company.id, contactId: null, method: "company_domain" };
  }

  return null;
}

async function getOfficeEmailSet(officeId: string): Promise<Set<string>> {
  const accounts = await prisma.emailAccount.findMany({
    where: { officeId },
    select: { email: true },
  });
  return new Set(accounts.map((a) => a.email.toLowerCase()));
}

// ── Touch logging ────────────────────────────────────────────────────────────

// Log one email message as a CRM touch. Safe to call from sync/send paths:
// it never throws — CRM logging must not break email flows.
export async function logEmailTouch(input: LogEmailTouchInput): Promise<EmailTouchResult> {
  try {
    const officeEmails = await getOfficeEmailSet(input.officeId);
    return await logEmailTouchWithContext(input, officeEmails);
  } catch (e) {
    console.warn("[crm-email-touch] logEmailTouch failed:", e);
    return { status: "error" };
  }
}

async function logEmailTouchWithContext(
  input: LogEmailTouchInput,
  officeEmails: Set<string>,
): Promise<EmailTouchResult> {
  try {
    // Dedupe: one Activity per EmailMessage, ever.
    const existing = await prisma.activity.findFirst({
      where: {
        officeId: input.officeId,
        type: { in: ["EMAIL", "WHATSAPP"] },
        sourceRefs: { path: ["emailMessageId"], equals: input.messageId },
      },
      select: { id: true },
    });
    if (existing) return { status: "duplicate" };

    const thread = await prisma.emailThread.findFirst({
      where: { id: input.threadId, officeId: input.officeId },
      select: { companyId: true, contactId: true, inquiryId: true, jobId: true },
    });
    if (!thread) return { status: "skipped" };

    const counterpartyEmails = selectCounterpartyEmails({
      direction: input.direction,
      fromEmail: input.fromEmail,
      toEmails: input.toEmails,
      officeEmails,
    });

    let companyId = thread.companyId;
    let contactId = thread.contactId;
    let method: string = "thread_link";

    if (companyId) {
      // Thread already resolved — reuse, but still try to pin down the contact.
      if (!contactId) {
        for (const email of counterpartyEmails) {
          if (email.startsWith("whatsapp:")) {
            const digits = email.slice("whatsapp:".length);
            if (digits.length < 10) continue;
            const contacts = await prisma.contact.findMany({
              where: { companyId, phone: { not: null } },
              select: { id: true, phone: true },
              orderBy: { createdAt: "asc" },
              take: 200,
            });
            const match = contacts.find((c) => phoneMatchesWaDigits(c.phone, digits));
            if (match) {
              contactId = match.id;
              break;
            }
            continue;
          }
          const contact = await prisma.contact.findFirst({
            where: { companyId, email: { equals: email, mode: "insensitive" } },
            select: { id: true },
          });
          if (contact) {
            contactId = contact.id;
            break;
          }
        }
      }
    } else {
      const resolved = await resolveEmailCounterparty(input.officeId, {
        counterpartyEmails,
        inquiryId: thread.inquiryId,
        jobId: thread.jobId,
      });
      if (!resolved) return { status: "unresolved" };
      companyId = resolved.companyId;
      contactId = resolved.contactId;
      method = resolved.method;
    }

    // Tenant safety: never attach an activity to a company outside this office.
    const company = await prisma.company.findFirst({
      where: { id: companyId, officeId: input.officeId },
      select: { id: true },
    });
    if (!company) return { status: "unresolved" };

    if (thread.companyId !== companyId || thread.contactId !== contactId) {
      await prisma.emailThread.updateMany({
        where: { id: input.threadId, officeId: input.officeId },
        data: { companyId, contactId },
      });
    }

    const isWhatsApp = counterpartyEmails.some((e) => e.startsWith("whatsapp:")) ||
      input.fromEmail.trim().toLowerCase().startsWith("whatsapp:");
    const channelNoun = isWhatsApp ? "WhatsApp" : "email";
    const snippet = input.snippet?.replace(/\s+/g, " ").trim() ?? "";
    const counterpartyLabel =
      counterpartyEmails.map((e) => (e.startsWith("whatsapp:") ? whatsAppPartyLabel(e) : e)).join(", ") ||
      (input.direction === "INBOUND" ? input.fromEmail : input.toEmails.join(", ")) ||
      "unknown";
    const body = snippet
      ? snippet.slice(0, ACTIVITY_BODY_MAX)
      : input.direction === "INBOUND"
        ? `Inbound ${channelNoun} from ${counterpartyLabel}`
        : `Outbound ${channelNoun} to ${counterpartyLabel}`;

    await prisma.activity.create({
      data: {
        officeId: input.officeId,
        companyId,
        contactId,
        inquiryId: thread.inquiryId ?? null,
        type: isWhatsApp ? "WHATSAPP" : "EMAIL",
        occurredAt: input.sentAt,
        subject: input.subject?.trim() || (isWhatsApp ? "WhatsApp" : "Email"),
        body,
        source: isWhatsApp ? "whatsapp" : "gmail",
        sourceRefs: {
          emailMessageId: input.messageId,
          emailThreadId: input.threadId,
          direction: input.direction,
        },
        provenance: { resolvedBy: method },
      },
    });

    // Bump lastTouchAt forward only — a backfilled old message must never
    // overwrite a newer touch. Conditional update = atomic max().
    await prisma.company.updateMany({
      where: {
        id: companyId,
        officeId: input.officeId,
        OR: [{ lastTouchAt: null }, { lastTouchAt: { lt: input.sentAt } }],
      },
      data: { lastTouchAt: input.sentAt },
    });
    if (contactId) {
      await prisma.contact.updateMany({
        where: {
          id: contactId,
          company: { officeId: input.officeId },
          OR: [{ lastTouchAt: null }, { lastTouchAt: { lt: input.sentAt } }],
        },
        data: { lastTouchAt: input.sentAt },
      });
    }

    // Strong (contact-level) match on a linked inquiry that has no company yet
    // → adopt it. Never for domain-only matches; too weak to claim an inquiry.
    if (thread.inquiryId && (method === "contact_email" || method === "contact_phone")) {
      await prisma.inquiry.updateMany({
        where: { id: thread.inquiryId, officeId: input.officeId, companyId: null },
        data: { companyId },
      });
    }

    return { status: "created", companyId, contactId };
  } catch (e) {
    console.warn("[crm-email-touch] logEmailTouch failed:", e);
    return { status: "error" };
  }
}

// Re-resolve a thread (e.g. after it just got linked to an inquiry) and create
// any missing EMAIL activities for its latest messages. Never throws.
export async function relinkThreadTouches(
  threadId: string,
): Promise<{ scanned: number; created: number; resolved: boolean }> {
  try {
    const thread = await prisma.emailThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        officeId: true,
        messages: {
          orderBy: { sentAt: "desc" },
          take: RELINK_MESSAGE_LIMIT,
          select: {
            id: true,
            direction: true,
            fromEmail: true,
            toEmails: true,
            subject: true,
            bodyText: true,
            sentAt: true,
          },
        },
      },
    });
    if (!thread) return { scanned: 0, created: 0, resolved: false };

    const officeEmails = await getOfficeEmailSet(thread.officeId);

    let created = 0;
    // Oldest first so the thread's company/contact link settles before the
    // newer messages log against it.
    for (const message of [...thread.messages].reverse()) {
      const result = await logEmailTouchWithContext(
        {
          officeId: thread.officeId,
          threadId: thread.id,
          messageId: message.id,
          direction: message.direction === "OUTBOUND" ? "OUTBOUND" : "INBOUND",
          fromEmail: message.fromEmail,
          toEmails: parseStoredEmailList(message.toEmails),
          subject: message.subject,
          snippet: message.bodyText ? message.bodyText.slice(0, 2000) : null,
          sentAt: message.sentAt,
        },
        officeEmails,
      );
      if (result.status === "created") created++;
    }

    const after = await prisma.emailThread.findUnique({
      where: { id: threadId },
      select: { companyId: true },
    });
    return { scanned: thread.messages.length, created, resolved: Boolean(after?.companyId) };
  } catch (e) {
    console.warn("[crm-email-touch] relinkThreadTouches failed:", e);
    return { scanned: 0, created: 0, resolved: false };
  }
}
