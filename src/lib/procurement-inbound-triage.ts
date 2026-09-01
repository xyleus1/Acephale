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

const BOUNCE = /mail delivery (sub)?system|delivery status notification|undeliverable|address not found|failure notice|recipient (address )?rejected/i;
const AUTO_REPLY = /out of (the )?office|automatic reply|auto[- ]?reply|on vacation|annual leave|currently away/i;
const WRONG_RECIPIENT = /wrong (email|address|person|department)|not the right (person|contact|address)|no longer (with|at)|please (contact|redirect|forward) (our|the)/i;

const QUESTION_LEAD = /^(what|which|when|where|who|how|can|could|would|will|do|does|did|is|are|may|should|please (confirm|advise|share|send|let)|kindly (confirm|advise|share|send))\b/i;

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
  if (BOUNCE.test(text)) return "BOUNCE";
  if (AUTO_REPLY.test(text)) return "AUTO_REPLY";
  if (WRONG_RECIPIENT.test(text)) return "WRONG_RECIPIENT";
  return supplierQuestions(body).length > 0 ? "QUESTION" : "STATEMENT";
}

export function supplierQuestions(body: string): string[] {
  const normalized = normalizeBody(body);
  if (!normalized) return [];
  const sentences = normalized
    .split(/\n|(?<=[.?!])[ \t]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && sentence.length <= 400);
  const questions = sentences.filter((sentence) => (
    sentence.endsWith("?") || QUESTION_LEAD.test(sentence)
  ));
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
