import assert from "node:assert/strict";
import { assessDomesticTruckingPricing } from "../src/lib/domestic-trucking-pricing";

const incomplete = assessDomesticTruckingPricing({
  id: "rfq-missing",
  officeId: "office-1",
  subject: "Need road quote",
  mode: "ROAD",
});

assert.equal(incomplete.eligible, true, "ROAD RFQs should be domestic-trucking eligible");
assert(incomplete.blockers.some((blocker) => blocker.includes("pickup")), "pickup window should block provider lookup");
assert.equal(incomplete.rateOptions.length, 0, "missing fields should prevent mock options");
assert.equal(incomplete.quoteDraft.status, "BLOCKED", "missing fields should block quote draft");

const complete = assessDomesticTruckingPricing({
  id: "rfq-ready",
  officeId: "office-1",
  subject: "Dallas to Phoenix dry van",
  fromEmail: "ops@example.com",
  fromCompany: "Acme Shipper",
  origin: "Dallas, TX",
  destination: "Phoenix, AZ",
  mode: "ROAD",
  containerType: "53 dry van",
  packages: 18,
  commodity: "Consumer goods",
  weight: 8164,
  volume: 42,
  cargoReadyDate: "2026-07-02T09:00:00.000Z",
  dangerousGoods: "NO",
  parsedData: JSON.stringify({
    temperatureControl: false,
    accessorials: [],
    accessorialsKnown: true,
    specialInstructions: "Dock to dock. Business hours pickup.",
  }),
  company: { name: "Acme Shipper" },
});

assert.equal(complete.eligible, true);
assert.equal(complete.blockers.length, 0, "complete request should have no blocking fields");
assert.equal(complete.rateOptions.length, 2, "mock provider should return deterministic benchmark options");
assert(complete.rateOptions.every((option) => option.canBook === false && option.canTender === false), "V1 must not book or tender");
assert.equal(complete.quoteDraft.status, "DRAFT_ONLY");
assert.equal(complete.quoteDraft.approvalState, "PENDING_HUMAN_APPROVAL");
assert(complete.providerCredentialStatuses.some((provider) => provider.providerCode === "manual_buy_rate"), "manual provider should be visible");
assert(complete.providerCredentialStatuses.every((provider) => provider.canBook === false && provider.canTender === false), "providers must be quote-only in V1");

const hazmatMissingDetails = assessDomesticTruckingPricing({
  id: "rfq-hazmat",
  officeId: "office-1",
  subject: "Hazmat road quote",
  fromEmail: "ops@example.com",
  origin: "Dallas, TX",
  destination: "Phoenix, AZ",
  mode: "ROAD",
  containerType: "53 dry van",
  packages: 10,
  commodity: "Chemicals",
  weight: 5000,
  cargoReadyDate: "2026-07-02T09:00:00.000Z",
  dangerousGoods: "YES",
  parsedData: JSON.stringify({
    temperatureControl: false,
    accessorialsKnown: true,
  }),
});

assert(hazmatMissingDetails.missingRequiredFields.some((field) => field.key === "hazmat_details"));
assert.equal(hazmatMissingDetails.rateOptions.length, 0, "hazmat quote should block without details");

const ocean = assessDomesticTruckingPricing({
  id: "rfq-ocean",
  officeId: "office-1",
  subject: "Shanghai to Istanbul",
  mode: "SEA-FCL",
});

assert.equal(ocean.eligible, false, "non-road freight should not be domestic-trucking eligible");

console.log("domestic-trucking-pricing tests passed");
