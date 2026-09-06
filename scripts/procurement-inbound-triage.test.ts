import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  procurementContextReplyBody,
  procurementReplyFacts,
  questionTopics,
  supplierAwaitingMessage,
  supplierInboundKind,
  supplierInboundNotice,
  supplierLatestWritten,
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
  // The loop re-sources or fades a wrong recipient by itself, so redirect
  // wording an ordinary answer also carries must not classify as one: a shop
  // pointing at its own sales desk while asking for the data pack is answered
  // where it wrote from, not moved off its address or excluded.
  assert.equal(
    supplierInboundKind("Re: RFQ", "Happy to quote. Please contact our sales team for the pricing sheet. Could you send the Gerbers?"),
    "QUESTION",
    "a redirect that does not send the request away from the recipient is an ordinary reply",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "Please contact our engineering team with the placement file."),
    "STATEMENT",
    "a redirect naming a team and nothing else never fades a supplier",
  );
  // A redirect that does send the request away is worked: it either says so, or
  // it names the address the RFQ belongs at.
  assert.equal(
    supplierInboundKind("Re: RFQ", "Please contact our quoting desk instead."),
    "WRONG_RECIPIENT",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "Please write to rfq@shop.com for this one."),
    "WRONG_RECIPIENT",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "I do not handle quoting. Thanks."),
    "WRONG_RECIPIENT",
  );
  // A shop declining the work is not a shop saying the mail reached the wrong
  // desk, so a capability refusal keeps the supplier where it is.
  assert.equal(
    supplierInboundKind("Re: RFQ", "We do not handle orders below 500 units, so we must pass on this one."),
    "STATEMENT",
    "a capability refusal is not a wrong contact",
  );
  // Named with the word the loop reads as its own work, a threshold under it
  // still makes it a refusal by the right desk, not a misdelivered mail.
  assert.equal(
    supplierInboundKind("Re: RFQ", "We do not handle RFQs below 500 units."),
    "STATEMENT",
    "a quantity threshold is a capability refusal from the right contact",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "We do not handle quoting under $5,000, sorry."),
    "STATEMENT",
    "a value threshold is a capability refusal from the right contact",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "We do not handle RFQs for orders of this size."),
    "STATEMENT",
    "an order size qualifier is a capability refusal from the right contact",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "We do not handle RFQs with quantities below 500 pieces."),
    "STATEMENT",
    "a quantity qualifier is a capability refusal from the right contact",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "We do not handle quoting for aluminium housings."),
    "STATEMENT",
    "a material qualifier is a capability refusal from the right contact",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "We do not handle procurement outside the EU."),
    "STATEMENT",
    "a geography qualifier is a capability refusal from the right contact",
  );
  // Mail wraps a qualifier onto its own line as readily as anything else, so a
  // line break is not the end of the refusal.
  assert.equal(
    supplierInboundKind("Re: RFQ", "We do not handle RFQs\nbelow 500 units, sorry."),
    "STATEMENT",
    "a qualifier wrapped onto the next line is still a capability refusal",
  );
  // The plain statement about the writer's own desk still moves the supplier.
  assert.equal(
    supplierInboundKind("Re: RFQ", "We do not handle RFQs here."),
    "WRONG_RECIPIENT",
    "a desk that does not handle RFQs at all is still a wrong contact",
  );
  for (const ending of ["myself", "personally", "in this office", "any more", "at all"]) {
    assert.equal(
      supplierInboundKind("Re: RFQ", `I do not handle RFQs ${ending}.`),
      "WRONG_RECIPIENT",
      `a definitive statement about the writer's own desk is a wrong contact: ${ending}`,
    );
  }
  // A redirect naming the desk it belongs at is read on its own evidence, so a
  // refusal that runs into the next line is not needed to move that supplier.
  assert.equal(
    supplierInboundKind("Re: RFQ", "I do not handle quoting.\nPlease write to rfq@shop.com instead."),
    "WRONG_RECIPIENT",
    "a refusal followed by a redirect is a wrong contact",
  );
  // A signature sits on its own line, so its address cannot be read as the
  // address a redirect sentence names.
  assert.equal(
    supplierInboundKind(
      "Re: RFQ",
      "Please contact our billing team about the credit application\n\nDana Reyes\nsales@shop.com",
    ),
    "STATEMENT",
    "an address in a signature does not turn a redirect into a wrong contact",
  );
  // A redirect that introduces its address with a colon still names it, even
  // wrapped onto the next line, so that supplier is re-sourced there.
  assert.equal(
    supplierInboundKind("Re: RFQ", "Please contact the following address:\nrfq@shop.com"),
    "WRONG_RECIPIENT",
  );
  assert.equal(
    supplierInboundKind("Re: RFQ", "I do not handle requests for quotation."),
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
    route.includes("supplierAwaitingMessage(conversation.messages)"),
    "triage runs on the supplier message the thread owes an answer to, notices aside",
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

// A machine notice on the thread is not a supplier message: it answers nothing
// and nobody answers it, so the question behind it is still the one owed a reply.
function awaitingMessage() {
  const question = {
    id: "in-1",
    direction: "INBOUND" as const,
    subject: "Re: RFQ",
    body: "What tolerance do you need on the board edge?",
  };
  const away = {
    id: "in-2",
    direction: "INBOUND" as const,
    subject: "Automatic reply: Re: RFQ",
    body: "I am out of the office until Monday with limited access to email.",
  };
  const bounce = {
    id: "in-3",
    direction: "INBOUND" as const,
    subject: "Undelivered Mail Returned to Sender",
    body: "Delivery to the following recipient failed permanently: 550 5.1.1 user unknown.",
  };
  const answer = {
    id: "out-1",
    direction: "OUTBOUND" as const,
    subject: "Re: RFQ",
    body: "The edge tolerance is plus or minus 0.15 mm.",
  };
  assert.equal(supplierAwaitingMessage([question, away, bounce])?.id, "in-1");
  assert.equal(supplierLatestWritten([question, away, bounce])?.id, "in-1");
  assert.equal(
    supplierAwaitingMessage([question, answer, away]),
    null,
    "a notice after our answer does not put the thread back on us",
  );
  assert.equal(supplierLatestWritten([question, answer, away])?.id, "out-1");
  assert.equal(supplierAwaitingMessage([answer]), null);
  assert.equal(supplierAwaitingMessage([]), null);
  assert.equal(
    supplierLatestWritten([away, bounce]),
    null,
    "a thread carrying nothing but notices holds no message anyone wrote",
  );
}

// Skipping a message is a send safety decision, so notice evidence is taken from
// what the supplier wrote at the top of their own text, never from ordinary prose
// mentioning an absence or from the thread history quoted underneath it.
function humanRepliesAreNotNotices() {
  const cases = [
    {
      why: "an apology for an absence is still the supplier writing",
      subject: "Re: RFQ",
      body: "Sorry for the delay, I was out of the office last week. Can you confirm the quantity?",
    },
    {
      why: "a supplier quoting the bounce we asked about is still the supplier writing",
      subject: "Re: RFQ",
      body: [
        "That address is dead, use mine instead.",
        "",
        "> Your message could not be delivered to sales@example.com",
        "> Delivery to the following recipient failed permanently",
      ].join("\n"),
    },
    {
      why: "commercial prose carrying failure wording is still the supplier writing",
      subject: "Re: RFQ",
      body: "Boards that fail delivery inspection are reworked at our cost. Unit price is USD 12.40 with a 15 day lead time.",
    },
    {
      why: "an away line above a real price is still the supplier writing",
      subject: "Re: RFQ",
      body: "I am out of the office this week but wanted to answer.\nOur price is USD 9.80 per board, lead time 12 days.",
    },
  ];
  for (const example of cases) {
    assert.equal(supplierInboundNotice(example.subject, example.body), false, example.why);
    assert.equal(
      supplierAwaitingMessage([
        { id: "in-1", direction: "INBOUND" as const, subject: example.subject, body: example.body },
      ])?.id,
      "in-1",
      example.why,
    );
  }
  const notices = [
    {
      why: "an away subject is a machine notice",
      subject: "Automatic reply: Re: RFQ",
      body: "I will return on Monday. For urgent matters contact the front desk.",
    },
    {
      why: "an away opening with nothing asked and nothing priced is a machine notice",
      subject: "Re: RFQ",
      body: "I am currently away on annual leave with no access to email.\nYour message will be read on my return.",
    },
    {
      why: "a delivery status report is a machine notice",
      subject: "Undelivered Mail Returned to Sender",
      body: "This is the mail delivery subsystem. Delivery to the following recipients failed.",
    },
  ];
  for (const example of notices) {
    assert.equal(supplierInboundNotice(example.subject, example.body), true, example.why);
  }
}

function main() {
  classification();
  awaitingMessage();
  humanRepliesAreNotNotices();
  questionExtraction();
  autoAnswer();
  bestEffort();
  needsHuman();
  factsFromOrder();
  surfaces();
  console.log("Procurement inbound triage contract passed.");
}

main();
