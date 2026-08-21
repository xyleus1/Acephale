import assert from "node:assert/strict";
import {
  missingSourcingFields,
  shouldLoadSourcingHistory,
  sourcingRequestStorageKey,
} from "../src/lib/supply-os/sourcing-request-contract";
import { sourcingDraftFromResearchInput } from "../src/lib/supply-os/sourcing-research-navigation";

const savedInput = {
  componentName: "6061-T6 aluminum sheet",
  manufacturer: null,
  mpn: null,
  specification: "6061-T6 sheet, 2.0 mm, mill finish",
  targetCountry: "United States",
  requestedQuantity: 4,
  requestedUnit: "blanks",
  sourceRegion: "North America",
  deliveryLocation: "Long Beach, CA",
  needByDate: "2026-09-15",
};

const restored = sourcingDraftFromResearchInput(savedInput);
assert.deepEqual(restored, {
  productName: "6061-T6 aluminum sheet",
  quantity: 4,
  unit: "blanks",
  manufacturer: null,
  partNumber: null,
  specification: "6061-T6 sheet, 2.0 mm, mill finish",
  sourceRegion: "North America",
  deliveryLocation: "Long Beach, CA",
  needByDate: "2026-09-15",
});
assert.deepEqual(missingSourcingFields(restored), [], "retrying a complete failed run must return directly to research without another clarification cycle");

const countryFallback = sourcingDraftFromResearchInput({
  ...savedInput,
  deliveryLocation: null,
  targetCountry: "Canada",
});
assert.equal(countryFallback.deliveryLocation, "Canada", "legacy saved runs may restore their target country as the delivery location");

const incomplete = sourcingDraftFromResearchInput({
  ...savedInput,
  requestedQuantity: null,
  requestedUnit: null,
  deliveryLocation: null,
  targetCountry: null,
  needByDate: null,
});
assert.deepEqual(missingSourcingFields(incomplete), ["quantity", "unit", "deliveryLocation", "needByDate"]);

assert.notEqual(
  sourcingRequestStorageKey({ storageScope: "office:user", dashboardId: "customer", workspaceId: "workspace-a" }),
  sourcingRequestStorageKey({ storageScope: "office:user", dashboardId: "customer", workspaceId: "workspace-b" }),
  "pending retries must not leak between customer workspaces",
);

assert.equal(
  shouldLoadSourcingHistory({ workspaceId: "workspace-a" }),
  true,
  "a real customer workspace must reload its saved research and procurement history",
);
assert.equal(
  shouldLoadSourcingHistory({ workspaceId: null }),
  false,
  "a surface without a selected workspace has no sourcing history to load",
);

console.log("Supply OS saved research retry restoration checks passed.");
