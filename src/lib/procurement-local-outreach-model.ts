import {
  MAX_PROCUREMENT_CONVERSATION_MESSAGES,
  boundProcurementConversationMessages,
  procurementConversationEmailAddresses,
  type ProcurementConversation,
} from "@/lib/procurement-conversation-model";
import { supplierBounceText } from "@/lib/procurement-inbound-triage";
import { classifyDeliveryFeedback } from "@/lib/email-delivery-feedback";

export const LOCAL_RFQ_MESSAGE_LIMIT = 4_000;
export const LOCAL_RFQ_BATCH_MESSAGES_PER_ORDER = 1_000;
export const LOCAL_RFQ_BATCH_ORDER_LIMIT = 50;

export type LocalRfqMessage = {
  id: string;
  threadId: string;
  direction: string;
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  body: string;
  sentAt: string;
  accountEmail: string | null;
  externalThreadId: string | null;
  deliveryKind?: string | null;
  classification?: string | null;
  rfcMessageId?: string | null;
};

export type LocalRfqOutreach = {
  contacted: number;
  responded: number;
  contactedEmails: string[];
  respondedEmails: string[];
};

export function rfqSubjectReferenceToken(orderId: string) {
  return orderId.slice(0, 8).toLowerCase();
}

export function rfqSubjectReference(orderId: string) {
  return `[RFQ ${orderId.slice(0, 8)}]`;
}

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function recipientEmails(message: LocalRfqMessage) {
  return [...message.toEmails, ...message.ccEmails]
    .flatMap((entry) => procurementConversationEmailAddresses(entry))
    .map((entry) => normalize(entry))
    .filter(Boolean);
}

// A delivery notice is the mail system speaking, not the supplier, so it never
// counts as an answer: doing so would both invent a response and cancel the
// follow up that a failed delivery should provoke.
// Bounce wording is read with the same rule inbound triage uses, so a provider
// that reports the failure from its own address is caught either way.
const DELIVERY_SYSTEM_SENDER = /^(mailer-daemon|mail-daemon|postmaster)@/i;

function deliveryNotice(message: LocalRfqMessage) {
  return DELIVERY_SYSTEM_SENDER.test(normalize(message.fromEmail))
    || supplierBounceText(message.subject ?? "", message.body);
}

// Our own mail is not a supplier answering, and a pooled mailbox that has no
// account row still writes its address on everything it sends, so a synced copy
// of our own send cannot be read as a reply.
function ourEmails(messages: LocalRfqMessage[]) {
  return new Set(messages.flatMap((message) => [
    normalize(message.accountEmail),
    message.direction === "OUTBOUND" ? normalize(message.fromEmail) : "",
  ]).filter(Boolean));
}

// A thread belongs to the addresses we mailed on it before any reply arrived.
// Answering a shop's helpdesk or ticketing address puts that address on the
// thread too, and counting it as a contact of its own would let it out match
// the address we actually mailed, which would drop the whole exchange out of
// that supplier's conversation from the second message onwards.
// A thread the supplier opened has no such anchor, so every address we mailed
// on it still counts. Only a real reply closes the window: a bounce or a synced
// copy of our own mail must not, or an RFQ resent to a corrected address after
// a bounce would never anchor the thread. An address a bounce reported as
// undeliverable stops anchoring, so a resend to a corrected address is not left
// competing with the dead one.
// Which address a delivery report failed is read by the same deterministic
// parser sender protection uses, so a report naming several recipients only
// retires the ones it reports as permanently undeliverable, and a delay or a
// full mailbox retires none.
// A provider whose wording that parser does not recognise still reports the
// dead address on its own failure line, so such a notice falls back to the
// addresses named there, line by line: a report that gave up on one address
// while it keeps retrying another retires only the first, and a line reading as
// a temporary problem retires nobody.
// A report that calls itself delayed in its subject or a heading of its own
// retires an address only where the line names why that address is dead, since
// "delivery failed" under a delay notice is the delay being reported, not a
// recipient given up on.
// An SMTP status on the recipient's own line outranks all of that wording, the
// same way the shared parser treats it: a 5.x.x line retires that address
// whatever the report calls itself, and a 4.x.x line keeps it. A bare code only
// counts where it reads as a rejected recipient or a domain refusing mail, and
// only where the same line also reports a failure, since a 535 is our own
// authentication and a quoted RFQ line can carry a number like 550 units, and
// retiring the address beside either would lose a live supplier.
const EMAIL_IN_TEXT = /[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/g;
const TRANSIENT_NOTICE = /quota|mailbox (is )?full|temporar(y|ily)|delay|greylist|rate limit|try(ing)? again/i;
// Wording a provider puts on the line that names the address it gave up on, so
// a quoted header or a support address elsewhere in the report is not read as
// a failed recipient.
const DEAD_RECIPIENT_LINE = /(user )?unknown|rejected|not found|no such (user|mailbox|address)|does ?n.t exist|does not exist|undeliverable|disabled/i;
const FAILED_LINE = new RegExp(`${DEAD_RECIPIENT_LINE.source}|(delivery )?failed|(could ?n.t|could not|was ?n.t|was not) be delivered|not delivered`, "i");
const PERMANENT_STATUS = /\b5\.\d\.\d\b/;
const PERMANENT_CODE = /\b(55[0-4]|556)\b/;
const TRANSIENT_STATUS = /\b4\.\d\.\d\b|\b4\d{2}\b/;

function failureLineRecipients(message: LocalRfqMessage) {
  const lines = message.body.split("\n");
  const reportTransient = TRANSIENT_NOTICE.test(message.subject ?? "")
    || lines.some((line) => TRANSIENT_NOTICE.test(line) && !line.match(EMAIL_IN_TEXT));
  const failed = reportTransient ? DEAD_RECIPIENT_LINE : FAILED_LINE;
  return lines
    .filter((line) => {
      if (PERMANENT_STATUS.test(line)) return true;
      if (TRANSIENT_NOTICE.test(line) || TRANSIENT_STATUS.test(line)) return false;
      return failed.test(line) || (FAILED_LINE.test(line) && PERMANENT_CODE.test(line));
    })
    .flatMap((line) => line.match(EMAIL_IN_TEXT) ?? []);
}

function permanentlyFailedRecipients(message: LocalRfqMessage, accountEmails: Set<string>) {
  const feedback = classifyDeliveryFeedback({
    fromEmail: message.fromEmail,
    subject: message.subject ?? "",
    bodyText: message.body,
    headers: [],
    ownAddresses: [...accountEmails],
  });
  const named = feedback?.kind === "BOUNCE"
    ? (feedback.permanent ? feedback.recipients : [])
    : failureLineRecipients(message);
  return named.map((recipient) => normalize(recipient)).filter((recipient) => (
    recipient && !accountEmails.has(recipient)
  ));
}

function contactsByThread(messages: LocalRfqMessage[]) {
  const ordered = [...messages].sort((left, right) => (
    left.sentAt.localeCompare(right.sentAt) || left.id.localeCompare(right.id)
  ));
  const accountEmails = ourEmails(ordered);
  const anchored = new Map<string, Set<string>>();
  const mailed = new Map<string, Set<string>>();
  const replied = new Set<string>();
  const failed = new Map<string, Set<string>>();
  for (const message of ordered) {
    if (message.direction !== "OUTBOUND") {
      const sender = normalize(message.fromEmail);
      if (!sender || accountEmails.has(sender)) continue;
      if (!deliveryNotice(message)) {
        replied.add(message.threadId);
        continue;
      }
      const dead = failed.get(message.threadId) ?? new Set<string>();
      for (const recipient of permanentlyFailedRecipients(message, accountEmails)) {
        dead.add(recipient);
      }
      failed.set(message.threadId, dead);
      continue;
    }
    const recipients = recipientEmails(message);
    const everyone = mailed.get(message.threadId) ?? new Set<string>();
    for (const recipient of recipients) everyone.add(recipient);
    mailed.set(message.threadId, everyone);
    if (replied.has(message.threadId)) continue;
    const anchor = anchored.get(message.threadId) ?? new Set<string>();
    for (const recipient of recipients) anchor.add(recipient);
    anchored.set(message.threadId, anchor);
  }
  return new Map([...mailed].map(([threadId, everyone]) => {
    const anchor = anchored.get(threadId);
    const claimants = anchor?.size ? anchor : everyone;
    const dead = failed.get(threadId);
    if (!dead?.size) return [threadId, claimants] as const;
    const alive = new Set([...claimants].filter((email) => !dead.has(email)));
    return [threadId, alive.size ? alive : claimants] as const;
  }));
}

// A supplier answers from whatever address its shop uses: a colleague, a
// helpdesk, a ticketing system. The addresses we mailed on that same thread are
// the only claim on such a reply, so it is attributed to the ones sharing the
// sender's domain, or to the single address we mailed there when a forwarder
// answers from elsewhere. A thread we mailed to several unrelated addresses
// attributes nothing, because the reply could belong to any of them.
function attributedContacts(
  message: LocalRfqMessage,
  contacts: Map<string, Set<string>>,
  accountEmails: Set<string>,
): string[] {
  const sender = normalize(message.fromEmail);
  if (!sender || accountEmails.has(sender) || deliveryNotice(message)) return [];
  const onThread = [...(contacts.get(message.threadId) ?? [])]
    .filter((email) => !accountEmails.has(email));
  if (!onThread.length) return [];
  const domain = sender.split("@")[1] ?? "";
  const sameDomain = domain ? onThread.filter((email) => email.endsWith(`@${domain}`)) : [];
  if (sameDomain.length) return sameDomain;
  return onThread.length === 1 ? onThread : [];
}

// The workflow database receipt column is read-only for the dashboard role, so
// supplier contact is also derived from the office's own sent RFQ records.
export function summarizeLocalRfqOutreach(messages: LocalRfqMessage[]): LocalRfqOutreach {
  const contacted = new Set<string>();
  const responded = new Set<string>();
  // One supplier answering from two addresses, or on two threads, is one
  // response, so the count keys on the addresses we mailed rather than on who
  // happened to type the reply.
  const respondents = new Set<string>();
  const accountEmails = ourEmails(messages);
  const contacts = contactsByThread(messages);
  for (const message of messages) {
    if (message.direction === "OUTBOUND") {
      for (const recipient of recipientEmails(message)) contacted.add(recipient);
      continue;
    }
    const sender = normalize(message.fromEmail);
    if (!sender || accountEmails.has(sender) || deliveryNotice(message)) continue;
    // The sender stays in the set as well, so a supplier row recorded under the
    // address that actually wrote to us keeps matching.
    const attributed = attributedContacts(message, contacts, accountEmails);
    for (const email of attributed) responded.add(email);
    responded.add(sender);
    respondents.add(attributed.length ? [...attributed].sort().join(",") : sender);
  }
  return {
    contacted: contacted.size,
    responded: respondents.size,
    contactedEmails: [...contacted],
    respondedEmails: [...responded],
  };
}

export const EMPTY_LOCAL_RFQ_OUTREACH: LocalRfqOutreach = {
  contacted: 0,
  responded: 0,
  contactedEmails: [],
  respondedEmails: [],
};

export function summarizeLocalRfqOutreachByOrder(
  messages: LocalRfqMessage[],
  orderIds: string[],
): Map<string, LocalRfqOutreach> {
  const referenceToOrder = new Map(orderIds.map((orderId) => [
    rfqSubjectReference(orderId).toLowerCase(),
    orderId,
  ]));
  const grouped = new Map<string, LocalRfqMessage[]>();
  for (const message of messages) {
    const subject = normalize(message.subject);
    for (const [reference, orderId] of referenceToOrder) {
      if (!subject.includes(reference)) continue;
      const bucket = grouped.get(orderId);
      if (bucket) bucket.push(message);
      else grouped.set(orderId, [message]);
    }
  }
  return new Map(orderIds.map((orderId) => [
    orderId,
    summarizeLocalRfqOutreach(grouped.get(orderId) ?? []),
  ]));
}

export function overlayRequestOutreach<T extends { contactedCount: number; responseCount: number }>(
  request: T,
  outreach: LocalRfqOutreach,
): T {
  return {
    ...request,
    contactedCount: Math.max(request.contactedCount, outreach.contacted),
    responseCount: Math.max(request.responseCount, outreach.responded),
  };
}

export function overlayVendorOutreach<T extends {
  contacted: boolean;
  responseCount: number;
  contact: { email: string | null } | null;
}>(vendor: T, outreach: LocalRfqOutreach): T {
  const email = normalize(vendor.contact?.email);
  if (!email) return vendor;
  return {
    ...vendor,
    contacted: vendor.contacted || outreach.contactedEmails.includes(email),
    responseCount: Math.max(vendor.responseCount, outreach.respondedEmails.includes(email) ? 1 : 0),
  };
}

// The one rule that decides which messages on our own threads belong to a
// supplier, so every reader of a local thread, the office RFQ ledger and a
// single anchored thread alike, attributes a colleague or helpdesk reply the
// same way instead of each keeping its own narrower rule.
export type LocalRfqThreadAttribution = {
  relatedIds: Set<string>;
  inboundIds: Set<string>;
  attributedSenders: string[];
};

export function attributeLocalRfqThread(
  messages: readonly LocalRfqMessage[],
  contactEmail: string,
): LocalRfqThreadAttribution {
  const contact = normalize(contactEmail);
  const relatedIds = new Set<string>();
  const inboundIds = new Set<string>();
  const attributedSenders = new Set<string>();
  if (!contact) return { relatedIds, inboundIds, attributedSenders: [] };
  const list = [...messages];
  const accountEmails = ourEmails(list);
  const contacts = contactsByThread(list);
  const vouchedByThread = new Map<string, Set<string>>();
  for (const message of list) {
    if (message.direction === "OUTBOUND") continue;
    const sender = normalize(message.fromEmail);
    if (sender === contact) {
      relatedIds.add(message.id);
      inboundIds.add(message.id);
      continue;
    }
    if (!attributedContacts(message, contacts, accountEmails).includes(contact)) continue;
    relatedIds.add(message.id);
    inboundIds.add(message.id);
    attributedSenders.add(sender);
    const vouched = vouchedByThread.get(message.threadId) ?? new Set<string>();
    vouched.add(sender);
    vouchedByThread.set(message.threadId, vouched);
  }
  // Our own answer often goes to the address that wrote to us rather than to the
  // address we first mailed, so it belongs to the same conversation. Without it
  // the transcript reads as unanswered and the supplier is answered again.
  for (const message of list) {
    if (message.direction !== "OUTBOUND") continue;
    const recipients = recipientEmails(message);
    const vouched = vouchedByThread.get(message.threadId);
    if (recipients.includes(contact) || recipients.some((recipient) => vouched?.has(recipient))) {
      relatedIds.add(message.id);
    }
  }
  return { relatedIds, inboundIds, attributedSenders: [...attributedSenders] };
}

export function localRfqConversationFor(
  messages: LocalRfqMessage[],
  contactEmail: string,
): ProcurementConversation | null {
  const contact = normalize(contactEmail);
  if (!contact) return null;
  const attribution = attributeLocalRfqThread(messages, contact);
  const related = messages
    .filter((message) => attribution.relatedIds.has(message.id))
    .slice(-MAX_PROCUREMENT_CONVERSATION_MESSAGES);
  if (!related.length) return null;
  // Answering such a reply means answering the address that wrote it, so the
  // conversation states which senders its own threads attribute to this
  // supplier rather than leaving the send path to guess.
  const attributedSenders = attribution.attributedSenders
    .filter((sender) => related.some((message) => normalize(message.fromEmail) === sender));
  const accountEmail = related.find((message) => message.accountEmail)?.accountEmail ?? null;
  const externalThreadId = related.find((message) => message.externalThreadId)?.externalThreadId ?? null;
  return {
    available: true,
    source: "DERYA_EMAIL_RECORD",
    sourceUrl: accountEmail && externalThreadId
      ? `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${encodeURIComponent(externalThreadId)}`
      : null,
    accountEmail,
    messages: boundProcurementConversationMessages(related.map((message) => ({
      id: message.id,
      direction: attribution.inboundIds.has(message.id) ? "INBOUND" : "OUTBOUND",
      fromEmail: message.fromEmail,
      fromName: message.fromName,
      toEmails: message.toEmails,
      ccEmails: message.ccEmails,
      subject: message.subject,
      body: message.body,
      sentAt: message.sentAt,
      truncated: false,
      // Only a real RFC id, never an account scoped external id, since a wrong
      // id would read as a different message when deliveries are matched.
      rfcMessageId: message.rfcMessageId ?? null,
    }))),
    unavailableReason: null,
    attributedSenders,
  } satisfies ProcurementConversation;
}
