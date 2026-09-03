import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  procurementContextReplyBody,
  procurementReplyFacts,
  questionTopics,
  supplierInboundKind,
  supplierQuestions,
  triageSupplierInbound,
  type ProcurementReplyFacts,
} from "../src/lib/procurement-inbound-triage";

const FACTS: ProcurementReplyFacts = {
  material: "PCBA for a rigid mouse bite 2 piece PCB",
  quantity: 100,
  unit: "finished units",
  neededBy: "2026-10-01",
  specification: "Four layer FR-4, 1 mm thickness, 6/6 mil track and spacing.",
  destination: "Austin, Texas",
  documentNames: ["hypnodreamz order 1 doc 2.csv", "hypnodreamz order 1 doc 1.png"],
};

function classification() {
  assert.equal(supplierInboundKind("Undeliverable: RFQ", "Mail delivery subsystem"), "BOUNCE");
  assert.equal(supplierInboundKind("Automatic reply", "I am out of the office until Monday."), "AUTO_REPLY");
  assert.equal(
    supplierInboundKind("Re: RFQ", "You have the wrong department, please contact our sales team."),
    "WRONG_RECIPIENT",
  );
  assert.equal(supplierInboundKind("Re: RFQ", "What quantity do you need?"), "QUESTION");
  assert.equal(supplierInboundKind("Re: RFQ", "Thanks, we will review and revert."), "STATEMENT");
  assert.equal(supplierInboundKind("Delivery failure", "Address not found"), "BOUNCE");
  assert.equal(
    supplierInboundKind("Re: RFQ", "Unit price USD 41.20, and delivery failed inspections are re-worked at our cost."),
    "STATEMENT",
    "a supplier writing about failed inspections is not a bounce",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "The samples you sent were returned to sender by our warehouse, please resend."),
    "STATEMENT",
    "a supplier writing about a returned shipment is not a bounce",
  );
  assert.equal(
    supplierInboundKind("Returned to sender", "The address is unreachable."),
    "BOUNCE",
    "a returned mail report is still a bounce",
  );
  for (const report of [
    "Your message wasn't delivered to sales@supplier.test.",
    "Your message was not delivered.",
    "Your message hasn't been delivered because the domain does not exist.",
    "Your email has not been delivered.",
  ]) {
    assert.equal(supplierInboundKind("Re: RFQ", report), "BOUNCE", report);
  }
  assert.equal(
    supplierInboundKind("Re: RFQ", "Your email has not delivered enough detail for us to price the board."),
    "STATEMENT",
    "a supplier saying our mail lacked detail is not a bounce",
  );
}

function questionExtraction() {
  const questions = supplierQuestions([
    "Hello,",
    "What quantity are you looking for?",
    "Please confirm the delivery date.",
    "We are a full turnkey shop.",
    "> On an earlier date you wrote:",
    "> What is your target price?",
  ].join("\n"));
  assert.deepEqual(questions, [
    "What quantity are you looking for?",
    "Please confirm the delivery date.",
  ], "quoted history is excluded and statements are not treated as questions");

  const trimmed = supplierQuestions([
    "How many units do you need?",
    "On Monday, supplier wrote:",
    "What is your target price?",
  ].join("\n"));
  assert.deepEqual(trimmed, ["How many units do you need?"], "text after the quote marker is dropped");

  assert.deepEqual(questionTopics("What quantity do you need?"), ["QUANTITY"]);
  assert.deepEqual(questionTopics("What is your target price?"), ["PRICE"]);
  assert.deepEqual(questionTopics("Can you share the gerber files?"), ["DOCUMENTS"]);
  assert.deepEqual(questionTopics("Are you able to sign our NDA?"), ["LEGAL"]);
  assert.deepEqual(questionTopics("What are your payment terms?"), ["TERMS"]);
  assert.deepEqual(questionTopics("Who is your favourite band?"), ["UNKNOWN"]);
  assert.deepEqual(
    questionTopics("How are the units packaged?"),
    ["UNKNOWN"],
    "a packaging question is not answered by the stored order quantity",
  );
  assert.deepEqual(
    questionTopics("How many units do you need?"),
    ["QUANTITY"],
    "a real quantity question still resolves",
  );
  assert.deepEqual(
    questionTopics("How many layers?"),
    ["UNKNOWN"],
    "a layer count question is not answered by the stored order quantity",
  );
  assert.deepEqual(
    questionTopics("What is the next step?"),
    ["UNKNOWN"],
    "a process question is not a request for the STEP files",
  );
  assert.deepEqual(
    questionTopics("Can you send the step files?"),
    ["DOCUMENTS"],
    "a file request still resolves",
  );
  assert.deepEqual(
    questionTopics("Where is your factory located?"),
    ["UNKNOWN"],
    "a question about the supplier site is not our delivery destination",
  );
  assert.deepEqual(
    questionTopics("Where should we ship the parts?"),
    ["DESTINATION"],
    "a real destination question still resolves",
  );
  assert.deepEqual(
    questionTopics("What quantity do you need and by when?"),
    ["QUANTITY", "TIMELINE"],
    "every topic inside one sentence has to be covered before it can be answered",
  );
}

function autoAnswer() {
  const triage = triageSupplierInbound({
    subject: "Re: [RFQ 24cb31bd] PCBA",
    body: "Hello, what quantity do you need and when do you need delivery? Also which material is it?",
    facts: FACTS,
  });
  assert.equal(triage.decision, "AUTO_ANSWER");
  assert.equal(triage.unanswered.length, 0);
  assert.deepEqual(
    triage.answered.map((entry) => entry.topic),
    ["QUANTITY", "TIMELINE", "MATERIAL"],
    "every topic raised across the message is answered from the request",
  );
  assert.ok(triage.answered.some((entry) => entry.answer.includes("100 finished units")));

  const body = procurementContextReplyBody({ supplierName: "Ada", answered: triage.answered });
  assert.ok(body.startsWith("Hello Ada,"));
  assert.ok(body.includes("100 finished units"));
  assert.ok(body.trimEnd().endsWith("Derya Supply Chain"));
  assert.ok(!body.includes("\u2014"), "generated supplier text never uses an em dash");
}

function bestEffort() {
  // Best effort answers around a missing fact instead of parking the thread.
  const missingFact = triageSupplierInbound({
    subject: "Re: RFQ",
    body: "When do you need delivery?",
    facts: { ...FACTS, neededBy: null },
    bestEffort: true,
  });
  assert.equal(missingFact.decision, "AUTO_ANSWER", "a missing date is answered as not settled yet");
  assert.equal(missingFact.unanswered.length, 0);
  assert.ok(
    missingFact.answered.some((entry) => entry.answer.includes("standard lead time")),
    "the answer says what is true rather than inventing a date",
  );

  // A fallback may only restate the request. It can never put a destination, a
  // date, or a requirement on the record that the buyer never gave.
  const empty = triageSupplierInbound({
    subject: "Re: RFQ",
    body: "Where should we ship the parts, what material, and what tolerance?",
    facts: {
      material: null,
      quantity: null,
      unit: null,
      neededBy: null,
      specification: null,
      destination: null,
      documentNames: [],
    },
    bestEffort: true,
  });
  assert.equal(empty.decision, "AUTO_ANSWER");
  for (const answer of empty.answered.map((entry) => entry.answer)) {
    assert.ok(!/United States|domestic|being prepared|open to/i.test(answer), `unsupported claim: ${answer}`);
    assert.ok(/not recorded|no file is recorded/i.test(answer), `answer states what is recorded: ${answer}`);
  }

  const statement = triageSupplierInbound({
    subject: "Re: RFQ",
    body: "Thanks, we received your request and will review it.",
    facts: FACTS,
    bestEffort: true,
  });
  assert.equal(statement.decision, "AUTO_ANSWER", "a message without a question still gets a reply");

  // Commercial and legal answers commit the buyer, so they stay with the operator
  // even in best effort.
  for (const body of [
    "What is your target price for this build?",
    "What are your payment terms?",
    "Can you sign our NDA first?",
  ]) {
    const triage = triageSupplierInbound({ subject: "Re: RFQ", body, facts: FACTS, bestEffort: true });
    assert.equal(triage.decision, "NEEDS_HUMAN", `best effort never answers: ${body}`);
  }
}

function needsHuman() {
  const price = triageSupplierInbound({
    subject: "Re: RFQ",
    body: "What is your target price for this build?",
    facts: FACTS,
  });
  assert.equal(price.decision, "NEEDS_HUMAN");
  assert.equal(price.unanswered[0]!.topic, "PRICE");

  const missingFact = triageSupplierInbound({
    subject: "Re: RFQ",
    body: "When do you need delivery?",
    facts: { ...FACTS, neededBy: null },
  });
  assert.equal(missingFact.decision, "NEEDS_HUMAN", "a missing request fact is never guessed");

  const statement = triageSupplierInbound({
    subject: "Re: RFQ",
    body: "Our quote is attached with pricing valid for 30 days.",
    facts: FACTS,
  });
  assert.equal(statement.decision, "NEEDS_HUMAN");

  const wrongRecipient = triageSupplierInbound({
    subject: "Re: RFQ",
    body: "I am no longer with the company.",
    facts: FACTS,
  });
  assert.equal(wrongRecipient.decision, "NEEDS_HUMAN");

  for (const body of ["Mail delivery subsystem: address not found", "Automatic reply: out of office"]) {
    assert.equal(
      triageSupplierInbound({ subject: "Re: RFQ", body, facts: FACTS }).decision,
      "NO_REPLY_NEEDED",
    );
  }
}

function factsFromOrder() {
  const facts = procurementReplyFacts({
    material: "Custom memory foam",
    quantity: 100,
    unit: "units",
    neededBy: null,
    specification: "  Memory foam casting  ",
    requestContext: {
      logistics: { destination: "Austin, Texas" },
      procurement_context: {
        documents: [
          { name: "doc 2.stl" },
          { name: "doc 4.stl" },
        ],
      },
      company_context: {
        documents: [
          { name: "doc 2.stl" },
          { name: "company profile.pdf" },
        ],
      },
    },
  });
  assert.equal(facts.destination, "Austin, Texas");
  assert.equal(facts.specification, "Memory foam casting");
  assert.deepEqual(
    facts.documentNames,
    ["doc 2.stl", "doc 4.stl", "company profile.pdf"],
    "request-specific documents come first and repeated names are deduplicated",
  );

  const empty = procurementReplyFacts({
    material: "",
    quantity: 0,
    unit: "",
    neededBy: null,
    specification: null,
    requestContext: {},
  });
  assert.deepEqual(empty, {
    material: null,
    quantity: null,
    unit: null,
    neededBy: null,
    specification: null,
    destination: null,
    documentNames: [],
  });
}

function surfaces() {
  const route = readFileSync(
    "src/app/api/procurement/requests/[orderId]/vendors/[vendorId]/conversation/route.ts",
    "utf8",
  );
  assert.ok(route.includes("triageSupplierInbound("), "the conversation route triages the latest inbound message");
  assert.ok(route.includes("procurementReplyFacts(order)"), "triage reads facts from the tenant scoped order");
  assert.ok(
    route.includes('latest?.direction === "INBOUND"'),
    "triage runs only when the newest message is inbound",
  );

  const ui = readFileSync("src/app/dashboard/supply-os/supply-os-active-sourcing.tsx", "utf8");
  assert.ok(ui.includes("Needs your reply"), "Messages shows a needs reply notification");
  assert.ok(ui.includes("Use context answer"), "an operator can apply the context grounded answer");
  assert.ok(
    ui.includes("procurementContextReplyBody("),
    "the applied answer is built from the deterministic context answer, not a model call",
  );
  assert.ok(
    ui.includes('data-needs-human={triage.decision === "NEEDS_HUMAN"}'),
    "the notification state is distinguishable",
  );
  assert.ok(
    !ui.includes("useContextAnswer();\n    void sendReply"),
    "applying the context answer never sends without the existing confirmation gate",
  );
  assert.ok(
    ui.includes('.replace(/\\s*\\u2014\\s*/g, " - ")'),
    "the context answer subject strips the em dash the way the drafted reply subject does",
  );
}

function main() {
  classification();
  questionExtraction();
  autoAnswer();
  bestEffort();
  needsHuman();
  factsFromOrder();
  surfaces();
  console.log("Procurement inbound triage contract passed.");
}

main();
