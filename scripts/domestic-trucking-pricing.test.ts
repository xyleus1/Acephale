import assert from "node:assert/strict";
import { assessDomesticTruckingPricing } from "../src/lib/domestic-trucking-pricing";

const incomplete = assessDomesticTruckingPricing({
  id: "rfq-missing",
  officeId: "office-1",
  subject: "Need road quote",
  mode: "ROAD",
});

assert.equal(incomplete.eligible, false, "ROAD alone is not enough; V1 requires US pickup and delivery");
assert.equal(incomplete.eligibilityStatus, "missing_info");
assert.equal(incomplete.marketScope, "UNKNOWN");
assert(incomplete.blockers.some((blocker) => blocker.includes("US pickup")), "US pickup should block provider lookup");
assert(incomplete.nextQuestions.some((question) => question.includes("pickup")), "missing pickup should produce an operator question");
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
assert.equal(complete.eligibilityStatus, "eligible");
assert.equal(complete.marketScope, "US_DOMESTIC");
assert.equal(complete.blockers.length, 0, "complete request should have no blocking fields");
assert.equal(complete.rateOptions.length, 2, "mock provider should return deterministic benchmark options");
assert(complete.rateOptions.every((option) => option.canBook === false && option.canTender === false), "V1 must not book or tender");
assert(complete.rateOptions.every((option) => option.rateSource === "mock"), "V1 options should be explicitly mock unless manually entered");
assert(complete.rateOptions.every((option) => option.provenance.includes("mock_domestic_market")), "mock options need provenance");
assert(complete.rateOptions.every((option) => option.terms.length > 0 && option.notes.length > 0), "rate options need terms and notes");
assert.equal(complete.rateOptions.filter((option) => option.selected).length, 1, "draft basis should select exactly one option");
assert.equal(complete.quoteDraft.status, "DRAFT_ONLY");
assert.equal(complete.quoteDraft.approvalState, "needs_approval");
assert.equal(complete.quoteDraft.customerSendState, "sent_disabled_v1");
assert(complete.quoteDraft.selectedOptionProvenance?.includes("mock_domestic_market"));
assert(complete.providerCredentialStatuses.some((provider) => provider.providerCode === "manual_buy_rate"), "manual provider should be visible");
assert(complete.providerCredentialStatuses.every((provider) => provider.canBook === false && provider.canTender === false), "providers must be quote-only in V1");
assert(complete.safetyLabels.includes("Draft only"));
assert(complete.safetyLabels.includes("No live provider API connected"));
assert(complete.auditLogPreview.every((entry) => entry.noExternalAction === true), "audit preview must not imply external action");

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
assert.equal(hazmatMissingDetails.eligibilityStatus, "missing_info");
assert.equal(hazmatMissingDetails.rateOptions.length, 0, "hazmat quote should block without details");

const hazmatReady = assessDomesticTruckingPricing({
  id: "rfq-hazmat-ready",
  officeId: "office-1",
  subject: "Hazmat road quote with details",
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
    hazmatDetails: "UN1993 Class 3 PG II MSDS on file",
  }),
});

assert.equal(hazmatReady.eligible, true);
assert.equal(hazmatReady.eligibilityStatus, "needs_human_review", "hazmat can be rate-shaped but needs operator review");
assert(hazmatReady.nextQuestions.some((question) => question.includes("hazmat")), "hazmat should produce a review question");

const turkeyRoad = assessDomesticTruckingPricing({
  id: "rfq-turkey",
  officeId: "office-1",
  subject: "Istanbul to Konya road",
  fromEmail: "ops@example.com",
  origin: "Istanbul, Turkey",
  destination: "Konya, Turkey",
  mode: "ROAD",
  containerType: "20GP",
  packages: 1,
  commodity: "Machinery",
  weight: 1000,
  cargoReadyDate: "2026-07-02T09:00:00.000Z",
  dangerousGoods: "NO",
  parsedData: JSON.stringify({
    temperatureControl: false,
    accessorialsKnown: true,
  }),
});

assert.equal(turkeyRoad.eligible, false, "Turkey road lanes must not appear as US domestic");
assert.equal(turkeyRoad.marketScope, "NON_US");
assert(turkeyRoad.blockers.some((blocker) => blocker.includes("US-only")));
assert.equal(turkeyRoad.rateOptions.length, 0);

const transatlanticRoad = assessDomesticTruckingPricing({
  id: "rfq-long-beach-lisbon",
  officeId: "office-1",
  subject: "Long Beach to Lisbon",
  fromEmail: "ops@example.com",
  origin: "Long Beach",
  destination: "Lisbon",
  mode: "ROAD",
  containerType: "53 dry van",
  packages: 4,
  commodity: "Parts",
  weight: 1200,
  cargoReadyDate: "2026-07-02T09:00:00.000Z",
  dangerousGoods: "NO",
  parsedData: JSON.stringify({
    temperatureControl: false,
    accessorialsKnown: true,
  }),
});

assert.equal(transatlanticRoad.eligible, false, "one US endpoint is not US domestic");
assert.equal(transatlanticRoad.marketScope, "NON_US");

const ocean = assessDomesticTruckingPricing({
  id: "rfq-ocean",
  officeId: "office-1",
  subject: "Shanghai to Istanbul",
  mode: "SEA-FCL",
});

assert.equal(ocean.eligible, false, "non-road freight should not be domestic-trucking eligible");

console.log("domestic-trucking-pricing tests passed");
