import assert from "node:assert/strict";
import {
  createCascadingSearchProvider,
  createHtmlSearchProvider,
  createSerperSearchProvider,
  selectSearchProvider,
  type SearchProvider,
} from "../src/lib/leadgen/search";
import { runProspectingBatch } from "../src/lib/leadgen/run";
import { MANEKS_PROFILE } from "../src/lib/leadgen/profile";
import { calculateLeadDiscoveryReport, percentage } from "../src/lib/leadgen/report";
import { recordLeadDiscoveries } from "../src/lib/leadgen/persist";
import { prisma } from "../src/lib/prisma";

// Paid providers must never be reached from the suite, even on a machine with keys.
delete process.env.BOUNCER_API_KEY;
delete process.env.HUNTER_API_KEY;

const freePage = (domain: string) => `<a href="https://${domain}/contact">${domain}</a>`;

async function main() {

let freeCalls = 0;
const enoughProvider = createCascadingSearchProvider({
  serperApiKey: "test-key",
  threshold: 2,
  fetchPage: async () => {
    freeCalls += 1;
    return freePage("free.example");
  },
  serperProvider: {
    name: "serper",
    searchWithStats: async () => ({
      hits: [
        { url: "https://paid-one.example/", domain: "paid-one.example", engine: "serper", rank: 1, provider: "serper" },
        { url: "https://paid-two.example/", domain: "paid-two.example", engine: "serper", rank: 2, provider: "serper" },
      ],
      pagesFetched: 1,
      providersUsed: ["serper"],
    }),
    search: async () => {
      throw new Error("search should use searchWithStats");
    },
  },
});
const enoughHits = await enoughProvider.search("steel buyers");
assert.equal(freeCalls, 0);
assert.deepEqual(enoughHits.map((hit) => hit.engine), ["serper", "serper"]);
assert.ok(enoughHits.every((hit) => hit.provider === "serper"));
const enoughResult = await enoughProvider.searchWithStats!("steel buyers");
assert.equal(enoughResult.pagesFetched, 1);
assert.deepEqual(enoughResult.providersUsed, ["serper"]);

let mergedFreeCalls = 0;
const mergedProvider = createCascadingSearchProvider({
  threshold: 3,
  serperApiKey: "test-key",
  freeEngines: ["duckduckgo", "brave", "bing"],
  fetchPage: async (url) => {
    mergedFreeCalls += 1;
    const host = new URL(url).hostname;
    return freePage(host === "html.duckduckgo.com" ? "free-one.example" : "free-two.example");
  },
  serperProvider: {
    name: "serper",
    searchWithStats: async () => ({
      hits: [{ url: "https://paid.example/", domain: "paid.example", engine: "serper", rank: 1, provider: "serper" }],
      pagesFetched: 1,
      providersUsed: ["serper"],
    }),
    search: async () => [],
  },
});
const mergedResult = await mergedProvider.searchWithStats!("merged query");
assert.equal(mergedFreeCalls, 2);
assert.equal(mergedResult.pagesFetched, 3);
assert.deepEqual(mergedResult.providersUsed, ["serper", "html:duckduckgo", "html:brave"]);
assert.deepEqual(mergedResult.hits.map((hit) => hit.domain), [
  "paid.example",
  "free-one.example",
  "free-two.example",
]);

let nullHtmlFetches = 0;
const nullHtml = createHtmlSearchProvider({
  fetchPage: async () => {
    nullHtmlFetches += 1;
    return null;
  },
});
const nullHtmlResult = await nullHtml.searchWithStats!("empty page");
assert.equal(nullHtmlFetches, 1);
assert.equal(nullHtmlResult.pagesFetched, 1);
assert.deepEqual((await createSerperSearchProvider("").searchWithStats!("no key")).pagesFetched, 0);

let fallbackCalls = 0;
const fallbackSerper: SearchProvider = {
  name: "serper",
  search: async () => {
    fallbackCalls += 1;
    return [{ url: "https://paid.example/", domain: "paid.example", engine: "serper", rank: 1, provider: "serper" }];
  },
};
const thinProvider = createCascadingSearchProvider({
  serperApiKey: "test-key",
  fetchPage: async () => null,
  serperProvider: fallbackSerper,
});
const thinHits = await thinProvider.search("thin query");
assert.equal(fallbackCalls, 1);
assert.equal(thinHits[0]?.engine, "serper");
const thinResult = await thinProvider.searchWithStats!("thin query");
assert.equal(thinResult.pagesFetched, 4);

let dedupeFallbackCalls = 0;
const dedupeProvider = createCascadingSearchProvider({
  threshold: 3,
  serperApiKey: "test-key",
  fetchPage: async (url) => new URL(url).hostname === "html.duckduckgo.com"
    ? `<a href="https://same.example/one">one</a><a href="https://same.example/two">two</a><a href="https://same.example/three">three</a>`
    : null,
  serperProvider: {
    name: "serper",
    search: async () => {
      dedupeFallbackCalls += 1;
      return [];
    },
  },
});
await dedupeProvider.search("duplicate query");
assert.equal(dedupeFallbackCalls, 1);

let noKeyCalls = 0;
const noKeyProvider = createCascadingSearchProvider({
  serperApiKey: "",
  freeEngines: ["duckduckgo", "brave", "bing"],
  fetchPage: async () => {
    noKeyCalls += 1;
    return null;
  },
  serperProvider: { name: "serper", search: async () => { noKeyCalls += 1; return []; } },
});
const noKeyResult = await noKeyProvider.searchWithStats!("no paid access");
assert.equal(noKeyCalls, 3);
assert.equal(noKeyResult.pagesFetched, 3);
assert.deepEqual(noKeyResult.providersUsed, ["html:duckduckgo", "html:brave", "html:bing"]);

let budgetSerperCalls = 0;
let budgetFreeCalls = 0;
const budgetProvider = createCascadingSearchProvider({
  threshold: 3,
  serperApiKey: "test-key",
  fetchPage: async () => {
    budgetFreeCalls += 1;
    return freePage("budget-free.example");
  },
  serperProvider: {
    name: "serper",
    searchWithStats: async () => {
      budgetSerperCalls += 1;
      return {
        hits: [],
        pagesFetched: 1,
        providersUsed: ["serper"],
      };
    },
    search: async () => [],
  },
});
const budgetResult = await budgetProvider.searchWithStats!("budget query", { maxPagesRemaining: 1 });
assert.equal(budgetSerperCalls, 1);
assert.equal(budgetFreeCalls, 0);
assert.equal(budgetResult.pagesFetched, 1);
assert.deepEqual(budgetResult.providersUsed, ["serper"]);

let zeroBudgetCalls = 0;
const zeroBudgetProvider = createCascadingSearchProvider({
  serperApiKey: "test-key",
  fetchPage: async () => {
    zeroBudgetCalls += 1;
    return null;
  },
  serperProvider: {
    name: "serper",
    search: async () => {
      zeroBudgetCalls += 1;
      return [];
    },
  },
});
const zeroBudgetResult = await zeroBudgetProvider.searchWithStats!("zero budget", { maxPagesRemaining: 0 });
assert.equal(zeroBudgetCalls, 0);
assert.equal(zeroBudgetResult.pagesFetched, 0);
assert.deepEqual(zeroBudgetResult.providersUsed, []);
assert.equal(selectSearchProvider({ providerName: "serper" }).name, "serper");
assert.equal(selectSearchProvider({ providerName: "html" }).name, "html");

const batch = await runProspectingBatch({
  profile: MANEKS_PROFILE,
  maxQueries: 1,
  maxPages: 2,
  search: async () => [{
    url: "https://attributed.example/contact",
    domain: "attributed.example",
    engine: "brave",
    provider: "html",
    rank: 7,
  }],
  fetchPage: async (url) => ({
    url,
    status: 200,
    contentType: "text/html",
    body: "<title>Attributed Steel</title><p>steel manufacturing</p><p>sales@attributed.example</p>",
    isPdf: false,
  }),
  resolveMx: async () => [{ exchange: "mx.attributed.example", priority: 10 }],
});
assert.equal(batch.candidates[0]?.candidate.discoveryProvider, "html");
assert.equal(batch.candidates[0]?.candidate.discoveryEngine, "brave");
assert.equal(batch.candidates[0]?.candidate.discoveryRank, 7);
assert.equal(batch.candidates[0]?.candidate.discoverySourceUrl, "https://attributed.example/contact");

const report = calculateLeadDiscoveryReport(
  [
    { provider: "html", engine: "duckduckgo", campaignTag: "wens", profileSlug: "wens", persisted: true, contactFound: true, usableContact: true, bestEmailVerdict: "deliverable_likely" },
    { provider: "html", engine: "duckduckgo", campaignTag: "wens", profileSlug: "wens", persisted: false, contactFound: false, usableContact: false, bestEmailVerdict: null },
  ],
  [{
    profileSlug: "wens",
    campaignTag: "wens",
    startedAt: new Date("2026-08-25T00:00:00Z"),
    status: "COMPLETED",
    queriesUsed: 2,
    pagesFetched: 4,
    candidatesFound: 2,
    companiesCreated: 1,
    error: null,
    providerStats: { "html:duckduckgo": { queries: 2, hits: 3, candidates: 2 } },
  }],
);
assert.deepEqual(report.providers[0], {
  provider: "html:duckduckgo",
  queries: 2,
  hits: 3,
  candidates: 2,
  companiesPersisted: 1,
  contactNumerator: 1,
  contactDenominator: 2,
  usableContactNumerator: 1,
  usableContactDenominator: 2,
  deliverableNumerator: 1,
  deliverableDenominator: 2,
});
assert.equal(percentage(0, 0), null);
assert.equal(percentage(1, 2), 50);
assert.equal(report.campaigns[0]?.contactNumerator, 1);
assert.equal(report.campaigns[0]?.contactDenominator, 2);
assert.equal(report.campaigns[0]?.usableContactNumerator, 1);
assert.equal(report.campaigns[0]?.usableContactDenominator, 2);

const discoveryRows: Array<Record<string, unknown>> = [];
await recordLeadDiscoveries({ leadDiscovery: {
  create: async ({ data }: { data: Record<string, unknown> }) => {
    discoveryRows.push(data);
    return data;
  },
} } as never, {
  officeId: "office-1",
  runId: "run-1",
  campaignTag: "wens",
  profileSlug: "wens",
  records: [{
    candidate: batch.candidates[0]!.candidate,
    verifications: [{
      email: "sales@attributed.example",
      verdict: "deliverable_likely",
      confidence: 40,
      isRole: true,
      hasMx: true,
      mxHost: "mx.attributed.example",
      isFreeProvider: false,
      domainMatchesCompany: true,
      reasons: ["low confidence"],
    }],
    persisted: false,
  }],
});
assert.equal(discoveryRows.length, 1);
assert.equal(discoveryRows[0]?.contactFound, true);
assert.equal(discoveryRows[0]?.usableContact, false);

const actionContext = {
  officeId: "office-failed-run",
  userId: "user-failed-run",
  role: "ADMIN",
  canViewWholeOffice: true,
};
const actionPayload = {
  schemaVersion: 1,
  type: "PROSPECTING",
  status: "PENDING",
  draft: {
    objective: "Find steel buyers",
    segments: ["steel buyers"],
    regions: ["Turkey"],
    productFocus: "Steel",
    listSlug: "failed-run",
    notes: "",
  },
  citations: [],
  requestMessageId: "message:failed-run",
  requestBody: "Find steel buyers.",
  requestCreatedAt: new Date("2026-08-27T00:00:00Z").toISOString(),
  runningStartedAt: null,
  stats: { queriesUsed: 0, pagesFetched: 0, candidatesFound: 0, rowsCreated: 0, rowsUpdated: 0 },
  nextQueryOffset: 0,
  exhausted: false,
};
const actionUpdates: Array<Record<string, unknown>> = [];
const failedDiscoveries: Array<Record<string, unknown>> = [];
let deletedDiscoveries: Record<string, unknown> | null = null;
const serverOnlyPath = require.resolve("server-only");
const serverOnlyCacheEntry = require.cache[serverOnlyPath];
require.cache[serverOnlyPath] = { exports: {} } as NonNullable<typeof serverOnlyCacheEntry>;
const { runCompanyContextProspectingAction } = await import("../src/lib/supply-os/context-prospecting");
if (serverOnlyCacheEntry) require.cache[serverOnlyPath] = serverOnlyCacheEntry;
else delete require.cache[serverOnlyPath];
const originalMethods = {
  workspaceFindFirst: prisma.supplyWorkspace.findFirst,
  contextFindFirst: prisma.companyContext.findFirst,
  contextUpdateMany: prisma.companyContext.updateMany,
  runCreate: prisma.leadGenRun.create,
  runUpdateMany: prisma.leadGenRun.updateMany,
  listFindMany: prisma.researchList.findMany,
  listFindUnique: prisma.researchList.findUnique,
  recordFindMany: prisma.researchRecord.findMany,
  recordUpsert: prisma.researchRecord.upsert,
  discoveryCreate: prisma.leadDiscovery.create,
  discoveryDeleteMany: prisma.leadDiscovery.deleteMany,
};
const replaceMethod = (target: object, key: string, value: unknown) => {
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
};
try {
  replaceMethod(prisma.supplyWorkspace, "findFirst", async () => ({
    id: "workspace-failed-run",
    officeId: actionContext.officeId,
    companyId: "company-failed-run",
    name: "Failed run workspace",
    members: [{ role: "OWNER" }],
  }));
  replaceMethod(prisma.companyContext, "findFirst", async () => ({
    id: "action-failed-run",
    payload: actionPayload,
    createdAt: new Date("2026-08-27T00:00:00Z"),
  }));
  replaceMethod(prisma.companyContext, "updateMany", async ({ data }: { data: Record<string, unknown> }) => {
    actionUpdates.push(data);
    return { count: 1 };
  });
  replaceMethod(prisma.leadGenRun, "create", async () => ({ id: "run-failed-run" }));
  replaceMethod(prisma.leadGenRun, "updateMany", async ({ data }: { data: Record<string, unknown> }) => {
    if (data.status === "COMPLETED") throw new Error("completion write failed");
    return { count: 1 };
  });
  replaceMethod(prisma.researchList, "findMany", async () => [{
    id: "list-failed-run",
    officeId: actionContext.officeId,
    slug: "failed-run",
    name: "failed-run",
    description: null,
    fields: [
      { key: "company_name", label: "Company", type: "text" },
      { key: "domain", label: "Domain", type: "text" },
      { key: "email", label: "Email", type: "email" },
    ],
    createdAt: new Date("2026-08-27T00:00:00Z"),
    updatedAt: new Date("2026-08-27T00:00:00Z"),
    _count: { records: 0 },
  }]);
  replaceMethod(prisma.researchList, "findUnique", async () => ({
    id: "list-failed-run",
    officeId: actionContext.officeId,
    slug: "failed-run",
    name: "failed-run",
    description: null,
    fields: [
      { key: "company_name", label: "Company", type: "text" },
      { key: "domain", label: "Domain", type: "text" },
      { key: "email", label: "Email", type: "email" },
    ],
    createdAt: new Date("2026-08-27T00:00:00Z"),
    updatedAt: new Date("2026-08-27T00:00:00Z"),
  }));
  replaceMethod(prisma.researchRecord, "findMany", async () => []);
  replaceMethod(prisma.researchRecord, "upsert", async () => ({ id: "record-failed-run" }));
  replaceMethod(prisma.leadDiscovery, "create", async ({ data }: { data: Record<string, unknown> }) => {
    failedDiscoveries.push(data);
    return data;
  });
  replaceMethod(prisma.leadDiscovery, "deleteMany", async ({ where }: { where: Record<string, unknown> }) => {
    deletedDiscoveries = where;
    return { count: failedDiscoveries.length };
  });

  await assert.rejects(
    () => runCompanyContextProspectingAction({
      context: actionContext,
      workspaceId: "workspace-failed-run",
      actionId: "action-failed-run",
      runBatch: async () => ({
        candidates: [batch.candidates[0]!],
        stats: { queriesUsed: 1, pagesFetched: 1, candidatesFound: 1 },
        nextQueryOffset: 1,
        exhausted: true,
      }),
    }),
    /completion write failed/,
  );
  assert.equal(failedDiscoveries.length, 1);
  assert.deepEqual(deletedDiscoveries, {
    officeId: actionContext.officeId,
    runId: "run-failed-run",
  });
  assert.equal(actionUpdates.at(-1)?.processingState, "FAILED");
} finally {
  replaceMethod(prisma.supplyWorkspace, "findFirst", originalMethods.workspaceFindFirst);
  replaceMethod(prisma.companyContext, "findFirst", originalMethods.contextFindFirst);
  replaceMethod(prisma.companyContext, "updateMany", originalMethods.contextUpdateMany);
  replaceMethod(prisma.leadGenRun, "create", originalMethods.runCreate);
  replaceMethod(prisma.leadGenRun, "updateMany", originalMethods.runUpdateMany);
  replaceMethod(prisma.researchList, "findMany", originalMethods.listFindMany);
  replaceMethod(prisma.researchList, "findUnique", originalMethods.listFindUnique);
  replaceMethod(prisma.researchRecord, "findMany", originalMethods.recordFindMany);
  replaceMethod(prisma.researchRecord, "upsert", originalMethods.recordUpsert);
  replaceMethod(prisma.leadDiscovery, "create", originalMethods.discoveryCreate);
  replaceMethod(prisma.leadDiscovery, "deleteMany", originalMethods.discoveryDeleteMany);
}

console.log("leadgen attribution: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
