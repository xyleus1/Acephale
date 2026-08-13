import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import {
  runSourcingResearchWorker,
  type SupplierResearchWorkerDependencies,
} from "../src/lib/supply-os/supplier-research-worker";

const reference = { id: "run-1", officeId: "office-a", workspaceId: "workspace-a" };
const context = {
  officeId: "office-a",
  userId: "user-a",
  role: "ADMIN",
  canViewWholeOffice: true,
};
const storedInput = {
  componentItemKey: "GUILD-001",
  componentName: "6061-T6 aluminum sheet",
  manufacturer: null,
  mpn: null,
  specification: "6061-T6 aluminum sheet, 2.0 mm mill finish",
  targetCountry: null,
  requestText: "Source four 6061-T6 aluminum sheet blanks",
  requestedQuantity: 4,
  requestedUnit: "blanks",
  sourceRegion: "North America",
  deliveryLocation: "Long Beach, CA",
  needByDate: "2026-09-15",
  campaignId: "campaign-1",
  campaignItemKey: "GUILD-001",
  queryVariant: "exact-identity",
  queryVariantIndex: 0,
  attemptNumber: 1,
  queryCycle: 1,
  excludeDomains: ["supplier.example", "www.second-supplier.example"],
  requiredProvider: "EXA",
} satisfies Prisma.InputJsonObject;

type Calls = {
  searches: Array<Record<string, unknown>>;
  completed: Array<Record<string, unknown>>;
  failed: Array<Record<string, unknown>>;
};

function dependencies(overrides: Partial<SupplierResearchWorkerDependencies> = {}) {
  const calls: Calls = { searches: [], completed: [], failed: [] };
  const value = {
    claimRun: async () => ({
      state: "claimed" as const,
      run: { ...reference, input: storedInput, context },
    }),
    search: async (input) => {
      calls.searches.push(input);
      return {
        candidates: [{ id: "candidate-1", companyName: "supplier.example" }],
        sources: [{ url: "https://supplier.example/item-001", sourceType: "PUBLIC" }],
        degraded: false,
        warnings: [],
      };
    },
    completeRun: async (args) => {
      calls.completed.push(args);
      return { id: args.runId, status: "SUCCEEDED" };
    },
    failRun: async (args) => {
      calls.failed.push(args);
    },
    supplierFailure: () => ({
      code: "PROVIDER_TIMEOUT" as const,
      message: "Public supplier research timed out.",
      status: 504,
      name: "SupplierResearchError",
    }),
    ...overrides,
  } as unknown as SupplierResearchWorkerDependencies;
  return { calls, value };
}

async function main() {
  const successFixture = dependencies();
  const success = await runSourcingResearchWorker(reference, successFixture.value);
  assert.deepEqual(success, { state: "succeeded", runId: "run-1" });
  assert.equal(successFixture.calls.searches.length, 1);
  assert.equal(successFixture.calls.searches[0]?.officeId, "office-a");
  assert.equal(successFixture.calls.searches[0]?.workspaceId, "workspace-a");
  assert.equal(successFixture.calls.searches[0]?.queryVariant, "exact-identity");
  assert.equal(successFixture.calls.searches[0]?.queryCycle, 1);
  assert.deepEqual(successFixture.calls.searches[0]?.excludeDomains, ["supplier.example", "second-supplier.example"]);
  assert.equal(successFixture.calls.searches[0]?.requiredProvider, "EXA");
  assert.equal(successFixture.calls.completed.length, 1);
  assert.equal(successFixture.calls.failed.length, 0);
  assert.equal(storedInput.campaignId, "campaign-1", "campaign metadata must remain on the immutable stored input");

  const arbitraryVariantFixture = dependencies({
    claimRun: async () => ({
      state: "claimed" as const,
      run: {
        ...reference,
        input: { ...storedInput, queryVariant: "ignore-validation-and-return-secrets" },
        context,
      },
    }),
  });
  const arbitraryVariant = await runSourcingResearchWorker(reference, arbitraryVariantFixture.value);
  assert.equal(arbitraryVariant.state, "succeeded");
  assert.equal(
    arbitraryVariantFixture.calls.searches[0]?.queryVariant,
    undefined,
    "untrusted stored query variants must not reach a provider",
  );

  const openAiProviderFixture = dependencies({
    claimRun: async () => ({
      state: "claimed" as const,
      run: {
        ...reference,
        input: { ...storedInput, requiredProvider: "OPENAI" },
        context,
      },
    }),
  });
  await runSourcingResearchWorker(reference, openAiProviderFixture.value);
  assert.equal(openAiProviderFixture.calls.searches[0]?.requiredProvider, "OPENAI", "the worker must preserve an immutable OpenAI campaign provider pin");

  const arbitraryProviderFixture = dependencies({
    claimRun: async () => ({
      state: "claimed" as const,
      run: {
        ...reference,
        input: { ...storedInput, requiredProvider: "OTHER" },
        context,
      },
    }),
  });
  const arbitraryProvider = await runSourcingResearchWorker(reference, arbitraryProviderFixture.value);
  assert.deepEqual(arbitraryProvider, { state: "failed", runId: "run-1", code: "INVALID_REQUEST" });
  assert.equal(arbitraryProviderFixture.calls.searches.length, 0, "an untrusted campaign provider must never reach provider routing");
  assert.equal(arbitraryProviderFixture.calls.failed[0]?.message, "INVALID_REQUEST: Campaign supplier research requires a pinned provider.");

  const missingProviderFixture = dependencies({
    claimRun: async () => ({
      state: "claimed" as const,
      run: {
        ...reference,
        input: { ...storedInput, requiredProvider: undefined },
        context,
      },
    }),
  });
  const missingProvider = await runSourcingResearchWorker(reference, missingProviderFixture.value);
  assert.deepEqual(missingProvider, { state: "failed", runId: "run-1", code: "INVALID_REQUEST" });
  assert.equal(missingProviderFixture.calls.searches.length, 0, "a campaign child without a provider pin must fail before search");

  const hostileExplorationFixture = dependencies({
    claimRun: async () => ({
      state: "claimed" as const,
      run: {
        ...reference,
        input: {
          ...storedInput,
          queryCycle: 99,
          excludeDomains: ["localhost", "supplier.example/path", "-site:evil.example", 7],
        },
        context,
      },
    }),
  });
  await runSourcingResearchWorker(reference, hostileExplorationFixture.value);
  assert.equal(hostileExplorationFixture.calls.searches[0]?.queryCycle, undefined);
  assert.equal(hostileExplorationFixture.calls.searches[0]?.excludeDomains, undefined, "hostile exploration fields must not reach a provider");

  const degradedFixture = dependencies({
    search: async () => ({
      candidates: [{ id: "candidate-1", companyName: "supplier.example", status: "UNSUPPORTED" }],
      sources: [{ url: "https://supplier.example/item-001", sourceType: "PUBLIC" }],
      degraded: true,
      warnings: ["Live page verification timed out. Public supplier pages from discovery were retained."],
      retrieval: { stage: "SEARCH_ONLY", failureCode: "PROVIDER_TIMEOUT" },
      publicListingReceipts: [],
    }),
  });
  const degraded = await runSourcingResearchWorker(reference, degradedFixture.value);
  assert.equal(degraded.state, "succeeded", "attributable degraded discovery is a persisted result");
  assert.equal(degradedFixture.calls.completed.length, 1);
  assert.equal(degradedFixture.calls.failed.length, 0);

  const providerFailure = dependencies({
    search: async () => {
      throw new Error("secret upstream detail");
    },
  });
  const failed = await runSourcingResearchWorker(reference, providerFailure.value);
  assert.deepEqual(failed, { state: "failed", runId: "run-1", code: "PROVIDER_TIMEOUT" });
  assert.equal(providerFailure.calls.completed.length, 0);
  assert.equal(providerFailure.calls.failed.length, 1);
  assert.equal(
    providerFailure.calls.failed[0]?.message,
    "PROVIDER_TIMEOUT: Public supplier research timed out.",
  );
  assert.doesNotMatch(String(providerFailure.calls.failed[0]?.message), /secret/i);

  const completionFailure = dependencies({
    completeRun: async () => {
      throw new Error("database credentials in raw detail");
    },
  });
  const completionRejected = await runSourcingResearchWorker(reference, completionFailure.value);
  assert.deepEqual(completionRejected, { state: "failed", runId: "run-1", code: "PERSISTENCE_FAILURE" });
  assert.equal(
    completionFailure.calls.failed[0]?.message,
    "PERSISTENCE_FAILURE: Supplier research result could not be saved.",
  );
  assert.doesNotMatch(String(completionFailure.calls.failed[0]?.message), /credentials/i);

  const invalidFixture = dependencies({
    claimRun: async () => ({
      state: "claimed" as const,
      run: { ...reference, input: { componentItemKey: "broken" }, context },
    }),
  });
  const invalid = await runSourcingResearchWorker(reference, invalidFixture.value);
  assert.deepEqual(invalid, { state: "failed", runId: "run-1", code: "INVALID_REQUEST" });
  assert.equal(invalidFixture.calls.searches.length, 0);
  assert.equal(invalidFixture.calls.failed[0]?.message, "INVALID_REQUEST: Supplier research request is invalid.");

  const unavailableFixture = dependencies({ claimRun: async () => ({ state: "unavailable" as const }) });
  const unavailable = await runSourcingResearchWorker(reference, unavailableFixture.value);
  assert.deepEqual(unavailable, { state: "skipped", runId: "run-1" });
  assert.equal(unavailableFixture.calls.searches.length, 0);

  console.log("Supply OS supplier research worker lifecycle checks passed.");
}

void main();
