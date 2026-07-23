// Outreach sequence for US Meta leads: up to four emails, then drop.
//
//   touch 1  first email (missing-info ask; Review leads get qualifier
//            questions prepended so they can talk themselves into Good)
//   touch 2  +2 days   gentle bump
//   touch 3  +3 days   value nudge ("reply and we price within 6 hours")
//   touch 4  +4 days   break-up ("closing your file, reply to reopen")
//   drop     +4 days   status -> IGNORED, sequence over
//
// Gaps are measured from the previous outbound touch (not from touch 1), so
// a manual re-send or the legacy scope follow-up naturally pushes the next
// automated email out instead of stacking on top of it. A detected reply
// stops everything - from there the desk owns the lead.
//
// Pure module (no server-only imports): stage derivation and copy are unit-
// testable; lead-auto-reply.ts wires it to Prisma + SMTP.
//
// Policy per Mert (2026-07-22): GOOD and REVIEW tiers are both worked
// automatically; WEAK never is. Review leads always get the ask-for-details
// email (never a "will be processed" promise).

import {
  leadFirstName,
  leadMissingQuestions,
  type InquiryForWhatsApp,
} from "./rfq-whatsapp";
import { buildLeadCustomerEmailContent } from "./lead-emails";
import { hasCompanySignal, type LeadQualityTier } from "./lead-quality";

export const OUTREACH_TOTAL_TOUCHES = 4;

// Days of silence before follow-up N goes out, counted from the last
// outbound touch. Sums to the day 0 / +2 / +5 / +9 cadence.
export const FOLLOW_UP_GAP_DAYS: Record<2 | 3 | 4, number> = { 2: 2, 3: 3, 4: 4 };

// Silence after the final email before the lead is auto-ignored.
export const DROP_GRACE_DAYS = 4;

// One long-tail revival email this many days after an auto-drop ("still
// planning to ship?"). Auto-dropped leads only - a lead the operator
// ignored by hand was a decision, not a timeout, and stays quiet.
export const REVIVAL_AFTER_DAYS = 30;

// Follow-ups only go out during California business hours - the first touch
// is an instant receipt and may send any time, but a "just checking in" from
// Mert at 3am reads as the robot it is.
export const OUTREACH_SEND_WINDOW = { startHour: 7, endHour: 19, timeZone: "America/Los_Angeles" } as const;

export function withinOutreachSendWindow(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: OUTREACH_SEND_WINDOW.timeZone,
    }).format(now),
  );
  return hour >= OUTREACH_SEND_WINDOW.startHour && hour < OUTREACH_SEND_WINDOW.endHour;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type OutreachStageKey =
  | "excluded" // weak tier or no usable email - the sequence never starts
  | "not_started" // eligible, first email not sent yet
  | "awaiting" // 1-3 sent, waiting for a reply
  | "final_sent" // all 4 sent, drop timer running
  | "replied" // inbound from the lead - needs desk action
  | "desk" // desk moved the status (pricing / custom) - automation backs off
  | "stopped" // operator paused the sequence
  | "dropped" // no reply after 4 - auto-ignored
  | "closed"; // desk closed it (booked / missed / trash)

export type OutreachTouch = {
  step: number; // 1..4
  label: string;
  at: Date | null; // null = not sent yet
};

export type OutreachState = {
  key: OutreachStageKey;
  step: number; // outbound touches sent, 0..4
  label: string;
  detail: string | null;
  // Next automated event: follow-up due time while awaiting, drop time after
  // the final email. Null when the sequence is over or never started.
  nextDueAt: Date | null;
  repliedAt: Date | null;
  droppedAt: Date | null;
  stoppedAt: Date | null;
  touches: OutreachTouch[];
};

export type OutreachStateInput = {
  // Parsed parsedData object (stamps live here).
  parsed: Record<string, unknown>;
  tier: LeadQualityTier | null;
  // Canonical inquiry status (inquiry-status.ts).
  status: string;
  hasValidEmail: boolean;
  now: Date;
  // Live reply signal from the inbox (fresher than the cron-written stamp).
  repliedAt?: Date | null;
};

export function stampDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const CLOSED_BY_DESK = new Set(["BOOKED", "MISSED", "TRASH"]);
const CLOSED_STATUSES = new Set(["BOOKED", "MISSED", "IGNORED", "TRASH"]);

function shortDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function deriveOutreachState(input: OutreachStateInput): OutreachState {
  const { parsed, tier, status, hasValidEmail, now } = input;

  const touch1At = stampDate(parsed.infoRequestSentAt) ?? stampDate(parsed.confirmationSentAt);
  const touch1Label = stampDate(parsed.infoRequestSentAt) ? "Missing-info email" : "Confirmation email";
  const followUps: Array<Date | null> = [
    stampDate(parsed.followUp2SentAt),
    stampDate(parsed.followUp3SentAt),
    stampDate(parsed.followUp4SentAt),
  ];
  const touches: OutreachTouch[] = [
    { step: 1, label: touch1At ? touch1Label : "First email", at: touch1At },
    { step: 2, label: "Follow-up 2", at: followUps[0] },
    { step: 3, label: "Follow-up 3", at: followUps[1] },
    { step: 4, label: "Final notice", at: followUps[2] },
  ];
  const step = touches.filter((t) => t.at != null).length;
  // Spacing anchor: the latest outbound of any kind, including the legacy
  // scope follow-up (a real extra email for pre-2026-07-20 leads).
  const lastTouchAt = [touch1At, ...followUps, stampDate(parsed.scopeAskedAt)]
    .filter((d): d is Date => d != null)
    .reduce<Date | null>((max, d) => (max == null || d > max ? d : max), null);

  const repliedAt = input.repliedAt ?? stampDate(parsed.leadRepliedAt);
  const droppedAt = stampDate(parsed.leadDroppedAt);
  const stoppedAt = stampDate(parsed.sequenceStoppedAt);

  const base = { step, repliedAt, droppedAt, stoppedAt, touches };

  // A reply is the whole point - it outranks everything the desk hasn't
  // explicitly closed. An IGNORED (auto-dropped) lead that answers the
  // break-up email resurfaces as Replied.
  if (repliedAt && !CLOSED_BY_DESK.has(status)) {
    return {
      ...base,
      key: "replied",
      label: "Replied - needs action",
      detail: `replied ${shortDate(repliedAt)}`,
      nextDueAt: null,
    };
  }
  if (droppedAt) {
    const revivalAt = stampDate(parsed.revivalSentAt);
    // One revival email waits 30 days out; after it is sent (or answered)
    // the sequence is permanently over.
    const revivalDueAt = revivalAt ? null : new Date(droppedAt.getTime() + REVIVAL_AFTER_DAYS * DAY_MS);
    return {
      ...base,
      key: "dropped",
      label: `Dropped - no reply after ${OUTREACH_TOTAL_TOUCHES}`,
      detail: revivalAt
        ? `dropped ${shortDate(droppedAt)} - revival sent ${shortDate(revivalAt)}`
        : `dropped ${shortDate(droppedAt)} - revival ${shortDate(new Date(droppedAt.getTime() + REVIVAL_AFTER_DAYS * DAY_MS))}`,
      nextDueAt: revivalDueAt,
    };
  }
  if (CLOSED_STATUSES.has(status)) {
    return { ...base, key: "closed", label: "Closed", detail: null, nextDueAt: null };
  }
  if (stoppedAt) {
    return {
      ...base,
      key: "stopped",
      label: "Sequence paused",
      detail: `paused ${shortDate(stoppedAt)}`,
      nextDueAt: null,
    };
  }
  // Any open status other than RECEIVED means the desk picked the lead up
  // (pricing, or a custom status). The robot must not email a lead a human
  // is already talking to - the sequence freezes where it was.
  if (status !== "RECEIVED") {
    return { ...base, key: "desk", label: "With the desk", detail: null, nextDueAt: null };
  }
  if (step === 0) {
    if (!hasValidEmail || tier === "WEAK" || tier == null) {
      return {
        ...base,
        key: "excluded",
        label: "Not auto-emailed",
        detail: !hasValidEmail ? "no valid email address" : "weak lead",
        nextDueAt: null,
      };
    }
    return { ...base, key: "not_started", label: "Not emailed yet", detail: null, nextDueAt: null };
  }
  if (step >= OUTREACH_TOTAL_TOUCHES) {
    const dropAt = new Date((lastTouchAt ?? now).getTime() + DROP_GRACE_DAYS * DAY_MS);
    return {
      ...base,
      key: "final_sent",
      label: `Sent ${OUTREACH_TOTAL_TOUCHES}/${OUTREACH_TOTAL_TOUCHES} - final notice`,
      detail: `drops ${shortDate(dropAt)} without a reply`,
      nextDueAt: dropAt,
    };
  }
  const nextStep = (step + 1) as 2 | 3 | 4;
  const dueAt = new Date((lastTouchAt ?? now).getTime() + FOLLOW_UP_GAP_DAYS[nextStep] * DAY_MS);
  return {
    ...base,
    key: "awaiting",
    label: `Sent ${step}/${OUTREACH_TOTAL_TOUCHES} - waiting`,
    detail: dueAt <= now ? `follow-up ${nextStep} due now` : `follow-up ${nextStep} due ${shortDate(dueAt)}`,
    nextDueAt: dueAt,
  };
}

// First lines of what the lead actually wrote, for the card's reply panel -
// quoted history and the "On … wrote:" header are noise, not the reply.
export function replyExcerpt(bodyText: string | null, maxLength = 240): string | null {
  if (!bodyText) return null;
  const lines = bodyText
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .filter((line) => !/^On .{4,80} wrote:\s*$/.test(line.trim()));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text;
}

export type NextOutreachSend =
  | { type: "first-touch"; step: 1 }
  | { type: "follow-up"; step: 2 | 3 | 4 }
  | null;

// What the engine (or the operator's "send next" button) would send for a
// lead in this state. Due time is enforced by the caller - the operator may
// override the cadence, the cron must not.
export function nextOutreachSend(state: OutreachState): NextOutreachSend {
  if (state.key === "not_started") return { type: "first-touch", step: 1 };
  if (state.key === "awaiting") return { type: "follow-up", step: (state.step + 1) as 2 | 3 | 4 };
  return null;
}

// ── Copy ─────────────────────────────────────────────────────────────────────

// Same personas as lead-emails.ts: Mert signs the US flow, Oğuzhan the TR.
const SIGNATURE_TR = `--
Oğuzhan Karaca
Kurucu Ortak & CEO, Derya
https://usederya.com/`;
const SIGNATURE_US = `--
Mert Turna
Co-founder, Derya
https://usederya.com/`;

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

export type InquiryForOutreach = InquiryForWhatsApp & {
  fromEmail: string | null;
  fromCompany: string | null;
};

// Qualifier questions for Review-tier leads: the two answers that would
// re-tier them. Skipped when the lead already answered (an explicit
// "individual shipment" is an answer - re-asking reads as not listening).
export function leadQualifierQuestions(inq: InquiryForOutreach, tier: LeadQualityTier | null): string[] {
  if (tier !== "REVIEW") return [];
  const parsed = parsedOf(inq.parsedData);
  const answers = (parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)
    ? parsed.answers
    : {}) as Record<string, unknown>;
  const en = leadMissingQuestions(inq).market === "US";

  const questions: string[] = [];
  const commercial = (s(answers.commercial) ?? "").toLocaleLowerCase("en-US");
  const answered = commercial.startsWith("yes") || commercial.startsWith("evet")
    || commercial.startsWith("no") || commercial.startsWith("hayır") || commercial.startsWith("hayir");
  if (!answered) {
    questions.push(en
      ? "Is this a commercial (business) shipment, or a personal one?"
      : "Gönderiniz ticari mi (işletme yükü) yoksa bireysel mi?");
  }
  if (!hasCompanySignal(inq.fromCompany, s(parsed.fullName))) {
    questions.push(en
      ? "If it is a business shipment: your company name (and website, if available)."
      : "İşletme yüküyse: firma adınız (ve varsa web siteniz).");
  }
  return questions;
}

// The sequence's first email: the standard smart customer email, with the
// Review qualifier questions asked first (they decide whether the rest is
// worth anyone's time).
export function buildLeadOutreachFirstTouch(inq: InquiryForOutreach, tier: LeadQualityTier | null) {
  return buildLeadCustomerEmailContent(inq, leadQualifierQuestions(inq, tier));
}

export type LeadFollowUpContent = {
  step: 2 | 3 | 4;
  subject: string;
  text: string;
};

// Follow-up emails 2-4. Questions are recomputed at send time - whatever the
// desk has filled in since (from a call, WhatsApp, an earlier reply) is no
// longer asked. Subject threads onto the first email ("Re: …").
export function buildLeadFollowUpContent(
  inq: InquiryForOutreach,
  tier: LeadQualityTier | null,
  step: 2 | 3 | 4,
): LeadFollowUpContent {
  const { market, questions } = leadMissingQuestions(inq);
  const en = market === "US";
  const parsed = parsedOf(inq.parsedData);
  const firstName = leadFirstName(s(parsed.fullName), market);
  const greeting = en ? `Hi${firstName ? ` ${firstName}` : ""},` : "Merhaba,";
  const commodity = s(inq.commodity);
  const lane = [s(inq.origin), s(inq.destination)].filter(Boolean).join(" → ");
  const aboutEn = commodity
    ? `your ${commodity} shipment${lane ? ` (${lane})` : ""}`
    : lane ? `your shipment (${lane})` : "your shipping request";
  const aboutTr = commodity
    ? `${commodity} gönderiniz${lane ? ` (${lane})` : ""}`
    : lane ? `gönderiniz (${lane})` : "taşıma talebiniz";

  const allQuestions = [...leadQualifierQuestions(inq, tier), ...questions];
  const bullets = allQuestions.map((q) => `- ${q}`).join("\n");
  const subject = `Re: ${buildLeadCustomerEmailContent(inq).subject}`;

  if (step === 2) {
    const text = en
      ? `${greeting}

Just checking in on ${aboutEn}. We are ready to work up your quote - the details below are all we still need:

${bullets}

A quick reply to this email is enough. If it is easier, send a phone number and a good time, and we will call you.
${SIGNATURE_US}`
      : `${greeting}

${aboutTr} hakkında kısa bir hatırlatma. Teklifinizi hazırlamaya haziriz - ihtiyacımız olan bilgiler:

${bullets}

Bu e-postayı kısaca yanıtlamanız yeterli. Dilerseniz telefon numaranızı ve uygun bir saati yazın, biz sizi arayalım.
${SIGNATURE_TR}`;
    return { step, subject, text };
  }

  if (step === 3) {
    const text = en
      ? `${greeting}

Following up once more on ${aboutEn}. We price shipments like this every day and usually return a firm quote within 6 hours of getting the details:

${bullets}

Reply here and we will get it moving right away.
${SIGNATURE_US}`
      : `${greeting}

${aboutTr} için tekrar yazıyorum. Bu tür yükleri her gün fiyatlıyoruz ve bilgiler geldikten sonra genellikle 6 saat içinde net teklif dönüyoruz:

${bullets}

Bu e-postayı yanıtlamanız yeterli - hemen çalışmaya başlayalım.
${SIGNATURE_TR}`;
    return { step, subject, text };
  }

  const text = en
    ? `${greeting}

We have not heard back, so we are closing your quote request for now - no action needed on your side.

If you still plan to ship${commodity ? ` your ${commodity}` : ""}${lane ? ` (${lane})` : ""}, just reply to this email and we will pick it up right where we left off.

Wishing you smooth shipping,
${SIGNATURE_US}`
    : `${greeting}

Sizden haber alamadığımız için talebinizi şimdilik kapatıyoruz - sizin tarafınızda yapmanız gereken bir şey yok.

${commodity ? `${commodity} gönderinizi` : "Gönderinizi"} hâlâ taşımayı planlıyorsanız, bu e-postayı yanıtlamanız yeterli - kaldığımız yerden devam ederiz.

İyi çalışmalar dileriz,
${SIGNATURE_TR}`;
  return { step, subject, text };
}

// The one revival email, ~30 days after the drop. Freight needs recur on
// their own clock; this is a low-pressure "still shipping?" that reopens
// the file with a single reply.
export function buildLeadRevivalContent(inq: InquiryForOutreach): { subject: string; text: string } {
  const { market } = leadMissingQuestions(inq);
  const en = market === "US";
  const parsed = parsedOf(inq.parsedData);
  const firstName = leadFirstName(s(parsed.fullName), market);
  const greeting = en ? `Hi${firstName ? ` ${firstName}` : ""},` : "Merhaba,";
  const commodity = s(inq.commodity);
  const lane = [s(inq.origin), s(inq.destination)].filter(Boolean).join(" → ");
  const aboutEn = commodity
    ? `your ${commodity} shipment${lane ? ` (${lane})` : ""}`
    : lane ? `your shipment (${lane})` : "your shipping plans";
  const aboutTr = commodity
    ? `${commodity} gönderiniz${lane ? ` (${lane})` : ""}`
    : lane ? `gönderiniz (${lane})` : "taşıma planlarınız";
  const subject = `Re: ${buildLeadCustomerEmailContent(inq).subject}`;

  const text = en
    ? `${greeting}

A while back we closed your quote request when we did not hear back - checking in once more in case the timing simply was not right.

If ${aboutEn} is back on the agenda, just reply to this email and we will pick it up from where we left off and get you a price quickly.

Either way, wishing you good business,
${SIGNATURE_US}`
    : `${greeting}

Bir süre önce sizden haber alamayınca talebinizi kapatmıştık - belki de sadece zamanlama uygun değildi diye bir kez daha yazmak istedik.

${aboutTr} yeniden gündemdeyse, bu e-postayı yanıtlamanız yeterli - kaldığımız yerden devam edip fiyatı hızlıca çalışalım.

Her durumda bol kazançlar dileriz,
${SIGNATURE_TR}`;
  return { subject, text };
}
