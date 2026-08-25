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
  needsHuman();
  factsFromOrder();
  surfaces();
  console.log("Procurement inbound triage contract passed.");
}

main();
