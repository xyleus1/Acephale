import assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  decodeCustomerPortalSession,
  encodeCustomerPortalSession,
  generateCustomerPortalCode,
  hashCustomerPortalCode,
  isCustomerPortalDocumentSource,
  normalizeCustomerPortalEmail,
} from "../src/lib/customer-portal-security";
import {
  buildCustomerPortalOperationsBrief,
  buildCustomerPortalShipment,
  customerPortalCanRespondToQuote,
} from "../src/lib/customer-portal-view";
import {
  customerPortalDocumentHref,
  customerPortalShipmentHref,
  customerPortalWorkspaceHref,
} from "../src/lib/customer-portal-navigation";

assert.strictEqual(
  customerPortalWorkspaceHref("company/a", true),
  "/portal/workspace?company=company%2Fa&preview=1",
);
assert.strictEqual(
  customerPortalShipmentHref("job/a", { companyId: "company/a", isPreview: true }),
  "/portal/shipments/job%2Fa?company=company%2Fa&preview=1",
);
assert.strictEqual(
  customerPortalShipmentHref("job/a", { companyId: "company/a", isPreview: false }),
  "/portal/shipments/job%2Fa",
);
assert.strictEqual(customerPortalDocumentHref("doc/a", true), "/api/jobs/document/doc%2Fa");
assert.strictEqual(customerPortalDocumentHref("doc/a"), "/api/portal/documents/doc%2Fa");

const customerLoginSource = readFileSync(resolve(process.cwd(), "src/app/portal/page.tsx"), "utf8");
const staffLoginSource = readFileSync(resolve(process.cwd(), "src/app/login/page.tsx"), "utf8");
const staffPortalSource = readFileSync(resolve(process.cwd(), "src/app/dashboard/customer-portal/page.tsx"), "utf8");
const customerDevelopmentPreviewSource = readFileSync(resolve(process.cwd(), "src/app/customer/page.tsx"), "utf8");
const customerWorkspaceSource = readFileSync(resolve(process.cwd(), "src/app/portal/workspace/page.tsx"), "utf8");

assert.match(customerLoginSource, /href="\/login">Team sign in/);
assert.match(customerLoginSource, /href="mailto:rfq@usederya\.com">Start shipment/);
assert.match(staffLoginSource, /Customer\? <a href="\/portal">Sign in to your shipment workspace<\/a>/);
assert.match(staffPortalSource, /customerPortalWorkspaceHref\(membership\.company\.id, true\)/);
assert.match(staffPortalSource, /Customer sign-in:/);
assert.match(staffPortalSource, />View as customer</);
assert.match(customerDevelopmentPreviewSource, /robots: \{ index: false, follow: false \}/);
assert.match(customerDevelopmentPreviewSource, /Development preview with fictional data/);
assert.match(customerDevelopmentPreviewSource, /buildCustomerPortalShipment/);
assert.match(customerDevelopmentPreviewSource, /CustomerOperationsOverview/);
assert.match(customerDevelopmentPreviewSource, /href="\/portal">Customer sign-in/);
assert.doesNotMatch(customerDevelopmentPreviewSource, /\bprisma\./);
assert.doesNotMatch(customerDevelopmentPreviewSource, /loadCustomerPortalWorkspace/);
assert.match(customerWorkspaceSource, /CustomerOperationsOverview/);
assert.match(customerWorkspaceSource, /Freight operations \| Derya/);

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

const operationsBrief = buildCustomerPortalOperationsBrief(
  [shipment],
  new Date("2026-08-04T16:00:00.000Z"),
);
assert.deepStrictEqual(
  operationsBrief.overdueMilestones.map((milestone) => milestone.id),
  ["ms-etd"],
  "unconfirmed planned milestones in the past should enter the schedule watch",
);
assert.deepStrictEqual(operationsBrief.upcomingMilestones, []);
assert.deepStrictEqual(operationsBrief.documents, {
  published: 1,
  needed: 1,
  underReview: 1,
});
assert.ok(
  operationsBrief.recentUpdates.some((update) => update.label === "Approved visible published"),
  "published customer documents should enter recent updates",
);
assert.ok(
  operationsBrief.recentUpdates.some((update) => update.label === "Commercial invoice received"),
  "customer uploads under review should enter recent updates",
);
assert.ok(
  operationsBrief.recentUpdates.every((update) => !update.label.includes("Approved hidden")),
  "hidden documents must not enter the customer operations brief",
);

const futureShipment = buildCustomerPortalShipment({
  ...portalInput,
  id: "job-future",
  reference: "DRY-1002",
  status: "BOOKED",
  milestones: [
    { id: "ms-today", type: "BOOKING", plannedAt: new Date("2026-08-04T23:30:00.000Z"), actualAt: null },
    { id: "ms-tomorrow", type: "CARGO_READY", plannedAt: new Date("2026-08-05T00:00:00.000Z"), actualAt: null },
    { id: "ms-boundary", type: "ETD", plannedAt: new Date("2026-08-25T00:00:00.000Z"), actualAt: null },
    { id: "ms-outside", type: "ETA", plannedAt: new Date("2026-08-26T00:00:00.000Z"), actualAt: null },
    { id: "ms-confirmed", type: "CUSTOMS_ENTRY", plannedAt: new Date("2026-08-03T00:00:00.000Z"), actualAt: new Date("2026-08-03T18:00:00.000Z") },
    { id: "ms-undated", type: "DELIVERY", plannedAt: null, actualAt: null },
  ],
  documents: [],
  customerPortalActions: [{
    id: "quote-change-1",
    type: "QUOTE_CHANGES_REQUESTED",
    status: "PENDING",
    message: "Please revise transit time",
    createdAt: new Date("2026-08-04T15:00:00.000Z"),
    portalUser: { fullName: "Taylor Chen", email: "taylor@example.com" },
  }],
});
const deliveredShipment = buildCustomerPortalShipment({
  ...portalInput,
  id: "job-delivered",
  reference: "DRY-1003",
  status: "DELIVERED",
  milestones: [
    { id: "ms-delivered-pending", type: "DELIVERY", plannedAt: new Date("2026-08-05T00:00:00.000Z"), actualAt: null },
  ],
  documents: [],
  customerPortalActions: [],
});
const expandedBrief = buildCustomerPortalOperationsBrief(
  [shipment, futureShipment, deliveredShipment],
  new Date("2026-08-04T16:00:00.000Z"),
);
assert.deepStrictEqual(
  expandedBrief.upcomingMilestones.map((milestone) => [milestone.id, milestone.daysFromToday]),
  [["ms-today", 0], ["ms-tomorrow", 1], ["ms-boundary", 21]],
  "schedule watch should use UTC calendar days and include the horizon boundary",
);
assert.ok(
  expandedBrief.upcomingMilestones.every((milestone) => milestone.id !== "ms-delivered-pending"),
  "delivered shipments must not remain on schedule watch",
);
assert.ok(
  expandedBrief.recentUpdates.some((update) =>
    update.kind === "MILESTONE" && update.label === "Customs entry confirmed"
  ),
  "confirmed customer milestones should enter recent updates",
);
assert.strictEqual(expandedBrief.recentUpdates[0]?.kind, "QUOTE_RESPONSE");
assert.strictEqual(expandedBrief.recentUpdates[0]?.label, "Quote change requested");
assert.strictEqual(expandedBrief.recentUpdates[0]?.detail, "Submitted by Taylor Chen");
assert.ok(
  expandedBrief.recentUpdates.every((update, index, updates) =>
    index === 0 || updates[index - 1].occurredAt >= update.occurredAt
  ),
  "shared activity should be newest first",
);

console.log("customer portal unit test passed");
