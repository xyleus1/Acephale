export type SupplierInboundKind =
  | "BOUNCE"
  | "AUTO_REPLY"
  | "WRONG_RECIPIENT"
  | "QUESTION"
  | "STATEMENT";

export type ProcurementReplyTopic =
  | "QUANTITY"
  | "TIMELINE"
  | "MATERIAL"
  | "SPECIFICATION"
  | "DOCUMENTS"
  | "DESTINATION"
  | "PRICE"
  | "TERMS"
  | "LEGAL"
  | "UNKNOWN";

export type ProcurementReplyFacts = {
  material: string | null;
  quantity: number | null;
  unit: string | null;
  neededBy: string | null;
  specification: string | null;
  destination: string | null;
  documentNames: string[];
};

export type AnsweredQuestion = {
  question: string;
  topic: ProcurementReplyTopic;
  answer: string;
};

export type UnansweredQuestion = {
  question: string;
  topic: ProcurementReplyTopic;
  reason: string;
};

// Commercial and legal answers commit the buyer, so best effort never covers
// them. Everything else can be answered from what the request holds, or with a
// truthful statement of what is not settled yet.
const OPERATOR_ONLY_TOPICS: ProcurementReplyTopic[] = ["PRICE", "TERMS", "LEGAL"];

export type ProcurementInboundTriage = {
  kind: SupplierInboundKind;
  decision: "AUTO_ANSWER" | "NEEDS_HUMAN" | "NO_REPLY_NEEDED";
  headline: string;
  answered: AnsweredQuestion[];
  unanswered: UnansweredQuestion[];
};

// Wording only a mail system writes, so it is bounce evidence wherever it sits.
const BOUNCE_REPORT = /mail delivery (sub)?system|delivery status notification|undeliverable|failure notice|delivery to the following recipients? failed|(your )?(message|email|mail) ((could not|couldn't|was not|wasn't) (be )?|(has not|hasn't|have not|haven't) been )(delivered|received)/i;
// Wording a supplier also writes in ordinary prose ("delivery failed
// inspections are re-worked at our cost", "the samples were returned to
// sender"), so it counts only where a mail system puts it: the subject, or the
// head of a report line.
const BOUNCE_HEADLINE = /^(re: |fwd?: )*(delivery (failure|failed|incomplete|delayed)|address not found|recipient (address )?rejected|delivery has failed|returned to sender)/i;
const AUTO_REPLY = /out of (the )?office|automatic reply|auto[- ]?reply|on vacation|annual leave|currently away/i;
// A shop stating that the RFQ reached the wrong desk, which is the evidence the
// loop needs before it moves a supplier to another address or fades the row.
// "We do not handle" only says that when it is unqualified, about the writer's
// own desk. Any qualifier under it ("we do not handle RFQs below 500 units",
// "... with quantities below 500", "... for aluminium", "... outside the EU") is
// a capability or commercial refusal from the right contact, so the clause is
// read only where the statement ends there, names the desk, or names the writer,
// rather than by listing the qualifiers a shop might use, and moving or fading a
// shop that is answering us is avoided. A line break does not end the refusal,
// since mail wraps a qualifier onto its own line as readily as anything else,
// and reading a wrapped refusal as unqualified is what would move or fade the
// shop.
const WRONG_RECIPIENT_DESK = /here\b|at all\b|any ?more\b|any longer\b|myself\b|personally\b|in (?:this|our) (?:office|department|team|role|position)\b/i;
const WRONG_RECIPIENT_STATEMENT = new RegExp(
  [
    "wrong (email|address|person|department|contact)",
    "not the right (person|contact|address|department)",
    "no longer (with|at)",
    "(i am|i'm|we are|we're) not the (right|correct) (person|contact|department)",
    "(i|we) (do not|don't) handle"
    + " (rfqs?|requests? for quotation|quote requests?|quotes?|quoting|pricing|purchasing|procurement|sourcing)"
    + `\\b(?=[ \\t]*(?:[.,;:!?)]|$|${WRONG_RECIPIENT_DESK.source}))`,
  ].join("|"),
  "i",
);
// Redirect wording is ordinary supplier prose too ("please contact our sales
// team for pricing", "please forward the Gerbers to our engineering team"), so
// on its own it says nothing about the recipient being wrong.
const WRONG_RECIPIENT_REDIRECT = /please (contact|redirect|forward|send (it|this|the rfq)|write|reach out) (to )?(our|the|him|her|them|[A-Za-z0-9._%+-]+@)/i;
// What turns a redirect into a wrong recipient: the same sentence sends the
// request away from whoever received it, either by saying so or by naming the
// address it belongs at.
const REDIRECT_EXCLUDES_RECIPIENT = /\binstead\b|rather than (me|us)|not (me|us|myself|my department)|no longer|(i am|i'm) not/i;
const NAMED_ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// One rule for whether the supplier said the RFQ reached the wrong desk, shared
// by classification and by anything that acts on it. The loop now re-sources or
// fades a wrong recipient by itself, so ambiguous redirect wording must not
// reach it: such a message stays an ordinary question or statement and is
// answered at the address that wrote it.
export function supplierWrongRecipientText(subject: string, body: string) {
  const written = `${subject}\n${supplierReplyText(body)}`;
  if (WRONG_RECIPIENT_STATEMENT.test(written)) return true;
  // A newline ends a sentence, so the address in a signature cannot stand in
  // for the address a redirect names. An address the redirect line introduces
  // with a colon is that address though, wrapped onto its own line, so such a
  // line is read together with the one under it.
  const lines = written.split(/\n|(?<=[.!?])\s+/);
  return lines.some((line, index) => {
    const sentence = /:\s*$/.test(line) ? `${line} ${lines.at(index + 1) ?? ""}` : line;
    return WRONG_RECIPIENT_REDIRECT.test(sentence)
      && (REDIRECT_EXCLUDES_RECIPIENT.test(sentence) || NAMED_ADDRESS.test(sentence));
  });
}

// Delivery reporting is the mail system speaking, so callers that only need to
// know whether a message is the supplier answering share this one rule.
export function supplierBounceText(subject: string, body: string) {
  if (BOUNCE_REPORT.test(`${subject}\n${body}`)) return true;
  if (BOUNCE_HEADLINE.test(subject.trim())) return true;
  return body.split("\n").some((line) => BOUNCE_HEADLINE.test(line.trim()));
}

const QUESTION_LEAD = /^(what|which|when|where|who|how|can|could|would|will|do|does|did|is|are|may|should|please (confirm|advise|share|send|let)|kindly (confirm|advise|share|send))\b/i;

// A supplier asks as often without a question mark as with one, so an opening
// interrogative counts too. This is the single test for whether a sentence asks
// something, shared with quote reading so a question can never be read as a
// commercial promise.
export function supplierQuestionSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  return trimmed.endsWith("?") || QUESTION_LEAD.test(trimmed);
}

const TOPIC_PATTERNS: Array<{ topic: ProcurementReplyTopic; pattern: RegExp }> = [
  { topic: "PRICE", pattern: /\b(target price|budget|price range|cost target|how much (are you|can you) pay|pricing expectation)\b/i },
  { topic: "TERMS", pattern: /\b(payment|net 30|net 60|incoterm|deposit|purchase order|po number|contract|credit|tariff|duty)\b/i },
  { topic: "LEGAL", pattern: /\b(nda|non[- ]disclosure|itar|liability|indemnif|terms and conditions|msa)\b/i },
  // Bare "units", "how many", and "volume" appear in manufacturing questions such
  // as "How many layers?" that the stored order quantity does not answer, so each
  // only counts next to a quantity cue.
  { topic: "QUANTITY", pattern: /\b(quantity|qty|(annual|order|production|build|monthly|yearly) volume|volume (per|you|do you)|how many (units|pieces|pcs|parts|boards|assemblies|sets|foams|do you need|will you (need|order))|annual usage|eau|moq|minimum order|(number|count|total) of units|units (per|per year|annually|do you need|are you (ordering|buying)))\b/i },
  { topic: "TIMELINE", pattern: /\b(lead ?time|timeline|deadline|delivery date|need(ed)? by|schedule|when do you need|by when|how soon|turnaround)\b/i },
  // "step" and "file" only mean a data pack in a file context, not in "what is
  // the next step" or "which file format do you prefer".
  { topic: "DOCUMENTS", pattern: /\b(drawing|drawings|stl|gerber|bom|bill of materials|cad|data ?pack|spec ?sheet|documentation|attachment|attachments|(step|design|source|native|3d|2d) files?|files? (attached|included|available|you (sent|shared)))\b/i },
  { topic: "MATERIAL", pattern: /\b(material|foam|resin|substrate|laminate|fr-?4|alloy|durometer|density)\b/i },
  { topic: "SPECIFICATION", pattern: /\b(spec|specification|tolerance|thickness|dimension|size|layer|finish|surface finish|mask|silkscreen|requirement)\b/i },
  // "located" alone asks where the supplier sits, which our destination fact
  // does not answer.
  { topic: "DESTINATION", pattern: /\b(ship to|shipping address|destination|deliver to|where .* (ship|deliver)|freight|delivery (address|location))\b/i },
];

// The supplier's own words only, with the quoted history of our thread cut
// away, so nothing we wrote is read back as if the supplier had said it.
export function supplierReplyText(body: string) {
  return normalizeBody(body);
}

function normalizeBody(body: string) {
  const withoutQuote = body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .split(/^\s*(?:on .{0,120}wrote:|-{2,}\s*original message\s*-{2,}|from:\s)/im)[0] ?? "";
  return withoutQuote
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export function supplierInboundKind(subject: string, body: string): SupplierInboundKind {
  const text = `${subject}\n${body}`;
  if (supplierBounceText(subject, body)) return "BOUNCE";
  if (AUTO_REPLY.test(text)) return "AUTO_REPLY";
  if (supplierWrongRecipientText(subject, body)) return "WRONG_RECIPIENT";
  return supplierQuestions(body).length > 0 ? "QUESTION" : "STATEMENT";
}

// Money and delivery wording a machine notice never carries, so a supplier
// apologising for an absence and then pricing the job is read as the supplier
// writing, not as an away notice.
const COMMERCIAL_TEXT = /(\b(usd|eur|gbp|try|cny|rmb)\s?[\d.,]|[$€£]\s?[\d.,]|[\d.,]\s?(usd|eur|gbp|try|cny|rmb)\b)|\b(unit price|total price|lead ?time|moq|minimum order|price is|we can (do|offer|supply)|our (price|cost|offer))\b/i;

// Away wording appears in ordinary supplier prose ("sorry, I was out of the
// office last week"), and skipping a message is a send safety decision, so it
// only counts where an away notice actually puts it: the subject, or the opening
// of the supplier's own text with nothing asked and nothing priced under it.
function supplierAwayNotice(subject: string, written: string) {
  if (AUTO_REPLY.test(subject)) return true;
  const opening = written.split("\n")[0] ?? "";
  if (!AUTO_REPLY.test(opening)) return false;
  return supplierQuestions(written).length === 0 && !COMMERCIAL_TEXT.test(written);
}

// An automatic notice is a machine message on the thread, not something the
// supplier wrote and not something anyone answers, so the whole procurement
// pipeline has to look past it to the message that is really owed a reply.
// Evidence is taken from the supplier's own text, never from the thread history
// quoted under it, so a reply quoting an earlier notice is still a real reply.
export function supplierInboundNotice(subject: string, body: string) {
  const written = normalizeBody(body);
  if (supplierBounceText(subject, written)) return true;
  return supplierAwayNotice(subject, written);
}

type SupplierThreadMessage = {
  direction: "INBOUND" | "OUTBOUND";
  subject?: string | null;
  body: string;
};

// The thread as the people on it wrote it, with machine notices dropped, so
// every read of who owes whom an answer sees the same messages.
export function supplierWrittenMessages<T extends SupplierThreadMessage>(
  messages: readonly T[],
): T[] {
  return messages.filter((message) => (
    message.direction !== "INBOUND"
    || !supplierInboundNotice(message.subject ?? "", message.body)
  ));
}

// The newest message on the thread that anyone actually wrote, so an out of
// office note or a bounce report landing after a supplier question does not make
// the thread look answered or make the question disappear.
export function supplierLatestWritten<T extends SupplierThreadMessage>(
  messages: readonly T[],
): T | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.direction === "INBOUND" && supplierInboundNotice(message.subject ?? "", message.body)) {
      continue;
    }
    return message;
  }
  return null;
}

// The supplier message this thread still owes an answer to, or null when the
// thread is waiting on the supplier instead.
export function supplierAwaitingMessage<T extends SupplierThreadMessage>(
  messages: readonly T[],
): T | null {
  const latest = supplierLatestWritten(messages);
  return latest && latest.direction === "INBOUND" ? latest : null;
}

export function supplierQuestions(body: string): string[] {
  const normalized = normalizeBody(body);
  if (!normalized) return [];
  const sentences = normalized
    .split(/\n|(?<=[.?!])[ \t]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && sentence.length <= 400);
  const questions = sentences.filter(supplierQuestionSentence);
  return questions.slice(0, 12);
}

export function questionTopics(question: string): ProcurementReplyTopic[] {
  const topics = TOPIC_PATTERNS
    .filter((entry) => entry.pattern.test(question))
    .map((entry) => entry.topic);
  return topics.length ? topics : ["UNKNOWN"];
}

function factAnswer(
  topic: ProcurementReplyTopic,
  facts: ProcurementReplyFacts,
): { answer: string } | { reason: string } {
  switch (topic) {
    case "QUANTITY": {
      if (facts.quantity === null) return { reason: "The stored request has no quantity." };
      const unit = facts.unit?.trim() || "units";
      return { answer: `Our current requirement is ${facts.quantity} ${unit}, and the exact ongoing volume is not fixed yet.` };
    }
    case "TIMELINE": {
      if (!facts.neededBy) return { reason: "The stored request has no required date." };
      return { answer: `We need delivery by ${facts.neededBy}.` };
    }
    case "MATERIAL": {
      if (!facts.material?.trim()) return { reason: "The stored request has no material." };
      return { answer: `The part we are sourcing is ${facts.material.trim()}.` };
    }
    case "SPECIFICATION": {
      const specification = facts.specification?.trim();
      if (!specification) return { reason: "The stored request has no specification text." };
      return { answer: `The recorded specification is: ${specification}` };
    }
    case "DOCUMENTS": {
      if (!facts.documentNames.length) return { reason: "No source document is recorded on the request." };
      return { answer: `We hold ${facts.documentNames.join(", ")} for this part and can share them on request.` };
    }
    case "DESTINATION": {
      if (!facts.destination?.trim()) return { reason: "The stored request has no destination." };
      return { answer: `Delivery destination is ${facts.destination.trim()}.` };
    }
    case "PRICE":
      return { reason: "Commercial pricing is never answered automatically." };
    case "TERMS":
      return { reason: "Commercial terms are never answered automatically." };
    case "LEGAL":
      return { reason: "Legal and compliance questions are never answered automatically." };
    default:
      return { reason: "The question does not map to a recorded request fact." };
  }
}

// Best effort keeps a supplier moving when the request does not hold the fact
// they asked for. Every line below is entailed by the request itself: it says
// only that the detail is not recorded and asks for a conditional quote, so no
// answer can put a requirement, a date, or a destination on the record that the
// buyer never stated.
function bestEffortAnswer(
  topic: ProcurementReplyTopic,
  facts: ProcurementReplyFacts,
): string | null {
  const known = facts.documentNames.length
    ? `The files recorded on this request are ${facts.documentNames.join(", ")}.`
    : "No file is recorded on this request.";
  switch (topic) {
    case "QUANTITY":
      return `${known} No further volume is recorded, so please quote this build and your price breaks.`;
    case "TIMELINE":
      return `${known} No required date is recorded, so please quote your standard lead time from order confirmation.`;
    case "MATERIAL":
      return `${known} No material is recorded beyond that, so please quote what you would run and state the assumption.`;
    case "SPECIFICATION":
      return `${known} This detail is not recorded, so please quote your standard process and state the assumption you used.`;
    case "DOCUMENTS":
      return `${known} We hold nothing further to send today, so please quote from that and list exactly what else you would need.`;
    case "DESTINATION":
      return `${known} No delivery address is recorded, so please quote ex works and add freight as a separate line.`;
    case "UNKNOWN":
      return `${known} Please tell us the specific detail you need and quote against what is there.`;
    default:
      return null;
  }
}

export function triageSupplierInbound(input: {
  subject: string | null;
  body: string;
  facts: ProcurementReplyFacts;
  bestEffort?: boolean;
}): ProcurementInboundTriage {
  const kind = supplierInboundKind(input.subject ?? "", input.body);
  if (kind === "BOUNCE") {
    return {
      kind,
      decision: "NO_REPLY_NEEDED",
      headline: "Delivery failed. Replace the supplier address instead of replying.",
      answered: [],
      unanswered: [],
    };
  }
  if (kind === "AUTO_REPLY") {
    return {
      kind,
      decision: "NO_REPLY_NEEDED",
      headline: "Automatic out of office notice. No reply is needed.",
      answered: [],
      unanswered: [],
    };
  }
  if (kind === "WRONG_RECIPIENT") {
    return {
      kind,
      decision: "NEEDS_HUMAN",
      headline: "The supplier says this is the wrong contact. Route it to the right address.",
      answered: [],
      unanswered: [{
        question: "Who should receive this request instead?",
        topic: "UNKNOWN",
        reason: "Choosing a new supplier contact is an operator decision.",
      }],
    };
  }

  const bestEffort = input.bestEffort === true;
  const questions = supplierQuestions(input.body);
  if (!questions.length && bestEffort) {
    const answer = bestEffortAnswer("UNKNOWN", input.facts);
    return {
      kind,
      decision: "AUTO_ANSWER",
      headline: "The supplier asked nothing specific, so the reply restates what we hold.",
      answered: answer
        ? [{ question: "What else do you need to quote?", topic: "UNKNOWN", answer }]
        : [],
      unanswered: [],
    };
  }
  if (!questions.length) {
    return {
      kind,
      decision: "NEEDS_HUMAN",
      headline: "The supplier replied without a question we can answer from the request. Read it and reply.",
      answered: [],
      unanswered: [{
        question: "What is the right response to this message?",
        topic: "UNKNOWN",
        reason: "No answerable question was found in the message.",
      }],
    };
  }

  const answered: AnsweredQuestion[] = [];
  const unanswered: UnansweredQuestion[] = [];
  for (const question of questions) {
    for (const topic of questionTopics(question)) {
      const resolved = factAnswer(topic, input.facts);
      if ("answer" in resolved) {
        answered.push({ question, topic, answer: resolved.answer });
        continue;
      }
      const fallback = bestEffort && !OPERATOR_ONLY_TOPICS.includes(topic)
        ? bestEffortAnswer(topic, input.facts)
        : null;
      if (fallback) {
        answered.push({ question, topic, answer: fallback });
        continue;
      }
      unanswered.push({ question, topic, reason: resolved.reason });
    }
  }

  if (unanswered.length) {
    return {
      kind,
      decision: "NEEDS_HUMAN",
      headline: unanswered.length === 1
        ? "One question needs your input before this supplier can be answered."
        : `${unanswered.length} questions need your input before this supplier can be answered.`,
      answered,
      unanswered,
    };
  }
  return {
    kind,
    decision: "AUTO_ANSWER",
    headline: answered.length === 1
      ? "The supplier question is fully covered by the recorded request."
      : "Every supplier question is fully covered by the recorded request.",
    answered,
    unanswered,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function contextDocumentNames(requestContext: Record<string, unknown>) {
  const sources = [
    record(requestContext.procurement_context),
    record(requestContext.company_context),
  ];
  const names = new Set<string>();
  for (const source of sources) {
    const documents = source?.documents;
    if (!Array.isArray(documents)) continue;
    for (const entry of documents) {
      const name = record(entry)?.name;
      if (typeof name === "string" && name.trim()) names.add(name.trim());
    }
  }
  return [...names].slice(0, 12);
}

export function procurementReplyFacts(order: {
  material: string;
  quantity: number;
  unit: string;
  neededBy: string | null;
  specification: string | null;
  requestContext: Record<string, unknown>;
}): ProcurementReplyFacts {
  const destination = record(order.requestContext.logistics)?.destination;
  return {
    material: order.material?.trim() || null,
    quantity: Number.isFinite(order.quantity) && order.quantity > 0 ? order.quantity : null,
    unit: order.unit?.trim() || null,
    neededBy: order.neededBy,
    specification: order.specification?.trim().slice(0, 2_000) || null,
    destination: typeof destination === "string" && destination.trim() ? destination.trim() : null,
    documentNames: contextDocumentNames(order.requestContext),
  };
}

export function procurementContextReplyBody(input: {
  supplierName: string | null;
  answered: AnsweredQuestion[];
}): string {
  const greetingName = input.supplierName?.trim();
  const greeting = greetingName ? `Hello ${greetingName},` : "Hello,";
  const lines = [...new Set(input.answered.map((entry) => entry.answer))];
  return [
    greeting,
    "",
    "Thank you for coming back to us. Answers below.",
    "",
    ...lines,
    "",
    "Tell us what else you need to quote and we will send it.",
    "",
    "Best,",
    "Mert",
    "Derya Supply Chain",
  ].join("\n");
}
