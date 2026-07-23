// Outreach sequence unit tests: stage derivation, cadence math, send window,
// qualifier questions, follow-up copy. Run: npm run test:lead-outreach

import assert from "node:assert/strict";
import {
  buildLeadFollowUpContent,
  buildLeadOutreachFirstTouch,
  buildLeadRevivalContent,
  deriveOutreachState,
  leadQualifierQuestions,
  nextOutreachSend,
  replyExcerpt,
  withinOutreachSendWindow,
  type InquiryForOutreach,
} from "../src/lib/lead-outreach";
import { assessLeadQuality } from "../src/lib/lead-quality";

const NOW = new Date("2026-07-22T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

function usLead(overrides: Partial<InquiryForOutreach> = {}, parsedExtra: Record<string, unknown> = {}): InquiryForOutreach {
  return {
    origin: "Los Angeles",
    destination: "Istanbul",
    mode: null,
    commodity: "textile machinery",
    containerType: null,
    containerCount: null,
    packages: null,
    weight: null,
    volume: null,
    dimensions: null,
    cargoReadyDate: null,
    fromEmail: "lead@example.com",
    fromCompany: "Lead Person",
    parsedData: JSON.stringify({
      source: "meta-leads",
      market: "US",
      fullName: "Lead Person",
      phone: "+13100000000",
      answers: { commercial: null, shipmentType: "Pallets", timing: "within 2-4 weeks" },
      ...parsedExtra,
    }),
    ...overrides,
  };
}

function stateOf(parsedExtra: Record<string, unknown>, opts: {
  tier?: "GOOD" | "REVIEW" | "WEAK" | null;
  status?: string;
  hasValidEmail?: boolean;
  repliedAt?: Date | null;
} = {}) {
  const inq = usLead({}, parsedExtra);
  return deriveOutreachState({
    parsed: JSON.parse(inq.parsedData!),
    tier: opts.tier === undefined ? "GOOD" : opts.tier,
    status: opts.status ?? "RECEIVED",
    hasValidEmail: opts.hasValidEmail ?? true,
    now: NOW,
    repliedAt: opts.repliedAt ?? null,
  });
}

// ── Stage derivation ─────────────────────────────────────────────────────────

// Fresh eligible lead: nothing sent.
{
  const state = stateOf({});
  assert.equal(state.key, "not_started");
  assert.equal(state.step, 0);
  assert.equal(nextOutreachSend(state)?.type, "first-touch");
}

// Weak tier and missing email are excluded from the sequence.
assert.equal(stateOf({}, { tier: "WEAK" }).key, "excluded");
assert.equal(stateOf({}, { hasValidEmail: false }).key, "excluded");
assert.equal(stateOf({}, { hasValidEmail: false }).detail, "no valid email address");

// First email out 3 days ago: follow-up 2 is overdue (gap 2d).
{
  const state = stateOf({ infoRequestSentAt: daysAgo(3) });
  assert.equal(state.key, "awaiting");
  assert.equal(state.step, 1);
  assert.ok(state.nextDueAt && state.nextDueAt <= NOW);
  assert.match(state.detail ?? "", /due now/);
  assert.deepEqual(nextOutreachSend(state), { type: "follow-up", step: 2 });
}

// The legacy scope follow-up counts as an outbound for spacing: follow-up 2
// waits 2 days from IT, not from the first email.
{
  const state = stateOf({ infoRequestSentAt: daysAgo(5), scopeAskedAt: daysAgo(1) });
  assert.equal(state.key, "awaiting");
  assert.equal(state.step, 1);
  assert.ok(state.nextDueAt && state.nextDueAt > NOW);
}

// Three sent, third one 2 days ago: final notice waits for the 4-day gap.
{
  const state = stateOf({
    infoRequestSentAt: daysAgo(10),
    followUp2SentAt: daysAgo(6),
    followUp3SentAt: daysAgo(2),
  });
  assert.equal(state.key, "awaiting");
  assert.equal(state.step, 3);
  assert.ok(state.nextDueAt && state.nextDueAt > NOW);
  assert.deepEqual(nextOutreachSend(state), { type: "follow-up", step: 4 });
}

// All four out: drop timer runs (grace 4d after the final email).
{
  const state = stateOf({
    infoRequestSentAt: daysAgo(12),
    followUp2SentAt: daysAgo(9),
    followUp3SentAt: daysAgo(6),
    followUp4SentAt: daysAgo(5),
  });
  assert.equal(state.key, "final_sent");
  assert.ok(state.nextDueAt && state.nextDueAt <= NOW); // drop is due
  assert.equal(nextOutreachSend(state), null);
}

// A reply beats everything the desk has not closed - including the
// auto-drop's IGNORED status (late responders resurface).
assert.equal(stateOf({ infoRequestSentAt: daysAgo(4), leadRepliedAt: daysAgo(1) }).key, "replied");
assert.equal(
  stateOf(
    { infoRequestSentAt: daysAgo(9), leadDroppedAt: daysAgo(2), leadRepliedAt: daysAgo(1) },
    { status: "IGNORED" },
  ).key,
  "replied",
);
// ...but a desk-closed lead stays closed.
assert.equal(stateOf({ infoRequestSentAt: daysAgo(4), leadRepliedAt: daysAgo(1) }, { status: "BOOKED" }).key, "closed");

// The live (unstamped) reply signal works the same way.
assert.equal(stateOf({ infoRequestSentAt: daysAgo(4) }, { repliedAt: new Date(NOW.getTime() - DAY) }).key, "replied");

// The desk picking a lead up (any open status other than RECEIVED, incl.
// custom ones) freezes the sequence - the robot must not email a lead a
// human is already working.
{
  const state = stateOf({ infoRequestSentAt: daysAgo(5) }, { status: "PRICING" });
  assert.equal(state.key, "desk");
  assert.equal(nextOutreachSend(state), null);
}
assert.equal(stateOf({}, { status: "Detailing" }).key, "desk");

// Dropped and paused states. A fresh drop schedules the one revival email
// 30 days out; once it is sent the sequence is permanently over.
{
  const state = stateOf({ infoRequestSentAt: daysAgo(9), leadDroppedAt: daysAgo(1) }, { status: "IGNORED" });
  assert.equal(state.key, "dropped");
  assert.ok(state.nextDueAt && state.nextDueAt > NOW);
  assert.match(state.detail ?? "", /revival/);
}
{
  const state = stateOf({ infoRequestSentAt: daysAgo(40), leadDroppedAt: daysAgo(31) }, { status: "IGNORED" });
  assert.equal(state.key, "dropped");
  assert.ok(state.nextDueAt && state.nextDueAt <= NOW); // revival is due
}
{
  const state = stateOf(
    { infoRequestSentAt: daysAgo(40), leadDroppedAt: daysAgo(35), revivalSentAt: daysAgo(2) },
    { status: "IGNORED" },
  );
  assert.equal(state.key, "dropped");
  assert.equal(state.nextDueAt, null);
  assert.match(state.detail ?? "", /revival sent/);
}
{
  const state = stateOf({ infoRequestSentAt: daysAgo(9), sequenceStoppedAt: daysAgo(1) });
  assert.equal(state.key, "stopped");
  assert.equal(nextOutreachSend(state), null);
}

// ── Send window (America/Los_Angeles, 07:00-19:00) ──────────────────────────

assert.equal(withinOutreachSendWindow(new Date("2026-07-22T15:00:00Z")), true); // 08:00 PDT
assert.equal(withinOutreachSendWindow(new Date("2026-07-22T05:00:00Z")), false); // 22:00 PDT (prev day)
assert.equal(withinOutreachSendWindow(new Date("2026-07-23T02:30:00Z")), false); // 19:30 PDT

// ── Qualifier questions (Review tier only) ───────────────────────────────────

// Unanswered commercial + no real company: both questions, English.
{
  const inq = usLead();
  assert.equal(assessLeadQuality(inq).tier, "REVIEW");
  const questions = leadQualifierQuestions(inq, "REVIEW");
  assert.equal(questions.length, 2);
  assert.match(questions[0], /commercial \(business\) shipment/);
  assert.match(questions[1], /company name/);
}

// An explicit "no, individual" answer is respected - only the company ask.
{
  const inq = usLead({}, { answers: { commercial: "no, individual shipment." } });
  const questions = leadQualifierQuestions(inq, "REVIEW");
  assert.equal(questions.length, 1);
  assert.match(questions[0], /company name/);
}

// A real company answer suppresses the company ask.
{
  const inq = usLead({ fromCompany: "Acme Textiles LLC" });
  const questions = leadQualifierQuestions(inq, "REVIEW");
  assert.equal(questions.length, 1);
  assert.match(questions[0], /commercial/);
}

// Good and Weak tiers never get qualifiers.
assert.deepEqual(leadQualifierQuestions(usLead(), "GOOD"), []);
assert.deepEqual(leadQualifierQuestions(usLead(), "WEAK"), []);

// ── First touch + follow-up copy ─────────────────────────────────────────────

// Review first touch: qualifier questions lead the bullet list, scope/customs
// still included, and it is an info-request (never a processing promise).
{
  const inq = usLead();
  const email = buildLeadOutreachFirstTouch(inq, "REVIEW");
  assert.equal(email.kind, "info-request");
  const commercialIdx = email.text.indexOf("commercial (business) shipment");
  const scopeIdx = email.text.indexOf("port-to-port");
  assert.ok(commercialIdx > -1 && scopeIdx > -1 && commercialIdx < scopeIdx);
}

// Follow-ups thread as replies, re-ask what is still missing, and step 4 is
// the break-up. No em dashes anywhere (house rule).
{
  const inq = usLead();
  for (const step of [2, 3, 4] as const) {
    const fu = buildLeadFollowUpContent(inq, "REVIEW", step);
    assert.ok(fu.subject.startsWith("Re: "), `step ${step} threads onto the first email`);
    assert.ok(!fu.text.includes("\u2014") && !fu.subject.includes("\u2014"), `step ${step} has no em dashes`);
    assert.match(fu.text, /Oğuzhan Karaca/);
  }
  assert.match(buildLeadFollowUpContent(inq, "REVIEW", 2).text, /commercial \(business\) shipment/);
  assert.match(buildLeadFollowUpContent(inq, "REVIEW", 3).text, /6 hours/);
  const breakup = buildLeadFollowUpContent(inq, "REVIEW", 4).text;
  assert.match(breakup, /closing your quote request/);
  assert.match(breakup, /just reply/i);
}

// Turkish market leads get Turkish follow-ups.
{
  const inq = usLead({}, { market: "TR" });
  const fu = buildLeadFollowUpContent(inq, "REVIEW", 2);
  assert.match(fu.text, /Merhaba/);
  assert.match(fu.text, /hatırlatma/);
}

// The day-30 revival email: threads onto the original conversation, reads as
// a low-pressure "still shipping?", both languages, no em dashes.
{
  const revival = buildLeadRevivalContent(usLead());
  assert.ok(revival.subject.startsWith("Re: "));
  assert.match(revival.text, /back on the agenda/);
  assert.match(revival.text, /textile machinery/);
  assert.ok(!revival.text.includes("\u2014") && !revival.subject.includes("\u2014"));
  const revivalTr = buildLeadRevivalContent(usLead({}, { market: "TR" }));
  assert.match(revivalTr.text, /Merhaba/);
  assert.match(revivalTr.text, /yeniden gündemdeyse/);
  assert.ok(!revivalTr.text.includes("\u2014"));
}

// ── Reply excerpt ────────────────────────────────────────────────────────────

assert.equal(
  replyExcerpt("Yes it is commercial cargo.\n\nOn Tue, 21 Jul 2026 rfq@usederya.com wrote:\n> Hi,\n> Thanks for your request"),
  "Yes it is commercial cargo.",
);
assert.equal(replyExcerpt(null), null);
assert.equal(replyExcerpt("> only quoted\n> lines"), null);
assert.ok(replyExcerpt("x".repeat(500))!.length <= 241);

console.log("lead-outreach tests passed");
