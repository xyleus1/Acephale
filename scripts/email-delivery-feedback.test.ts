import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/test?sslmode=require";

type Header = { name: string; value: string };

const OWN = "outreach@derya.ai";

function feedbackInput(input: { fromEmail: string; subject: string; bodyText: string; headers?: Header[] }) {
  return { ...input, headers: input.headers ?? [], ownAddresses: [OWN] };
}

const PERMANENT_DSN = feedbackInput({
  fromEmail: "mailer-daemon@googlemail.com",
  subject: "Delivery Status Notification (Failure)",
  headers: [{ name: "Content-Type", value: 'multipart/report; report-type=delivery-status; boundary="x"' }],
  bodyText: [
    "The response from the remote server was:",
    "550 5.1.1 The email account that you tried to reach does not exist.",
    "",
    "Reporting-MTA: dns; googlemail.com",
    "Final-Recipient: rfc822; buyer@acme-machining.example",
    "Action: failed",
    "Status: 5.1.1",
    "Diagnostic-Code: smtp; 550 5.1.1 The email account that you tried to reach does not exist.",
  ].join("\n"),
});

const TRANSIENT_DSN = feedbackInput({
  fromEmail: "postmaster@outlook.example",
  subject: "Delivery Status Notification (Delay)",
  bodyText: [
    "Delivery to the following recipient has been delayed:",
    "Final-Recipient: rfc822; ops@slow-mail.example",
    "Action: delayed",
    "Status: 4.4.1",
    "Diagnostic-Code: smtp; 451 4.4.1 Mailbox is full, will retry",
  ].join("\n"),
});

const GMAIL_STYLE_BOUNCE = feedbackInput({
  fromEmail: "mailer-daemon@googlemail.com",
  subject: "Delivery Status Notification (Failure)",
  bodyText: [
    "Address not found",
    "",
    "Your message wasn't delivered to purchasing@nowhere-corp.example because the address couldn't be found, or is unable to receive mail.",
  ].join("\n"),
});

const ARF_COMPLAINT = feedbackInput({
  fromEmail: "abuse@isp.example",
  subject: "Abuse report",
  headers: [{ name: "Content-Type", value: 'multipart/report; report-type=feedback-report; boundary="y"' }],
  bodyText: [
    "Feedback-Type: abuse",
    "User-Agent: SomeGenerator/1.0",
    "Version: 1",
    "Original-Rcpt-To: cfo@angry-customer.example",
    "Removal-Recipient: cfo@angry-customer.example",
  ].join("\n"),
});

// Gmail's generic Failure subject with only transient diagnostics in the body
// and no Status field.
const GENERIC_FAILURE_TRANSIENT = feedbackInput({
  fromEmail: "mailer-daemon@googlemail.com",
  subject: "Delivery Status Notification (Failure)",
  bodyText: [
    "Message blocked",
    "",
    "Your message to ops@busy-plant.example couldn't be delivered.",
    "The response from the remote server was:",
    "452 4.2.2 The recipient's mailbox is full. Try again later.",
    "Final-Recipient: rfc822; ops@busy-plant.example",
    "Action: failed",
  ].join("\n"),
});

const GENERIC_FAILURE_PERMANENT = feedbackInput({
  fromEmail: "mailer-daemon@googlemail.com",
  subject: "Delivery Status Notification (Failure)",
  bodyText: [
    "Your message to gone@closed-shop.example couldn't be delivered.",
    "The response from the remote server was:",
    "550 User unknown",
    "Final-Recipient: rfc822; gone@closed-shop.example",
    "Action: failed",
  ].join("\n"),
});

// One multipart report, two recipients: a dead address and a full mailbox.
const MIXED_DSN = feedbackInput({
  fromEmail: "mailer-daemon@relay.example",
  subject: "Delivery Status Notification (Failure)",
  headers: [{ name: "Content-Type", value: 'multipart/report; report-type=delivery-status; boundary="m"' }],
  bodyText: [
    "Delivery to the following recipients failed permanently or is still pending.",
    "",
    "Reporting-MTA: dns; relay.example",
    "",
    "Original-Recipient: rfc822; gone@dead-domain.example",
    "Final-Recipient: rfc822; gone@dead-domain.example",
    "Action: failed",
    "Status: 5.1.1",
    "Diagnostic-Code: smtp; 550 5.1.1 User unknown",
    "",
    "Original-Recipient: rfc822; ops@busy-plant.example",
    "Final-Recipient: rfc822; ops@busy-plant.example",
    "Action: delayed",
    "Status: 4.2.2",
    "Diagnostic-Code: smtp; 452 4.2.2 Mailbox full, will retry",
  ].join("\n"),
});

// Greylisting: rejection wording next to a 4.x.x code and no Status field.
const GREYLISTED_REJECTION = feedbackInput({
  fromEmail: "mailer-daemon@googlemail.com",
  subject: "Delivery Status Notification (Failure)",
  bodyText: [
    "Your message to buyer@greylist-plant.example couldn't be delivered.",
    "The response from the remote server was:",
    "451 4.7.1 <buyer@greylist-plant.example>: Recipient address rejected: Greylisted, please try again later",
    "Final-Recipient: rfc822; buyer@greylist-plant.example",
    "Action: failed",
  ].join("\n"),
});

const ARF_NOT_SPAM = feedbackInput({
  fromEmail: "feedback@isp.example",
  subject: "Feedback report",
  headers: [{ name: "Content-Type", value: 'multipart/report; report-type=feedback-report; boundary="n"' }],
  bodyText: [
    "Feedback-Type: not-spam",
    "User-Agent: SomeGenerator/1.0",
    "Version: 1",
    "Original-Rcpt-To: rescued@happy-customer.example",
  ].join("\n"),
});

// Our outbound subject carried opt-out wording; the reply keeps it as Re: and
// the recipient is interested.
const INHERITED_OPT_OUT_SUBJECT = feedbackInput({
  fromEmail: "buyer@prospect.example",
  subject: "Re: Aluminum enclosures for your device line (reply unsubscribe to opt out)",
  bodyText: [
    "Yes, please send pricing for 5,000 units to Los Angeles.",
    "",
    "On Mon, 31 Aug 2026 Derya <outreach@derya.ai> wrote:",
    "> Reply unsubscribe to opt out.",
  ].join("\n"),
});

const STANDALONE_OPT_OUT_SUBJECT = feedbackInput({
  fromEmail: "buyer@prospect.example",
  subject: "Unsubscribe",
  bodyText: "",
});

const ARF_COMPLAINT_RFC822 = feedbackInput({
  fromEmail: "abuse@isp.example",
  subject: "Abuse report",
  headers: [{ name: "Content-Type", value: 'multipart/report; report-type=feedback-report; boundary="y"' }],
  bodyText: [
    "Feedback-Type: abuse",
    "Version: 1",
    "Original-Rcpt-To: rfc822; complainer@strict-isp.example",
    "Removal-Recipient: rfc822; <complainer@strict-isp.example>",
  ].join("\n"),
});

const AUTO_REPLY = feedbackInput({
  fromEmail: "Jane.Doe@prospect.example",
  subject: "Automatic reply: Aluminum enclosures for your device line",
  headers: [{ name: "Auto-Submitted", value: "auto-replied" }],
  bodyText: "I am out of the office until 12 September with limited access to email.",
});

const OPT_OUT = feedbackInput({
  fromEmail: "buyer@prospect.example",
  subject: "Re: Aluminum enclosures for your device line",
  bodyText: [
    "Please remove me from your list, we source these internally.",
    "",
    "On Mon, 31 Aug 2026 Derya <outreach@derya.ai> wrote:",
    "> Reply STOP to opt out.",
  ].join("\n"),
});

const QUOTED_OPT_OUT_ONLY = feedbackInput({
  fromEmail: "buyer@prospect.example",
  subject: "Re: Aluminum enclosures for your device line",
  bodyText: [
    "Thanks, can you send the datasheet and MOQ?",
    "",
    "On Mon, 31 Aug 2026 Derya <outreach@derya.ai> wrote:",
    "> If this is not relevant, reply unsubscribe and we will stop emailing you.",
  ].join("\n"),
});

const ORDINARY_REPLY = feedbackInput({
  fromEmail: "buyer@prospect.example",
  subject: "Re: Aluminum enclosures for your device line",
  bodyText: "Interesting. We have a full quote cycle in October; can you deliver 5,000 units to Los Angeles by then?",
});

const ORDINARY_SUPPLIER_QUOTE = feedbackInput({
  fromEmail: "sales@supplier.example",
  subject: "RE: [RFQ 24cb31bd] Turnkey 4-layer PCBA, 100 finished units",
  bodyText: "Quote attached. Unit price USD 41.20, lead time 4 weeks, delivery failed inspections are re-worked at our cost.",
});

async function main() {
  const {
    classifyDeliveryFeedback,
    decodeStoredDeliveryFeedback,
    encodeStoredDeliveryFeedback,
    senderProtectionDecision,
    suppressionSkipMessage,
    EMAIL_SUPPRESSION_REASONS,
    SENDER_PROTECTION_MIN_SENDS,
  } = await import("../src/lib/email-delivery-feedback");
  const {
    deliveryFeedbackNeedsRecovery,
    listSuppressedEmails,
    recordDeliveryFeedback,
    recoverUnfinishedDeliveryFeedback,
    DELIVERY_FEEDBACK_RECOVERY_BATCH,
  } = await import("../src/lib/email-delivery-events");

  // Parser fixtures.
  assert.deepEqual(classifyDeliveryFeedback(PERMANENT_DSN), {
    kind: "BOUNCE",
    permanent: true,
    recipients: ["buyer@acme-machining.example"],
    detail: "smtp; 550 5.1.1 The email account that you tried to reach does not exist.",
  });
  const transient = classifyDeliveryFeedback(TRANSIENT_DSN);
  assert.equal(transient?.kind, "BOUNCE");
  assert.equal(transient?.permanent, false, "a 4.x.x delay is not a permanent bounce");
  assert.deepEqual(transient?.recipients, ["ops@slow-mail.example"]);
  const gmailStyle = classifyDeliveryFeedback(GMAIL_STYLE_BOUNCE);
  assert.equal(gmailStyle?.kind, "BOUNCE");
  assert.equal(gmailStyle?.permanent, true);
  assert.deepEqual(gmailStyle?.recipients, ["purchasing@nowhere-corp.example"], "the failed address is read from the failure line");
  const genericTransient = classifyDeliveryFeedback(GENERIC_FAILURE_TRANSIENT);
  assert.equal(genericTransient?.kind, "BOUNCE");
  assert.equal(genericTransient?.permanent, false, "a Failure subject does not outrank 4.x.x or mailbox-full diagnostics");
  assert.deepEqual(genericTransient?.recipients, ["ops@busy-plant.example"]);
  const genericPermanent = classifyDeliveryFeedback(GENERIC_FAILURE_PERMANENT);
  assert.equal(genericPermanent?.kind, "BOUNCE");
  assert.equal(genericPermanent?.permanent, true, "permanent diagnostics under a Failure subject stay permanent");
  const greylisted = classifyDeliveryFeedback(GREYLISTED_REJECTION);
  assert.equal(greylisted?.kind, "BOUNCE");
  assert.equal(greylisted?.permanent, false, "a 4.x.x code outranks 'recipient address rejected' wording");
  assert.deepEqual(greylisted?.recipients, ["buyer@greylist-plant.example"]);
  assert.deepEqual(classifyDeliveryFeedback(MIXED_DSN), {
    kind: "BOUNCE",
    permanent: true,
    recipients: ["gone@dead-domain.example"],
    detail: "smtp; 550 5.1.1 User unknown",
    transientRecipients: ["ops@busy-plant.example"],
  }, "a mixed report marks only the 5.x.x recipient permanent and keeps the 4.x.x one as transient");
  // The same two recipient groups without blank lines between them still split
  // at each Original-Recipient field.
  const runTogether = classifyDeliveryFeedback({
    ...MIXED_DSN,
    bodyText: MIXED_DSN.bodyText.split("\n").filter((line) => line.trim()).join("\n"),
  });
  assert.deepEqual(runTogether?.recipients, ["gone@dead-domain.example"]);
  assert.deepEqual(runTogether?.transientRecipients, ["ops@busy-plant.example"]);
  assert.equal(classifyDeliveryFeedback(ARF_NOT_SPAM), null, "a not-spam ARF report is not a complaint");
  assert.equal(classifyDeliveryFeedback({ ...ARF_NOT_SPAM, headers: [], subject: "Abuse report" }), null, "not-spam is not a complaint under a complaint subject either");
  const complaint = classifyDeliveryFeedback(ARF_COMPLAINT);
  assert.equal(complaint?.kind, "COMPLAINT");
  assert.equal(complaint?.permanent, true);
  assert.deepEqual(complaint?.recipients, ["cfo@angry-customer.example"]);
  assert.equal(complaint?.detail, "abuse");
  const rfc822Complaint = classifyDeliveryFeedback(ARF_COMPLAINT_RFC822);
  assert.equal(rfc822Complaint?.kind, "COMPLAINT");
  assert.deepEqual(rfc822Complaint?.recipients, ["complainer@strict-isp.example"], "ARF fields with an rfc822; prefix still name the recipient");
  const autoReply = classifyDeliveryFeedback(AUTO_REPLY);
  assert.equal(autoReply?.kind, "AUTO_REPLY");
  assert.equal(autoReply?.permanent, false);
  assert.deepEqual(autoReply?.recipients, ["jane.doe@prospect.example"]);
  const optOut = classifyDeliveryFeedback(OPT_OUT);
  assert.equal(optOut?.kind, "OPT_OUT");
  assert.deepEqual(optOut?.recipients, ["buyer@prospect.example"]);
  assert.equal(optOut?.detail, 'Recipient wrote "remove me".');
  assert.equal(classifyDeliveryFeedback(QUOTED_OPT_OUT_ONLY), null, "quoted opt-out copy from our own mail is not an opt-out");
  assert.equal(classifyDeliveryFeedback(INHERITED_OPT_OUT_SUBJECT), null, "opt-out wording inherited in a Re: subject is not the recipient's request");
  assert.equal(classifyDeliveryFeedback({ ...INHERITED_OPT_OUT_SUBJECT, subject: `FW: ${INHERITED_OPT_OUT_SUBJECT.subject}` }), null);
  const standaloneOptOut = classifyDeliveryFeedback(STANDALONE_OPT_OUT_SUBJECT);
  assert.equal(standaloneOptOut?.kind, "OPT_OUT", "a standalone recipient-authored subject still opts out");
  assert.equal(standaloneOptOut?.detail, 'Recipient wrote "Unsubscribe".');
  assert.equal(classifyDeliveryFeedback(ORDINARY_REPLY), null, "an interested reply is not delivery feedback");
  assert.equal(classifyDeliveryFeedback(ORDINARY_SUPPLIER_QUOTE), null, "the word failed inside a quote is not a bounce");

  // Own mailbox addresses are never reported as affected recipients.
  const ownOnly = classifyDeliveryFeedback(feedbackInput({
    fromEmail: "mailer-daemon@googlemail.com",
    subject: "Undeliverable: Hello",
    bodyText: `Final-Recipient: rfc822; ${OWN}\nStatus: 5.1.1`,
  }));
  assert.equal(ownOnly?.kind, "BOUNCE");
  assert.deepEqual(ownOnly?.recipients, []);

  // The stored classificationReason round-trips the parsed feedback so a
  // half-persisted row can be completed without the provider message.
  for (const fixture of [PERMANENT_DSN, TRANSIENT_DSN, MIXED_DSN, ARF_COMPLAINT, ARF_COMPLAINT_RFC822, AUTO_REPLY, OPT_OUT]) {
    const parsed = classifyDeliveryFeedback(fixture)!;
    assert.deepEqual(decodeStoredDeliveryFeedback(encodeStoredDeliveryFeedback(parsed)), parsed, `${fixture.subject} round-trips through classificationReason`);
  }
  assert.deepEqual(
    decodeStoredDeliveryFeedback(encodeStoredDeliveryFeedback({ kind: "BOUNCE", permanent: true, recipients: [], detail: "" })),
    { kind: "BOUNCE", permanent: true, recipients: [], detail: "" },
  );
  assert.equal(decodeStoredDeliveryFeedback("BOUNCE: 5.1.1 user unknown"), null, "the pre-encoding reason format is not mistaken for stored feedback");
  assert.deepEqual(
    decodeStoredDeliveryFeedback("BOUNCE permanent a@b.example: 5.1.1"),
    { kind: "BOUNCE", permanent: true, recipients: ["a@b.example"], detail: "5.1.1" },
    "rows stored before mixed reports were encoded still decode",
  );
  const mixedManyTransient = encodeStoredDeliveryFeedback({
    kind: "BOUNCE",
    permanent: true,
    recipients: ["dead@x.example"],
    detail: "550",
    transientRecipients: Array.from({ length: 40 }, (_, index) => `slow-${index}@very-long-supplier-domain-${index}.example`),
  });
  assert.ok(mixedManyTransient.length <= 500);
  const decodedMixed = decodeStoredDeliveryFeedback(mixedManyTransient);
  assert.deepEqual(decodedMixed?.recipients, ["dead@x.example"]);
  assert.ok((decodedMixed?.transientRecipients?.length ?? 0) > 0, "transient recipients are kept while they fit");
  assert.equal(decodedMixed?.detail, "550");
  assert.equal(decodeStoredDeliveryFeedback("Carrier reply about rates"), null);
  assert.equal(decodeStoredDeliveryFeedback(null), null);
  assert.ok(encodeStoredDeliveryFeedback({ kind: "COMPLAINT", permanent: true, recipients: ["a@b.example"], detail: "x".repeat(1000) }).length <= 500);
  // A recipient list larger than the storage budget still yields a decodable
  // value: whole addresses are dropped from the end, never cut in half.
  const manyRecipients = Array.from({ length: 40 }, (_, index) => `buyer-${index}@very-long-supplier-domain-${index}.example`);
  const oversized = encodeStoredDeliveryFeedback({ kind: "BOUNCE", permanent: true, recipients: manyRecipients, detail: "550 5.1.1 user unknown" });
  assert.ok(oversized.length <= 500);
  const decodedOversized = decodeStoredDeliveryFeedback(oversized);
  assert.ok(decodedOversized, "an oversized recipient list still decodes");
  assert.equal(decodedOversized.kind, "BOUNCE");
  assert.equal(decodedOversized.permanent, true);
  assert.ok(decodedOversized.recipients.length > 0 && decodedOversized.recipients.length < manyRecipients.length);
  assert.deepEqual(decodedOversized.recipients, manyRecipients.slice(0, decodedOversized.recipients.length), "stored recipients are a prefix of real affected addresses");
  assert.equal(decodedOversized.detail, "550 5.1.1 user unknown", "detail survives when the header leaves room");
  const singleHuge = encodeStoredDeliveryFeedback({ kind: "BOUNCE", permanent: true, recipients: [`${"a".repeat(600)}@x.example`], detail: "d" });
  assert.deepEqual(decodeStoredDeliveryFeedback(singleHuge), { kind: "BOUNCE", permanent: true, recipients: [], detail: "d" }, "an address that cannot fit is omitted rather than truncated");

  // Sender protection thresholds.
  assert.deepEqual(senderProtectionDecision({ sent: 100, permanentBounces: 0, complaints: 1 }), { pause: false });
  assert.equal(senderProtectionDecision({ sent: 0, permanentBounces: 0, complaints: 2 }).pause, true, "two complaints pause regardless of volume");
  assert.equal(senderProtectionDecision({ sent: SENDER_PROTECTION_MIN_SENDS - 1, permanentBounces: 9, complaints: 0 }).pause, false, "below the minimum volume bounces do not pause");
  const bounceSpike = senderProtectionDecision({ sent: 20, permanentBounces: 1, complaints: 0 });
  assert.deepEqual(bounceSpike, { pause: true, reason: "1 of 20 sends bounced (5%) in 24 hours." });
  assert.deepEqual(senderProtectionDecision({ sent: 40, permanentBounces: 1, complaints: 0 }), { pause: false });

  for (const reason of EMAIL_SUPPRESSION_REASONS) {
    assert.ok(!suppressionSkipMessage(reason).includes("\u2014"), "skip copy must not contain em dashes");
  }

  // Persistence: idempotent event, office-scoped suppression, sender pause.
  type FailurePoint = "event" | "suppression" | "protection";
  function fakeDeliveryDb(input: {
    outboundSent: number;
    outboundRecipients?: string[];
    outboundCc?: string[];
    // Outbound history of the mailbox, used to attribute unthreaded reports.
    outboundHistory?: Array<{ toEmails: string[]; ccEmails?: string[]; officeId: string }>;
    // Stored feedback rows whose deliveryKind is still null.
    pendingFeedback?: Array<{
      id: string;
      threadId: string;
      fromEmail: string;
      subject: string;
      bodyText: string;
      classificationReason: string | null;
      classificationAt?: Date | null;
      thread: { officeId: string; autoLinkSkipReason: string | null };
    }>;
  }) {
    const events = new Map<string, Record<string, unknown>>();
    const suppressions = new Map<string, Record<string, unknown>>();
    const messageUpdates: Array<Record<string, unknown>> = [];
    const accountUpdates: Array<Record<string, unknown>> = [];
    const completedFeedbackIds = new Set<string>();
    const attemptedAt = new Map<string, Date | null>(
      (input.pendingFeedback ?? []).map((row) => [row.id, row.classificationAt ?? null]),
    );
    const sweepBatches: string[][] = [];
    const failures = new Set<FailurePoint>();
    const failOnce = (point: FailurePoint) => {
      if (!failures.has(point)) return;
      failures.delete(point);
      throw new Error(`simulated ${point} failure`);
    };
    const db = {
      events,
      suppressions,
      messageUpdates,
      accountUpdates,
      attemptedAt,
      sweepBatches,
      failNextAt: (point: FailurePoint) => failures.add(point),
      emailDeliveryEvent: {
        upsert: async (args: { where: { messageId: string }; create: Record<string, unknown> }) => {
          failOnce("event");
          if (!events.has(args.where.messageId)) events.set(args.where.messageId, args.create);
          return events.get(args.where.messageId);
        },
        count: async (args: { where: { kind: string; permanent?: boolean } }) => [...events.values()]
          .filter((event) => event.kind === args.where.kind && (args.where.permanent === undefined || event.permanent === args.where.permanent))
          .length,
      },
      emailMessage: {
        updateMany: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          messageUpdates.push({ ...args.where, ...args.data });
          const pending = input.pendingFeedback?.find((row) => row.id === args.where.id);
          if (pending && args.data.deliveryKind) completedFeedbackIds.add(pending.id);
          if (pending && args.data.classificationAt instanceof Date) attemptedAt.set(pending.id, args.data.classificationAt);
          return { count: 1 };
        },
        count: async () => input.outboundSent,
        findFirst: async (args: { select: Record<string, boolean> }) => {
          if (!input.outboundRecipients) return null;
          assert.equal(args.select.ccEmails, true, "thread fallback reads copied recipients too");
          return {
            toEmails: JSON.stringify(input.outboundRecipients),
            ccEmails: input.outboundCc ? JSON.stringify(input.outboundCc) : null,
          };
        },
        findMany: async (args: {
          where: { accountId: string; direction?: string; classification?: string; deliveryKind?: null };
          orderBy?: unknown;
          take?: number;
        }) => {
          if (args.where.direction === "OUTBOUND") {
            return (input.outboundHistory ?? []).map((row) => ({
              toEmails: JSON.stringify(row.toEmails),
              ccEmails: row.ccEmails ? JSON.stringify(row.ccEmails) : null,
              thread: { officeId: row.officeId },
            }));
          }
          assert.equal(args.where.classification, "DELIVERY_FEEDBACK", "recovery sweeps stored delivery feedback only");
          assert.equal(args.where.deliveryKind, null, "recovery sweeps rows whose persistence never finished");
          assert.equal(args.take, DELIVERY_FEEDBACK_RECOVERY_BATCH, "recovery is bounded per sync");
          assert.deepEqual(
            args.orderBy,
            [{ classificationAt: { sort: "asc", nulls: "first" } }, { sentAt: "asc" }],
            "least recently attempted rows are swept first",
          );
          const batch = (input.pendingFeedback ?? [])
            .filter((row) => !completedFeedbackIds.has(row.id))
            .map((row, index) => ({ row, index, attempted: attemptedAt.get(row.id) ?? null }))
            .sort((left, right) => {
              if (left.attempted === null || right.attempted === null) {
                if (left.attempted === right.attempted) return left.index - right.index;
                return left.attempted === null ? -1 : 1;
              }
              return left.attempted.getTime() - right.attempted.getTime() || left.index - right.index;
            })
            .slice(0, args.take)
            .map(({ row }) => ({ ...row, sentAt: new Date("2026-08-30T08:00:00Z") }));
          sweepBatches.push(batch.map((row) => row.id));
          return batch;
        },
      },
      emailSuppression: {
        upsert: async (args: {
          where: { officeId_email: { officeId: string; email: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          failOnce("suppression");
          const key = `${args.where.officeId_email.officeId}:${args.where.officeId_email.email}`;
          const existing = suppressions.get(key);
          const row = existing ? { ...existing, ...args.update } : { ...args.create };
          suppressions.set(key, row);
          return row;
        },
        findMany: async (args: { where: { officeId: string; email: { in: string[] } } }) => [...suppressions.values()]
          .filter((row) => row.officeId === args.where.officeId && args.where.email.in.includes(String(row.email)))
          .map((row) => ({ email: String(row.email), reason: String(row.reason) })),
      },
      emailAccount: {
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          failOnce("protection");
          accountUpdates.push({ ...args.where, ...args.data });
          return { count: 1 };
        },
      },
    };
    return db;
  }

  const now = new Date("2026-08-31T12:00:00Z");
  const bounceDb = fakeDeliveryDb({ outboundSent: 20 });
  const bounceInput = {
    routing: { routed: true as const, officeId: "office-1" },
    accountId: "account-1",
    messageId: "message-dsn-1",
    threadId: "thread-1",
    occurredAt: now,
    source: "GMAIL" as const,
    feedback: classifyDeliveryFeedback(PERMANENT_DSN)!,
    now,
  };
  const recorded = await recordDeliveryFeedback(bounceDb as never, bounceInput);
  assert.deepEqual(recorded.suppressed, ["buyer@acme-machining.example"]);
  assert.equal(recorded.senderPaused, true, "1 permanent bounce in 20 sends crosses the 5% threshold");
  assert.equal(bounceDb.events.size, 1);
  assert.equal(bounceDb.suppressions.get("office-1:buyer@acme-machining.example")?.reason, "BOUNCED");
  assert.equal(bounceDb.suppressions.get("office-1:buyer@acme-machining.example")?.evidenceMessageId, "message-dsn-1");
  assert.equal(recorded.officeId, "office-1");
  assert.deepEqual(bounceDb.messageUpdates, [{ id: "message-dsn-1", deliveryKind: "BOUNCE" }]);
  assert.equal(bounceDb.accountUpdates.length, 1);
  assert.equal(bounceDb.accountUpdates[0].sendPausedReason, "1 of 20 sends bounced (5%) in 24 hours.");

  // A re-synced copy of the same message changes nothing.
  const again = await recordDeliveryFeedback(bounceDb as never, bounceInput);
  assert.deepEqual(again.suppressed, ["buyer@acme-machining.example"]);
  assert.equal(bounceDb.events.size, 1, "one delivery event per message");
  assert.equal(bounceDb.suppressions.size, 1, "one suppression per office and address");

  // Transient bounces are recorded but suppress nobody and never pause a sender.
  const transientDb = fakeDeliveryDb({ outboundSent: 5 });
  const transientRecorded = await recordDeliveryFeedback(transientDb as never, {
    ...bounceInput,
    messageId: "message-dsn-2",
    feedback: classifyDeliveryFeedback(TRANSIENT_DSN)!,
  });
  assert.deepEqual(transientRecorded.suppressed, []);
  assert.equal(transientRecorded.senderPaused, false);
  assert.equal(transientDb.events.size, 1);
  assert.equal(transientDb.suppressions.size, 0);
  assert.equal(transientDb.accountUpdates.length, 0);

  // A mixed report suppresses only the recipient whose own status is
  // permanent; the transient recipient stays mailable and is kept on the
  // feedback and the stored classification.
  const mixedDb = fakeDeliveryDb({ outboundSent: 5 });
  const mixedRecorded = await recordDeliveryFeedback(mixedDb as never, {
    ...bounceInput,
    messageId: "message-dsn-mixed",
    feedback: classifyDeliveryFeedback(MIXED_DSN)!,
  });
  assert.deepEqual(mixedRecorded.suppressed, ["gone@dead-domain.example"]);
  assert.equal(mixedDb.suppressions.size, 1);
  assert.equal(mixedDb.suppressions.has("office-1:ops@busy-plant.example"), false, "the 4.x.x recipient is not suppressed");
  assert.deepEqual(mixedRecorded.feedback.transientRecipients, ["ops@busy-plant.example"]);
  const mixedEvent = mixedDb.events.get("message-dsn-mixed");
  assert.equal(mixedEvent?.permanent, true);
  assert.deepEqual(JSON.parse(String(mixedEvent?.recipients)), ["gone@dead-domain.example"], "the event's permanent verdict names only the dead address");

  // A DSN naming no recipient falls back to the thread's last outbound recipients.
  const fallbackDb = fakeDeliveryDb({ outboundSent: 1, outboundRecipients: ["Someone@Target.example"] });
  const fallbackRecorded = await recordDeliveryFeedback(fallbackDb as never, {
    ...bounceInput,
    messageId: "message-dsn-3",
    feedback: { kind: "BOUNCE", permanent: true, recipients: [], detail: "5.1.1" },
  });
  assert.deepEqual(fallbackRecorded.recipients, ["someone@target.example"]);
  assert.deepEqual(fallbackRecorded.suppressed, ["someone@target.example"]);

  // The fallback covers copied recipients as well: a report for a message
  // sent to one address with another in cc attributes both.
  const ccFallbackDb = fakeDeliveryDb({
    outboundSent: 1,
    outboundRecipients: ["Someone@Target.example"],
    outboundCc: ["Copied@Partner.example"],
  });
  const ccFallbackRecorded = await recordDeliveryFeedback(ccFallbackDb as never, {
    ...bounceInput,
    messageId: "message-dsn-3-cc",
    feedback: { kind: "BOUNCE", permanent: true, recipients: [], detail: "5.1.1" },
  });
  assert.deepEqual(ccFallbackRecorded.recipients, ["someone@target.example", "copied@partner.example"]);
  assert.deepEqual(ccFallbackRecorded.suppressed, ["someone@target.example", "copied@partner.example"]);
  assert.equal(ccFallbackDb.suppressions.has("office-1:copied@partner.example"), true, "the cc recipient is suppressed by the fallback");

  // Auto-replies are recorded for visibility only.
  const autoDb = fakeDeliveryDb({ outboundSent: 1 });
  const autoRecorded = await recordDeliveryFeedback(autoDb as never, {
    ...bounceInput,
    messageId: "message-auto-1",
    feedback: classifyDeliveryFeedback(AUTO_REPLY)!,
  });
  assert.deepEqual(autoRecorded.suppressed, []);
  assert.equal(autoDb.suppressions.size, 0);
  assert.equal(autoDb.accountUpdates.length, 0);

  // Complaints suppress and two of them pause the sender.
  const complaintDb = fakeDeliveryDb({ outboundSent: 500 });
  const firstComplaint = await recordDeliveryFeedback(complaintDb as never, {
    ...bounceInput,
    messageId: "message-arf-1",
    feedback: classifyDeliveryFeedback(ARF_COMPLAINT)!,
  });
  assert.equal(firstComplaint.senderPaused, false);
  assert.equal(complaintDb.suppressions.get("office-1:cfo@angry-customer.example")?.reason, "COMPLAINED");
  const secondComplaint = await recordDeliveryFeedback(complaintDb as never, {
    ...bounceInput,
    messageId: "message-arf-2",
    feedback: { ...classifyDeliveryFeedback(ARF_COMPLAINT)!, recipients: ["other@angry-customer.example"] },
  });
  assert.equal(secondComplaint.senderPaused, true);
  assert.equal(complaintDb.accountUpdates[0].sendPausedReason, "2 spam complaints in 24 hours.");

  // Opt-outs suppress the sender of the reply.
  const optOutDb = fakeDeliveryDb({ outboundSent: 1 });
  const optOutRecorded = await recordDeliveryFeedback(optOutDb as never, {
    ...bounceInput,
    messageId: "message-reply-1",
    feedback: classifyDeliveryFeedback(OPT_OUT)!,
  });
  assert.deepEqual(optOutRecorded.suppressed, ["buyer@prospect.example"]);
  assert.equal(optOutDb.suppressions.get("office-1:buyer@prospect.example")?.reason, "OPTED_OUT");
  assert.equal(optOutDb.accountUpdates.length, 0, "opt-outs never pause a sender");

  // Persistence that fails part way leaves the message recoverable, and the
  // retry finishes the job without a second event or suppression.
  for (const point of ["event", "suppression", "protection"] as const) {
    const retryDb = fakeDeliveryDb({ outboundSent: 20 });
    retryDb.failNextAt(point);
    const retryInput = { ...bounceInput, messageId: `message-retry-${point}` };
    await assert.rejects(recordDeliveryFeedback(retryDb as never, retryInput), /simulated/);
    assert.equal(retryDb.messageUpdates.length, 0, `${point}: deliveryKind stays null when persistence fails`);
    assert.ok(
      deliveryFeedbackNeedsRecovery({ classification: "DELIVERY_FEEDBACK", deliveryKind: null }),
      `${point}: the stored message is flagged for another attempt`,
    );
    const retried = await recordDeliveryFeedback(retryDb as never, retryInput);
    assert.deepEqual(retried.suppressed, ["buyer@acme-machining.example"], `${point}: the retry suppresses`);
    assert.equal(retried.senderPaused, true, `${point}: the retry pauses the sender`);
    assert.equal(retryDb.events.size, 1, `${point}: one event after the retry`);
    assert.equal(retryDb.suppressions.size, 1, `${point}: one suppression after the retry`);
    assert.equal(retryDb.accountUpdates.length, 1, `${point}: one pause after the retry`);
    assert.deepEqual(retryDb.messageUpdates, [{ id: retryInput.messageId, deliveryKind: "BOUNCE" }]);
    assert.equal(deliveryFeedbackNeedsRecovery({ classification: "DELIVERY_FEEDBACK", deliveryKind: "BOUNCE" }), false);
  }
  assert.equal(deliveryFeedbackNeedsRecovery({ classification: null, deliveryKind: null }), false, "ordinary mail is never recovered");

  // Rows that fell out of the provider fetch window are completed from the
  // database: the encoded reason is preferred, older rows are re-parsed from
  // the stored body, and one failing row does not block the others.
  const permanentFeedback = classifyDeliveryFeedback(PERMANENT_DSN)!;
  const sweepDb = fakeDeliveryDb({
    outboundSent: 20,
    outboundHistory: [{ toEmails: ["ops@busy-plant.example"], officeId: "office-2" }],
    pendingFeedback: [
      {
        id: "message-old-1",
        threadId: "thread-old-1",
        fromEmail: "mailer-daemon@googlemail.com",
        subject: "Delivery Status Notification (Failure)",
        bodyText: "",
        classificationReason: encodeStoredDeliveryFeedback(permanentFeedback),
        thread: { officeId: "office-1", autoLinkSkipReason: null },
      },
      {
        id: "message-old-2",
        threadId: "thread-old-2",
        fromEmail: GENERIC_FAILURE_TRANSIENT.fromEmail,
        subject: GENERIC_FAILURE_TRANSIENT.subject,
        bodyText: GENERIC_FAILURE_TRANSIENT.bodyText,
        classificationReason: "BOUNCE: legacy reason without recipients",
        thread: { officeId: "office-1", autoLinkSkipReason: "UNROUTED_SHARED_MAILBOX" },
      },
      {
        id: "message-old-3",
        threadId: "thread-old-3",
        fromEmail: "someone@example.com",
        subject: "Re: quote",
        bodyText: "Thanks, attached.",
        classificationReason: "OTHER: not actually feedback",
        thread: { officeId: "office-1", autoLinkSkipReason: null },
      },
    ],
  });
  sweepDb.failNextAt("event");
  const sweepInput = {
    accountId: "account-1",
    accountEmail: OWN,
    fallbackOfficeId: "office-1",
    source: "GMAIL_IMAP" as const,
    now,
  };
  const firstSweep = await recoverUnfinishedDeliveryFeedback(sweepDb as never, sweepInput);
  assert.deepEqual(firstSweep, { pending: 3, completed: 1 }, "the failing row is skipped, the next one completes, the non-feedback row is left alone");
  assert.equal(sweepDb.events.has("message-old-1"), false, "the failed row has no event yet");
  assert.equal(sweepDb.events.get("message-old-2")?.officeId, "office-2", "an unthreaded row is attributed by outbound history, not the connecting office");
  assert.equal(sweepDb.events.get("message-old-2")?.permanent, false, "the legacy row was re-parsed from its stored body");
  assert.equal(sweepDb.suppressions.size, 0, "a transient bounce suppresses nobody");
  const secondSweep = await recoverUnfinishedDeliveryFeedback(sweepDb as never, sweepInput);
  assert.deepEqual(secondSweep, { pending: 2, completed: 1 }, "the previously failed row completes on the next sync");
  assert.equal(sweepDb.events.get("message-old-1")?.officeId, "office-1");
  assert.equal(sweepDb.events.get("message-old-1")?.occurredAt instanceof Date, true, "the event keeps the stored message time");
  assert.equal(sweepDb.suppressions.get("office-1:buyer@acme-machining.example")?.reason, "BOUNCED", "recipients come from the encoded reason, not from re-parsing an empty body");
  assert.equal(sweepDb.suppressions.get("office-1:buyer@acme-machining.example")?.evidenceMessageId, "message-old-1");
  assert.equal(sweepDb.events.size, 2);
  const thirdSweep = await recoverUnfinishedDeliveryFeedback(sweepDb as never, sweepInput);
  assert.deepEqual(thirdSweep, { pending: 1, completed: 0 }, "nothing is re-persisted once deliveryKind is set");
  assert.equal(sweepDb.events.size, 2, "the sweep never duplicates an event");
  assert.equal(sweepDb.attemptedAt.get("message-old-3")?.getTime(), now.getTime(), "a row that cannot be decoded is stamped with the attempt time");
  assert.equal(sweepDb.attemptedAt.get("message-old-1")?.getTime(), now.getTime(), "a row whose persistence failed is stamped with the attempt time");
  assert.equal(
    sweepDb.messageUpdates.filter((update) => update.id === "message-old-1").length,
    2,
    "the failed attempt is stamped, then the completing attempt sets deliveryKind",
  );

  // A full batch of rows that never finish must not keep newer feedback out
  // of the sweep forever: stamped rows go to the back, so unattempted rows
  // are picked up on the next sync.
  const poisonDb = fakeDeliveryDb({
    outboundSent: 20,
    pendingFeedback: [
      ...Array.from({ length: DELIVERY_FEEDBACK_RECOVERY_BATCH }, (_, index) => ({
        id: `poison-${index}`,
        threadId: `thread-poison-${index}`,
        fromEmail: "someone@example.com",
        subject: "Re: quote",
        bodyText: "Thanks, attached.",
        classificationReason: "OTHER: stored as feedback but nothing to decode",
        thread: { officeId: "office-1", autoLinkSkipReason: null },
      })),
      {
        id: "message-new",
        threadId: "thread-new",
        fromEmail: "mailer-daemon@googlemail.com",
        subject: "Delivery Status Notification (Failure)",
        bodyText: "",
        classificationReason: encodeStoredDeliveryFeedback(permanentFeedback),
        thread: { officeId: "office-1", autoLinkSkipReason: null },
      },
    ],
  });
  const poisonFirst = await recoverUnfinishedDeliveryFeedback(poisonDb as never, sweepInput);
  assert.deepEqual(poisonFirst, { pending: DELIVERY_FEEDBACK_RECOVERY_BATCH, completed: 0 }, "the first sync is spent on the unfinishable rows");
  assert.equal(poisonDb.sweepBatches[0].includes("message-new"), false);
  const poisonSecond = await recoverUnfinishedDeliveryFeedback(poisonDb as never, {
    ...sweepInput,
    now: new Date(now.getTime() + 60_000),
  });
  assert.equal(poisonDb.sweepBatches[1][0], "message-new", "the unattempted row is swept before the stamped ones");
  assert.equal(poisonSecond.completed, 1, "newer feedback still completes behind a batch of poison rows");
  assert.equal(poisonDb.events.get("message-new")?.officeId, "office-1");
  assert.equal(poisonDb.suppressions.get("office-1:buyer@acme-machining.example")?.reason, "BOUNCED");
  assert.equal(poisonDb.events.size, 1, "poison rows never produce an event");

  // Unthreaded reports on a shared mailbox go to the office that mailed the
  // address, not the office that connected the mailbox.
  const unrouted = { routed: false as const, fallbackOfficeId: "office-1" };
  const otherOfficeDb = fakeDeliveryDb({
    outboundSent: 20,
    outboundHistory: [{ toEmails: ["Buyer@Acme-Machining.example"], officeId: "office-2" }],
  });
  const otherOffice = await recordDeliveryFeedback(otherOfficeDb as never, {
    ...bounceInput,
    routing: unrouted,
    messageId: "message-shared-1",
  });
  assert.equal(otherOffice.officeId, "office-2", "the event belongs to the originating office");
  assert.deepEqual(otherOffice.suppressed, ["buyer@acme-machining.example"]);
  assert.equal(otherOfficeDb.suppressions.get("office-2:buyer@acme-machining.example")?.reason, "BOUNCED");
  assert.equal(otherOfficeDb.suppressions.has("office-1:buyer@acme-machining.example"), false, "the connecting office is never suppressed by proxy");
  assert.equal(otherOfficeDb.events.get("message-shared-1")?.officeId, "office-2");
  assert.equal(otherOffice.senderPaused, true, "sender protection is per mailbox and still applies");

  // A copied recipient is still this mailbox's outbound evidence.
  const ccDb = fakeDeliveryDb({
    outboundSent: 20,
    outboundHistory: [{ toEmails: ["ops@busy-plant.example"], ccEmails: ["Buyer@Acme-Machining.example"], officeId: "office-2" }],
  });
  const copied = await recordDeliveryFeedback(ccDb as never, {
    ...bounceInput,
    routing: unrouted,
    messageId: "message-shared-cc",
  });
  assert.equal(copied.officeId, "office-2", "a cc'd address attributes to the office that copied it");
  assert.equal(ccDb.suppressions.get("office-2:buyer@acme-machining.example")?.reason, "BOUNCED");

  // Two offices mailed the address: nobody is suppressed, the event is parked
  // on the connecting office for manual routing.
  const ambiguousDb = fakeDeliveryDb({
    outboundSent: 20,
    outboundHistory: [
      { toEmails: ["buyer@acme-machining.example"], officeId: "office-2" },
      { toEmails: ["buyer@acme-machining.example"], officeId: "office-3" },
    ],
  });
  const ambiguous = await recordDeliveryFeedback(ambiguousDb as never, {
    ...bounceInput,
    routing: unrouted,
    messageId: "message-shared-2",
  });
  assert.equal(ambiguous.officeId, "office-1");
  assert.deepEqual(ambiguous.suppressed, []);
  assert.equal(ambiguousDb.suppressions.size, 0, "ambiguous origin suppresses nobody");
  assert.equal(ambiguousDb.events.size, 1, "the report is still retained");
  assert.equal(ambiguous.senderPaused, true);

  // No outbound history at all: same treatment.
  const unknownDb = fakeDeliveryDb({ outboundSent: 20 });
  const unknown = await recordDeliveryFeedback(unknownDb as never, {
    ...bounceInput,
    routing: unrouted,
    messageId: "message-shared-3",
  });
  assert.equal(unknown.officeId, "office-1");
  assert.equal(unknownDb.suppressions.size, 0, "a report about an address this mailbox never wrote to suppresses nobody");
  assert.equal(unknownDb.events.size, 1);

  // Lookups normalise addresses, stay office scoped, and fail closed on unknown reasons.
  const lookupDb = fakeDeliveryDb({ outboundSent: 0 });
  lookupDb.suppressions.set("office-1:buyer@prospect.example", { officeId: "office-1", email: "buyer@prospect.example", reason: "OPTED_OUT" });
  lookupDb.suppressions.set("office-1:legacy@prospect.example", { officeId: "office-1", email: "legacy@prospect.example", reason: "SOMETHING_ELSE" });
  lookupDb.suppressions.set("office-2:other@prospect.example", { officeId: "office-2", email: "other@prospect.example", reason: "BOUNCED" });
  const lookup = await listSuppressedEmails(
    "office-1",
    [" Buyer@Prospect.example ", "legacy@prospect.example", "other@prospect.example", "not-an-email"],
    lookupDb as never,
  );
  assert.deepEqual([...lookup.entries()], [
    ["buyer@prospect.example", "OPTED_OUT"],
    ["legacy@prospect.example", "MANUAL"],
  ]);
  assert.deepEqual(await listSuppressedEmails("office-1", [], lookupDb as never), new Map());

  // Source contracts: paused mailboxes leave the sender pool but stay synced,
  // and both sync paths persist feedback before any AI classification.
  const root = process.cwd();
  const pool = readFileSync(path.join(root, "src/lib/email-account-pool.ts"), "utf8");
  const senderFilter = pool.slice(pool.indexOf("export const SHARED_SENDER_POOL_FILTER"));
  assert.match(senderFilter, /sendPausedAt: null/, "paused senders are excluded from the sender pool");
  const mailboxFilter = pool.slice(pool.indexOf("export const SHARED_MAILBOX_POOL_FILTER"), pool.indexOf("export const SHARED_SENDER_POOL_FILTER"));
  assert.doesNotMatch(mailboxFilter, /sendPausedAt/, "paused senders still sync inbound mail");
  const senderPool = readFileSync(path.join(root, "src/lib/email-sender-pool.ts"), "utf8");
  assert.match(senderPool, /where: \{\s*\.\.\.SHARED_SENDER_POOL_FILTER,/, "reservations only consider sender-pool mailboxes");
  for (const file of ["src/lib/gmail-sync.ts", "src/lib/imap-sync.ts"]) {
    const source = readFileSync(path.join(root, file), "utf8");
    assert.match(source, /classifyDeliveryFeedback\(/, `${file} classifies delivery feedback deterministically`);
    assert.match(source, /&& !deliveryFeedback\)/, `${file} skips the AI classifier for delivery feedback`);
    assert.doesNotMatch(source, /deliveryKind: deliveryFeedback\?\.kind/, `${file} leaves deliveryKind to the persistence step so failures stay recoverable`);
    assert.match(source, /routing: feedbackRouting,\s*accountId: account\.id,\s*messageId: createdMessage\.id/, `${file} records feedback with the thread routing`);
    assert.match(source, /fallbackOfficeId: account\.officeId/, `${file} passes the connecting office only as a fallback`);
    assert.match(source, /deliveryFeedbackNeedsRecovery\(existing\)/, `${file} retries unfinished feedback on resync`);
    assert.match(source, /messageId: existing\.id,\s*threadId: existing\.threadId/, `${file} recovers onto the stored message, never a duplicate`);
    assert.match(source, /encodeStoredDeliveryFeedback\(deliveryFeedback\)/, `${file} stores the parsed feedback so recovery does not need the provider message`);
    assert.match(source, /accountId: account\.id,\s*accountEmail: account\.email,\s*fallbackOfficeId: account\.officeId,/, `${file} sweeps unfinished feedback for the mailbox on every sync`);
    assert.doesNotMatch(source, /`\$\{deliveryFeedback\.kind\}: \$\{deliveryFeedback\.detail\}`/, `${file} no longer stores the unparseable reason format`);
  }
  const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.match(schema, /reason\s+String \/\/ BOUNCED \| COMPLAINED \| OPTED_OUT \| MANUAL/, "schema comment matches the persisted reasons");
  assert.match(schema, /@@unique\(\[officeId, email\]\)/, "suppressions are unique per office and address");

  console.log("Email delivery feedback checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
