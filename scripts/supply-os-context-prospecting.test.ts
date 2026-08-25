import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { buildQueryPlan } from "../src/lib/leadgen/query-plan";
import {
  profileFromProspectingDraft,
  runProspectingBatch,
  searchProspectingQuery,
} from "../src/lib/leadgen/run";
import type { FetchedPage } from "../src/lib/leadgen/harvest";
import {
  createCompanyContextProspectingActions,
  dismissCompanyContextProspectingAction,
  listCompanyContextProspectingActions,
  runCompanyContextProspectingAction,
} from "../src/lib/supply-os/context-prospecting";
import { createSupplyWorkspace, type SupplyAccessContext } from "../src/lib/supply-os/persistence";
import type { ProspectingBatchCandidate } from "../src/lib/leadgen/run";

const draft = {
  objective: "Find steel fabricators",
  segments: ["steel fabricators"],
  regions: ["Venezuela", "Russia"],
  productFocus: "Non-bulk steel and ore",
  listSlug: "steel-buyers",
  notes: "",
};
const profile = profileFromProspectingDraft(draft);
assert.equal(profileFromProspectingDraft({ ...draft, segments: [] }).segments.length, 0);
assert.deepEqual(profile.regions, draft.regions);
assert.equal(profile.offering, draft.productFocus);
assert.ok(profile.positiveSignals.includes("steel"));
assert.equal(profile.customerName, "Prospecting");
assert.equal(profile.segments[0]?.label, "steel fabricators");
const regionPlan = buildQueryPlan(profile, { segmentKeys: [profile.segments[0]!.key] });
assert.ok(regionPlan.some((query) => query.region === "Venezuela" && query.query.includes("company contact email")));
assert.ok(regionPlan.some((query) => query.region === "Russia" && query.query.includes("buyers distributors")));
assert.ok(regionPlan.some((query) => query.region === null && query.query.includes("firma iletisim")));
assert.ok(regionPlan.some((query) => query.region === null && query.query.includes("company contact email")));
const turkishPlan = buildQueryPlan({ ...profile, regions: ["Istanbul"] }, { segmentKeys: [profile.segments[0]!.key] });
assert.ok(turkishPlan.some((query) => query.region === "Istanbul" && query.query.includes("firma iletisim")));
assert.ok(turkishPlan.every((query) => query.region !== "Istanbul" || !query.query.includes("company contact email")));

async function main() {
  let searchCalls = 0;
  let pageCalls = 0;
  let firstQueryId = "";
  const page: FetchedPage = {
  url: "https://example-steel.test/",
  status: 200,
  contentType: "text/html",
  body: "<title>Example Steel Manufacturing</title><p>steel fabrication manufacturing</p><a href='/contact'>Contact</a>",
  isPdf: false,
  };
  const contact: FetchedPage = {
  ...page,
  url: "https://example-steel.test/contact",
  body: "<p>sales@example-steel.test +90 212 555 12 34</p>",
  };
  const result = await runProspectingBatch({
  profile,
  maxQueries: 1,
  maxPages: 2,
  budgetMs: 10_000,
  search: async (query) => {
    searchCalls += 1;
    firstQueryId = query.id;
    return [{ url: page.url, domain: "example-steel.test", engine: "brave", rank: 1 }];
  },
  fetchPage: async (url) => {
    pageCalls += 1;
    return url.endsWith("/contact") ? contact : page;
  },
  resolveMx: async () => [{ exchange: "mx.example-steel.test", priority: 10 }],
  });
  assert.equal(searchCalls, 1);
  assert.equal(pageCalls, 2);
  assert.equal(result.stats.queriesUsed, 1);
  assert.equal(result.stats.pagesFetched, 2);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.verifications[0]?.verdict, "deliverable_likely");
  assert.equal(result.candidates[0]?.verifications[0]?.hasMx, true);
  assert.equal(result.nextQueryOffset, 1);
  const resumedQueryIds: string[] = [];
  await runProspectingBatch({
    profile,
    queryOffset: result.nextQueryOffset,
    maxQueries: 1,
    maxPages: 1,
    budgetMs: 10_000,
    search: async (query) => {
      resumedQueryIds.push(query.id);
      return [];
    },
    fetchPage: async () => null,
    resolveMx: async () => [{ exchange: "mx.example-steel.test", priority: 10 }],
  });
  assert.equal(resumedQueryIds.length, 1);
  assert.notEqual(resumedQueryIds[0], firstQueryId);
  const fallback = await searchProspectingQuery(
    buildQueryPlan(profile, { limit: 1 })[0]!,
    async (url) => ({
      url,
      status: url.includes("duckduckgo") ? 429 : 200,
      contentType: "text/html",
      body: url.includes("duckduckgo")
        ? ""
        : `<a href="https://fallback-steel.test/">Fallback Steel</a>`,
      isPdf: false,
    }),
  );
  assert.equal(fallback.pagesFetched, 2);
  assert.equal(fallback.hits[0]?.engine, "brave");

  const runSource = readFileSync(resolve(process.cwd(), "src/lib/leadgen/run.ts"), "utf8");
  assert.match(runSource, /resolveMx: args\.resolveMx/);
  assert.doesNotMatch(runSource, /resolveMx: async \(\) => \[\]/);
  const source = readFileSync(resolve(process.cwd(), "src/lib/supply-os/context-prospecting.ts"), "utf8");
  assert.match(source, /processingState: found\.status/);
  assert.match(source, /processingState: "RUNNING"/);
  assert.match(source, /officeId: args\.context\.officeId/);
  assert.match(source, /accessKind === "customer"/);
  assert.match(source, /defaultFetcher/);
  assert.match(source, /resetStatus: false/);
  const constantsSource = readFileSync(resolve(process.cwd(), "src/lib/supply-os/context-prospecting-constants.ts"), "utf8");
  assert.match(constantsSource, /export const STALE_RUN_MS = 300_000/);
  assert.match(source, /export \{ STALE_RUN_MS \}/);
  assert.match(source, /action\.status === "RUNNING"/);
  assert.match(source, /runningStartedAt/);
  const harvest = readFileSync(resolve(process.cwd(), "src/lib/leadgen/harvest.ts"), "utf8");
  assert.match(harvest, /guardedRequest/);
  assert.match(harvest, /checkPublicUrl/);
  const agent = readFileSync(resolve(process.cwd(), "src/lib/supply-os/context-agent.ts"), "utf8");
  assert.match(agent, /explicitly asks to find buyers, prospects, customers, or a target list/);
  assert.match(agent, /missing segments or regions/);
  assert.match(agent, /prospectingDrafts/);
  const prospectingValidation = agent.indexOf("if (normalizedProspectingDrafts.some((entry) => entry === null))");
  const procurementPersistence = agent.indexOf("const procurementActions = await createCompanyContextProcurementActions");
  assert.ok(
    prospectingValidation >= 0 && procurementPersistence > prospectingValidation,
    "invalid prospecting drafts must be rejected before procurement persistence",
  );
  const prospectingSource = readFileSync(resolve(process.cwd(), "src/lib/supply-os/context-prospecting.ts"), "utf8");
  assert.match(prospectingSource, /companyWorkspace\(context, workspaceId, "view"\)/);
  const contextUi = readFileSync(resolve(process.cwd(), "src/app/dashboard/supply-os/supply-os-context.tsx"), "utf8");
  assert.match(contextUi, /runningStartedAt/);
  assert.match(contextUi, /STALE_RUN_MS/);
  assert.match(contextUi, /previous research run was interrupted/);
  const route = readFileSync(resolve(process.cwd(), "src/app/api/supply-os/workspaces/[workspaceId]/context/prospecting/[actionId]/route.ts"), "utf8");
  assert.match(route, /session\.accessKind === "customer"/);

  const suffix = randomUUID().slice(0, 8);
  const office = await prisma.office.create({
    data: { name: `Prospecting test ${suffix}`, pricingTargetMarginPct: 12.5 },
  });
  try {
    const admin = await prisma.user.create({
      data: {
        officeId: office.id,
        email: `prospecting-${suffix}@example.test`,
        passwordHash: "test",
        fullName: "Prospecting Test",
        role: "ADMIN",
        canViewWholeOffice: true,
      },
    });
    const company = await prisma.company.create({
      data: { officeId: office.id, name: `Prospecting Company ${suffix}` },
    });
    const context: SupplyAccessContext = {
      officeId: office.id,
      userId: admin.id,
      role: admin.role,
      canViewWholeOffice: true,
    };
    const workspace = await createSupplyWorkspace(context, { name: company.name, companyId: company.id });
    const lifecycleDraft = { ...draft, listSlug: `prospecting-test-${suffix}` };
    const [action] = await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: lifecycleDraft, citations: [{ id: "message:test", label: "Test request" }] }],
      requestMessageId: "message:test",
      requestBody: "Find steel buyers.",
      requestCreatedAt: new Date(),
    });
    assert(action);
    assert.equal(action.status, "PENDING");
    assert.equal((await listCompanyContextProspectingActions(context, workspace.id)).length, 1);
    const candidate = {
      candidate: {
        domain: "fixture-steel.test",
        website: "https://fixture-steel.test",
        companyName: "Fixture Steel",
        city: "Caracas",
        emails: ["buyer@fixture-steel.test"],
        phones: ["+58 1 555 0100"],
        segmentKey: "prospect_segment_1",
        fit: {
          score: 88,
          tier: "A",
          matchedSignals: ["steel"],
          matchedSegments: ["steel fabricators"],
          rejectionReason: null,
        },
        evidence: [{
          url: "https://fixture-steel.test/about",
          kind: "home",
          emails: ["buyer@fixture-steel.test"],
          phones: ["+58 1 555 0100"],
        }],
        discoveredVia: "fixture query",
        harvestedAt: new Date().toISOString(),
      },
      verifications: [],
      region: "Venezuela",
    } satisfies ProspectingBatchCandidate;
    let runnerCalls = 0;
    const resolveMx = async () => [{ exchange: "mx.fixture-steel.test", priority: 10 }];
    const runBatch = async ({
      queryOffset,
      resolveMx: suppliedResolveMx,
    }: {
      queryOffset: number;
      resolveMx?: typeof resolveMx;
    }) => {
      assert.equal(suppliedResolveMx, resolveMx);
      const expectedQueryOffset = runnerCalls === 0 ? 0 : runnerCalls === 1 ? 1 : 0;
      runnerCalls += 1;
      assert.equal(queryOffset, expectedQueryOffset);
      return {
        candidates: [candidate],
        stats: { queriesUsed: 1, pagesFetched: 1, candidatesFound: 1 },
        nextQueryOffset: runnerCalls,
        exhausted: runnerCalls > 1,
      };
    };
    const completed = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: action.id,
      runBatch,
      resolveMx,
    });
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.stats.rowsCreated, 1);
    const list = await prisma.researchList.findFirst({
      where: { officeId: office.id, slug: lifecycleDraft.listSlug },
      include: { records: true },
    });
    assert.equal(list?.records.length, 1);
    assert.equal(list?.records[0]?.data && (list.records[0].data as Record<string, unknown>).country, "Venezuela");
    await prisma.researchRecord.update({
      where: { id: list!.records[0]!.id },
      data: { status: "rejected" },
    });
    assert.equal((await prisma.researchList.findFirst({
      where: { officeId: office.id, slug: lifecycleDraft.listSlug },
      include: { records: true },
    }))?.records.length, 1);
    const continued = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: action.id,
      runBatch,
      resolveMx,
    });
    assert.equal(continued.status, "COMPLETED");
    assert.equal(runnerCalls, 2);
    assert.equal((await prisma.researchRecord.findUnique({
      where: { id: list!.records[0]!.id },
    }))?.status, "rejected");
    const runningAction = (await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: { ...lifecycleDraft, listSlug: `${lifecycleDraft.listSlug}-running` }, citations: [] }],
      requestMessageId: "message:test",
      requestBody: "Find steel buyers.",
      requestCreatedAt: new Date(),
    }))[0]!;
    const runningRow = await prisma.companyContext.findUniqueOrThrow({
      where: { id: runningAction.id },
      select: { payload: true },
    });
    await prisma.companyContext.update({
      where: { id: runningAction.id },
      data: {
        payload: {
          ...(runningRow.payload as Record<string, unknown>),
          status: "RUNNING",
          runningStartedAt: new Date().toISOString(),
        },
        processingState: "RUNNING",
      },
    });
    await assert.rejects(
      () => runCompanyContextProspectingAction({
        context,
        workspaceId: workspace.id,
        actionId: runningAction.id,
        runBatch,
      }),
      /already in progress/,
    );
    await prisma.companyContext.update({
      where: { id: runningAction.id },
      data: {
        payload: {
          ...(runningRow.payload as Record<string, unknown>),
          status: "RUNNING",
          runningStartedAt: new Date(Date.now() - 301_000).toISOString(),
        },
        processingState: "RUNNING",
      },
    });
    const staleRetry = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: runningAction.id,
      runBatch,
      resolveMx,
    });
    assert.equal(staleRetry.status, "COMPLETED");
    const staleDismissedAction = (await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: { ...lifecycleDraft, listSlug: `${lifecycleDraft.listSlug}-stale-dismissed` }, citations: [] }],
      requestMessageId: "message:test",
      requestBody: "Find steel buyers.",
      requestCreatedAt: new Date(),
    }))[0]!;
    const staleDismissedRow = await prisma.companyContext.findUniqueOrThrow({
      where: { id: staleDismissedAction.id },
      select: { payload: true },
    });
    await prisma.companyContext.update({
      where: { id: staleDismissedAction.id },
      data: {
        payload: {
          ...(staleDismissedRow.payload as Record<string, unknown>),
          status: "RUNNING",
          runningStartedAt: new Date(Date.now() - 301_000).toISOString(),
        },
        processingState: "RUNNING",
      },
    });
    const staleDismissed = await dismissCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: staleDismissedAction.id,
    });
    assert.equal(staleDismissed.status, "DISMISSED");
    assert.equal(staleDismissed.runningStartedAt, null);
    const dismissedAction = (await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: { ...lifecycleDraft, listSlug: `${lifecycleDraft.listSlug}-dismissed` }, citations: [] }],
      requestMessageId: "message:test",
      requestBody: "Find steel buyers.",
      requestCreatedAt: new Date(),
    }))[0]!;
    assert.equal((await dismissCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: dismissedAction.id,
    })).status, "DISMISSED");
    assert.deepEqual(await createCompanyContextProspectingActions({
      context: { ...context, accessKind: "customer" },
      workspaceId: workspace.id,
      items: [{ draft: lifecycleDraft, citations: [] }],
      requestMessageId: "message:test",
      requestBody: "Find steel buyers.",
      requestCreatedAt: new Date(),
    }), []);
    await assert.rejects(
      () => runCompanyContextProspectingAction({
        context: { ...context, accessKind: "customer" },
        workspaceId: workspace.id,
        actionId: action.id,
        runBatch,
      }),
      /not available for customer access/,
    );
  } finally {
    await prisma.office.delete({ where: { id: office.id } });
  }

  console.log("Supply OS Context prospecting contract passed.");
}

void main();
