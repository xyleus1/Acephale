import assert from "node:assert/strict";
import { normalizeSupplierQuoteExtraction } from "../src/lib/supply-os/supplier-quote-extraction";

const input = {
  subject: "Quote Q-410",
  bodyText: "Quote Q-410: USD 126.00 per each, MOQ 4 units. Delivery September 18, 2026. Valid through October 1, 2026.",
  attachmentNames: [],
  receivedOn: "2026-08-11",
  requestedUnitOfMeasure: "EA",
  needBy: "2026-09-15",
};

const proposal = normalizeSupplierQuoteExtraction({
  price: { value: "126.00", evidenceText: "USD 126.00 per each", evidenceSourceId: "EMAIL_BODY" },
  currency: { value: "USD", evidenceText: "USD 126.00 per each", evidenceSourceId: "EMAIL_BODY" },
  minimumOrderQuantity: { value: "4", evidenceText: "MOQ 4 units", evidenceSourceId: "EMAIL_BODY" },
  unitOfMeasure: { value: "EA", evidenceText: "per each", evidenceSourceId: "EMAIL_BODY" },
  deliveryDate: { value: "2026-09-18", evidenceText: "Delivery September 18, 2026", evidenceSourceId: "EMAIL_BODY" },
  quoteReference: { value: "Q-410", evidenceText: "Quote Q-410", evidenceSourceId: "EMAIL_SUBJECT" },
  validUntil: { value: "2026-10-01", evidenceText: "Valid through October 1, 2026", evidenceSourceId: "EMAIL_BODY" },
  warnings: [],
}, input);

assert.equal(proposal.state, "PROPOSED");
assert.equal(proposal.fields.price.value, "126");
assert.equal(proposal.fields.currency.state, "EXTRACTED");
assert.equal(proposal.fields.minimumOrderQuantity.value, "4");
assert.equal(proposal.fields.unitOfMeasure.value, "EA");
assert.equal(proposal.fields.quoteReference.value, "Q-410");
assert.equal(proposal.fields.deliveryDate.state, "CONFLICT", "delivery after need-by must stay visible as a conflict");
assert.match(proposal.fields.deliveryDate.reason ?? "", /after the requested need-by date/i);

const unsupported = normalizeSupplierQuoteExtraction({
  price: { value: "126", evidenceText: "USD 126.00 per each" },
  currency: { value: "EUR", evidenceText: "USD 126.00 per each" },
  minimumOrderQuantity: { value: null, evidenceText: null },
  unitOfMeasure: { value: "KG", evidenceText: "per each" },
  deliveryDate: { value: "2026-02-31", evidenceText: "Delivery September 18, 2026" },
  quoteReference: { value: "Q-999", evidenceText: "Quote Q-410" },
  validUntil: { value: "2026-10-01", evidenceText: "This quotation is attached" },
  warnings: ["Check the attachment."],
}, input);

assert.equal(unsupported.fields.currency.state, "UNKNOWN", "a model cannot change an explicit currency citation");
assert.equal(unsupported.fields.unitOfMeasure.state, "UNKNOWN", "a unit needs supporting supplier text before conflict analysis");
assert.equal(unsupported.fields.deliveryDate.state, "UNKNOWN", "invalid calendar dates must be rejected");
assert.equal(unsupported.fields.quoteReference.state, "UNKNOWN", "a quote reference must appear in its cited text");
assert.equal(unsupported.fields.validUntil.state, "UNKNOWN", "a citation that is absent from the reply must fail closed");
assert.ok(!unsupported.warnings.includes("Check the attachment."), "free-form model warnings must not cross the trust boundary");

const mislabeled = normalizeSupplierQuoteExtraction({
  price: { value: "4", evidenceText: "MOQ 4 units" },
  currency: { value: "XYZ", evidenceText: "Currency XYZ" },
  minimumOrderQuantity: { value: "126", evidenceText: "USD 126.00 per each" },
  unitOfMeasure: { value: null, evidenceText: null },
  deliveryDate: { value: "2026-10-01", evidenceText: "Valid through October 1, 2026" },
  quoteReference: { value: null, evidenceText: null },
  validUntil: { value: "2026-09-18", evidenceText: "Delivery September 18, 2026" },
  warnings: [],
}, { ...input, bodyText: `${input.bodyText} Currency XYZ.` });

assert.equal(mislabeled.fields.price.state, "UNKNOWN", "an MOQ citation cannot support a unit price");
assert.equal(mislabeled.fields.minimumOrderQuantity.state, "UNKNOWN", "a unit-price citation cannot support MOQ");
assert.equal(mislabeled.fields.deliveryDate.state, "UNKNOWN", "a validity citation cannot support delivery");
assert.equal(mislabeled.fields.validUntil.state, "UNKNOWN", "a delivery citation cannot support validity");
assert.equal(mislabeled.fields.currency.state, "UNKNOWN", "three letters are not enough unless they identify a supported ISO currency");

const stitchedCitation = normalizeSupplierQuoteExtraction({
  price: { value: "126", evidenceText: "USD 126 per EA" },
  currency: { value: "USD", evidenceText: "USD 126 per EA" },
  minimumOrderQuantity: { value: null, evidenceText: null },
  unitOfMeasure: { value: null, evidenceText: null },
  deliveryDate: { value: null, evidenceText: null },
  quoteReference: { value: null, evidenceText: null },
  validUntil: { value: null, evidenceText: null },
  warnings: [],
}, { ...input, subject: "USD", bodyText: "126 per EA" });

assert.equal(stitchedCitation.fields.price.state, "UNKNOWN", "a citation cannot be synthesized across the subject and body boundary");

const unitConflict = normalizeSupplierQuoteExtraction({
  price: { value: null, evidenceText: null },
  currency: { value: null, evidenceText: null },
  minimumOrderQuantity: { value: null, evidenceText: null },
  unitOfMeasure: { value: "KG", evidenceText: "price per KG" },
  deliveryDate: { value: null, evidenceText: null },
  quoteReference: { value: null, evidenceText: null },
  validUntil: { value: null, evidenceText: null },
  warnings: [],
}, { ...input, bodyText: `${input.bodyText} Alternate price per KG.` });

assert.equal(unitConflict.fields.unitOfMeasure.state, "CONFLICT");
assert.match(unitConflict.fields.unitOfMeasure.reason ?? "", /does not match requested unit EA/i);

const attachmentOnly = normalizeSupplierQuoteExtraction({
  price: { value: null, evidenceText: null },
  currency: { value: null, evidenceText: null },
  minimumOrderQuantity: { value: null, evidenceText: null },
  unitOfMeasure: { value: null, evidenceText: null },
  deliveryDate: { value: null, evidenceText: null },
  quoteReference: { value: null, evidenceText: null },
  validUntil: { value: null, evidenceText: null },
  warnings: [],
}, { ...input, bodyText: "Please see the attached quotation.", attachmentNames: ["quote.pdf"] });

assert.equal(attachmentOnly.state, "NO_TERMS");
assert.ok(attachmentOnly.warnings.some((warning) => /no supported attachment text/i.test(warning)));

const attachmentInput = {
  ...input,
  bodyText: "Please review the attached quotation.",
  attachmentNames: ["Q-410.pdf"],
  attachmentSources: [{
    sourceId: "ATTACHMENT_1",
    name: "Q-410.pdf",
    text: "Quote Q-410. Unit price USD 119.50 per EA. MOQ 6 EA. Delivery September 10, 2026. Valid through October 1, 2026.",
    contentHash: "attachment-content-hash",
  }],
  attachmentWarnings: [],
};
const attachmentProposal = normalizeSupplierQuoteExtraction({
  price: { value: "119.50", evidenceText: "Unit price USD 119.50 per EA", evidenceSourceId: "ATTACHMENT_1" },
  currency: { value: "USD", evidenceText: "Unit price USD 119.50 per EA", evidenceSourceId: "ATTACHMENT_1" },
  minimumOrderQuantity: { value: "6", evidenceText: "MOQ 6 EA", evidenceSourceId: "ATTACHMENT_1" },
  unitOfMeasure: { value: "EA", evidenceText: "per EA", evidenceSourceId: "ATTACHMENT_1" },
  deliveryDate: { value: "2026-09-10", evidenceText: "Delivery September 10, 2026", evidenceSourceId: "ATTACHMENT_1" },
  quoteReference: { value: "Q-410", evidenceText: "Quote Q-410", evidenceSourceId: "ATTACHMENT_1" },
  validUntil: { value: "2026-10-01", evidenceText: "Valid through October 1, 2026", evidenceSourceId: "ATTACHMENT_1" },
}, attachmentInput);

assert.equal(attachmentProposal.fields.price.value, "119.5");
assert.equal(attachmentProposal.fields.price.evidenceSource?.kind, "ATTACHMENT");
assert.equal(attachmentProposal.fields.price.evidenceSource?.label, "Q-410.pdf");
assert.equal(attachmentProposal.fields.deliveryDate.state, "EXTRACTED");

const wrongAttachmentSource = normalizeSupplierQuoteExtraction({
  price: { value: "119.50", evidenceText: "Unit price USD 119.50 per EA", evidenceSourceId: "EMAIL_BODY" },
  currency: { value: null, evidenceText: null, evidenceSourceId: null },
  minimumOrderQuantity: { value: null, evidenceText: null, evidenceSourceId: null },
  unitOfMeasure: { value: null, evidenceText: null, evidenceSourceId: null },
  deliveryDate: { value: null, evidenceText: null, evidenceSourceId: null },
  quoteReference: { value: null, evidenceText: null, evidenceSourceId: null },
  validUntil: { value: null, evidenceText: null, evidenceSourceId: null },
}, attachmentInput);
assert.equal(wrongAttachmentSource.fields.price.state, "UNKNOWN", "attachment text cannot be cited as email-body evidence");

const ambiguousSource = normalizeSupplierQuoteExtraction({
  price: { value: "119.50", evidenceText: "Unit price USD 119.50 per EA" },
  currency: { value: null, evidenceText: null },
  minimumOrderQuantity: { value: null, evidenceText: null },
  unitOfMeasure: { value: null, evidenceText: null },
  deliveryDate: { value: null, evidenceText: null },
  quoteReference: { value: null, evidenceText: null },
  validUntil: { value: null, evidenceText: null },
}, { ...attachmentInput, bodyText: "Unit price USD 119.50 per EA" });
assert.equal(ambiguousSource.fields.price.state, "UNKNOWN", "a citation present in two sources must name the exact source");

const swappedCommercialNumbers = normalizeSupplierQuoteExtraction({
  price: { value: "6", evidenceText: "Unit price USD 119.50 per EA. MOQ 6 EA.", evidenceSourceId: "ATTACHMENT_1" },
  currency: { value: null, evidenceText: null, evidenceSourceId: null },
  minimumOrderQuantity: { value: "119.50", evidenceText: "Unit price USD 119.50 per EA. MOQ 6 EA.", evidenceSourceId: "ATTACHMENT_1" },
  unitOfMeasure: { value: null, evidenceText: null, evidenceSourceId: null },
  deliveryDate: { value: null, evidenceText: null, evidenceSourceId: null },
  quoteReference: { value: null, evidenceText: null, evidenceSourceId: null },
  validUntil: { value: null, evidenceText: null, evidenceSourceId: null },
}, attachmentInput);
assert.equal(swappedCommercialNumbers.fields.price.state, "UNKNOWN", "a multi-number citation cannot support a swapped price");
assert.equal(swappedCommercialNumbers.fields.minimumOrderQuantity.state, "UNKNOWN", "a multi-number citation cannot support a swapped MOQ");

const mismatchedDates = normalizeSupplierQuoteExtraction({
  price: { value: null, evidenceText: null, evidenceSourceId: null },
  currency: { value: null, evidenceText: null, evidenceSourceId: null },
  minimumOrderQuantity: { value: null, evidenceText: null, evidenceSourceId: null },
  unitOfMeasure: { value: null, evidenceText: null, evidenceSourceId: null },
  deliveryDate: { value: "2026-09-12", evidenceText: "Delivery September 10, 2026", evidenceSourceId: "ATTACHMENT_1" },
  quoteReference: { value: null, evidenceText: null, evidenceSourceId: null },
  validUntil: { value: "2026-10-15", evidenceText: "Valid through October 1, 2026", evidenceSourceId: "ATTACHMENT_1" },
}, attachmentInput);
assert.equal(mismatchedDates.fields.deliveryDate.state, "UNKNOWN", "delivery must equal the date in its citation");
assert.equal(mismatchedDates.fields.validUntil.state, "UNKNOWN", "validity must equal the date in its citation");

console.log("Supply OS supplier quote extraction tests passed.");
