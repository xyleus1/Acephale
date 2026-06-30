import assert from "node:assert/strict";
import { mergeRfqLoadDraftValues } from "../src/lib/rfq-load-draft-core";

const draft = mergeRfqLoadDraftValues({
  companyId: "company-1",
  companyName: "Acme Logistics",
  rfq: {
    id: "rfq-1",
    title: "New order",
    origin: "Port Klang, MY",
    mode: "SEA-FCL",
    targetPrice: null,
    targetPriceStatus: "UNKNOWN",
  },
  priorLoad: {
    id: "job-1",
    reference: "JOB-2026-011",
    origin: "Shanghai, CN",
    destination: "Istanbul, TR",
    mode: "AIR",
    commodity: "Plastic resin",
    incoterms: "FOB",
    containerCount: 2,
    containerType: "40HC",
    dangerousGoods: "NO",
    customsBy: "US",
    targetPrice: 8800,
    targetCurrency: "USD",
    targetPriceStatus: "PROVIDED",
  },
});

assert.equal(draft.values.origin, "Port Klang, MY", "current RFQ origin should beat prior load origin");
assert.equal(draft.sources.origin.kind, "rfq");

assert.equal(draft.values.destination, "Istanbul, TR", "blank destination should carry from prior customer load");
assert.equal(draft.sources.destination.kind, "prior_load");
assert(draft.carriedFromPrior.includes("destination"));

assert.equal(draft.values.mode, "SEA-FCL", "current RFQ mode should beat prior load mode");
assert.equal(draft.values.containerType, "40HC", "container type can carry when RFQ omits it");
assert.equal(draft.values.dangerousGoods, "NO", "DG posture can carry as reviewable history");
assert.equal(draft.values.customsBy, "US", "customs posture can carry as reviewable history");

assert.equal(draft.values.targetPrice, null, "prior target price must not be carried silently");
assert.equal(draft.values.targetPriceStatus, "UNKNOWN", "prior target status must not be carried silently");

const proposedWins = mergeRfqLoadDraftValues({
  companyName: "Acme Logistics",
  rfq: { id: "rfq-2", destination: "Hamburg, DE" },
  proposedLoad: { id: "job-proposed", reference: "JOB-2026-012", destination: "Bremen, DE" },
  priorLoad: { id: "job-old", reference: "JOB-2026-010", destination: "Istanbul, TR" },
});

assert.equal(proposedWins.values.destination, "Bremen, DE", "operator-edited proposed load should beat RFQ/prior defaults");
assert.equal(proposedWins.sources.destination.kind, "proposed_load");

console.log("rfq-load-draft tests passed");

