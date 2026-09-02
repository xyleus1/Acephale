import { supplierQuestionSentence, supplierReplyText } from "@/lib/procurement-inbound-triage";

// A supplier answer only becomes a quote when it carries commercial facts we
// can act on. Reading is deterministic and quotes the supplier's own sentence
// as evidence, so a recorded price is always traceable to what was written and
// never inferred by a model.

export type SupplierQuoteMoney = {
  amount: number;
  currency: string;
};

export type SupplierQuoteReading = {
  unitPrice: SupplierQuoteMoney | null;
  totalPrice: SupplierQuoteMoney | null;
  quantity: number | null;
  minimumOrderQuantity: number | null;
  leadTimeDays: number | null;
  // The supplier sentences each fact was read from, in reading order.
  evidence: string[];
  // A price plus a lead time is what a purchase order needs, so anything less
  // stays a partial reading that never counts as a quote.
  complete: boolean;
  // The supplier withdrew, expired, or retracted what they said before, so
  // nothing older than this message may be treated as current.
  withdrawsEarlier: boolean;
  // Amounts this message refuses, held as "CURRENCY amount", so an older reply
  // may not restore a price the supplier has since turned down.
  refusedPrices: string[];
  // The supplier refused their own price and named no replacement, so no older
  // price stands even though this message states none.
  retractsPrice: boolean;
};

const CURRENCY_CODES: Record<string, string> = {
  usd: "USD",
  "us$": "USD",
  dollar: "USD",
  dollars: "USD",
  eur: "EUR",
  euro: "EUR",
  euros: "EUR",
  gbp: "GBP",
  pound: "GBP",
  pounds: "GBP",
  try: "TRY",
  tl: "TRY",
  cad: "CAD",
  aud: "AUD",
  chf: "CHF",
  cny: "CNY",
  rmb: "CNY",
  inr: "INR",
  jpy: "JPY",
  sek: "SEK",
  pln: "PLN",
  "$": "USD",
  "\u20ac": "EUR",
  "\u00a3": "GBP",
  "\u20ba": "TRY",
  "\u20b9": "INR",
  "\u00a5": "JPY",
};

// A currency code is a word of its own, so the letters may not be borrowed from
// a longer word: the "TL" inside "STL 2" prices nothing.
const CURRENCY_BEFORE = "(?<![A-Za-z])(?:us\\$|\\$|\\u20ac|\\u00a3|\\u20ba|\\u20b9|\\u00a5|usd|eur|gbp|try|tl|cad|aud|chf|cny|rmb|inr|jpy|sek|pln)";
const CURRENCY_AFTER = "(?:usd|eur|gbp|try|tl|cad|aud|chf|cny|rmb|inr|jpy|sek|pln|dollars?|euros?|pounds?)(?![A-Za-z])";
// Grouped thousands need at least one group of three, otherwise the plain form
// reads the whole number. Without that, 1250 would be truncated to 125.
const AMOUNT = "\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,4})?";

const MONEY = new RegExp(
  `(?:(${CURRENCY_BEFORE})\\s*(${AMOUNT})|(${AMOUNT})\\s*(${CURRENCY_AFTER}))`,
  "gi",
);

// A denominator only makes a unit price when it is a unit: "$100 per order"
// and "$400 per shipment" price the whole job, not the piece.
const UNIT_PRICE_CUE = /\b(?:per|\/)\s*(?:unit|piece|pc|pcs|pce|part|board|assembly|panel|set|ea|item)\b|\b(?:each|apiece)\b|\bunit price\b|\bprice per (?:unit|piece|pc|pcs|part|board|assembly|panel|set|item)\b|\bea\.\b/i;
const TOTAL_PRICE_CUE = /\b(total|lot price|order value|extended price|grand total|all in|altogether|for the (whole|entire|full) (lot|order|batch|run|quantity))\b/i;
const LEAD_TIME_CUE = /\b(lead ?time|delivery|deliver|ship(?:ping|ment|s|ped)?|turnaround|turn ?around|dispatch|ready|eta|production time|build time|after (?:order|po|payment|approval))\b/i;
const QUANTITY_CUE = /\b(?:for|at|qty|quantity|based on|assuming)\s*(?:a\s+)?(?:quantity\s+of\s+)?(\d{1,3}(?:[.,]\d{3})*|\d+)\s*(?:units?|pcs?|pieces?|parts?|boards?|assemblies|sets?|off)?\b/i;
const MOQ_CUE = /\b(?:moq|minimum order(?: quantity)?|min(?:imum)? (?:order|qty|quantity))\b[^\d]{0,20}(\d{1,3}(?:[.,]\d{3})*|\d+)/i;
const DURATION = /(\d{1,3})\s*(?:-|to|\u2013|\u2014)?\s*(\d{1,3})?\s*(business |working |calendar )?(day|days|week|weeks|month|months)\b/i;

// A supplier taking back an earlier offer states it plainly. Nothing older than
// such a message is current, even when the withdrawal names no new number.
const WITHDRAWN = /\b(withdraw(?:n|ing|s)?|retract(?:ed|ing|s)?|no longer (?:valid|available|able|holds?|stands?)|has expired|is expired|expired on|void|disregard|please ignore|supersed(?:e|es|ed)|cancel(?:led|ling)? (?:our|the) (?:quote|offer|pricing)|not able to hold)\b/i;

// A supplier asking what our budget is has quoted nothing, but the question
// binds its own clause, so a firm offer stated beside it still records.
const BUYER_TARGET = /\b(target price|your budget|budget|price range|how much|what (?:price|are you paying))\b/i;

// A disclaimer governs every amount in the sentence it is written in, wherever
// it sits, because a supplier calling their numbers indicative disclaims all of
// them: "indicative only, unit price is $15 per board" offers no price.
const DISCLAIMED = /\b(indicative only|ballpark|for reference only|not (?:a|our) quote|tooling cost estimate is not)\b/i;

// Three digits after a single separator are thousands in "1,240" and decimals
// in "0.125", and what tells them apart is the integer part: a supplier writing
// a fraction of a currency unit leads with a zero, while a grouped thousand
// never does. A separator with any other number of trailing digits is a
// decimal point.
function groupsThousands(amount: string, separatorAt: number) {
  if (amount.length - separatorAt - 1 !== 3) return false;
  const whole = amount.slice(0, separatorAt);
  return whole.length > 0 && whole.length <= 3 && !whole.startsWith("0");
}

// Repeated separators of one kind are grouping and nothing else, because a
// number holds a single decimal point: "1,234,567" and "1.234.567" are both
// the same million.
const GROUPED_BY_COMMA = /^\d{1,3}(?:,\d{3})+$/;
const GROUPED_BY_DOT = /^\d{1,3}(?:\.\d{3})+$/;

function normalizeAmount(raw: string) {
  const trimmed = raw.trim();
  const lastComma = trimmed.lastIndexOf(",");
  const lastDot = trimmed.lastIndexOf(".");
  let normalized = trimmed;
  if (GROUPED_BY_COMMA.test(trimmed) && trimmed.indexOf(",") !== lastComma) {
    normalized = trimmed.split(",").join("");
  } else if (GROUPED_BY_DOT.test(trimmed) && trimmed.indexOf(".") !== lastDot) {
    normalized = trimmed.split(".").join("");
  } else if (lastComma >= 0 && lastDot >= 0) {
    // The rightmost separator is the decimal point, so the other one groups
    // thousands, which covers both 1,234.56 and 1.234,56.
    const decimal = lastComma > lastDot ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    normalized = trimmed.split(grouping).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    normalized = groupsThousands(trimmed, lastComma)
      ? trimmed.split(",").join("")
      : trimmed.replace(",", ".");
  } else if (lastDot >= 0) {
    normalized = groupsThousands(trimmed, lastDot)
      ? trimmed.split(".").join("")
      : trimmed;
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function currencyOf(token: string | undefined) {
  if (!token) return null;
  return CURRENCY_CODES[token.trim().toLowerCase()] ?? null;
}

// Where an amount sits in the sentence is what tells a unit price from freight,
// tooling, or tax, so each amount keeps its position.
type PositionedMoney = SupplierQuoteMoney & { index: number };

function moneyIn(sentence: string): PositionedMoney[] {
  const found: PositionedMoney[] = [];
  for (const match of sentence.matchAll(MONEY)) {
    const currency = currencyOf(match[1]) ?? currencyOf(match[4]);
    const amount = normalizeAmount(match[2] ?? match[3] ?? "");
    if (!currency || amount === null || match.index === undefined) continue;
    found.push({ amount, currency, index: match.index });
  }
  return found;
}

// A supplier lists several commercial facts in one sentence, and each one lives
// in its own clause: "freight $80, unit price $12.40" or "$14.00 per board plus
// $900 tooling". Reading clause by clause is what keeps a fee, a tax, or a
// validity period from being taken for the fact its neighbour labels.
function clausesOf(sentence: string) {
  // A comma inside a grouped amount is part of the number, not a clause break,
  // so "$1,240" stays one amount instead of becoming "$1" and "240".
  return sentence.split(/(?<!\d),|,(?!\d{3}(?!\d))|;|\bplus\b|\band\b|\bwhile\b|\bwhereas\b|\bexcluding\b|\bexcl\.?\b|\bwith\b/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

// Freight, tooling, tax, or a similar add on is a charge on top of a price and
// never the price itself, so an amount in such a clause is never a quote.
const ANCILLARY_CHARGE = /\b(freight|shipping|carriage|courier|postage|tooling|tool|mould?|mold|die|setup|set ?up|nre|amortiz\w+|tax|taxes|vat|gst|duty|duties|customs|tariff|insurance|warranty|stencil|fixture|jig|sample charge|expedit\w+|rush fee|surcharge|handling|bank (?:fee|charge)|deposit)\b/i;

// A price a buyer can act on is named as one, which is what separates it from a
// bare number the supplier never called a price.
const PRICE_WORD = /\b(price[ds]?|pricing|quote[ds]?|quotation|cost[s]?|rate|amounts? to|comes to|works out to)\b/i;

// A supplier who refuses an amount has not offered it, so "we cannot offer $10
// per unit" carries no price. The refusal binds its own clause only, so a
// replacement price named later in the same sentence still counts.
const REFUSED_PRICE = /\b(cannot|can ?not|can't|unable to|not able to|will not|won't|no way to|not possible|not workable|not feasible|nowhere near|below (?:our )?cost|declin\w+|reject\w+)\b/i;

// An adversative turn changes who owns the amounts around it: "we cannot meet
// $10 but we can do $12.50" offers the second amount, while "$10 per unit,
// but we cannot commit to that price" takes back the first.
const ADVERSATIVE = /\bbut\b|\bhowever\b|\balthough\b|\bthough\b|\binstead\b/i;

// A refusal only reaches back to an amount already named when it points at it,
// either by referring to it or by repeating it. That is what separates "but we
// cannot commit to that price" from "but we cannot ship before June", which
// refuses a delivery date and leaves the price standing.
const REFUSAL_REFERS_BACK = /\b(that|this|these|those|it|them|the (?:above|quoted|stated|same))\b|\bhonou?r\b|\bcommit\b|\bhold\b/i;

function amountKeysOf(text: string) {
  return new Set(moneyIn(text).map((entry) => `${entry.currency} ${entry.amount}`));
}

// A later turn takes back an earlier amount when it refuses, names no amount
// the earlier turn did not already name, and either points back at what was
// said or repeats the very amount it refuses. A later turn naming a new amount
// is a counter offer, so it replaces the refused one rather than voiding it.
function retractsEarlier(later: string, earlier: Set<string>) {
  if (!REFUSED_PRICE.test(later)) return false;
  const named = amountKeysOf(later);
  for (const amount of named) {
    if (!earlier.has(amount)) return false;
  }
  return named.size > 0 || REFUSAL_REFERS_BACK.test(later);
}

function offeredTurnsOf(sentence: string) {
  const turns = sentence.split(ADVERSATIVE)
    .map((turn) => turn.trim())
    .filter((turn) => turn.length > 0);
  return turns.filter((turn, index) => {
    const named = amountKeysOf(turn);
    return !turns.slice(index + 1).some((later) => retractsEarlier(later, named));
  });
}

// A clause may only be read for a price when it names neither an add on charge
// nor a refusal, which is what keeps freight, tooling, tax, and a price the
// supplier turned down out of every reading.
function priceClausesOf(sentence: string) {
  return offeredTurnsOf(sentence)
    .flatMap((turn) => clausesOf(turn))
    .filter((clause) => (
      !ANCILLARY_CHARGE.test(clause)
      && !REFUSED_PRICE.test(clause)
      && !BUYER_TARGET.test(clause)
    ));
}

// A bare amount is only the lot price when its own clause calls it a price and
// names no add on charge, so "for 100 units, freight is $80" stays priceless.
function bareLotPrice(sentence: string): SupplierQuoteMoney | null {
  const priced = priceClausesOf(sentence)
    .map((clause) => (PRICE_WORD.test(clause) ? moneyIn(clause) : []))
    .filter((money) => money.length > 0);
  // A supplier who prices several named components in one breath, "PCB cost is
  // 132usd, assembly cost is 456usd, components cost is 3520usd", has given a
  // breakdown rather than a lot price, and any single line of it understates
  // what the order costs, so nothing is read as the total.
  if (priced.length !== 1) return null;
  const money = priced[0];
  const dearest = money.reduce((high, entry) => (entry.amount > high.amount ? entry : high), money[0]);
  return { amount: dearest.amount, currency: dearest.currency };
}

// A duration a supplier attaches to a warranty, a price validity, or payment
// terms is not a delivery promise, even when the clause also names delivery:
// "delivery includes a 12 month warranty" promises no 360 day lead time.
const NON_DELIVERY_DURATION = /\b(warrant\w+|guarantee[ds]?|valid(?:ity)?|expir\w+|payment terms?|net|credit terms?|shelf life|storage|retention|nda|contract term)\b/i;

function leadTimeDaysInClause(sentence: string) {
  if (!LEAD_TIME_CUE.test(sentence)) return null;
  if (NON_DELIVERY_DURATION.test(sentence)) return null;
  const match = DURATION.exec(sentence);
  if (!match) return null;
  const low = Number(match[1]);
  const high = match[2] ? Number(match[2]) : low;
  const upper = Math.max(low, high);
  if (!Number.isFinite(upper) || upper <= 0) return null;
  const unit = match[4].toLowerCase();
  const business = (match[3] ?? "").trim().toLowerCase();
  const days = unit.startsWith("week")
    ? upper * 7
    : unit.startsWith("month")
      ? upper * 30
      : business === "business" || business === "working"
        ? Math.ceil(upper * 7 / 5)
        : upper;
  // A lead time longer than a year in a sentence is a version number or a
  // price mistaken for a duration, not a delivery promise.
  return days > 0 && days <= 400 ? days : null;
}

// A duration only counts when it sits in the same clause as the delivery cue,
// so "price valid 30 days, lead time 2 weeks" reads as two weeks.
function leadTimeDaysIn(sentence: string) {
  for (const clause of clausesOf(sentence)) {
    const days = leadTimeDaysInClause(clause);
    if (days !== null) return days;
  }
  return null;
}

function countIn(sentence: string, pattern: RegExp) {
  const match = pattern.exec(sentence);
  if (!match?.[1]) return null;
  const value = Number(match[1].split(",").join("").split(".").join(""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

// A cue labels the amount written in the same clause, so freight, tooling,
// setup, or tax stated alongside a unit price is never read as that price.
function labelledPrice(sentence: string, cue: RegExp): SupplierQuoteMoney | null {
  for (const clause of priceClausesOf(sentence)) {
    if (!cue.test(clause)) continue;
    const money = moneyIn(clause);
    if (!money.length) continue;
    const at = cue.exec(clause)?.index ?? 0;
    const closest = money.reduce((best, entry) => (
      Math.abs(entry.index - at) < Math.abs(best.index - at) ? entry : best
    ), money[0]);
    return { amount: closest.amount, currency: closest.currency };
  }
  return null;
}

// A reply subject is usually our own RFQ line quoted back, so an RFQ naming a
// target price must never be read as the supplier's price. What tells the two
// apart is the subject we sent: a heading that matches one of ours once the
// reply prefixes are stripped carries no supplier words, while a heading the
// supplier rewrote is theirs and may carry a price or a lead time.
const REPLY_PREFIXES = /^(?:\s*(?:re|aw|fw|fwd|sv|vs|antwort)\s*(?:\[\d+\])?\s*:\s*)+/i;

function headingKey(subject: string) {
  return subject
    .replace(REPLY_PREFIXES, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Our own heading is read for a withdrawal alone, which can only take an older
// offer back, never make an offer. A subject of unknown provenance is treated
// as ours, because recording a price nobody offered is the worse mistake.
function supplierHeading(subject: string | null, ourSubjects: string[]) {
  const heading = (subject ?? "").trim();
  if (!heading) return "";
  const key = headingKey(heading);
  if (!key) return "";
  const ours = ourSubjects.some((sent) => headingKey(sent) === key);
  return ours ? "" : heading;
}

function sentencesOf(subject: string | null, body: string, ourSubjects: string[]) {
  const heading = (subject ?? "").trim();
  const written = supplierHeading(subject, ourSubjects);
  const read = written || (WITHDRAWN.test(heading) ? heading : "");
  // A heading is a statement of its own, so it ends in a sentence break that
  // keeps it from running into the first line of the body.
  const text = `${read}\n${supplierReplyText(body)}`;
  return text
    .split(/\n|(?<=[.?!;])[ \t]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && sentence.length <= 400);
}

// A withdrawal ends with its own clause, so what a supplier writes after that
// boundary is a fresh statement rather than part of what was taken back:
// "our quote is withdrawn, unit price is now $8.10" replaces instead of erasing.
const CLAUSE_BREAK = /[,;:]|\band\b|\bbut\b|\bhowever\b|\binstead\b/i;

function afterWithdrawal(sentence: string) {
  const withdrawal = WITHDRAWN.exec(sentence);
  if (!withdrawal) return "";
  const rest = sentence.slice(withdrawal.index + withdrawal[0].length);
  const boundary = CLAUSE_BREAK.exec(rest);
  return boundary ? rest.slice(boundary.index + boundary[0].length).trim() : "";
}

// A refusal reaches back into the thread: an amount the supplier turns down may
// not be restored from an older reply, and a refusal aimed at their own price
// with no replacement leaves no price standing at all. A refusal about freight,
// a date, or another term touches no price.
function readRefusals(sentence: string, reading: SupplierQuoteReading) {
  for (const turn of sentence.split(ADVERSATIVE)) {
    for (const clause of clausesOf(turn)) {
      if (!REFUSED_PRICE.test(clause) || ANCILLARY_CHARGE.test(clause)) continue;
      const named = amountKeysOf(clause);
      for (const amount of named) reading.refusedPrices.push(amount);
      if (named.size) continue;
      if (REFUSAL_REFERS_BACK.test(clause) && PRICE_WORD.test(clause)) {
        reading.retractsPrice = true;
      }
    }
  }
}

function dropStandingPrices(reading: SupplierQuoteReading) {
  reading.unitPrice = null;
  reading.totalPrice = null;
}

function dropRefusedPrice(reading: SupplierQuoteReading, refused: string) {
  const key = (price: SupplierQuoteMoney | null) => (
    price ? `${price.currency} ${price.amount}` : null
  );
  if (key(reading.unitPrice) === refused) reading.unitPrice = null;
  if (key(reading.totalPrice) === refused) reading.totalPrice = null;
}

// A supplier who states a fact twice in one message means the later one, the
// same way a later message supersedes an earlier one, so a correction written
// further down replaces what it corrects.
function readSentenceFacts(
  sentence: string,
  reading: SupplierQuoteReading,
  evidence: Set<string>,
) {
  const retractedBefore = reading.retractsPrice;
  const refusedBefore = reading.refusedPrices.length;
  readRefusals(sentence, reading);
  // A refusal reaches back over the whole message, not only over older ones, so
  // a price this sentence takes back stops standing even when the supplier
  // wrote it a sentence earlier. A replacement stated after the refusal is read
  // below and stands on its own.
  if (reading.retractsPrice && !retractedBefore) dropStandingPrices(reading);
  for (const refused of reading.refusedPrices.slice(refusedBefore)) {
    dropRefusedPrice(reading, refused);
  }
  // A question states nothing, so it carries neither a promise nor an offer:
  // "can you accept delivery in three weeks" is not a lead time any more than
  // it is a price, question mark or not.
  if (supplierQuestionSentence(sentence)) return;
  const leadTimeDays = leadTimeDaysIn(sentence);
  if (leadTimeDays !== null) {
    reading.leadTimeDays = leadTimeDays;
    evidence.add(sentence);
  }
  const moq = countIn(sentence, MOQ_CUE);
  if (moq !== null) {
    reading.minimumOrderQuantity = moq;
    evidence.add(sentence);
  }
  // A disclaimer covers every amount beside it, whatever clause each one sits
  // in, while leaving a lead time the supplier stated in the same breath.
  if (DISCLAIMED.test(sentence)) return;
  const money = moneyIn(sentence);
  if (!money.length) return;
  const quantity = countIn(sentence, QUANTITY_CUE);
  const unitPrice = labelledPrice(sentence, UNIT_PRICE_CUE);
  const totalPrice = labelledPrice(sentence, TOTAL_PRICE_CUE);
  if (unitPrice) {
    reading.unitPrice = unitPrice;
    if (quantity !== null) reading.quantity = quantity;
    evidence.add(sentence);
    if (!totalPrice) return;
  }
  if (totalPrice) {
    reading.totalPrice = totalPrice;
    if (quantity !== null) reading.quantity = quantity;
    evidence.add(sentence);
    return;
  }
  // A price against a stated quantity is a lot price, which is a commercial
  // fact even though the supplier did not label it as the total. The largest
  // amount in the clause is the lot, since the rest are add ons to it.
  if (quantity !== null) {
    const lot = bareLotPrice(sentence);
    if (!lot) return;
    reading.totalPrice = lot;
    reading.quantity = quantity;
    evidence.add(sentence);
  }
}

export function readSupplierQuote(args: {
  subject: string | null;
  body: string;
  // The subjects we sent on this thread. A reply heading that matches one of
  // them is our own words quoted back and carries no supplier facts.
  ourSubjects?: string[];
}): SupplierQuoteReading {
  const reading: SupplierQuoteReading = {
    unitPrice: null,
    totalPrice: null,
    quantity: null,
    minimumOrderQuantity: null,
    leadTimeDays: null,
    evidence: [],
    complete: false,
    withdrawsEarlier: false,
    refusedPrices: [],
    retractsPrice: false,
  };
  const evidence = new Set<string>();
  for (const sentence of sentencesOf(args.subject, args.body, args.ourSubjects ?? [])) {
    if (WITHDRAWN.test(sentence)) {
      // A withdrawal takes back what the supplier said before it, inside this
      // message as much as in an older one, so facts read from earlier
      // sentences are dropped, and the withdrawal clause itself is not read for
      // facts because the amount it names is the one being taken back. What
      // the supplier states after that clause is the current offer.
      reading.unitPrice = null;
      reading.totalPrice = null;
      reading.quantity = null;
      reading.minimumOrderQuantity = null;
      reading.leadTimeDays = null;
      evidence.clear();
      reading.withdrawsEarlier = true;
      evidence.add(sentence);
      readRefusals(sentence, reading);
      const replacement = afterWithdrawal(sentence);
      if (replacement) readSentenceFacts(replacement, reading, evidence);
      continue;
    }
    readSentenceFacts(sentence, reading, evidence);
  }
  reading.evidence = [...evidence].slice(0, 8);
  reading.complete = Boolean(
    (reading.unitPrice ?? reading.totalPrice) && reading.leadTimeDays !== null,
  );
  return reading;
}

// Which message supplied each fact, so a price merged out of an older reply is
// traceable to that reply rather than to the newest one.
export type SupplierQuoteFactSources = {
  unitPrice: string | null;
  totalPrice: string | null;
  quantity: string | null;
  minimumOrderQuantity: string | null;
  leadTimeDays: string | null;
};

export type SupplierQuoteMessageEvidence = {
  messageId: string;
  evidence: string[];
};

export type SupplierQuoteThreadReading = {
  reading: SupplierQuoteReading;
  facts: SupplierQuoteFactSources;
  messages: SupplierQuoteMessageEvidence[];
};

// A supplier often prices in one message and dates it in the next, so a thread
// is read as a whole. Readings arrive newest first and the newest statement of
// a fact wins, while an older message still supplies what the newest is silent
// about. Every contributing sentence stays in the evidence, next to the id of
// the message it was written in.
export function mergeSupplierQuoteThread(
  messages: readonly { messageId: string; reading: SupplierQuoteReading }[],
): SupplierQuoteThreadReading {
  const merged: SupplierQuoteReading = {
    unitPrice: null,
    totalPrice: null,
    quantity: null,
    minimumOrderQuantity: null,
    leadTimeDays: null,
    evidence: [],
    complete: false,
    withdrawsEarlier: false,
    refusedPrices: [],
    retractsPrice: false,
  };
  const facts: SupplierQuoteFactSources = {
    unitPrice: null,
    totalPrice: null,
    quantity: null,
    minimumOrderQuantity: null,
    leadTimeDays: null,
  };
  const evidence = new Set<string>();
  const contributors: SupplierQuoteMessageEvidence[] = [];
  // What a newer message refuses binds every older one, so a price the supplier
  // has since turned down cannot come back out of the thread as current. A
  // message's own refusals apply only to what came before it, which is what
  // lets "we cannot honour that price, it is now $12 per unit" keep the $12.
  const refused = new Set<string>();
  let priceRetracted = false;
  for (const message of messages) {
    const reading = message.reading;
    const standing = (price: SupplierQuoteMoney | null) => {
      if (!price || priceRetracted) return null;
      return refused.has(`${price.currency} ${price.amount}`) ? null : price;
    };
    const unitPrice = standing(reading.unitPrice);
    const totalPrice = standing(reading.totalPrice);
    for (const amount of reading.refusedPrices) refused.add(amount);
    if (reading.retractsPrice) {
      priceRetracted = true;
      merged.retractsPrice = true;
    }
    const took = (fact: keyof SupplierQuoteFactSources, present: boolean) => {
      if (!present || facts[fact] !== null) return false;
      facts[fact] = message.messageId;
      return true;
    };
    const contributes = [
      took("unitPrice", unitPrice !== null),
      took("totalPrice", totalPrice !== null),
      took("quantity", reading.quantity !== null),
      took("minimumOrderQuantity", reading.minimumOrderQuantity !== null),
      took("leadTimeDays", reading.leadTimeDays !== null),
    ].some(Boolean);
    merged.unitPrice = merged.unitPrice ?? unitPrice;
    merged.totalPrice = merged.totalPrice ?? totalPrice;
    merged.quantity = merged.quantity ?? reading.quantity;
    merged.minimumOrderQuantity = merged.minimumOrderQuantity ?? reading.minimumOrderQuantity;
    merged.leadTimeDays = merged.leadTimeDays ?? reading.leadTimeDays;
    if (contributes || reading.withdrawsEarlier) {
      for (const sentence of reading.evidence) evidence.add(sentence);
      contributors.push({
        messageId: message.messageId,
        evidence: reading.evidence.slice(0, 8),
      });
    }
    // Once the supplier has taken an earlier offer back, an older message is
    // history, so it may not quietly restore the price it named.
    if (reading.withdrawsEarlier) {
      merged.withdrawsEarlier = true;
      break;
    }
  }
  merged.refusedPrices = [...refused];
  merged.evidence = [...evidence].slice(0, 8);
  merged.complete = Boolean(
    (merged.unitPrice ?? merged.totalPrice) && merged.leadTimeDays !== null,
  );
  return { reading: merged, facts, messages: contributors };
}

export function mergeSupplierQuoteReadings(
  readings: readonly SupplierQuoteReading[],
): SupplierQuoteReading {
  return mergeSupplierQuoteThread(
    readings.map((reading, index) => ({ messageId: String(index), reading })),
  ).reading;
}
