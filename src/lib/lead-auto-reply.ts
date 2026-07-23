// Automated outreach for US Meta leads, run after every lead-sheet sync
// (hourly cron and the manual button). Policy per Mert (2026-07-22):
//
//  - GOOD and REVIEW ("Maybe") tiers both get the automated sequence; WEAK
//    leads never do. Review leads always get the ask-for-details email with
//    the qualifier questions prepended (src/lib/lead-outreach.ts) - never a
//    "will be processed" promise.
//  - After the first email: up to three follow-ups (+2d/+3d/+4d gaps), then
//    the lead is dropped - status IGNORED - after 4 more silent days.
//  - A detected reply (inbound message from the lead's address in any synced
//    inbox, after our first send) stops the sequence and flags the lead
//    "Replied - needs action". Replies land in oguzhan@/mert@ (both
//    OAuth-synced hourly); rfq@ itself is SMTP-only.
//  - First touches only go to leads received within the backlog window
//    (DERYA_LEAD_OUTREACH_BACKLOG_DAYS, default 30) - a months-old lead
//    getting "thanks for your request" reads as spam.
//
// Safety rails: per-kind CAS send stamps (never double-sends, and skips
// anything the desk already emailed manually), open-status only, strict
// single-address recipient, per-run send cap, follow-ups only during
// California business hours, and DERYA_LEAD_AUTO_REPLY=off as the kill
// switch for every automated send.

import { prisma } from "./prisma";
import { canonicalInquiryStatus, openInquiryStatusFilter } from "./inquiry-status";
import { US_LEAD_PARSED_MARKER } from "./meta-leads";
import { assessLeadQuality } from "./lead-quality";
import {
  deriveOutreachState,
  stampDate,
  withinOutreachSendWindow,
} from "./lead-outreach";
import {
  buildLeadCustomerEmail,
  buildLeadFollowUpEmail,
  buildLeadRevivalEmail,
  buildLeadScopeFollowUpEmail,
  claimInquirySendStamp,
  clearInquirySendStamp,
  isSingleEmailAddress,
  mergeInquiryParsedData,
  rfqMailConfigured,
  sendRfqMail,
  type SendStampKey,
} from "./rfq-mail";
import { recordMemoryEvent } from "./memory/record-event";

export type AutoReplySummary = {
  sent: number; // first-touch emails
  followUps: number; // follow-up emails 2-4
  replies: number; // leads newly marked as replied
  dropped: number; // leads auto-ignored after the final email
  revivals: number; // day-30 "still shipping?" emails to auto-dropped leads
  skipped: number;
  failed: number;
  warnings: string[];
};

// One cron tick's worth of emails (first touches + follow-ups combined);
// the hourly cadence drains any backlog.
const AUTO_REPLY_CAP = 25;

function autoReplyEnabled(): boolean {
  return (process.env.DERYA_LEAD_AUTO_REPLY ?? "us").toLowerCase() !== "off";
}

function backlogDays(): number {
  const n = Number(process.env.DERYA_LEAD_OUTREACH_BACKLOG_DAYS ?? "30");
  return Number.isFinite(n) && n > 0 ? n : 30;
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

function firstOutboundAt(parsed: Record<string, unknown>): Date | null {
  const dates = [stampDate(parsed.infoRequestSentAt), stampDate(parsed.confirmationSentAt)]
    .filter((d): d is Date => d != null);
  return dates.length > 0 ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
}

async function recordOutreachEvent(
  officeId: string,
  inquiryId: string,
  eventType: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  await recordMemoryEvent({
    officeId,
    sourceType: "GOOGLE_SHEETS",
    sourceExternalId: `meta_leads_outreach:${inquiryId}`,
    sourceLabel: "Meta leads outreach",
    eventType,
    entityType: "inquiry",
    entityId: inquiryId,
    actorType: "system",
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: { inquiryId, ...payload },
    provenance: {
      source: "google_sheets",
      operation: "us_lead_outreach",
      path: "src/lib/lead-auto-reply.ts",
      function: "autoReplyToUsLeads",
      sourceRecordId: inquiryId,
    },
    idempotencyKey,
  }).catch(() => null);
}

export type InboundReply = { sentAt: Date; bodyText: string | null };

// Newest inbound message per (lowercased) sender address across the office's
// synced inboxes - the deterministic "did the lead write back?" signal.
// Shared by the engine (stamps leadRepliedAt) and the US lead cards (live
// reply display, one sync ahead of the stamp).
export async function latestInboundByEmail(
  officeId: string,
  emails: string[],
): Promise<Map<string, InboundReply>> {
  const latest = new Map<string, InboundReply>();
  if (emails.length === 0) return latest;
  const inbound = await prisma.emailMessage.findMany({
    where: {
      direction: "INBOUND",
      fromEmail: { in: emails, mode: "insensitive" },
      thread: { officeId },
    },
    select: { fromEmail: true, sentAt: true, bodyText: true },
    orderBy: { sentAt: "desc" },
    take: 2000,
  });
  for (const message of inbound) {
    const key = message.fromEmail.toLowerCase();
    if (!latest.has(key)) latest.set(key, { sentAt: message.sentAt, bodyText: message.bodyText });
  }
  return latest;
}

export async function autoReplyToUsLeads(officeId: string): Promise<AutoReplySummary> {
  const summary: AutoReplySummary = {
    sent: 0, followUps: 0, replies: 0, dropped: 0, revivals: 0, skipped: 0, failed: 0, warnings: [],
  };
  if (!autoReplyEnabled()) return summary;
  if (!rfqMailConfigured()) {
    summary.warnings.push("Auto-reply skipped: RFQ mail is not configured.");
    return summary;
  }

  const now = new Date();
  const backlogCutoff = new Date(now.getTime() - backlogDays() * 24 * 60 * 60 * 1000);

  // Oldest first so the backlog drains in arrival order under the cap.
  const candidates = await prisma.inquiry.findMany({
    where: {
      officeId,
      parsedData: { contains: US_LEAD_PARSED_MARKER },
      status: openInquiryStatusFilter(),
    },
    orderBy: { receivedAt: "asc" },
    take: 400,
  });

  // Auto-dropped leads (status IGNORED via the drop pass, marked by the
  // leadDroppedAt stamp). They still get reply detection - a late answer to
  // the break-up email resurfaces them - and one day-30 revival email.
  const droppedCandidates = await prisma.inquiry.findMany({
    where: {
      officeId,
      status: "IGNORED",
      AND: [
        { parsedData: { contains: US_LEAD_PARSED_MARKER } },
        { parsedData: { contains: '"leadDroppedAt"' } },
      ],
    },
    orderBy: { receivedAt: "asc" },
    take: 200,
  });

  // ── Pass 1: reply detection ────────────────────────────────────────────
  // Emailed, unreplied leads whose address has since sent us anything - the
  // reply lands in the rfq@/mert@ inboxes via Reply-To and CC, and the
  // hourly Gmail sync stores it as an INBOUND EmailMessage.
  const unreplied = [...candidates, ...droppedCandidates].filter((inq) => {
    const parsed = parsedOf(inq.parsedData);
    return firstOutboundAt(parsed) != null && !parsed.leadRepliedAt && isSingleEmailAddress(inq.fromEmail);
  });
  const repliedIds = new Set<string>();
  try {
    const inboundByEmail = await latestInboundByEmail(
      officeId,
      [...new Set(unreplied.map((inq) => inq.fromEmail!.toLowerCase()))],
    );
    for (const inquiry of unreplied) {
      const parsed = parsedOf(inquiry.parsedData);
      const sentAt = firstOutboundAt(parsed);
      const replyAt = inboundByEmail.get(inquiry.fromEmail!.toLowerCase())?.sentAt;
      if (!sentAt || !replyAt || replyAt <= sentAt) continue;
      const merged = await mergeInquiryParsedData(officeId, inquiry.id, { leadRepliedAt: replyAt.toISOString() });
      if (merged !== "merged") continue;
      repliedIds.add(inquiry.id);
      summary.replies++;
      await recordOutreachEvent(
        officeId,
        inquiry.id,
        "meta_leads.lead.replied",
        { from: inquiry.fromEmail, repliedAt: replyAt.toISOString() },
        `meta_leads_lead_replied:${inquiry.id}`,
      );
    }
  } catch (e) {
    summary.warnings.push(`Reply detection: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── Pass 2: sends and drops ────────────────────────────────────────────
  let sendBudget = AUTO_REPLY_CAP;
  for (const inquiry of candidates) {
    // Recipients are pre-validated, so send failures are systemic (bad app
    // password, Gmail limit) - stop hammering SMTP; the next tick retries.
    if (summary.failed >= 3) {
      summary.warnings.push("Outreach sends aborted after repeated failures.");
      break;
    }
    if (repliedIds.has(inquiry.id)) continue;

    const parsed = parsedOf(inquiry.parsedData);
    if (!isSingleEmailAddress(inquiry.fromEmail)) {
      summary.skipped++;
      continue;
    }
    const tier = assessLeadQuality(inquiry).tier;
    if (tier === "WEAK") continue;

    const state = deriveOutreachState({
      parsed,
      tier,
      status: canonicalInquiryStatus(inquiry.status),
      hasValidEmail: true,
      now,
    });

    // Drop: final email out, grace period silent - archive the lead. Not an
    // email, so it ignores the send budget and the business-hours window.
    if (state.key === "final_sent" && state.nextDueAt && state.nextDueAt <= now) {
      const claim = await claimInquirySendStamp(inquiry.id, "leadDroppedAt");
      if (claim !== "claimed") continue;
      await prisma.inquiry.updateMany({
        where: { id: inquiry.id, officeId },
        data: { status: "IGNORED" },
      });
      summary.dropped++;
      await recordOutreachEvent(
        officeId,
        inquiry.id,
        "meta_leads.lead.dropped",
        { after: "final follow-up", to: inquiry.fromEmail },
        `meta_leads_lead_dropped:${inquiry.id}`,
      );
      continue;
    }

    if (sendBudget <= 0) continue;

    // First touch: the smart customer email (missing-info ask; Review leads
    // get the qualifier questions first). Sends any hour - it is a receipt.
    if (state.key === "not_started") {
      if (inquiry.receivedAt < backlogCutoff) continue;
      const email = buildLeadCustomerEmail(inquiry);
      const stampKey: SendStampKey = email.kind === "info-request" ? "infoRequestSentAt" : "confirmationSentAt";
      const claim = await claimInquirySendStamp(inquiry.id, stampKey);
      if (claim !== "claimed") {
        summary.skipped++;
        continue;
      }
      const result = await sendRfqMail({
        officeId,
        inquiryId: inquiry.id,
        to: inquiry.fromEmail,
        cc: email.cc,
        replyTo: email.replyTo,
        subject: email.subject,
        text: email.text,
        rememberLeadMessageId: true,
      });
      if ("error" in result) {
        await clearInquirySendStamp(inquiry.id, stampKey);
        summary.failed++;
        if (summary.warnings.length === 0) summary.warnings.push(`Auto-reply: ${result.error}`);
        continue;
      }
      sendBudget--;
      summary.sent++;
      // Audit marker + the first touch covers the scope/customs questions.
      await claimInquirySendStamp(inquiry.id, "autoRepliedAt").catch(() => null);
      await claimInquirySendStamp(inquiry.id, "scopeAskedAt").catch(() => null);
      await recordOutreachEvent(
        officeId,
        inquiry.id,
        "meta_leads.auto_reply.sent",
        { kind: email.kind, tier, to: inquiry.fromEmail, subject: email.subject },
        `meta_leads_auto_reply:${inquiry.id}:${stampKey}`,
      );
      continue;
    }

    if (state.key !== "awaiting") continue;

    // Legacy: leads emailed before scope/customs joined the standard question
    // set get one short follow-up asking just those two.
    const needsScopeFollowUp = !parsed.scopeAskedAt;
    const due = state.nextDueAt != null && state.nextDueAt <= now;
    if (!needsScopeFollowUp && !due) continue;
    // Follow-ups read as personal notes from Mert - only send them during
    // California business hours.
    if (!withinOutreachSendWindow(now)) continue;

    const step = (state.step + 1) as 2 | 3 | 4;
    const email = needsScopeFollowUp
      ? { ...buildLeadScopeFollowUpEmail(inquiry), inReplyTo: null as string | null }
      : buildLeadFollowUpEmail(inquiry, step);
    const stampKey: SendStampKey = needsScopeFollowUp ? "scopeAskedAt" : `followUp${step}SentAt`;
    const claim = await claimInquirySendStamp(inquiry.id, stampKey);
    if (claim !== "claimed") {
      summary.skipped++;
      continue;
    }
    const result = await sendRfqMail({
      officeId,
      inquiryId: inquiry.id,
      to: inquiry.fromEmail,
      cc: email.cc,
      replyTo: email.replyTo,
      subject: email.subject,
      text: email.text,
      inReplyTo: email.inReplyTo,
      rememberLeadMessageId: true,
    });
    if ("error" in result) {
      await clearInquirySendStamp(inquiry.id, stampKey);
      summary.failed++;
      if (summary.warnings.length === 0) summary.warnings.push(`Follow-up: ${result.error}`);
      continue;
    }
    sendBudget--;
    summary.followUps++;
    await recordOutreachEvent(
      officeId,
      inquiry.id,
      needsScopeFollowUp ? "meta_leads.auto_reply.sent" : "meta_leads.follow_up.sent",
      { kind: needsScopeFollowUp ? "scope-follow-up" : `follow-up-${step}`, tier, to: inquiry.fromEmail, subject: email.subject },
      `meta_leads_outreach:${inquiry.id}:${stampKey}`,
    );
  }

  // ── Pass 3: day-30 revival for auto-dropped leads ──────────────────────
  // One "still planning to ship?" per dropped lead, REVIVAL_AFTER_DAYS after
  // the drop. Eligibility was checked at first-touch time; here only the
  // address still has to be valid. Manual ignores (no leadDroppedAt stamp)
  // are never revived - the query above already excludes them.
  for (const inquiry of droppedCandidates) {
    if (summary.failed >= 3) break; // same systemic-SMTP guard as pass 2
    if (sendBudget <= 0) break;
    if (repliedIds.has(inquiry.id)) continue;
    if (!isSingleEmailAddress(inquiry.fromEmail)) continue;
    if (!withinOutreachSendWindow(now)) break;

    const parsed = parsedOf(inquiry.parsedData);
    const state = deriveOutreachState({
      parsed,
      tier: assessLeadQuality(inquiry).tier,
      status: canonicalInquiryStatus(inquiry.status),
      hasValidEmail: true,
      now,
    });
    // For a dropped lead, nextDueAt is the revival due time (null once sent
    // or after a reply resurfaced it).
    if (state.key !== "dropped" || !state.nextDueAt || state.nextDueAt > now) continue;

    const email = buildLeadRevivalEmail(inquiry);
    const claim = await claimInquirySendStamp(inquiry.id, "revivalSentAt");
    if (claim !== "claimed") {
      summary.skipped++;
      continue;
    }
    const result = await sendRfqMail({
      officeId,
      inquiryId: inquiry.id,
      to: inquiry.fromEmail,
      cc: email.cc,
      replyTo: email.replyTo,
      subject: email.subject,
      text: email.text,
      inReplyTo: email.inReplyTo,
      rememberLeadMessageId: true,
    });
    if ("error" in result) {
      await clearInquirySendStamp(inquiry.id, "revivalSentAt");
      summary.failed++;
      if (summary.warnings.length === 0) summary.warnings.push(`Revival: ${result.error}`);
      continue;
    }
    sendBudget--;
    summary.revivals++;
    await recordOutreachEvent(
      officeId,
      inquiry.id,
      "meta_leads.revival.sent",
      { kind: "revival", to: inquiry.fromEmail, subject: email.subject },
      `meta_leads_outreach:${inquiry.id}:revivalSentAt`,
    );
  }

  return summary;
}
