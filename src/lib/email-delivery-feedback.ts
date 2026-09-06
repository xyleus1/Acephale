// Deterministic classification of inbound delivery feedback: bounces (DSN),
// complaints (ARF), auto-replies, and explicit opt-out replies. Runs on every
// synced inbound message before any LLM classification so suppression and
// sender protection never depend on model output.

export const DELIVERY_FEEDBACK_KINDS = ["BOUNCE", "COMPLAINT", "AUTO_REPLY", "OPT_OUT"] as const;
// EmailMessage.classification value for messages the deterministic parser
// recognised, so the AI classifier is never asked about them.
export const DELIVERY_FEEDBACK_CLASSIFICATION = "DELIVERY_FEEDBACK";
export type DeliveryFeedbackKind = (typeof DELIVERY_FEEDBACK_KINDS)[number];

export const EMAIL_SUPPRESSION_REASONS = ["BOUNCED", "COMPLAINED", "OPTED_OUT", "UNDELIVERABLE", "MANUAL"] as const;
export type EmailSuppressionReason = (typeof EMAIL_SUPPRESSION_REASONS)[number];

const SUPPRESSION_SKIP_MESSAGES: Record<EmailSuppressionReason, string> = {
  BOUNCED: "Recipient skipped: the address bounced permanently.",
  COMPLAINED: "Recipient skipped: the address filed a spam complaint.",
  OPTED_OUT: "Recipient skipped: the recipient asked not to be contacted.",
  UNDELIVERABLE: "Recipient skipped: the address failed the pre-send quality check.",
  MANUAL: "Recipient skipped: the address is on the do-not-email list.",
};

export function suppressionSkipMessage(reason: EmailSuppressionReason) {
  return SUPPRESSION_SKIP_MESSAGES[reason];
}

export type DeliveryFeedback = {
  kind: DeliveryFeedbackKind;
  permanent: boolean;
  // The recipients `permanent` describes. For a mixed delivery report these
  // are the permanently failed addresses only.
  recipients: string[];
  detail: string;
  // Recipients of the same delivery report whose own status is transient while
  // `recipients` failed permanently. Recorded, never suppressed.
  transientRecipients?: string[];
};

// Stored as EmailMessage.classificationReason so an unfinished feedback row can
// be completed later from the database alone, without the provider message.
// Recipient lists are comma separated; a `|` separates the transient recipients
// of a mixed report from the permanent ones.
const STORED_FEEDBACK_PATTERN = /^(BOUNCE|COMPLAINT|AUTO_REPLY|OPT_OUT) (permanent|transient) (\S+): ?([\s\S]*)$/;
export const STORED_FEEDBACK_MAX_LENGTH = 500;

function packRecipients(recipients: readonly string[], budget: number) {
  let packed = "";
  for (const email of recipients) {
    const address = email.trim();
    if (!address || /[\s,|]/.test(address)) continue;
    const next = packed ? `${packed},${address}` : address;
    if (next.length > budget) break;
    packed = next;
  }
  return packed;
}

// The header (kind, permanence, recipients, delimiter) always fits the budget;
// only the detail is cut. Recipients are dropped whole from the end when the
// list itself would not fit, so a stored address is always a real affected
// address, never a truncated one.
export function encodeStoredDeliveryFeedback(feedback: DeliveryFeedback) {
  const prefix = `${feedback.kind} ${feedback.permanent ? "permanent" : "transient"} `;
  const recipientBudget = STORED_FEEDBACK_MAX_LENGTH - prefix.length - ": ".length;
  const recipients = packRecipients(feedback.recipients, recipientBudget);
  const transient = feedback.transientRecipients?.length
    ? packRecipients(feedback.transientRecipients, recipientBudget - (recipients || "-").length - "|".length)
    : "";
  const list = `${recipients || "-"}${transient ? `|${transient}` : ""}`;
  return `${prefix}${list}: ${feedback.detail}`.slice(0, STORED_FEEDBACK_MAX_LENGTH);
}

function unpackRecipients(packed: string | undefined) {
  if (!packed || packed === "-") return [];
  return packed.split(",").filter((email) => email.includes("@"));
}

export function decodeStoredDeliveryFeedback(reason: string | null | undefined): DeliveryFeedback | null {
  const match = reason?.match(STORED_FEEDBACK_PATTERN);
  if (!match) return null;
  const [permanentList, transientList] = match[3].split("|");
  const transientRecipients = unpackRecipients(transientList);
  return {
    kind: match[1] as DeliveryFeedbackKind,
    permanent: match[2] === "permanent",
    recipients: unpackRecipients(permanentList),
    detail: match[4].trim(),
    ...(transientRecipients.length ? { transientRecipients } : {}),
  };
}

export type DeliveryFeedbackInput = {
  fromEmail: string;
  subject: string;
  bodyText: string;
  headers: ReadonlyArray<{ name: string; value: string }>;
  // Addresses that belong to us (the receiving mailbox). Never reported as
  // affected recipients.
  ownAddresses: readonly string[];
};

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const BOUNCE_SENDER_PATTERN = /^(mailer-daemon|postmaster|mail-daemon|maildaemon|noreply-dmarc-support)(@|\+|$)/i;
const BOUNCE_SUBJECT_PATTERNS = [
  /delivery status notification/i,
  /undeliver(able|ed)/i,
  /returned to sender/i,
  /mail delivery (failed|failure|problem|subsystem)/i,
  /delivery (failure|failed|has failed|incomplete)/i,
  /failure notice/i,
  /message not delivered/i,
  /could ?n.t be delivered/i,
  /address not found/i,
];

// Numeric SMTP evidence outranks wording: a greylisting MTA writes "recipient
// address rejected" next to a 4.x.x code, and only the code says whether the
// address is dead.
const PERMANENT_CODE_PATTERNS = [/\b5\.\d\.\d\b/, /\b55[0-4]\b/];
const TRANSIENT_CODE_PATTERNS = [/\b4\.\d\.\d\b/, /\b4[25]\d\b/];

const PERMANENT_BOUNCE_PATTERNS = [
  /user unknown/i,
  /unknown user/i,
  /no such user/i,
  /mailbox unavailable/i,
  /mailbox not found/i,
  /recipient (address )?rejected/i,
  /address (not found|rejected|does not exist|doesn.t exist)/i,
  /does not exist/i,
  /doesn.t exist/i,
  /invalid recipient/i,
  /account (has been )?disabled/i,
  /domain (not found|does not exist)/i,
  /permanent(ly)? (error|failure|rejected)/i,
  /wasn.t delivered to .* because the address couldn.t be found/i,
];

const TRANSIENT_BOUNCE_PATTERNS = [
  /quota exceeded/i,
  /over quota/i,
  /mailbox (is )?full/i,
  /try(ing)? again later/i,
  /temporar(y|ily)/i,
  /delayed/i,
  /greylist/i,
  /rate limit/i,
];

const BOUNCE_LINE_PATTERNS = [
  /wasn.t delivered/i,
  /could ?n.t be delivered/i,
  /not delivered/i,
  /delivery (to|has) failed/i,
  /failed/i,
  /rejected/i,
  /unknown/i,
  /not found/i,
  /does not exist/i,
  /doesn.t exist/i,
  /unavailable/i,
  /quota/i,
  /full/i,
];

const COMPLAINT_SUBJECT_PATTERNS = [
  /abuse report/i,
  /feedback report/i,
  /spam complaint/i,
  /complaint/i,
];

const AUTO_REPLY_SUBJECT_PATTERNS = [
  /^auto(matic|mated)?[\s-]*(reply|response)/i,
  /\bautoreply\b/i,
  /\bauto-reply\b/i,
  /\bautomatic reply\b/i,
  /\bout of (the )?office\b/i,
  /\bout of office\b/i,
  /\baway from (the |my )?office\b/i,
  /\bon (annual |parental |sick )?leave\b/i,
  /\bon vacation\b/i,
  /\bon holiday\b/i,
  /\babwesenheit/i,
  /\botomatik yan[iı]t\b/i,
  /\bofis d[iı][sş][iı]nday[iı]m\b/i,
];

const OPT_OUT_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bopt[\s-]?out\b/i,
  /\bremove me\b/i,
  /\btake me off\b/i,
  /\bstop (emailing|sending|contacting)\b/i,
  /\bdo not (contact|email)\b/i,
  /\bdon.t (contact|email) (me|us)\b/i,
  /\bno longer (wish|want) to (receive|be contacted)\b/i,
];

const OPT_OUT_MAX_BODY_CHARS = 2_000;

// A reply or forward keeps our outbound subject, so opt-out wording in such a
// subject is campaign copy, not the recipient's request.
const INHERITED_SUBJECT_PREFIX = /^\s*(?:(?:re|fw|fwd|aw|wg|ynt|sv|vs|tr|rif|antw)\s*(?:\[\d+\])?\s*:\s*)+/i;
const OPT_OUT_MAX_STANDALONE_SUBJECT_CHARS = 80;

function headerValue(headers: ReadonlyArray<{ name: string; value: string }>, name: string) {
  const wanted = name.toLowerCase();
  return headers.find((header) => header.name.toLowerCase() === wanted)?.value.trim() ?? null;
}

function headerValues(headers: ReadonlyArray<{ name: string; value: string }>, name: string) {
  const wanted = name.toLowerCase();
  return headers.filter((header) => header.name.toLowerCase() === wanted).map((header) => header.value.trim());
}

function localPart(email: string) {
  return email.trim().toLowerCase().split("@")[0] ?? "";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase().replace(/^<|>$/g, "").replace(/^rfc822;\s*/i, "");
}

function extractEmails(text: string) {
  return (text.match(EMAIL_PATTERN) ?? []).map(normalizeEmail);
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

function withoutOwn(recipients: readonly string[], input: DeliveryFeedbackInput) {
  const own = new Set(input.ownAddresses.map((address) => address.trim().toLowerCase()));
  own.add(input.fromEmail.trim().toLowerCase());
  return unique(recipients.filter((email) => (
    email.includes("@") && !own.has(email) && !BOUNCE_SENDER_PATTERN.test(email)
  )));
}

// Lines quoted from the original message are not the recipient's own words.
export function recipientAuthoredBody(body: string) {
  const lines = body.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*On .+ wrote:\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s.+@/i.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n");
}

const DSN_RECIPIENT_FIELD = /^(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*<?([^\s>]+@[^\s>]+)>?/i;

type DsnRecipientBlock = { recipients: string[]; text: string };

// One block per recipient group of a delivery-status report. Groups are
// separated by blank lines, or start at each Original-Recipient field (or a
// further Final-Recipient) when an MTA runs them together. Each block carries
// its own Action, Status, and Diagnostic-Code lines.
function dsnRecipientBlocks(body: string): DsnRecipientBlock[] {
  const blocks: DsnRecipientBlock[] = [];
  let current: { recipients: string[]; lines: string[]; finals: number } | null = null;
  const flush = () => {
    if (current?.recipients.length) {
      blocks.push({ recipients: unique(current.recipients), text: current.lines.join("\n") });
    }
    current = null;
  };
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const field = line.match(DSN_RECIPIENT_FIELD);
    if (field) {
      const isFinal = /^Final-Recipient:/i.test(line);
      const isOriginal = /^Original-Recipient:/i.test(line);
      if (current && ((isOriginal && current.recipients.length) || (isFinal && current.finals > 0))) flush();
      current ??= { recipients: [], lines: [], finals: 0 };
      current.recipients.push(normalizeEmail(field[1]));
      if (isFinal) current.finals += 1;
    } else {
      current ??= { recipients: [], lines: [], finals: 0 };
    }
    current.lines.push(line);
  }
  flush();
  return blocks;
}

function failedRecipientHeaders(headers: ReadonlyArray<{ name: string; value: string }>) {
  const recipients: string[] = [];
  for (const value of headerValues(headers, "X-Failed-Recipients")) {
    recipients.push(...extractEmails(value));
  }
  return recipients;
}

function failureLineRecipients(body: string) {
  const recipients: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!BOUNCE_LINE_PATTERNS.some((pattern) => pattern.test(line))) continue;
    recipients.push(...extractEmails(line));
  }
  return recipients;
}

function isBounce(input: DeliveryFeedbackInput) {
  const contentType = headerValue(input.headers, "Content-Type") ?? "";
  if (/report-type\s*=\s*"?delivery-status/i.test(contentType)) return true;
  if (headerValue(input.headers, "X-Failed-Recipients")) return true;
  const daemonSender = BOUNCE_SENDER_PATTERN.test(localPart(input.fromEmail));
  const subjectMatch = BOUNCE_SUBJECT_PATTERNS.some((pattern) => pattern.test(input.subject));
  if (daemonSender && subjectMatch) return true;
  if (daemonSender && /^(Final|Original)-Recipient:/im.test(input.bodyText)) return true;
  if (subjectMatch && /^(Final|Original)-Recipient:|^Action:\s*failed|^Status:\s*[45]\.\d\.\d/im.test(input.bodyText)) return true;
  return false;
}

// Permanence evidence in one stretch of report text, most authoritative first:
// the Status field, then the Diagnostic-Code line, then any SMTP code, then
// wording. Transient wording wins over permanent wording because suppressing a
// live address is the costlier mistake. Null when the text says nothing.
function permanenceEvidence(text: string): boolean | null {
  const status = text.match(/^Status:\s*([45])\.\d\.\d/im)?.[1] ?? null;
  if (status === "5") return true;
  if (status === "4") return false;
  const diagnostic = text.match(/^Diagnostic-Code:\s*(.+)$/im)?.[1] ?? null;
  if (diagnostic) {
    if (TRANSIENT_CODE_PATTERNS.some((pattern) => pattern.test(diagnostic))) return false;
    if (PERMANENT_CODE_PATTERNS.some((pattern) => pattern.test(diagnostic))) return true;
  }
  if (TRANSIENT_CODE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (PERMANENT_CODE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (TRANSIENT_BOUNCE_PATTERNS.some((pattern) => pattern.test(text))) return false;
  if (PERMANENT_BOUNCE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return null;
}

// Message-level permanence: the whole report, then the subject. Diagnostics in
// the body outrank a generic failure subject: a provider reports a full mailbox
// or a 4.x.x code under the same subject it uses for a dead address.
function bouncePermanence(input: DeliveryFeedbackInput) {
  if (/delivery status notification \(delay\)/i.test(input.subject)) return false;
  const evidence = permanenceEvidence(input.bodyText) ?? permanenceEvidence(input.subject);
  if (evidence !== null) return evidence;
  if (/delivery status notification \(failure\)/i.test(input.subject)) return true;
  return false;
}

function bounceDetail(input: DeliveryFeedbackInput, text = input.bodyText) {
  const diagnostic = text.match(/^Diagnostic-Code:\s*(.+)$/im)?.[1]?.trim();
  if (diagnostic) return diagnostic.slice(0, 300);
  const status = text.match(/^Status:\s*([45]\.\d\.\d)/im)?.[1];
  const reason = `${input.subject}\n${text}`.match(
    /(user unknown|no such user|mailbox unavailable|mailbox not found|recipient (?:address )?rejected|address not found|does not exist|doesn.t exist|quota exceeded|over quota|mailbox (?:is )?full|account (?:has been )?disabled|domain not found)/i,
  )?.[1];
  return [status, reason ?? input.subject].filter(Boolean).join(" ").slice(0, 300);
}

type ParsedBounce = Pick<DeliveryFeedback, "permanent" | "recipients" | "detail" | "transientRecipients">;

// Permanence is decided per recipient block. A report naming one dead address
// and one full mailbox suppresses only the dead one; the full mailbox is kept
// as a transient recipient. Recipients without a block of their own (header
// lists, human-readable failure lines) take the message-level verdict.
function parseBounce(input: DeliveryFeedbackInput): ParsedBounce {
  const messagePermanent = bouncePermanence(input);
  const blocks = dsnRecipientBlocks(input.bodyText);
  const permanent: string[] = [];
  const transient: string[] = [];
  let permanentText: string | null = null;
  for (const block of blocks) {
    const verdict = permanenceEvidence(block.text) ?? messagePermanent;
    for (const recipient of block.recipients) {
      if (verdict) {
        permanent.push(recipient);
        permanentText ??= block.text;
      } else {
        transient.push(recipient);
      }
    }
  }
  const blockRecipients = new Set([...permanent, ...transient]);
  const unblocked = failedRecipientHeaders(input.headers).filter((recipient) => !blockRecipients.has(recipient));
  if (!blocks.length && !unblocked.length) unblocked.push(...failureLineRecipients(input.bodyText));
  (messagePermanent ? permanent : transient).push(...unblocked);

  const permanentRecipients = withoutOwn(permanent, input);
  const transientRecipients = withoutOwn(transient, input).filter((recipient) => !permanentRecipients.includes(recipient));
  if (permanentRecipients.length) {
    return {
      permanent: true,
      recipients: permanentRecipients,
      detail: bounceDetail(input, permanentText ?? input.bodyText),
      ...(transientRecipients.length ? { transientRecipients } : {}),
    };
  }
  if (transientRecipients.length) {
    return { permanent: false, recipients: transientRecipients, detail: bounceDetail(input) };
  }
  return { permanent: messagePermanent, recipients: [], detail: bounceDetail(input) };
}

// ARF `not-spam` reports say the recipient rescued our mail from the spam
// folder; they are the opposite of a complaint.
function isComplaint(input: DeliveryFeedbackInput) {
  const feedbackType = input.bodyText.match(/^Feedback-Type:\s*([a-z-]+)/im)?.[1]?.toLowerCase() ?? null;
  if (feedbackType === "not-spam") return false;
  const contentType = headerValue(input.headers, "Content-Type") ?? "";
  if (/report-type\s*=\s*"?feedback-report/i.test(contentType)) return true;
  if (feedbackType && ["abuse", "fraud", "virus", "other"].includes(feedbackType)) return true;
  if (COMPLAINT_SUBJECT_PATTERNS.some((pattern) => pattern.test(input.subject))
    && /^(Original-Rcpt-To|Removal-Recipient|Feedback-Type):/im.test(input.bodyText)) return true;
  return false;
}

function complaintRecipients(body: string) {
  const recipients: string[] = [];
  const fieldPattern = /^(?:Original-Rcpt-To|Removal-Recipient):\s*(?:rfc822;)?\s*<?([^\s>]+@[^\s>]+)>?/gim;
  for (const match of body.matchAll(fieldPattern)) recipients.push(normalizeEmail(match[1]));
  return recipients;
}

function isAutoReply(input: DeliveryFeedbackInput) {
  const autoSubmitted = headerValue(input.headers, "Auto-Submitted");
  if (autoSubmitted && !/^no\b/i.test(autoSubmitted)) return true;
  if (headerValue(input.headers, "X-Autoreply") || headerValue(input.headers, "X-Autorespond")) return true;
  const suppress = headerValue(input.headers, "X-Auto-Response-Suppress");
  if (suppress && /\b(OOF|AutoReply|All)\b/i.test(suppress)) return true;
  const precedence = headerValue(input.headers, "Precedence");
  if (precedence && /^auto[_-]?reply$/i.test(precedence)) return true;
  return AUTO_REPLY_SUBJECT_PATTERNS.some((pattern) => pattern.test(input.subject));
}

// Only a subject the recipient wrote themselves counts as opt-out evidence: no
// reply or forward prefix, and short enough to be a standalone request rather
// than a copy of our campaign subject.
function recipientAuthoredSubject(subject: string) {
  const trimmed = subject.trim();
  if (!trimmed || INHERITED_SUBJECT_PREFIX.test(trimmed)) return "";
  if (trimmed.length > OPT_OUT_MAX_STANDALONE_SUBJECT_CHARS) return "";
  return trimmed;
}

function optOutText(input: DeliveryFeedbackInput) {
  return `${recipientAuthoredSubject(input.subject)}\n${recipientAuthoredBody(input.bodyText).slice(0, OPT_OUT_MAX_BODY_CHARS)}`;
}

function isOptOut(input: DeliveryFeedbackInput) {
  const text = optOutText(input);
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(text));
}

function optOutDetail(input: DeliveryFeedbackInput) {
  const text = optOutText(input);
  for (const pattern of OPT_OUT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return `Recipient wrote "${match[0]}".`;
  }
  return "Recipient asked not to be contacted.";
}

export function classifyDeliveryFeedback(input: DeliveryFeedbackInput): DeliveryFeedback | null {
  if (isBounce(input)) {
    return { kind: "BOUNCE", ...parseBounce(input) };
  }
  if (isComplaint(input)) {
    return {
      kind: "COMPLAINT",
      permanent: true,
      recipients: withoutOwn(complaintRecipients(input.bodyText), input),
      detail: (input.bodyText.match(/^Feedback-Type:\s*(.+)$/im)?.[1]?.trim() ?? input.subject).slice(0, 300),
    };
  }
  if (isAutoReply(input)) {
    const sender = normalizeEmail(input.fromEmail);
    const own = input.ownAddresses.some((address) => address.trim().toLowerCase() === sender);
    return {
      kind: "AUTO_REPLY",
      permanent: false,
      recipients: own || !sender.includes("@") ? [] : [sender],
      detail: input.subject.slice(0, 300),
    };
  }
  if (isOptOut(input)) {
    return {
      kind: "OPT_OUT",
      permanent: true,
      recipients: [normalizeEmail(input.fromEmail)],
      detail: optOutDetail(input),
    };
  }
  return null;
}

// Sender protection thresholds. A mailbox is paused when its permanent bounce
// share over the rolling window crosses the threshold with enough volume to be
// meaningful, or when complaints in the window reach the complaint count.
export const SENDER_PROTECTION_WINDOW_HOURS = 24;
export const SENDER_PROTECTION_MIN_SENDS = 10;
export const SENDER_PROTECTION_BOUNCE_RATE = 0.05;
export const SENDER_PROTECTION_COMPLAINT_COUNT = 2;

// A pause is held for at least the window it was measured over, so the sends
// that caused it have aged out before the mailbox is judged again. Without a
// recovery rule a paused mailbox never sends again until a person resumes it,
// which is how sender protection turned a bad day into a permanently smaller
// pool and left supplier conversations owed with nothing able to answer them.
export const SENDER_PROTECTION_COOLDOWN_HOURS = SENDER_PROTECTION_WINDOW_HOURS;

export function senderProtectionDecision(input: {
  sent: number;
  permanentBounces: number;
  complaints: number;
}): { pause: true; reason: string } | { pause: false } {
  if (input.complaints >= SENDER_PROTECTION_COMPLAINT_COUNT) {
    return {
      pause: true,
      reason: `${input.complaints} spam complaints in ${SENDER_PROTECTION_WINDOW_HOURS} hours.`,
    };
  }
  if (input.sent >= SENDER_PROTECTION_MIN_SENDS && input.permanentBounces / input.sent >= SENDER_PROTECTION_BOUNCE_RATE) {
    const percent = Math.round((input.permanentBounces / input.sent) * 100);
    return {
      pause: true,
      reason: `${input.permanentBounces} of ${input.sent} sends bounced (${percent}%) in ${SENDER_PROTECTION_WINDOW_HOURS} hours.`,
    };
  }
  return { pause: false };
}

export type SenderProtectionRecovery =
  | { resume: true }
  | { resume: false; reason: string; eligibleAt: Date };

// A paused mailbox is resumed once the cooldown has passed and the same
// measurement that paused it no longer holds. The mailbox is judged on the
// current window, so a mailbox that starts bouncing again is paused again by
// the next delivery report rather than being trusted for good.
export function senderProtectionRecoveryDecision(input: {
  pausedAt: Date;
  now: Date;
  sent: number;
  permanentBounces: number;
  complaints: number;
}): SenderProtectionRecovery {
  const eligibleAt = new Date(input.pausedAt.getTime() + SENDER_PROTECTION_COOLDOWN_HOURS * 3_600_000);
  if (input.now.getTime() < eligibleAt.getTime()) {
    return {
      resume: false,
      reason: `Paused less than ${SENDER_PROTECTION_COOLDOWN_HOURS} hours ago.`,
      eligibleAt,
    };
  }
  const decision = senderProtectionDecision({
    sent: input.sent,
    permanentBounces: input.permanentBounces,
    complaints: input.complaints,
  });
  if (decision.pause) {
    return {
      resume: false,
      reason: decision.reason,
      // The window is rolling, so the soonest a still failing mailbox can be
      // judged clean is once the current window has passed.
      eligibleAt: new Date(input.now.getTime() + SENDER_PROTECTION_WINDOW_HOURS * 3_600_000),
    };
  }
  return { resume: true };
}
