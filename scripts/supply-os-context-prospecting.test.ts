import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { buildQueryPlan, QUERY_PLAN_VERSION } from "../src/lib/leadgen/query-plan";
import {
  profileFromProspectingDraft,
  runProspectingBatch,
  searchProspectingQuery,
} from "../src/lib/leadgen/run";
import { finishLeadGenRun } from "../src/lib/leadgen/persist";
import type { FetchedPage } from "../src/lib/leadgen/harvest";
import { createResearchList, slugify } from "../src/lib/research-lists";
import { ensureResearchProject } from "../src/lib/research-projects";
import { clampAgentRowTarget } from "../src/lib/supply-os/context-agent";
import {
  createCompanyContextProspectingActions,
  dismissCompanyContextProspectingAction,
  groupProspectingResearchRows,
  hideCompanyContextProspectingAction,
  listCompanyContextProspectingActions,
  normalizeProspectingDraft,
  runProspectingBackgroundTick,
  runCompanyContextProspectingAction,
  shouldContinueProspectingInBackground,
  STALE_RUN_MS,
  type StoredProspectingAction,
} from "../src/lib/supply-os/context-prospecting";
import { createSupplyWorkspace, type SupplyAccessContext } from "../src/lib/supply-os/persistence";
import type { ProspectingBatchCandidate } from "../src/lib/leadgen/run";

const draft = {
  objective: "Find steel fabricators",
  segments: ["steel fabricators"],
  regions: ["Venezuela", "Russia"],
  productFocus: "Non-bulk steel and ore",
  projectName: "",
  listSlug: "steel-buyers",
  notes: "",
  rowTarget: 500,
};
const profile = profileFromProspectingDraft(draft);
assert.equal(clampAgentRowTarget(undefined), 500);
assert.equal(clampAgentRowTarget(20), 500);
assert.equal(clampAgentRowTarget(1200), 1200);
assert.equal(clampAgentRowTarget(99999), 5000);
assert.equal(clampAgentRowTarget("abc"), 500);
const backgroundNow = Date.parse("2026-09-02T00:00:00.000Z");
const backgroundAction: StoredProspectingAction = {
  schemaVersion: 1,
  type: "PROSPECTING",
  status: "COMPLETED",
  draft,
  citations: [],
  requestMessageId: "message:test",
  requestBody: "Find steel buyers.",
  requestCreatedAt: new Date(backgroundNow).toISOString(),
  threadId: null,
  runningStartedAt: null,
  hiddenAt: null,
  stats: { queriesUsed: 0, pagesFetched: 0, candidatesFound: 0, rowsCreated: 0, rowsUpdated: 0 },
  planVersion: 0,
  nextQueryOffset: 0,
  exhausted: false,
  autoContinue: true,
  workspaceId: null,
  claimToken: null,
  attempts: 0,
  lastError: null,
  lastBackgroundRunAt: null,
};

async function waitFor<T>(read: () => Promise<T | null>, label: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
assert.equal(shouldContinueProspectingInBackground({ ...backgroundAction, exhausted: true }, { now: backgroundNow }), false);
assert.equal(shouldContinueProspectingInBackground({
  ...backgroundAction,
  stats: { ...backgroundAction.stats, rowsCreated: draft.rowTarget },
}, { now: backgroundNow }), false);
assert.equal(shouldContinueProspectingInBackground(backgroundAction, { now: backgroundNow }), true);
assert.equal(shouldContinueProspectingInBackground({
  ...backgroundAction,
  status: "FAILED",
  attempts: 2,
}, { now: backgroundNow }), true);
assert.equal(shouldContinueProspectingInBackground({
  ...backgroundAction,
  status: "FAILED",
  attempts: 3,
}, { now: backgroundNow }), false);
assert.equal(shouldContinueProspectingInBackground({
  ...backgroundAction,
  status: "RUNNING",
  runningStartedAt: new Date(backgroundNow - STALE_RUN_MS + 1).toISOString(),
}, { now: backgroundNow }), false);
assert.equal(shouldContinueProspectingInBackground({
  ...backgroundAction,
  status: "RUNNING",
  runningStartedAt: new Date(backgroundNow - STALE_RUN_MS - 1).toISOString(),
}, { now: backgroundNow }), true);
assert.equal(shouldContinueProspectingInBackground({ ...backgroundAction, autoContinue: false }, { now: backgroundNow }), false);
assert.equal(shouldContinueProspectingInBackground({ ...backgroundAction, status: "PENDING" }, { now: backgroundNow }), false);
assert.equal(shouldContinueProspectingInBackground({ ...backgroundAction, status: "DISMISSED" }, { now: backgroundNow }), false);
assert.equal(normalizeProspectingDraft({ ...draft, rowTarget: undefined })?.rowTarget, 500);
assert.equal(normalizeProspectingDraft({ ...draft, rowTarget: "invalid" })?.rowTarget, 500);
assert.equal(normalizeProspectingDraft({ ...draft, rowTarget: 10 })?.rowTarget, 50);
assert.equal(normalizeProspectingDraft({ ...draft, rowTarget: 99999 })?.rowTarget, 5000);
assert.equal(normalizeProspectingDraft({ ...draft, projectName: "Steel workflow" })?.projectName, "Steel workflow");
assert.equal(normalizeProspectingDraft({
  objective: draft.objective,
  segments: draft.segments,
  regions: draft.regions,
  productFocus: draft.productFocus,
  listSlug: draft.listSlug,
  notes: draft.notes,
  rowTarget: draft.rowTarget,
})?.projectName, "");
assert.equal(profileFromProspectingDraft({ ...draft, segments: [] }).segments.length, 0);
assert.deepEqual(profile.regions, draft.regions);
assert.equal(profile.offering, draft.productFocus);
assert.ok(profile.positiveSignals.includes("steel"));
assert.equal(profile.customerName, "Prospecting");
const sharedDedupeRows = groupProspectingResearchRows([
  { row: { company_name: "Alpha Steel", domain: "alpha.example" }, dedupeField: "domain" },
  { row: { company_name: "Beta Steel", domain: "beta.example" }, dedupeField: "domain" },
  { row: { company_name: "Gamma Steel", domain: "gamma.example" }, dedupeField: "domain" },
]);
assert.equal(sharedDedupeRows.size, 1, "directory rows sharing a dedupe field use one upsert group");
assert.equal(sharedDedupeRows.get("domain")?.length, 3);
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
  assert.match(contextUi, /MAX_PROSPECTING_BATCHES = 20/);
  assert.match(contextUi, /payload\?\.action/);
  assert.match(contextUi, /action\.draft\.rowTarget/);
  assert.match(contextUi, /action\.stats\.rowsCreated\} of \{action\.draft\.rowTarget/);
  assert.match(contextUi, /action\.stats\.rowsCreated >= action\.draft\.rowTarget/);
  assert.doesNotMatch(contextUi, /action\.stats\.rowsCreated \+ action\.stats\.rowsUpdated/);
  assert.match(contextUi, /action\.autoContinue && action\.status === "COMPLETED"/);
  assert.match(contextUi, /prospectingGenerationRef/);
  assert.match(contextUi, /generation !== prospectingGenerationRef\.current/);
  assert.match(prospectingSource, /claimToken: randomUUID\(\)/);
  assert.match(prospectingSource, /BACKGROUND_SCAN_CAP/);
  assert.match(prospectingSource, /orderBy: \[\{ updatedAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(prospectingSource, /lostClaims/);
  assert.match(prospectingSource, /revoked/);
  assert.match(prospectingSource, /isActive: true/);
  assert.match(prospectingSource, /args\.background && !shouldContinueProspectingInBackground/);
  assert.match(prospectingSource, /autoContinue: args\.background \? found\.autoContinue : true/);
  assert.match(prospectingSource, /progressCommitted/);
  const route = readFileSync(resolve(process.cwd(), "src/app/api/supply-os/workspaces/[workspaceId]/context/prospecting/[actionId]/route.ts"), "utf8");
  assert.match(route, /session\.accessKind === "customer"/);
  const cronRoute = readFileSync(resolve(process.cwd(), "src/app/api/cron/context-prospecting/route.ts"), "utf8");
  assert.match(cronRoute, /process\.env\.CRON_SECRET/);
  assert.match(cronRoute, /status: 503/);
  assert.match(cronRoute, /status: 401/);
  assert.match(cronRoute, /authorization/);
  assert.match(cronRoute, /x-cron-secret/);
  const vercel = readFileSync(resolve(process.cwd(), "vercel.json"), "utf8");
  assert.match(vercel, /"path": "\/api\/cron\/context-prospecting"/);

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
    const lifecycleDraft = { ...draft, projectName: `Steel buyers workflow ${suffix}`, listSlug: `prospecting-test-${suffix}` };
    const createBackgroundAction = async (listSlug: string) => (await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: { ...lifecycleDraft, listSlug }, citations: [] }],
      requestMessageId: `message:${listSlug}`,
      requestBody: "Find steel buyers.",
      requestCreatedAt: new Date(),
    }))[0]!;
    const setActionPayload = async (
      actionId: string,
      patch: Record<string, unknown>,
      processingState: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "DISMISSED",
    ) => {
      const row = await prisma.companyContext.findUniqueOrThrow({
        where: { id: actionId },
        select: { payload: true },
      });
      await prisma.companyContext.update({
        where: { id: actionId },
        data: {
          payload: { ...(row.payload as Record<string, unknown>), ...patch },
          processingState,
        },
      });
    };
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
    assert.equal(completed.planVersion, QUERY_PLAN_VERSION);
    const legacyResumeAction = await createBackgroundAction(`plan-version-legacy-${suffix}`);
    await setActionPayload(legacyResumeAction.id, {
      status: "COMPLETED",
      planVersion: 0,
      nextQueryOffset: 30,
      exhausted: false,
      autoContinue: false,
    }, "COMPLETED");
    let legacyQueryOffset = -1;
    const legacyCompleted = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: legacyResumeAction.id,
      runBatch: async ({ queryOffset }) => {
        legacyQueryOffset = queryOffset;
        return {
          candidates: [],
          stats: { queriesUsed: 0, pagesFetched: 0, candidatesFound: 0 },
          nextQueryOffset: 31,
          exhausted: true,
        };
      },
    });
    assert.equal(legacyQueryOffset, 0);
    assert.equal(legacyCompleted.planVersion, QUERY_PLAN_VERSION);
    const currentResumeAction = await createBackgroundAction(`plan-version-current-${suffix}`);
    await setActionPayload(currentResumeAction.id, {
      status: "COMPLETED",
      planVersion: QUERY_PLAN_VERSION,
      nextQueryOffset: 30,
      exhausted: false,
      autoContinue: false,
    }, "COMPLETED");
    let currentQueryOffset = -1;
    await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: currentResumeAction.id,
      runBatch: async ({ queryOffset }) => {
        currentQueryOffset = queryOffset;
        return {
          candidates: [],
          stats: { queriesUsed: 0, pagesFetched: 0, candidatesFound: 0 },
          nextQueryOffset: 31,
          exhausted: true,
        };
      },
    });
    assert.equal(currentQueryOffset, 30);
    const list = await prisma.researchList.findFirst({
      where: { officeId: office.id, slug: lifecycleDraft.listSlug },
      include: { records: true },
    });
    assert.equal(list?.records.length, 1);
    assert.equal(list?.projectId, (await prisma.researchProject.findFirst({
      where: { officeId: office.id, name: lifecycleDraft.projectName },
      select: { id: true },
    }))?.id);
    assert.equal(list?.records[0]?.data && (list.records[0].data as Record<string, unknown>).country, "Venezuela");
    const secondProjectDraft = {
      ...lifecycleDraft,
      projectName: `Aluminum buyers workflow ${suffix}`,
    };
    const secondAction = (await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: secondProjectDraft, citations: [] }],
      requestMessageId: "message:second-project",
      requestBody: "Find aluminum buyers.",
      requestCreatedAt: new Date(),
    }))[0]!;
    const secondCompleted = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: secondAction.id,
      runBatch: async () => ({
        candidates: [candidate],
        stats: { queriesUsed: 1, pagesFetched: 1, candidatesFound: 1 },
        nextQueryOffset: 1,
        exhausted: true,
      }),
      resolveMx,
    });
    assert.equal(secondCompleted.status, "COMPLETED");
    const projectLists = await prisma.researchList.findMany({
      where: { officeId: office.id },
      include: { records: true },
      orderBy: { createdAt: "asc" },
    });
    const firstProject = await prisma.researchProject.findFirstOrThrow({
      where: { officeId: office.id, name: lifecycleDraft.projectName },
      select: { id: true },
    });
    const secondProject = await prisma.researchProject.findFirstOrThrow({
      where: { officeId: office.id, name: secondProjectDraft.projectName },
      select: { id: true, slug: true },
    });
    const firstProjectList = projectLists.find((item) => item.projectId === firstProject.id);
    const secondProjectList = projectLists.find((item) => item.projectId === secondProject.id);
    assert(firstProjectList);
    assert(secondProjectList);
    assert.equal(firstProjectList.records.length, 1);
    assert.equal(secondProjectList.records.length, 1);
    assert.equal(firstProjectList.slug, lifecycleDraft.listSlug);
    assert.equal(secondProjectList.slug, `${secondProject.slug}-${secondProjectDraft.listSlug}`);
    assert.equal(secondCompleted.draft.listSlug, secondProjectList.slug);
    assert(await prisma.leadGenRun.findFirst({
      where: {
        officeId: office.id,
        workspaceId: workspace.id,
        campaignTag: secondProjectList.slug,
      },
    }));
    const fixtureFields = [{ key: "company_name", label: "Company name", type: "text" }] as const;
    const collisionBlocker = await ensureResearchProject(office.id, {
      name: `Collision blocker ${suffix}`,
      companyId: company.id,
    });
    const longProjectName = `${"long-project-".repeat(10)}${suffix}`;
    const longProject = await ensureResearchProject(office.id, {
      name: longProjectName,
      companyId: company.id,
    });
    assert.equal(longProject.slug.length, 80);
    const longDrafts = [
      { ...lifecycleDraft, projectName: longProjectName, listSlug: `workflow-alpha-${suffix}` },
      { ...lifecycleDraft, projectName: longProjectName, listSlug: `workflow-beta-${suffix}` },
    ];
    for (const longDraft of longDrafts) {
      await createResearchList(office.id, {
        name: `Blocked ${longDraft.listSlug}`,
        slug: longDraft.listSlug,
        fields: fixtureFields,
        projectId: collisionBlocker.id,
      });
      const longAction = (await createCompanyContextProspectingActions({
        context,
        workspaceId: workspace.id,
        items: [{ draft: longDraft, citations: [] }],
        requestMessageId: `message:${longDraft.listSlug}`,
        requestBody: "Find long workflow prospects.",
        requestCreatedAt: new Date(),
      }))[0]!;
      await runCompanyContextProspectingAction({
        context,
        workspaceId: workspace.id,
        actionId: longAction.id,
        runBatch: async () => ({
          candidates: [],
          stats: { queriesUsed: 0, pagesFetched: 0, candidatesFound: 0 },
          nextQueryOffset: 1,
          exhausted: true,
        }),
      });
    }
    const longProjectLists = await prisma.researchList.findMany({
      where: { officeId: office.id, projectId: longProject.id },
      select: { slug: true },
    });
    assert.equal(longProjectLists.length, longDrafts.length);
    for (const longDraft of longDrafts) {
      assert(longProjectLists.some((item) => item.slug.endsWith(longDraft.listSlug)));
    }
    const fallbackProjectName = `Fallback target ${suffix}`;
    const fallbackProject = await ensureResearchProject(office.id, {
      name: fallbackProjectName,
      companyId: company.id,
    });
    const fallbackBlocker = await ensureResearchProject(office.id, {
      name: `Fallback blocker ${suffix}`,
      companyId: company.id,
    });
    const fallbackThird = await ensureResearchProject(office.id, {
      name: `Fallback third ${suffix}`,
      companyId: company.id,
    });
    const fallbackDraft = {
      ...lifecycleDraft,
      projectName: fallbackProjectName,
      listSlug: `fallback-workflow-${suffix}`,
    };
    const fallbackRoom = Math.max(8, 79 - fallbackDraft.listSlug.length);
    const fallbackPrimary = slugify(`${fallbackProject.slug.slice(0, fallbackRoom)}-${fallbackDraft.listSlug}`);
    const fallbackIdRoom = Math.max(1, 79 - fallbackProject.id.length);
    const fallbackSlug = slugify(`${fallbackDraft.listSlug.slice(0, fallbackIdRoom)}-${fallbackProject.id}`);
    await createResearchList(office.id, {
      name: `Blocked ${fallbackDraft.listSlug}`,
      slug: fallbackDraft.listSlug,
      fields: fixtureFields,
      projectId: fallbackBlocker.id,
    });
    await createResearchList(office.id, {
      name: `Occupied ${fallbackPrimary}`,
      slug: fallbackPrimary,
      fields: fixtureFields,
      projectId: fallbackThird.id,
    });
    const fallbackAction = (await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: fallbackDraft, citations: [] }],
      requestMessageId: "message:fallback-project",
      requestBody: "Find fallback workflow prospects.",
      requestCreatedAt: new Date(),
    }))[0]!;
    const fallbackCompleted = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: fallbackAction.id,
      runBatch: async () => ({
        candidates: [],
        stats: { queriesUsed: 0, pagesFetched: 0, candidatesFound: 0 },
        nextQueryOffset: 1,
        exhausted: true,
      }),
    });
    assert.equal(fallbackCompleted.draft.listSlug, fallbackSlug);
    const fallbackRerunAction = (await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: fallbackDraft, citations: [] }],
      requestMessageId: "message:fallback-project-rerun",
      requestBody: "Find fallback workflow prospects again.",
      requestCreatedAt: new Date(),
    }))[0]!;
    const fallbackRerun = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: fallbackRerunAction.id,
      runBatch: async () => ({
        candidates: [],
        stats: { queriesUsed: 0, pagesFetched: 0, candidatesFound: 0 },
        nextQueryOffset: 1,
        exhausted: true,
      }),
    });
    assert.equal(fallbackRerun.draft.listSlug, fallbackSlug);
    assert.equal(await prisma.researchList.count({
      where: { officeId: office.id, projectId: fallbackProject.id, slug: fallbackSlug },
    }), 1);
    const directoryAction = (await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: { ...lifecycleDraft, listSlug: `${lifecycleDraft.listSlug}-directory` }, citations: [] }],
      requestMessageId: "message:directory",
      requestBody: "Find chamber members.",
      requestCreatedAt: new Date(),
    }))[0]!;
    const directoryCandidate = {
      candidate: {
        ...candidate.candidate,
        companyName: "Names Only Steel",
        domain: "",
        website: "https://chamber.example/members.pdf",
        city: "Ankara",
        emails: [],
        phones: [],
      },
      directoryRow: {
        companyName: "Names Only Steel",
        domain: null,
        emails: [],
        phones: [],
        city: "Ankara",
        rawLine: "12 12 Names Only Steel Ankara",
        sourceUrl: "https://chamber.example/members.pdf",
        rowIndex: 12,
        needsResolution: true,
      },
      verifications: [],
      region: "Turkey",
    } satisfies ProspectingBatchCandidate;
    const directoryCompleted = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: directoryAction.id,
      runBatch: async () => ({
        candidates: [directoryCandidate],
        stats: { queriesUsed: 1, pagesFetched: 1, candidatesFound: 1 },
        nextQueryOffset: 1,
        exhausted: true,
      }),
    });
    assert.equal(directoryCompleted.stats.rowsCreated, 1);
    assert.equal(directoryCompleted.autoContinue, false);
    const directoryList = await prisma.researchList.findFirst({
      where: { officeId: office.id, slug: `${lifecycleDraft.listSlug}-directory` },
      include: { records: true },
    });
    const directoryData = directoryList?.records[0]?.data as Record<string, unknown> | undefined;
    assert.equal(directoryList?.records.length, 1);
    assert.equal(directoryData?.email, null);
    assert.equal(directoryData?.email_verdict, "unknown");
    assert.match(String(directoryData?.buys), /row 12/);
    assert.match(String(directoryData?.buys), /needsResolution=true/);
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
    const hiddenRestartAction = (await createCompanyContextProspectingActions({
      context,
      workspaceId: workspace.id,
      items: [{ draft: { ...lifecycleDraft, listSlug: `${lifecycleDraft.listSlug}-hidden-restart` }, citations: [] }],
      requestMessageId: "message:test",
      requestBody: "Find steel buyers.",
      requestCreatedAt: new Date(),
    }))[0]!;
    const emptyBatch = async () => ({
      candidates: [],
      stats: { queriesUsed: 1, pagesFetched: 1, candidatesFound: 0 },
      nextQueryOffset: 1,
      exhausted: false,
    });
    const exhaustingBatch = async () => ({
      candidates: [],
      stats: { queriesUsed: 1, pagesFetched: 1, candidatesFound: 0 },
      nextQueryOffset: 1,
      exhausted: true,
    });
    const terminalActions = [];
    for (let index = 0; index < 5; index += 1) {
      const terminalAction = await createBackgroundAction(`background-terminal-${suffix}-${index}`);
      terminalActions.push(terminalAction);
      await setActionPayload(terminalAction.id, {
        status: "COMPLETED",
        autoContinue: true,
        exhausted: true,
      }, "COMPLETED");
    }
    const pagedAction = await createBackgroundAction(`background-paged-${suffix}`);
    await setActionPayload(pagedAction.id, {
      status: "COMPLETED",
      autoContinue: true,
      exhausted: false,
      workspaceId: workspace.id,
    }, "COMPLETED");
    const pagedTick = await runProspectingBackgroundTick({
      maxJobs: 1,
      budgetMs: 50_000,
      batchBudgetMs: 1_000,
      runBatch: exhaustingBatch,
    });
    assert.equal(pagedTick.ran, 1);
    assert.equal(pagedTick.completed, 1);
    assert.ok(pagedTick.scanned >= terminalActions.length + 1);
    const pagedPayload = await prisma.companyContext.findUniqueOrThrow({
      where: { id: pagedAction.id },
      select: { payload: true },
    });
    assert.equal((pagedPayload.payload as Record<string, unknown>).autoContinue, false);

    await setActionPayload(hiddenRestartAction.id, {
      status: "COMPLETED",
      autoContinue: false,
    }, "COMPLETED");
    const ineligibleListSlug = `background-ineligible-${suffix}`;
    const ineligibleAction = await createBackgroundAction(ineligibleListSlug);
    await setActionPayload(ineligibleAction.id, {
      status: "COMPLETED",
      autoContinue: true,
      exhausted: false,
      workspaceId: workspace.id,
    }, "COMPLETED");
    let ineligibleSelected = false;
    const ineligibleTick = await runProspectingBackgroundTick({
      maxJobs: 1,
      budgetMs: 50_000,
      batchBudgetMs: 1_000,
      beforeClaim: async (selected) => {
        if (selected.draft.listSlug !== ineligibleListSlug) return;
        ineligibleSelected = true;
        await setActionPayload(ineligibleAction.id, {
          autoContinue: false,
        }, "COMPLETED");
      },
      runBatch: async () => {
        throw new Error("Ineligible action must not run.");
      },
    });
    assert.equal(ineligibleSelected, true);
    assert.equal(ineligibleTick.ran, 0);
    assert.equal(ineligibleTick.skipped, 1);
    const ineligiblePayload = await prisma.companyContext.findUniqueOrThrow({
      where: { id: ineligibleAction.id },
      select: { payload: true, processingState: true },
    });
    assert.equal(ineligiblePayload.processingState, "COMPLETED");
    assert.equal((ineligiblePayload.payload as Record<string, unknown>).autoContinue, false);
    assert.equal((ineligiblePayload.payload as Record<string, unknown>).claimToken, null);

    const manualClaimAction = await createBackgroundAction(`background-manual-claim-${suffix}`);
    await setActionPayload(manualClaimAction.id, {
      status: "COMPLETED",
      autoContinue: false,
      exhausted: false,
      workspaceId: workspace.id,
    }, "COMPLETED");
    const manualClaimed = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: manualClaimAction.id,
      runBatch: emptyBatch,
    });
    assert.equal(manualClaimed.status, "COMPLETED");
    assert.equal(manualClaimed.autoContinue, true);
    await setActionPayload(manualClaimAction.id, {
      autoContinue: false,
    }, "COMPLETED");

    const tailListSlug = `background-tail-${suffix}`;
    const tailAction = await createBackgroundAction(tailListSlug);
    await setActionPayload(tailAction.id, {
      status: "PENDING",
      autoContinue: false,
      exhausted: false,
      workspaceId: workspace.id,
    }, "PENDING");
    const tailCompleted = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: tailAction.id,
      runBatch: async () => ({
        candidates: [candidate],
        stats: { queriesUsed: 1, pagesFetched: 1, candidatesFound: 1 },
        nextQueryOffset: 42,
        exhausted: false,
      }),
      bookkeeping: {
        recordLeadDiscoveries: async () => {
          throw new Error("fixture bookkeeping failure");
        },
        finishLeadGenRun,
      },
    });
    assert.equal(tailCompleted.status, "COMPLETED");
    assert.equal(tailCompleted.stats.rowsCreated, 1);
    assert.equal(tailCompleted.nextQueryOffset, 42);
    const tailPayload = await prisma.companyContext.findUniqueOrThrow({
      where: { id: tailAction.id },
      select: { payload: true, processingState: true },
    });
    assert.equal(tailPayload.processingState, "COMPLETED");
    assert.equal((tailPayload.payload as Record<string, unknown>).status, "COMPLETED");
    assert.equal((tailPayload.payload as Record<string, unknown>).nextQueryOffset, 42);
    assert.equal((tailPayload.payload as Record<string, unknown>).stats
      && ((tailPayload.payload as Record<string, unknown>).stats as Record<string, unknown>).rowsCreated, 1);
    const tailRun = await prisma.leadGenRun.findFirst({
      where: { officeId: office.id, workspaceId: workspace.id, campaignTag: tailListSlug },
      orderBy: { startedAt: "desc" },
    });
    assert(tailRun);
    assert.equal(tailRun.status, "FAILED");
    assert.match(tailRun.error ?? "", /fixture bookkeeping failure/);
    assert.equal(await prisma.leadDiscovery.count({ where: { officeId: office.id, runId: tailRun.id } }), 0);
    await setActionPayload(tailAction.id, {
      autoContinue: false,
    }, "COMPLETED");
    const prePersistenceListSlug = `background-pre-persistence-${suffix}`;
    const prePersistenceAction = await createBackgroundAction(prePersistenceListSlug);
    await assert.rejects(
      () => runCompanyContextProspectingAction({
        context,
        workspaceId: workspace.id,
        actionId: prePersistenceAction.id,
        runBatch: async () => {
          throw new Error("fixture pre-persistence failure");
        },
      }),
      /fixture pre-persistence failure/,
    );
    const prePersistencePayload = await prisma.companyContext.findUniqueOrThrow({
      where: { id: prePersistenceAction.id },
      select: { payload: true, processingState: true },
    });
    assert.equal(prePersistencePayload.processingState, "FAILED");
    assert.equal((prePersistencePayload.payload as Record<string, unknown>).status, "FAILED");
    const prePersistenceRun = await prisma.leadGenRun.findFirst({
      where: { officeId: office.id, workspaceId: workspace.id, campaignTag: prePersistenceListSlug },
      orderBy: { startedAt: "desc" },
    });
    assert(prePersistenceRun);
    assert.equal(prePersistenceRun.status, "FAILED");
    assert.equal(await prisma.leadDiscovery.count({
      where: { officeId: office.id, runId: prePersistenceRun.id },
    }), 0);
    await setActionPayload(prePersistenceAction.id, {
      autoContinue: false,
    }, "FAILED");

    const targetAction = await createBackgroundAction(`background-target-${suffix}`);
    await setActionPayload(targetAction.id, {
      status: "COMPLETED",
      autoContinue: true,
      exhausted: false,
      workspaceId: workspace.id,
      stats: { ...backgroundAction.stats, rowsCreated: lifecycleDraft.rowTarget },
    }, "COMPLETED");
    const targetCompleted = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: targetAction.id,
      runBatch: emptyBatch,
    });
    assert.equal(targetCompleted.autoContinue, false);

    const failingAction = await createBackgroundAction(`background-failing-${suffix}`);
    await setActionPayload(failingAction.id, {
      status: "COMPLETED",
      autoContinue: true,
      exhausted: false,
      workspaceId: workspace.id,
    }, "COMPLETED");
    const failingBatch = async () => {
      throw new Error("fixture background failure");
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failedTick = await runProspectingBackgroundTick({
        maxJobs: 1,
        budgetMs: 50_000,
        batchBudgetMs: 1_000,
        runBatch: failingBatch,
      });
      assert.equal(failedTick.failed, 1);
    }
    const failedPayload = await prisma.companyContext.findUniqueOrThrow({
      where: { id: failingAction.id },
      select: { payload: true },
    });
    assert.equal((failedPayload.payload as Record<string, unknown>).attempts, 3);
    assert.equal((failedPayload.payload as Record<string, unknown>).autoContinue, false);

    const staleAction = await createBackgroundAction(`background-stale-${suffix}`);
    await setActionPayload(staleAction.id, {
      status: "COMPLETED",
      autoContinue: true,
      exhausted: false,
      workspaceId: workspace.id,
    }, "COMPLETED");
    let releaseA: (() => void) | null = null;
    const workerA = runProspectingBackgroundTick({
      maxJobs: 1,
      budgetMs: 50_000,
      batchBudgetMs: 1_000,
      runBatch: async () => {
        await new Promise<void>((resolve) => {
          releaseA = resolve;
        });
        return emptyBatch();
      },
    });
    const claimedPayload = await waitFor(async () => {
      const row = await prisma.companyContext.findUnique({
        where: { id: staleAction.id },
        select: { payload: true },
      });
      const payload = row?.payload;
      return payload && typeof payload === "object" && !Array.isArray(payload)
        && (payload as Record<string, unknown>).status === "RUNNING"
        && typeof (payload as Record<string, unknown>).claimToken === "string"
        ? payload as Record<string, unknown>
        : null;
    }, "background claim");
    await setActionPayload(staleAction.id, {
      ...claimedPayload,
      runningStartedAt: new Date(Date.now() - STALE_RUN_MS - 1).toISOString(),
    }, "RUNNING");
    const workerB = await runProspectingBackgroundTick({
      maxJobs: 1,
      budgetMs: 50_000,
      batchBudgetMs: 1_000,
      runBatch: exhaustingBatch,
    });
    assert.equal(workerB.completed, 1);
    assert(releaseA);
    releaseA();
    const workerAResult = await workerA;
    assert.equal(workerAResult.lostClaims, 1);

    const inactiveAction = await createBackgroundAction(`background-inactive-${suffix}`);
    await setActionPayload(inactiveAction.id, {
      status: "COMPLETED",
      autoContinue: true,
      exhausted: false,
      workspaceId: workspace.id,
    }, "COMPLETED");
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
    const inactiveTick = await runProspectingBackgroundTick({
      maxJobs: 1,
      budgetMs: 50_000,
      batchBudgetMs: 1_000,
      runBatch: exhaustingBatch,
    });
    assert.equal(inactiveTick.revoked, 1);
    await prisma.user.update({ where: { id: admin.id }, data: { isActive: true } });
    const inactivePayload = await prisma.companyContext.findUniqueOrThrow({
      where: { id: inactiveAction.id },
      select: { payload: true },
    });
    assert.equal((inactivePayload.payload as Record<string, unknown>).autoContinue, false);

    const missingCreatorAction = await createBackgroundAction(`background-missing-creator-${suffix}`);
    await setActionPayload(missingCreatorAction.id, {
      status: "COMPLETED",
      autoContinue: true,
      exhausted: false,
      workspaceId: workspace.id,
    }, "COMPLETED");
    await prisma.companyContext.update({
      where: { id: missingCreatorAction.id },
      data: { createdByUserId: null },
    });
    const missingCreatorTick = await runProspectingBackgroundTick({
      maxJobs: 1,
      budgetMs: 50_000,
      batchBudgetMs: 1_000,
      runBatch: exhaustingBatch,
    });
    assert.equal(missingCreatorTick.revoked, 1);

    const firstRun = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: hiddenRestartAction.id,
      runBatch: emptyBatch,
      resolveMx,
    });
    assert.equal(firstRun.status, "COMPLETED");
    const hiddenBeforeRestart = await hideCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: hiddenRestartAction.id,
    });
    assert(hiddenBeforeRestart.hiddenAt, "Hiding completed research must record hiddenAt.");
    const restarted = await runCompanyContextProspectingAction({
      context,
      workspaceId: workspace.id,
      actionId: hiddenRestartAction.id,
      runBatch: emptyBatch,
      resolveMx,
    });
    assert.equal(restarted.status, "COMPLETED");
    assert.equal(
      restarted.hiddenAt,
      hiddenBeforeRestart.hiddenAt,
      "Restarting hidden research must preserve hiddenAt through RUNNING and COMPLETED.",
    );
    const reloadedHidden = (await listCompanyContextProspectingActions(context, workspace.id))
      .find((entry) => entry.id === hiddenRestartAction.id);
    assert.equal(reloadedHidden?.hiddenAt, hiddenBeforeRestart.hiddenAt, "Persisted hiddenAt must survive a restart.");
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
