import assert from "node:assert/strict";
import {
  canPublishIdentityResolution,
  resolveProductIdentity,
} from "../src/lib/supply-os/product-identity";
import {
  approveSupplierCandidate,
  assertPublicResearchUrl,
  filterRelevantSupplySignals,
  normalizeSupplierResearch,
  qualifyProviderCandidate,
  rejectsLoginOrPaywall,
  ResearchRateLimiter,
  type EvidenceEnvelope,
  type ProviderCandidate,
} from "../src/lib/supply-os/research";

const items = [
  { itemKey: "A", externalId: "ERP-1", sku: "RADIO-1", manufacturer: "Acme", mpn: "RM-9", gtin: "0001", name: "Radio module" },
  { itemKey: "B", externalId: "ERP-2", sku: "RADIO-2", manufacturer: "Beta", mpn: "RM-10", gtin: "0002", name: "Industrial radio module" },
];

const exact = resolveProductIdentity({ query: { sku: "radio-1" }, items });
assert.equal(exact.status, "RESOLVED");
assert.equal(exact.itemKey, "A");
assert.equal(canPublishIdentityResolution(exact), true);

const collision = resolveProductIdentity({
  query: { externalId: "ERP-X" },
  items: [
    { ...items[0]!, externalId: "ERP-X" },
    { ...items[1]!, externalId: "ERP-X" },
  ],
});
assert.equal(collision.status, "REVIEW_REQUIRED");
assert.deepEqual(collision.candidates.map((value) => value.itemKey), ["A", "B"]);
assert.equal(canPublishIdentityResolution(collision), false);

const lexical = resolveProductIdentity({ query: { name: "Industrial radio module" }, items });
assert.equal(lexical.status, "REVIEW_REQUIRED");
assert.equal(lexical.method, "LEXICAL");
assert.equal(canPublishIdentityResolution(lexical), false);

const vector = resolveProductIdentity({
  query: { name: "unfamiliar transceiver description" },
  items,
  vectorCandidates: [{ itemKey: "A", similarity: 0.93 }],
});
assert.equal(vector.method, "VECTOR_PROPOSAL");
assert.equal(vector.status, "REVIEW_REQUIRED");

const now = new Date("2026-08-08T12:00:00.000Z");
const official = { url: "https://radio.example/product/rm9", sourceType: "OFFICIAL" as const };
const publicSource = { url: "https://registry.example/radio", sourceType: "PUBLIC" as const };
const rawCandidate = {
  candidates: [{
    id: "radio-inc",
    companyName: "Radio Inc",
    website: "https://radio.example/",
    roles: ["MANUFACTURER", "INVENTED_ROLE"],
    country: { value: "US", state: "SUPPORTED", confidence: 0.9, sourceUrls: [publicSource.url], observedAt: "2026-08-01" },
    facility: { value: "Austin", state: "SUPPORTED", confidence: 0.8, sourceUrls: ["https://invented.example"], observedAt: "2026-08-01" },
    productCapability: { value: "RM-9 radio module", state: "SUPPORTED", confidence: 0.95, sourceUrls: [official.url], observedAt: "2026-08-01" },
    price: { value: 42, state: "SUPPORTED", confidence: 0.7, sourceUrls: ["https://invented.example/price"], observedAt: "2026-08-01" },
    currency: { value: "USD", state: "SUPPORTED", confidence: 0.7, sourceUrls: [official.url], observedAt: "2026-08-01" },
    minimumOrderQuantity: { value: 10, state: "SUPPORTED", confidence: 0.7, sourceUrls: [official.url], observedAt: "2026-08-01" },
    leadTimeDays: { value: 21, state: "SUPPORTED", confidence: 0.7, sourceUrls: [official.url], observedAt: "2025-01-01" },
    sourceUrls: [official.url, publicSource.url, "https://invented.example"],
    cautions: ["Capacity is unknown."],
  }],
};

const normalized = normalizeSupplierResearch({
  officeId: "office-a",
  workspaceId: "workspace-a",
  componentItemKey: "RADIO-1",
  raw: rawCandidate,
  providerSources: [official, publicSource],
  now,
});
assert.equal(normalized.degraded, false);
assert.equal(normalized.candidates.length, 1);
const candidate = normalized.candidates[0]!;
assert.deepEqual(candidate.roles, ["MANUFACTURER"]);
assert.deepEqual(candidate.sourceUrls, [official.url, publicSource.url]);
assert.equal(candidate.facility.state, "PARTIAL", "unsupported citations must downgrade a supported claim");
assert.equal(candidate.facility.sources.length, 0);
assert.equal(candidate.price.state, "PARTIAL");
assert.equal(candidate.leadTimeDays.freshness, "STALE");
assert.equal(candidate.status, "REVIEW_REQUIRED");

const approved = approveSupplierCandidate({
  candidate,
  officeId: "office-a",
  workspaceId: "workspace-a",
  reviewerUserId: "reviewer-1",
  approvedAt: now,
});
assert.equal(approved.status, "APPROVED");
assert.equal(approved.approvedByUserId, "reviewer-1");
assert.throws(() => approveSupplierCandidate({
  candidate,
  officeId: "office-b",
  workspaceId: "workspace-a",
  reviewerUserId: "reviewer-2",
}), /outside the active office/i, "cross-office approval must fail");

const unsupportedResult = normalizeSupplierResearch({
  officeId: "office-a",
  workspaceId: "workspace-a",
  componentItemKey: "RADIO-1",
  raw: {
    candidates: [{
      ...rawCandidate.candidates[0],
      productCapability: { value: "RM-9", state: "SUPPORTED", confidence: 1, sourceUrls: ["https://invented.example"], observedAt: "2026-08-01" },
    }],
  },
  providerSources: [official],
  now,
});
assert.equal(unsupportedResult.candidates[0]?.status, "UNSUPPORTED");
assert.throws(() => approveSupplierCandidate({
  candidate: unsupportedResult.candidates[0]!,
  officeId: "office-a",
  workspaceId: "workspace-a",
  reviewerUserId: "reviewer-1",
}), /cannot become approved/i);

const noSource = normalizeSupplierResearch({
  officeId: "office-a",
  workspaceId: "workspace-a",
  componentItemKey: "RADIO-1",
  raw: rawCandidate,
  providerSources: [],
  now,
});
assert.equal(noSource.degraded, true);
assert.deepEqual(noSource.candidates, []);
assert.match(noSource.warnings[0]!, /no attributable public sources/i);

const supportedEnvelope = (value: string): EvidenceEnvelope<string> => ({
  value,
  state: "SUPPORTED",
  confidence: 1,
  sources: [official],
  observedAt: "2026-08-01T00:00:00.000Z",
  freshness: "FRESH",
});
const provider: ProviderCandidate = {
  id: "broker-1",
  officeId: "office-a",
  workspaceId: "workspace-a",
  role: "CUSTOMS_BROKER",
  companyName: "Broker One",
  sourceUrls: [official.url],
  qualifications: { broker_license: supportedEnvelope("License 123") },
};
assert.deepEqual(qualifyProviderCandidate(provider), {
  status: "REVIEW_REQUIRED",
  missing: ["jurisdiction"],
  role: "CUSTOMS_BROKER",
});
provider.qualifications.jurisdiction = supportedEnvelope("United States");
assert.equal(qualifyProviderCandidate(provider).status, "EVIDENCE_COMPLETE");

const signals = filterRelevantSupplySignals({
  signals: [
    { id: "component", kind: "TARIFF", affectedType: "COMPONENT", affectedKey: "RADIO-1", sourceUrl: official.url, observedAt: "2026-08-01" },
    { id: "fake-customs-lane", kind: "CUSTOMS", affectedType: "MOVEMENT", affectedKey: "ACE CATAIR -> Updates", sourceUrl: official.url, observedAt: "2026-08-01" },
    { id: "real-lane", kind: "CUSTOMS", affectedType: "MOVEMENT", affectedKey: "Shanghai -> Long Beach", sourceUrl: official.url, observedAt: "2026-08-01" },
    { id: "unrelated", kind: "CAPACITY", affectedType: "SUPPLIER_REGION", affectedKey: "EU", sourceUrl: official.url, observedAt: "2026-08-01" },
  ],
  componentKeys: new Set(["RADIO-1"]),
  supplierRegions: new Set(["US"]),
  movementKeys: new Set(["ACE CATAIR -> Updates", "Shanghai -> Long Beach"]),
});
assert.deepEqual(signals.map((signal) => signal.id), ["component", "real-lane"]);

assert.equal(rejectsLoginOrPaywall("https://example.com/login", "public page"), true);
assert.equal(rejectsLoginOrPaywall("https://example.com/news", "Subscribe to continue"), true);
assert.equal(rejectsLoginOrPaywall("https://example.com/news", "Public product catalog"), false);

const limiter = new ResearchRateLimiter(2, 1_000);
assert.equal(limiter.consume("office-a", 0), true);
assert.equal(limiter.consume("office-a", 1), true);
assert.equal(limiter.consume("office-a", 2), false);
assert.equal(limiter.consume("office-a", 1_001), true);

async function verifyNetworkPolicy() {
  await assert.rejects(() => assertPublicResearchUrl("http://127.0.0.1/catalog"), /private address/i);
}

verifyNetworkPolicy().then(() => {
  console.log("Supply OS ingestion and research trust contract passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
