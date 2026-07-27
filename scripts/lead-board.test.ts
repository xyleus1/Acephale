// Agent lead-board unit tests: row derivation from raw inquiries, stage chip
// mapping, live-reply rules, filters, counts, and the agent/prompt shapes.
// Run: npm run test:lead-board

import assert from "node:assert/strict";
import {
  deriveLeadBoardRow,
  leadBoardPromptLine,
  leadBoardRowForAgent,
  leadBoardStageOf,
  leadHasSingleEmail,
  matchesLeadBoardFilter,
  summarizeLeadBoard,
  type LeadBoardInquiry,
  type LeadBoardRow,
} from "../src/lib/lead-board";

const NOW = new Date("2026-07-24T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

let leadSeq = 0;

function lead(
  overrides: Partial<LeadBoardInquiry> = {},
  parsedExtra: Record<string, unknown> | null = {},
): LeadBoardInquiry {
  leadSeq += 1;
  return {
    id: `inq_${leadSeq}`,
    reference: `DRY2607${String(leadSeq).padStart(4, "0")}`,
    subject: "US lead: furniture - Oakland -> Lome",
    status: "RECEIVED",
    receivedAt: daysAgo(1),
    fromEmail: "lead@example.com",
    fromCompany: "Togo Atlantic Logistics",
    origin: "Oakland California",
    destination: "Lome Togo",
    commodity: "furniture",
    mode: null,
    targetPrice: 5000,
    targetCurrency: "USD",
    targetPriceStatus: "PROVIDED",
    parsedData: parsedExtra == null ? null : JSON.stringify({
      source: "meta-leads",
      market: "US",
      fullName: "Evrard Evrarsco",
      phone: "+12545245016",
      answers: { commercial: "Yes, commercial shipment", shipmentType: "Pallets" },
      ...parsedExtra,
    }),
    ...overrides,
  };
}

function row(
  overrides: Partial<LeadBoardInquiry> = {},
  parsedExtra: Record<string, unknown> = {},
  liveReply?: { sentAt: Date; bodyText: string | null } | null,
): LeadBoardRow {
  const derived = deriveLeadBoardRow(lead(overrides, parsedExtra), NOW, liveReply);
  assert.ok(derived, "expected a lead row");
  return derived;
}

// ── Lead detection ───────────────────────────────────────────────────────────

assert.equal(deriveLeadBoardRow(lead({}, null), NOW), null, "no parsedData -> not a lead");
assert.equal(
  deriveLeadBoardRow(lead({ parsedData: JSON.stringify({ qualification: { isMature: false } }) }), NOW),
  null,
  "manual RFQ parsedData -> not a lead",
);
assert.ok(deriveLeadBoardRow(lead(), NOW), "meta-lead parsedData -> lead row");

// ── Market + quality ─────────────────────────────────────────────────────────

assert.equal(row().market, "US");
const trRow = row({}, { market: "TR" });
assert.equal(trRow.market, "TR");
assert.equal(row().quality.tier, "GOOD", "explicit commercial shipment with contact + lane is GOOD");

// ── Stage chip mapping ───────────────────────────────────────────────────────

assert.equal(leadBoardStageOf("replied"), "replied");
assert.equal(leadBoardStageOf("awaiting"), "waiting");
assert.equal(leadBoardStageOf("final_sent"), "waiting");
assert.equal(leadBoardStageOf("stopped"), "waiting");
assert.equal(leadBoardStageOf("dropped"), "dropped");
assert.equal(leadBoardStageOf("closed"), "dropped");
assert.equal(leadBoardStageOf("desk"), "desk");
assert.equal(leadBoardStageOf("excluded"), "new");
assert.equal(leadBoardStageOf("not_started"), "new");

// ── Sequence states from stamps ──────────────────────────────────────────────

const notEmailed = row();
assert.equal(notEmailed.stage, "new");
assert.equal(notEmailed.outreach.step, 0);

const sentOne = row({}, { infoRequestSentAt: daysAgo(1).toISOString() });
assert.equal(sentOne.stage, "waiting");
assert.equal(sentOne.outreach.step, 1);

const dropped = row(
  { status: "IGNORED" },
  { infoRequestSentAt: daysAgo(14).toISOString(), leadDroppedAt: daysAgo(2).toISOString() },
);
assert.equal(dropped.stage, "dropped");

const withDesk = row({ status: "PRICING" });
assert.equal(withDesk.stage, "desk");

const booked = row({ status: "BOOKED" });
assert.equal(booked.stage, "dropped", "closed-by-desk statuses group under the dropped chip");

// ── Live reply rules (same as the cards) ─────────────────────────────────────

const replied = row(
  {},
  { infoRequestSentAt: daysAgo(3).toISOString() },
  { sentAt: daysAgo(1), bodyText: "Yes, still shipping.\n> quoted history" },
);
assert.equal(replied.stage, "replied");
assert.equal(replied.repliedAt?.getTime(), daysAgo(1).getTime());
assert.equal(replied.replyExcerpt, "Yes, still shipping.");

const staleInbound = row(
  {},
  { infoRequestSentAt: daysAgo(3).toISOString() },
  { sentAt: daysAgo(5), bodyText: "old unrelated mail" },
);
assert.equal(staleInbound.stage, "waiting", "inbound before our first email is not a reply");

const stampedReply = row(
  {},
  { infoRequestSentAt: daysAgo(3).toISOString(), leadRepliedAt: daysAgo(2).toISOString() },
);
assert.equal(stampedReply.stage, "replied", "engine stamp counts without a live message");
assert.equal(stampedReply.replyExcerpt, null);

// ── Filters ──────────────────────────────────────────────────────────────────

const freshReplied = row(
  { receivedAt: daysAgo(2) },
  { infoRequestSentAt: daysAgo(2).toISOString() },
  { sentAt: daysAgo(1), bodyText: "answering your questions" },
);
assert.ok(matchesLeadBoardFilter(freshReplied, { market: "US", stage: "replied", arrivedWithinDays: 3 }, NOW));
assert.ok(!matchesLeadBoardFilter(freshReplied, { market: "TR" }, NOW));
assert.ok(!matchesLeadBoardFilter(freshReplied, { stage: "waiting" }, NOW));
assert.ok(!matchesLeadBoardFilter(freshReplied, { quality: "WEAK" }, NOW));
assert.ok(matchesLeadBoardFilter(freshReplied, { repliedWithinDays: 2 }, NOW));
assert.ok(!matchesLeadBoardFilter(freshReplied, { repliedWithinDays: 0 }, NOW));

const oldLead = row({ receivedAt: daysAgo(10) });
assert.ok(!matchesLeadBoardFilter(oldLead, { arrivedWithinDays: 3 }, NOW));
assert.ok(!matchesLeadBoardFilter(oldLead, { repliedWithinDays: 30 }, NOW), "never-replied lead fails replied-within");

// ── Counts ───────────────────────────────────────────────────────────────────

const counts = summarizeLeadBoard([notEmailed, sentOne, dropped, withDesk, replied, staleInbound]);
assert.equal(counts.total, 6);
assert.equal(counts.byStage.new, 1);
assert.equal(counts.byStage.waiting, 2);
assert.equal(counts.byStage.dropped, 1);
assert.equal(counts.byStage.desk, 1);
assert.equal(counts.byStage.replied, 1);
assert.equal(counts.byQuality.GOOD, 6);

// ── Agent + prompt shapes ────────────────────────────────────────────────────

const agentRow = leadBoardRowForAgent(replied);
assert.equal(agentRow.reference, replied.reference);
assert.equal(agentRow.review_url, `/dashboard/rfq/${replied.id}`);
assert.equal(agentRow.stage, "replied");
assert.equal(agentRow.touches_sent, "1/4");
assert.equal(agentRow.reply_excerpt, "Yes, still shipping.");
assert.ok(agentRow.quality.startsWith("Good"), `quality summary readable: ${agentRow.quality}`);
assert.ok(agentRow.contact.includes("Evrard Evrarsco"));
assert.ok(agentRow.contact.includes("lead@example.com"));
assert.ok(agentRow.route.includes("Oakland California"));

const line = leadBoardPromptLine(sentOne);
assert.ok(line.includes(sentOne.reference));
assert.ok(line.includes("Sent 1/4"));
assert.ok(line.includes("Oakland California -> Lome Togo"));
assert.ok(line.includes("arrived 1d ago"));
assert.ok(!line.includes("—"), "no em dashes anywhere");

// ── Email shape guard ────────────────────────────────────────────────────────

assert.ok(leadHasSingleEmail("lead@example.com"));
assert.ok(!leadHasSingleEmail("a@b.com, c@d.com"), "comma lists are not a single address");
assert.ok(!leadHasSingleEmail("not-an-email"));
assert.ok(!leadHasSingleEmail(null));

console.log("lead-board.test.ts: all assertions passed");
