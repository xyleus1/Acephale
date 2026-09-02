import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  mergeSupplierQuoteReadings,
  mergeSupplierQuoteThread,
  readSupplierQuote,
} from "../src/lib/procurement-supplier-quote-reading";
import {
  quoteCapturePage,
  quoteCursorBeforeFailures,
  quoteWriteBatch,
} from "../src/lib/procurement-supplier-quote-page";

// A recorded quote is what turns outreach into a purchase order, so a reading
// has to be exactly as strict as a buyer would be: a price the supplier stated,
// a lead time the supplier stated, and the sentence both came from. Everything
// softer than that stays a partial reading and is never recorded.

function completeQuote() {
  const reading = readSupplierQuote({
    subject: "Re: RFQ for PCBA",
    body: [
      "Hello,",
      "We can build this. Unit price is $12.40 per assembly for 100 units.",
      "Lead time is 15 business days after order.",
      "Regards,",
    ].join("\n"),
  });
  assert.deepEqual(reading.unitPrice, { amount: 12.4, currency: "USD" });
  assert.equal(reading.quantity, 100);
  assert.equal(
    reading.leadTimeDays,
    21,
    "Business days become calendar days, so a lead time compares against a needed by date.",
  );
  assert.equal(reading.complete, true, "A stated unit price plus a stated lead time is actionable.");
  assert.ok(
    reading.evidence.some((line) => line.includes("$12.40")),
    "The supplier sentence the price came from is kept, so a recorded price is traceable.",
  );
}

function totalPriceAndWeeks() {
  const reading = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Total for the whole lot is EUR 3.450,00 and delivery takes 4 weeks.",
  });
  assert.deepEqual(
    reading.totalPrice,
    { amount: 3450, currency: "EUR" },
    "European grouping is read as thousands, not as a decimal.",
  );
  assert.equal(reading.unitPrice, null, "A lot price is never silently treated as a unit price.");
  assert.equal(reading.leadTimeDays, 28, "Weeks are normalized to days so lead times compare.");
  assert.equal(reading.complete, true);
}

function priceWithoutLeadTime() {
  const reading = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our price is $9.90 each. We will confirm scheduling once you place the order.",
  });
  assert.deepEqual(reading.unitPrice, { amount: 9.9, currency: "USD" });
  assert.equal(reading.leadTimeDays, null);
  assert.equal(
    reading.complete,
    false,
    "A price with no date cannot support a purchase order, so it stays partial.",
  );
}

function leadTimeWithoutPrice() {
  const reading = readSupplierQuote({
    subject: "Re: RFQ",
    body: "We can ship in 10 days. Send the Gerbers and we will price it.",
  });
  assert.equal(reading.leadTimeDays, 10);
  assert.equal(reading.unitPrice, null);
  assert.equal(reading.totalPrice, null);
  assert.equal(reading.complete, false);
}

function questionsAreNotQuotes() {
  const budget = readSupplierQuote({
    subject: "Re: RFQ",
    body: "What is your target price per unit, around $10? Lead time would be 3 weeks.",
  });
  assert.equal(
    budget.unitPrice,
    null,
    "A supplier asking about our budget has not quoted a price.",
  );
  assert.equal(budget.complete, false);

  const ballpark = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Ballpark is $15 per board, this is not a quote. Delivery 20 days.",
  });
  assert.equal(
    ballpark.unitPrice,
    null,
    "A figure the supplier disclaims is not a price we may record.",
  );
  assert.equal(ballpark.complete, false);

  const askedDelivery = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is $10 per unit. Can you accept delivery in three weeks?",
  });
  assert.equal(
    askedDelivery.leadTimeDays,
    null,
    "A delivery the supplier asks about is not a delivery they promised.",
  );
  assert.equal(
    askedDelivery.complete,
    false,
    "A price plus a question about dates is not a quote.",
  );

  const warranty = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is $10 per unit. Delivery includes a 12 month warranty.",
  });
  assert.equal(
    warranty.leadTimeDays,
    null,
    "A warranty period stated beside delivery is not a lead time.",
  );
  assert.equal(warranty.complete, false);

  const perOrder = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our price is $100 per order. Lead time is 3 weeks.",
  });
  assert.equal(
    perOrder.unitPrice,
    null,
    "An amount priced per order is not a price per unit.",
  );

  const perPiece = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our price is $12.40 each. Lead time is 3 weeks.",
  });
  assert.deepEqual(
    perPiece.unitPrice,
    { amount: 12.4, currency: "USD" },
    "A price stated as each is still a unit price.",
  );

  const disclaimedFirst = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Indicative only, unit price is $15 per board. Delivery is 20 days.",
  });
  assert.equal(
    disclaimedFirst.unitPrice,
    null,
    "A disclaimer governs every amount in its sentence, including one in the next clause.",
  );
  assert.equal(disclaimedFirst.complete, false);

  const unpunctuated = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is $9 per board. Would 20 days delivery work for you",
  });
  assert.equal(
    unpunctuated.leadTimeDays,
    null,
    "A question without a question mark is still a question, not a lead time.",
  );
  assert.equal(unpunctuated.complete, false);

  const counterOffer = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Your budget of $4.50 per unit is below our cost, our price is $6.20 per unit. Lead time is 3 weeks.",
  });
  assert.deepEqual(
    counterOffer.unitPrice,
    { amount: 6.2, currency: "USD" },
    "A firm offer stated beside our own target is still the supplier's price.",
  );
  assert.equal(counterOffer.complete, true);
}

function pricesInOurOwnSubjectAreNotQuotes() {
  const ourSubjects = ["RFQ 5000 units, target price $4.50 per unit"];
  const reading = readSupplierQuote({
    subject: "Re: RFQ 5000 units, target price $4.50 per unit",
    body: "Lead time is 3 weeks from purchase order.",
    ourSubjects,
  });
  assert.equal(
    reading.unitPrice,
    null,
    "A price in the subject we wrote is never read as the supplier's price.",
  );
  assert.equal(
    reading.complete,
    false,
    "A reply stating only a lead time is not a quote, whatever the subject names.",
  );

  const unknownSubject = readSupplierQuote({
    subject: "RFQ 5000 units, target price $4.50 per unit",
    body: "Lead time is 3 weeks from purchase order.",
  });
  assert.equal(
    unknownSubject.unitPrice,
    null,
    "With no sent subject to compare, a heading is treated as ours rather than priced.",
  );

  const supplierWrote = readSupplierQuote({
    subject: "Re: RFQ 5000 units, we can do $6.20 per unit",
    body: "Lead time is 3 weeks from purchase order.",
    ourSubjects,
  });
  assert.deepEqual(
    supplierWrote.unitPrice,
    { amount: 6.2, currency: "USD" },
    "A heading the supplier rewrote carries their own price.",
  );
  assert.equal(
    supplierWrote.complete,
    true,
    "A price the supplier put in the subject completes a lead time stated in the body.",
  );

  const datedSubject = readSupplierQuote({
    subject: "Re: RFQ 5000 units, lead time 3 weeks",
    body: "Unit price is $6.20 per unit.",
    ourSubjects,
  });
  assert.equal(
    datedSubject.leadTimeDays,
    21,
    "A lead time the supplier put in the subject completes a price stated in the body.",
  );
  assert.equal(datedSubject.complete, true);

  const withdrawal = readSupplierQuote({
    subject: "Re: RFQ, our quotation is withdrawn",
    body: "We are no longer bidding on this build.",
  });
  assert.equal(
    withdrawal.withdrawsEarlier,
    true,
    "A withdrawal announced in the subject still takes an older offer back.",
  );
}

function quotedHistoryIsIgnored() {
  const reading = readSupplierQuote({
    subject: "Re: RFQ",
    body: [
      "We are reviewing internally and will revert.",
      "On an earlier date you wrote:",
      "> Our budget is $11.00 per unit and we need delivery in 12 days.",
    ].join("\n"),
  });
  assert.equal(reading.unitPrice, null, "Our own words quoted back are never read as the supplier's.");
  assert.equal(reading.leadTimeDays, null);
  assert.equal(reading.complete, false);
}

function minimumOrderQuantity() {
  const reading = readSupplierQuote({
    subject: "Re: RFQ",
    body: "MOQ is 250 pcs, unit price $8.75, lead time 3 weeks.",
  });
  assert.equal(reading.minimumOrderQuantity, 250);
  assert.deepEqual(reading.unitPrice, { amount: 8.75, currency: "USD" });
  assert.equal(reading.leadTimeDays, 21);
  assert.equal(reading.complete, true);
}

function fourDigitPrice() {
  const reading = readSupplierQuote({
    subject: "Re: RFQ",
    body: "The lot price is $1250 total and delivery is 3 weeks.",
  });
  assert.deepEqual(
    reading.totalPrice,
    { amount: 1250, currency: "USD" },
    "An ungrouped four digit price keeps all of its digits.",
  );
}

function labelledAmountWins() {
  const withFreight = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is $12.40, freight is $80.00, lead time 2 weeks.",
  });
  assert.deepEqual(
    withFreight.unitPrice,
    { amount: 12.4, currency: "USD" },
    "The amount beside the unit cue is the unit price, not the cheapest number in the sentence.",
  );

  const withTooling = readSupplierQuote({
    subject: "Re: RFQ",
    body: "$14.00 per board plus $900 one time tooling, ships in 20 days.",
  });
  assert.deepEqual(
    withTooling.unitPrice,
    { amount: 14, currency: "USD" },
    "A one time charge in the same sentence never becomes the unit price.",
  );
}

function chargesNeverBecomePrices() {
  const freightFirst = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Freight $80, unit price $12.40, lead time 2 weeks.",
  });
  assert.deepEqual(
    freightFirst.unitPrice,
    { amount: 12.4, currency: "USD" },
    "A freight charge written before the unit price is not the unit price.",
  );

  const freightLast = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price $12.40, freight $80, ships in 14 days.",
  });
  assert.deepEqual(freightLast.unitPrice, { amount: 12.4, currency: "USD" });

  const mixedCharges = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Setup $450, tax $60, unit price $9.20 each, total for the lot $9200, delivery 3 weeks.",
  });
  assert.deepEqual(
    mixedCharges.unitPrice,
    { amount: 9.2, currency: "USD" },
    "Setup and tax stated in the same sentence never become the unit price.",
  );
  assert.deepEqual(
    mixedCharges.totalPrice,
    { amount: 9200, currency: "USD" },
    "Both labelled amounts in one sentence are read as the facts they label.",
  );
  assert.equal(mixedCharges.leadTimeDays, 21);
}

function durationsBelongToTheirCue() {
  const validityFirst = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Price valid 30 days, lead time 2 weeks. Unit price $10.00 each.",
  });
  assert.equal(
    validityFirst.leadTimeDays,
    14,
    "How long a price is valid is not how long delivery takes.",
  );
  assert.equal(validityFirst.complete, true);

  const cueFirst = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Lead time 18 days, warranty 12 months, payment terms 60 days.",
  });
  assert.equal(cueFirst.leadTimeDays, 18, "A warranty or payment period is not a delivery time.");

  const durationBeforeCue = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Quotation is firm for 45 days. We need 3 weeks to ship after order.",
  });
  assert.equal(
    durationBeforeCue.leadTimeDays,
    21,
    "A duration stated before its delivery cue is still the lead time.",
  );
}

function withdrawnOffersStayWithdrawn() {
  const withdrawn = mergeSupplierQuoteReadings([
    readSupplierQuote({
      subject: "Re: RFQ",
      body: "We have to withdraw our quotation, the material cost moved.",
    }),
    readSupplierQuote({ subject: "Re: RFQ", body: "Unit price $7.50 each, lead time 12 days." }),
  ]);
  assert.equal(withdrawn.unitPrice, null, "A withdrawn price is never restored from the older message.");
  assert.equal(withdrawn.leadTimeDays, null);
  assert.equal(withdrawn.complete, false);
  assert.ok(
    withdrawn.evidence.some((line) => line.includes("withdraw")),
    "The withdrawal itself is kept as evidence for why nothing is recorded.",
  );

  const expired = mergeSupplierQuoteReadings([
    readSupplierQuote({ subject: "Re: RFQ", body: "Our offer has expired." }),
    readSupplierQuote({ subject: "Re: RFQ", body: "Total price $4500, delivery 20 days." }),
  ]);
  assert.equal(expired.totalPrice, null);
  assert.equal(expired.complete, false);

  const corrected = mergeSupplierQuoteReadings([
    readSupplierQuote({
      subject: "Re: RFQ",
      body: "Please disregard our earlier pricing. Unit price is $8.10 each, lead time 2 weeks.",
    }),
    readSupplierQuote({ subject: "Re: RFQ", body: "Unit price $7.50 each, lead time 30 days." }),
  ]);
  assert.deepEqual(
    corrected.unitPrice,
    { amount: 8.1, currency: "USD" },
    "A correction that states new facts is recorded from the correction alone.",
  );
  assert.equal(
    corrected.leadTimeDays,
    14,
    "The corrected message supplies the lead time, and the retracted one supplies nothing.",
  );

  const takenBackInOneMessage = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is $7.50 each, lead time 12 days. That quotation is withdrawn.",
  });
  assert.equal(
    takenBackInOneMessage.unitPrice,
    null,
    "A price the same message takes back is not a price, so a request cannot go purchase ready on it.",
  );
  assert.equal(takenBackInOneMessage.leadTimeDays, null);
  assert.equal(takenBackInOneMessage.complete, false);
  assert.equal(takenBackInOneMessage.withdrawsEarlier, true);

  const correctedInOneMessage = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is $7.50 each, lead time 12 days. Correction: unit price is $7.80 each and lead time is 3 weeks.",
  });
  assert.deepEqual(
    correctedInOneMessage.unitPrice,
    { amount: 7.8, currency: "USD" },
    "A correction later in the same message supersedes the price it corrects.",
  );
  assert.equal(
    correctedInOneMessage.leadTimeDays,
    21,
    "The corrected lead time is the one that stands.",
  );

  const replacedInOneSentence = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our earlier quote of $7.50 per unit is withdrawn, unit price is now $8.10 each and lead time is 2 weeks.",
  });
  assert.deepEqual(
    replacedInOneSentence.unitPrice,
    { amount: 8.1, currency: "USD" },
    "A replacement written after the withdrawal clause of the same sentence is still the current price.",
  );
  assert.equal(replacedInOneSentence.leadTimeDays, 14);
  assert.equal(replacedInOneSentence.complete, true);
  assert.equal(replacedInOneSentence.withdrawsEarlier, true);

  const replacedInOneMessage = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our earlier quote of $7.50 per unit is withdrawn. Unit price is now $8.10 each, lead time 2 weeks.",
  });
  assert.deepEqual(
    replacedInOneMessage.unitPrice,
    { amount: 8.1, currency: "USD" },
    "A replacement stated after the withdrawal is the current price, and the retracted amount is not read.",
  );
  assert.equal(replacedInOneMessage.leadTimeDays, 14);
  assert.equal(replacedInOneMessage.complete, true);
}

function fractionalPrices() {
  const dotted = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is $0.125 each, lead time 12 days.",
  });
  assert.deepEqual(
    dotted.unitPrice,
    { amount: 0.125, currency: "USD" },
    "Three decimals after a leading zero are a fraction of a unit, not thousands.",
  );

  const commaDecimal = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is EUR 0,125 each, lead time 12 days.",
  });
  assert.deepEqual(
    commaDecimal.unitPrice,
    { amount: 0.125, currency: "EUR" },
    "European notation reads the same fraction rather than 125.",
  );

  const grouped = readSupplierQuote({
    subject: "Re: RFQ",
    body: "The lot price is $1,240 total, lead time 12 days.",
  });
  assert.deepEqual(
    grouped.totalPrice,
    { amount: 1240, currency: "USD" },
    "A grouped thousand still reads whole, so a lot price is not cut to a fraction.",
  );

  const millions = readSupplierQuote({
    subject: "Re: RFQ",
    body: "For 5000 units the total price is $1,234,567, lead time 8 weeks.",
  });
  assert.deepEqual(
    millions.totalPrice,
    { amount: 1234567, currency: "USD" },
    "Repeated separators are grouping, so a million scale total reads instead of being dropped.",
  );

  const europeanMillions = readSupplierQuote({
    subject: "Re: RFQ",
    body: "For 5000 units the total price is EUR 1.234.567, lead time 8 weeks.",
  });
  assert.deepEqual(
    europeanMillions.totalPrice,
    { amount: 1234567, currency: "EUR" },
    "The same million in European notation reads the same.",
  );
}

function factsAcrossMessages() {
  const priceFirst = mergeSupplierQuoteReadings([
    readSupplierQuote({ subject: "Re: RFQ", body: "Lead time is 12 days after order." }),
    readSupplierQuote({ subject: "Re: RFQ", body: "Unit price is $7.50 each." }),
  ]);
  assert.deepEqual(priceFirst.unitPrice, { amount: 7.5, currency: "USD" });
  assert.equal(priceFirst.leadTimeDays, 12);
  assert.equal(
    priceFirst.complete,
    true,
    "A supplier that prices in one message and dates it in the next is still quoted.",
  );
  assert.equal(priceFirst.evidence.length, 2, "Both supplier sentences are kept as evidence.");

  const revised = mergeSupplierQuoteReadings([
    readSupplierQuote({ subject: "Re: RFQ", body: "Revised unit price is $6.90 each." }),
    readSupplierQuote({ subject: "Re: RFQ", body: "Unit price $7.50 each, lead time 12 days." }),
  ]);
  assert.deepEqual(
    revised.unitPrice,
    { amount: 6.9, currency: "USD" },
    "The newest statement of a price supersedes the older one.",
  );
  assert.equal(revised.leadTimeDays, 12, "The older message still supplies what the newest omits.");
}

function capturePersistence() {
  // The capture path is server-only, so its guarantees are read from source.
  const root = process.cwd();
  const source = readFileSync(resolve(root, "src/lib/procurement-supplier-quote.ts"), "utf8");
  assert.ok(
    source.includes("record_order_vendor_quote($1::uuid, $2::uuid, $3::uuid, $4::jsonb)")
      && source.includes("customerId: plan.customerId"),
    "The write goes through the tenant scoped database function, so it cannot land on another customer's supplier row.",
  );
  assert.ok(
    !/UPDATE order_vendors/.test(source),
    "The capture path holds no direct supplier update, so the quote column is the only thing it can change.",
  );
  assert.ok(
    source.includes('candidate.state === "COMPLETE"'),
    "Only a complete reading is recorded, so a partial answer never reports a request as quoted.",
  );
  assert.ok(
    source.includes("vendor.responseCount > 0"),
    "Suppliers that never answered cost no conversation read, so a large request stays inside its budget.",
  );
  assert.ok(
    source.includes("overlayVendorOutreach(vendor, outreach)")
      && source.includes("localRfqOutreach(summary.officeId, summary.orderId)"),
    "A reply that only the office email records saw still makes its supplier a candidate, and the overlay stays office and order scoped.",
  );
  assert.ok(
    source.includes("quoteCapturePage("),
    "Reading is paged, so a request with many respondents is worked through instead of reread.",
  );
  assert.ok(
    source.includes("mergeSupplierQuoteThread(inbound.map"),
    "The whole reply thread is read, so a price in one message and a date in the next still form a quote.",
  );
  assert.ok(
    source.includes("facts: args.facts") && source.includes("messages: args.messages"),
    "A recorded quote names the reply each fact came from, so provenance survives a merge across messages.",
  );
  assert.ok(
    source.includes("evidence: args.reading.evidence"),
    "The supplier sentences are stored with the quote, so a price is always auditable.",
  );
  assert.ok(
    !source.includes("\u2014"),
    "The repository forbids that dash character.",
  );

  const route = readFileSync(
    resolve(root, "src/app/api/admin/procurement-supplier-quotes/route.ts"),
    "utf8",
  );
  assert.ok(
    route.includes("operatorSecretAuthorized(req)") && route.includes('status: 401'),
    "Both methods stay behind operator authorization.",
  );
  assert.ok(
    route.includes("procurementOrderIdError(orderId)"),
    "The order id is validated at the boundary.",
  );
  assert.ok(
    !route.includes("error instanceof Error ? error.message"),
    "Raw failures never reach an operator response.",
  );
}

function everyRespondentIsEventuallyRead() {
  const respondents = Array.from({ length: 95 }, (_, index) => ({
    id: `vendor-${String(index).padStart(3, "0")}`,
    quoted: index % 10 === 0,
  }));
  const reads = 40;
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let pass = 0; pass < 5; pass += 1) {
    const page = quoteCapturePage(respondents, { after: cursor, reads });
    assert.ok(page.read.length <= reads, "A pass never reads more than its budget.");
    assert.ok(
      page.recorded.every((id) => respondents.find((entry) => entry.id === id)?.quoted),
      "Only suppliers that already hold a quote are reported without a read.",
    );
    for (const id of page.read) {
      assert.ok(!seen.includes(id), "A paged pass never rereads a respondent it already examined.");
      seen.push(id);
    }
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  assert.equal(cursor, null, "Paging finishes instead of running forever.");
  const unquoted = respondents.filter((entry) => !entry.quoted).map((entry) => entry.id);
  assert.deepEqual(
    [...seen].sort((left, right) => left.localeCompare(right)),
    unquoted,
    "Consecutive passes examine every respondent, so a later reply is never starved by the first batch.",
  );
}

function onePassWalksPastTheFirstPage() {
  const root = process.cwd();
  const source = readFileSync(resolve(root, "src/lib/procurement-supplier-quote.ts"), "utf8");
  assert.ok(
    source.includes("export async function sweepSupplierQuoteCapture")
      && source.includes("after: cursor")
      && source.includes("cursor = run.nextCursor"),
    "A sweep carries the cursor of the run before it, so one pass reaches past its first page of respondents.",
  );
  assert.ok(
    source.includes("if (run.failed > 0) break;"),
    "A failed write ends the sweep, so the retry the cursor rewound to is not read again in the same pass.",
  );

  const autopilot = readFileSync(resolve(root, "src/lib/procurement-autopilot.ts"), "utf8");
  assert.ok(
    autopilot.includes("sweepSupplierQuoteCapture({ orderId: args.orderId })")
      && !autopilot.includes("runSupplierQuoteCapture("),
    "The autopilot sweeps, so respondents beyond the first page are never starved of capture.",
  );
}

function labelledChargesAreNotPrices() {
  const toolingTotal = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Tooling total is $1250. Production lead time is 3 weeks.",
  });
  assert.equal(
    toolingTotal.totalPrice,
    null,
    "A tooling amount labelled as a total is still a charge, not the price of the parts.",
  );
  assert.equal(toolingTotal.complete, false);

  const freightEach = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Freight is $80 each. Lead time is 10 days.",
  });
  assert.equal(
    freightEach.unitPrice,
    null,
    "A per unit freight charge is not a unit price.",
  );
  assert.equal(freightEach.complete, false);

  const both = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is $12.40 each, tooling total is $1250. Lead time is 3 weeks.",
  });
  assert.deepEqual(
    both.unitPrice,
    { amount: 12.4, currency: "USD" },
    "A product price stated beside a charge is still read.",
  );
  assert.equal(
    both.totalPrice,
    null,
    "The tooling amount beside a real unit price never becomes the order total.",
  );
  assert.equal(both.complete, true);
}

function refusedPricesAreNotQuotes() {
  const refused = readSupplierQuote({
    subject: "Re: RFQ",
    body: "We cannot offer $10 per unit at this volume. Lead time is 3 weeks.",
  });
  assert.equal(
    refused.unitPrice,
    null,
    "A price the supplier refuses is not a price they offered.",
  );
  assert.equal(
    refused.complete,
    false,
    "A refused price plus a lead time never reports a request as purchase ready.",
  );

  const disclaimed = readSupplierQuote({
    subject: "Re: RFQ",
    body: "We could look at $10 per unit, but we cannot commit to that price. Lead time is 3 weeks.",
  });
  assert.equal(
    disclaimed.unitPrice,
    null,
    "A refusal that follows an amount takes that amount back, so it is not a price.",
  );
  assert.equal(disclaimed.complete, false);

  const notHonoured = readSupplierQuote({
    subject: "Re: RFQ",
    body: "The rate is $10 per unit although we will not honor it. Lead time is 3 weeks.",
  });
  assert.equal(notHonoured.unitPrice, null);
  assert.equal(
    notHonoured.complete,
    false,
    "A disclaimed amount plus a lead time never makes a request purchase order ready.",
  );

  const repeatedRefusal = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our price is $10 per unit, but we cannot honor $10 per unit. Lead time is 3 weeks.",
  });
  assert.equal(
    repeatedRefusal.unitPrice,
    null,
    "A refusal repeating the amount it refuses is not a counter offer.",
  );
  assert.equal(repeatedRefusal.complete, false);

  const unrelatedRefusal = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our price is $12.50 per unit, but we cannot cover freight. Lead time is 3 weeks.",
  });
  assert.deepEqual(
    unrelatedRefusal.unitPrice,
    { amount: 12.5, currency: "USD" },
    "A refusal about another term leaves the price standing.",
  );
  assert.equal(unrelatedRefusal.complete, true);

  const adversative = readSupplierQuote({
    subject: "Re: RFQ",
    body: "We cannot meet $10 per unit but we can do $12.50 per unit. Lead time is 3 weeks.",
  });
  assert.deepEqual(
    adversative.unitPrice,
    { amount: 12.5, currency: "USD" },
    "A price offered after a refusal is the supplier's price, so the counteroffer is read.",
  );
  assert.equal(adversative.complete, true);

  const counterOffer = readSupplierQuote({
    subject: "Re: RFQ",
    body: "We cannot meet $10 per unit, our price is $12.50 per unit. Lead time is 3 weeks.",
  });
  assert.deepEqual(
    counterOffer.unitPrice,
    { amount: 12.5, currency: "USD" },
    "A refusal binds its own clause, so the replacement price in the same sentence still counts.",
  );
  assert.equal(counterOffer.complete, true);

  const retractedLater = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our price is $10 each. Lead time is 3 weeks. We cannot honor that price.",
  });
  assert.equal(
    retractedLater.unitPrice,
    null,
    "A price the supplier takes back later in the message no longer stands.",
  );
  assert.equal(
    retractedLater.complete,
    false,
    "A retracted price plus a lead time never reports a request as purchase ready.",
  );

  const replacedLater = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our price is $10 each. Lead time is 3 weeks. We cannot honor that price, our price is now $12.50 each.",
  });
  assert.deepEqual(
    replacedLater.unitPrice,
    { amount: 12.5, currency: "USD" },
    "A replacement stated after the retraction is the price that stands.",
  );
  assert.equal(replacedLater.complete, true);

  const namedRefusalLater = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our price is $10 per unit. Lead time is 3 weeks. We cannot do $10 per unit at this volume.",
  });
  assert.equal(
    namedRefusalLater.unitPrice,
    null,
    "An amount refused by name is dropped even when it was stated earlier in the same message.",
  );
}

function costBreakdownsAreNotTotals() {
  const breakdown = readSupplierQuote({
    subject: "Re: RFQ",
    body: "For 100pcs, the estimated PCB cost is 132usd, PCB assembly cost is 456usd, the components cost is 3520usd. Lead time is 3 weeks.",
  });
  assert.equal(
    breakdown.totalPrice,
    null,
    "One line of a component breakdown understates the order, so it is not the total.",
  );
  assert.equal(
    breakdown.complete,
    false,
    "A breakdown with no stated total never reports a request as purchase ready.",
  );

  const statedLot = readSupplierQuote({
    subject: "Re: RFQ",
    body: "For 100 units the price is 4108usd. Lead time is 3 weeks.",
  });
  assert.deepEqual(
    statedLot.totalPrice,
    { amount: 4108, currency: "USD" },
    "A single priced clause against a stated quantity is still a lot price.",
  );
  assert.equal(statedLot.quantity, 100);
  assert.equal(statedLot.complete, true);
}

function currencyCodesAreWholeWords() {
  const stl = readSupplierQuote({
    subject: "Re: RFQ",
    body: "We can mold 100 units of STL 2 and 100 units of STL 4, 200 parts total. Lead time is 3 weeks.",
  });
  assert.equal(
    stl.totalPrice,
    null,
    "The letters inside STL are not a currency, so a file name prices nothing.",
  );
  assert.equal(stl.complete, false);

  const lira = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is 240 TL each. Lead time is 3 weeks.",
  });
  assert.deepEqual(
    lira.unitPrice,
    { amount: 240, currency: "TRY" },
    "A currency code standing as its own word is still read.",
  );
}

function refusedPricesStayRefusedAcrossMessages() {
  const priced = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Unit price is $7.50 each, lead time 12 days.",
  });
  const refusesTheAmount = mergeSupplierQuoteReadings([
    readSupplierQuote({
      subject: "Re: RFQ",
      body: "We cannot honour $7.50 per unit any more. Lead time is still 12 days.",
    }),
    priced,
  ]);
  assert.equal(
    refusesTheAmount.unitPrice,
    null,
    "An amount the newest reply refuses may not be restored from an older reply.",
  );
  assert.equal(
    refusesTheAmount.complete,
    false,
    "A refused price plus a lead time never makes a request purchase order ready.",
  );

  const refusesTheirOwnPrice = mergeSupplierQuoteReadings([
    readSupplierQuote({
      subject: "Re: RFQ",
      body: "We cannot honour that price now. Lead time is still 12 days.",
    }),
    priced,
  ]);
  assert.equal(
    refusesTheirOwnPrice.unitPrice,
    null,
    "A supplier refusing their own price leaves no older price standing.",
  );
  assert.equal(refusesTheirOwnPrice.complete, false);

  const replaced = mergeSupplierQuoteReadings([
    readSupplierQuote({
      subject: "Re: RFQ",
      body: "We cannot honour that price, unit price is now $8.10 each. Lead time is 12 days.",
    }),
    priced,
  ]);
  assert.deepEqual(
    replaced.unitPrice,
    { amount: 8.1, currency: "USD" },
    "A refusal reaches back into the thread, not into the price stated with it.",
  );
  assert.equal(replaced.complete, true);

  const refusesFreight = mergeSupplierQuoteReadings([
    readSupplierQuote({
      subject: "Re: RFQ",
      body: "We cannot absorb the freight cost. Lead time is 12 days.",
    }),
    priced,
  ]);
  assert.deepEqual(
    refusesFreight.unitPrice,
    { amount: 7.5, currency: "USD" },
    "A refusal about another term leaves the older price standing.",
  );
  assert.equal(refusesFreight.complete, true);
}

function factsKeepTheMessageTheyCameFrom() {
  const priceOnly = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Our unit price is $12.40 per board.",
  });
  const dateOnly = readSupplierQuote({
    subject: "Re: RFQ",
    body: "Lead time is 3 weeks from approval.",
  });
  // The thread is read newest first, so the lead time arrives before the price.
  const thread = mergeSupplierQuoteThread([
    { messageId: "message-new", reading: dateOnly },
    { messageId: "message-old", reading: priceOnly },
  ]);
  assert.equal(thread.reading.complete, true);
  assert.equal(
    thread.facts.unitPrice,
    "message-old",
    "A price merged out of an older reply is credited to that reply.",
  );
  assert.equal(thread.facts.leadTimeDays, "message-new");
  assert.deepEqual(
    thread.messages.map((entry) => entry.messageId),
    ["message-new", "message-old"],
    "Both contributing replies stay traceable, not only the newest.",
  );
  assert.ok(
    thread.messages
      .find((entry) => entry.messageId === "message-old")
      ?.evidence.some((sentence) => sentence.includes("12.40")),
    "Each evidence sentence sits with the reply that wrote it.",
  );

  const silent = mergeSupplierQuoteThread([
    { messageId: "message-new", reading: priceOnly },
    { messageId: "message-old", reading: priceOnly },
  ]);
  assert.deepEqual(
    silent.messages.map((entry) => entry.messageId),
    ["message-new"],
    "A reply that repeats a fact already taken from a newer message is not credited with it.",
  );
}

function chargesAlongsideAQuantityAreNotAQuote() {
  const freightOnly = readSupplierQuote({
    subject: "Re: RFQ",
    body: "For 100 units, freight is $80. Lead time is 2 weeks.",
  });
  assert.equal(
    freightOnly.totalPrice,
    null,
    "A freight charge stated against a quantity is not a lot price.",
  );
  assert.equal(freightOnly.unitPrice, null);
  assert.equal(
    freightOnly.complete,
    false,
    "A reply carrying only a charge and a date never becomes purchase ready.",
  );

  const toolingOnly = readSupplierQuote({
    subject: "Re: RFQ",
    body: "For 500 pcs the tooling is $4500 and delivery is 3 weeks.",
  });
  assert.equal(toolingOnly.totalPrice, null, "Tooling stated against a quantity is not the price of the parts.");
  assert.equal(toolingOnly.complete, false);

  const lotPrice = readSupplierQuote({
    subject: "Re: RFQ",
    body: "For 100 units the price is $1,240. Lead time is 2 weeks.",
  });
  assert.deepEqual(
    lotPrice.totalPrice,
    { amount: 1240, currency: "USD" },
    "An amount the supplier calls a price is still read when they never label it a total.",
  );
  assert.equal(lotPrice.quantity, 100);
  assert.equal(lotPrice.complete, true);
}

function writesStopAtTheirBatchWithoutSkipping() {
  const candidates = Array.from({ length: 95 }, (_, index) => ({
    id: `vendor-${String(index).padStart(3, "0")}`,
    recordable: true,
  }));
  const limit = 40;
  const written: string[] = [];
  let cursor: string | null = null;
  for (let pass = 0; pass < 4; pass += 1) {
    const remaining = candidates.filter((candidate) => (
      !written.includes(candidate.id)
      && (!cursor || candidate.id.localeCompare(cursor) > 0)
    ));
    // A read pass that reaches the end of the reply set reports no read cursor,
    // so only the write budget can carry one.
    const batch = quoteWriteBatch(remaining, { limit, readCursor: null });
    assert.ok(batch.write.length <= limit, "A pass never writes more than its batch limit.");
    for (const id of batch.write) {
      assert.ok(!written.includes(id), "A recorded supplier is never written twice.");
      written.push(id);
    }
    cursor = batch.nextCursor;
    if (!cursor) break;
  }
  assert.equal(cursor, null, "The write batch finishes the reply set instead of stalling.");
  assert.deepEqual(
    [...written].sort((left, right) => left.localeCompare(right)),
    candidates.map((candidate) => candidate.id),
    "Every complete reply is eventually recorded, so none is paged past unwritten.",
  );

  const mixed = quoteWriteBatch(
    [
      { id: "vendor-a", recordable: false },
      { id: "vendor-b", recordable: true },
      { id: "vendor-c", recordable: true },
    ],
    { limit: 1, readCursor: "vendor-c" },
  );
  assert.deepEqual(mixed.write, ["vendor-b"]);
  assert.equal(
    mixed.nextCursor,
    "vendor-b",
    "A truncated pass reports the supplier it settled, not the further read cursor.",
  );

  const whole = quoteWriteBatch(
    [{ id: "vendor-a", recordable: true }],
    { limit: 40, readCursor: "vendor-a" },
  );
  assert.equal(
    whole.nextCursor,
    "vendor-a",
    "A pass that writes everything it read carries the read cursor forward.",
  );
}

function failedWritesAreNotPagedPast() {
  const batch = quoteWriteBatch(
    [
      { id: "vendor-a", recordable: true },
      { id: "vendor-b", recordable: true },
      { id: "vendor-c", recordable: true },
    ],
    { limit: 40, readCursor: "vendor-c" },
  );
  assert.deepEqual(batch.settled, ["vendor-a", "vendor-b", "vendor-c"]);

  assert.equal(
    quoteCursorBeforeFailures({
      cursor: batch.nextCursor,
      settled: batch.settled,
      failed: [],
    }),
    "vendor-c",
    "A pass with no failure keeps the cursor it earned.",
  );

  assert.equal(
    quoteCursorBeforeFailures({
      cursor: batch.nextCursor,
      settled: batch.settled,
      failed: ["vendor-b"],
    }),
    "vendor-a",
    "A failed write stops the page before it, so the next pass reads that reply again.",
  );

  assert.equal(
    quoteCursorBeforeFailures({
      cursor: batch.nextCursor,
      settled: batch.settled,
      failed: ["vendor-a", "vendor-c"],
    }),
    null,
    "A failure in the first reply of the page restarts the page instead of skipping it.",
  );

  assert.equal(
    quoteCursorBeforeFailures({
      cursor: "vendor-a",
      settled: batch.settled,
      failed: ["vendor-c"],
    }),
    "vendor-a",
    "A cursor already short of the failure is never advanced by this correction.",
  );
}

function main() {
  completeQuote();
  totalPriceAndWeeks();
  priceWithoutLeadTime();
  leadTimeWithoutPrice();
  questionsAreNotQuotes();
  pricesInOurOwnSubjectAreNotQuotes();
  quotedHistoryIsIgnored();
  minimumOrderQuantity();
  fourDigitPrice();
  labelledAmountWins();
  chargesNeverBecomePrices();
  durationsBelongToTheirCue();
  withdrawnOffersStayWithdrawn();
  fractionalPrices();
  factsAcrossMessages();
  chargesAlongsideAQuantityAreNotAQuote();
  labelledChargesAreNotPrices();
  refusedPricesAreNotQuotes();
  refusedPricesStayRefusedAcrossMessages();
  costBreakdownsAreNotTotals();
  currencyCodesAreWholeWords();
  factsKeepTheMessageTheyCameFrom();
  everyRespondentIsEventuallyRead();
  onePassWalksPastTheFirstPage();
  writesStopAtTheirBatchWithoutSkipping();
  failedWritesAreNotPagedPast();
  capturePersistence();
  console.log("Procurement supplier quote reading contract passed.");
}

main();
