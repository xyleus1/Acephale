import assert from "assert";
import {
  decodeCustomerPortalSession,
  encodeCustomerPortalSession,
  generateCustomerPortalCode,
  hashCustomerPortalCode,
  isCustomerPortalDocumentSource,
  normalizeCustomerPortalEmail,
} from "../src/lib/customer-portal-security";
import {
  buildCustomerPortalShipment,
  customerPortalCanRespondToQuote,
} from "../src/lib/customer-portal-view";

assert.strictEqual(normalizeCustomerPortalEmail("  Ops@Customer.COM "), "ops@customer.com");
for (let index = 0; index < 100; index += 1) {
  assert.match(generateCustomerPortalCode(), /^\d{6}$/);
}

const secret = "portal-test-secret";
const now = Date.parse("2026-07-29T12:00:00.000Z");
const token = encodeCustomerPortalSession(secret, {
  portalUserId: "portal-user-1",
  officeId: "office-1",
  email: "ops@customer.com",
}, now);
assert.deepStrictEqual(
  decodeCustomerPortalSession(secret, token, now + 1000),
  {
    portalUserId: "portal-user-1",
    officeId: "office-1",
    email: "ops@customer.com",
    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
  },
);
assert.strictEqual(decodeCustomerPortalSession("wrong-secret", token, now + 1000), null);
assert.strictEqual(decodeCustomerPortalSession(secret, `${token.slice(0, -1)}0`, now + 1000), null);
assert.strictEqual(
  decodeCustomerPortalSession(secret, token, now + 31 * 24 * 60 * 60 * 1000),
  null,
);

const codeHash = hashCustomerPortalCode(secret, "office-1", "ops@customer.com", "123456");
assert.notStrictEqual(
  codeHash,
  hashCustomerPortalCode(secret, "office-2", "ops@customer.com", "123456"),
  "login codes must be tenant-scoped",
);
assert.strictEqual(isCustomerPortalDocumentSource("local-upload://job-documents/office/job/file.pdf"), true);
assert.strictEqual(isCustomerPortalDocumentSource("s3://bucket/job-documents/office/job/file.pdf"), true);
assert.strictEqual(isCustomerPortalDocumentSource("data:application/pdf;base64,JVBERi0="), true);
assert.strictEqual(
  isCustomerPortalDocumentSource("/api/gmail/attachment?messageDbId=msg-1&attachmentId=att-1"),
  true,
);
assert.strictEqual(isCustomerPortalDocumentSource("https://files.example.com/invoice.pdf"), false);
assert.strictEqual(isCustomerPortalDocumentSource("http://169.254.169.254/latest/meta-data"), false);
assert.strictEqual(isCustomerPortalDocumentSource("//169.254.169.254/latest/meta-data"), false);

const portalInput = {
  id: "job-1",
  reference: "DRY-1001",
  title: "Sample load",
  status: "QUOTED",
  mode: "SEA-FCL",
  origin: "Shanghai",
  destination: "Long Beach",
  commodity: "Hardware",
  incoterms: "FOB",
  weight: 10000,
  volume: null,
  packages: 20,
  containerCount: 1,
  containerType: "40HC",
  etd: new Date("2026-08-01T00:00:00.000Z"),
  eta: new Date("2026-08-20T00:00:00.000Z"),
  currency: "USD",
  quoteLines: "Ocean freight|2500|USD\nDocumentation|125|USD",
  notes: "Internal note that must not be exposed",
  createdAt: new Date("2026-07-20T00:00:00.000Z"),
  updatedAt: new Date("2026-07-29T00:00:00.000Z"),
  milestones: [
    { id: "ms-etd", type: "ETD", plannedAt: new Date("2026-08-01T00:00:00.000Z"), actualAt: null },
    { id: "ms-customs", type: "CUSTOMS_ENTRY", plannedAt: null, actualAt: null },
    { id: "ms-internal", type: "INTERNAL_REVIEW", plannedAt: null, actualAt: null },
  ],
  documents: [
    {
      id: "doc-visible",
      name: "Approved visible",
      docType: "BL",
      status: "APPROVED",
      customerVisible: true,
      customerRequested: false,
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    },
    {
      id: "doc-hidden",
      name: "Approved hidden",
      docType: "INVOICE",
      status: "APPROVED",
      customerVisible: false,
      customerRequested: false,
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    },
    {
      id: "doc-requested",
      name: "Packing list",
      docType: "PACKING_LIST",
      status: "PENDING",
      customerVisible: false,
      customerRequested: true,
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    },
    {
      id: "doc-review",
      name: "Commercial invoice",
      docType: "INVOICE",
      status: "UPLOADED",
      customerVisible: false,
      customerRequested: true,
      updatedAt: new Date("2026-07-29T00:00:00.000Z"),
    },
  ],
  customerPortalActions: [],
};
const shipment = buildCustomerPortalShipment(portalInput);

assert.deepStrictEqual(shipment.documents.map((document) => document.id), ["doc-visible"]);
assert.deepStrictEqual(
  shipment.documentRequests.map((document) => [document.id, document.status]),
  [["doc-requested", "NEEDED"], ["doc-review", "UNDER_REVIEW"]],
);
assert.deepStrictEqual(
  shipment.milestones.map((milestone) => milestone.type),
  ["ETD", "CUSTOMS_ENTRY"],
);
assert.strictEqual(customerPortalCanRespondToQuote(shipment), true);
assert.strictEqual(shipment.progressIndex, 1);
assert.strictEqual(shipment.progressPercent, 25);
assert.ok(!("type" in (shipment.nextMilestone ?? {})), "the next milestone summary should expose only safe fields");
assert.strictEqual(shipment.nextMilestone?.label, "Estimated departure");
assert.strictEqual(shipment.completedMilestones, 0);
const customsShipment = buildCustomerPortalShipment({ ...portalInput, status: "CUSTOMS" });
assert.strictEqual(customsShipment.progressIndex, 3, "customs belongs to the in-transit tracking stage");
assert.strictEqual(customsShipment.progressPercent, 75);
const noLegacyQuoteShipment = buildCustomerPortalShipment({
  ...portalInput,
  quoteLines: null,
  notes: "Internal surcharge|900|USD",
});
assert.deepStrictEqual(
  noLegacyQuoteShipment.quoteLines,
  [],
  "internal notes must never become customer quote lines",
);
assert.ok(!("notes" in shipment), "internal notes must not enter the customer projection");
assert.ok(!("cost" in shipment), "internal cost must not enter the customer projection");

console.log("customer portal unit test passed");
