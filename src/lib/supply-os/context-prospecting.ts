import "server-only";

import { prisma } from "@/lib/prisma";
import {
  companyContextActorData,
  companyContextVisibilityWhere,
  isCustomerContextAccess,
  requireCompanyContextWorkspace,
  type CompanyContextAccess,
} from "@/lib/customer-context-access";
import {
  createResearchList,
  listResearchLists,
  RESEARCH_MAX_ROWS,
  slugify,
  upsertResearchRecords,
  type ParsedResearchRow,
  type ResearchInputRow,
} from "@/lib/research-lists";
import {
  defaultProspectingSearch,
  profileFromProspectingDraft,
  runProspectingBatch,
  type ProspectingBatchResult,
  type ProspectingBatchCandidate,
  type ProspectingBatchStats,
  type ProspectingDraft,
  type ProspectingSearch,
} from "@/lib/leadgen/run";
import { defaultFetcher } from "@/lib/leadgen/harvest";
import { createLeadGenRun, finishLeadGenRun, recordLeadDiscoveries } from "@/lib/leadgen/persist";
import type { VerifyOptions } from "@/lib/leadgen/verify";
import { SupplyPersistenceError } from "@/lib/supply-os/persistence";
import { lockCompanyContextAction, type CompanyContextCitation } from "@/lib/company-context";
import { STALE_RUN_MS } from "@/lib/supply-os/context-prospecting-constants";
export { STALE_RUN_MS };

const MAX_ACTIONS = 50;
const MAX_ACTION_SCAN_ROWS = 500;
const ACTION_TYPE = "PROSPECTING";
const LIST_FIELDS = [
  { key: "company_name", label: "Company", type: "text" },
  { key: "website", label: "Website", type: "url" },
  { key: "domain", label: "Domain", type: "text" },
  { key: "country", label: "Country", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "segment", label: "Segment", type: "text" },
  { key: "buys", label: "Buys", type: "text" },
  { key: "contact_name", label: "Contact", type: "text" },
  { key: "contact_title", label: "Title", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "fit_score", label: "Fit score", type: "number" },
  { key: "email_verdict", label: "Email verdict", type: "text" },
  { key: "evidence_urls", label: "Evidence URLs", type: "text" },
  { key: "source_query", label: "Source query", type: "text" },
] as const;

type ProspectingStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "DISMISSED";

type ProspectingStats = {
  queriesUsed: number;
  pagesFetched: number;
  candidatesFound: number;
  rowsCreated: number;
  rowsUpdated: number;
};

type StoredProspectingAction = {
  schemaVersion: 1;
  type: typeof ACTION_TYPE;
  status: ProspectingStatus;
  draft: ProspectingDraft;
  citations: CompanyContextCitation[];
  requestMessageId: string;
  requestBody: string;
  requestCreatedAt: string;
  threadId: string | null;
  runningStartedAt: string | null;
  hiddenAt: string | null;
  stats: ProspectingStats;
  nextQueryOffset: number;
  exhausted: boolean;
};

export type ContextProspectingAction = StoredProspectingAction & {
  id: string;
  createdAt: Date;
};

export function normalizeProspectingDraft(value: unknown): ProspectingDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const text = (item: unknown, max: number) => typeof item === "string"
    ? item.replace(/\u2014/g, "-").replace(/\0/g, "").trim().slice(0, max)
    : "";
  const list = (item: unknown, max: number) => Array.isArray(item)
    ? item.map((entry) => text(entry, max)).filter(Boolean).slice(0, 20)
    : [];
  const objective = text(input.objective, 500);
  const segments = list(input.segments, 200);
  const regions = list(input.regions, 160);
  const productFocus = text(input.productFocus, 500);
  const listSlug = slugify(text(input.listSlug, 80) || objective);
  const notes = text(input.notes, 2_000);
  if (!objective || !segments.length || !regions.length || !productFocus || !listSlug) return null;
  return { objective, segments, regions, productFocus, listSlug, notes };
}

function customerAccess(context: CompanyContextAccess) {
  return isCustomerContextAccess(context) || context.accessKind === "customer";
}

async function companyWorkspace(context: CompanyContextAccess, workspaceId: string, mode: "view" | "edit") {
  if (customerAccess(context)) {
    throw new SupplyPersistenceError("Prospecting is not available for customer access.", "forbidden");
  }
  const workspace = await requireCompanyContextWorkspace(context, workspaceId, mode);
  if (!workspace.companyId) {
    throw new SupplyPersistenceError("Context requires a company-linked workspace.", "invalid_input");
  }
  return { ...workspace, companyId: workspace.companyId };
}

function decodeAction(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  if (value.type !== ACTION_TYPE) return null;
  const draft = normalizeProspectingDraft(value.draft);
  const statuses: ProspectingStatus[] = ["PENDING", "RUNNING", "COMPLETED", "FAILED", "DISMISSED"];
  const status = statuses.includes(value.status as ProspectingStatus)
    ? value.status as ProspectingStatus
    : null;
  const text = (item: unknown, max: number) => typeof item === "string" ? item.trim().slice(0, max) : "";
  const statsValue = value.stats && typeof value.stats === "object" && !Array.isArray(value.stats)
    ? value.stats as Record<string, unknown>
    : {};
  const number = (item: unknown) => typeof item === "number" && Number.isFinite(item) ? Math.max(0, Math.floor(item)) : 0;
  const citations = Array.isArray(value.citations) ? value.citations.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const citation = entry as Record<string, unknown>;
    const id = text(citation.id, 250);
    const label = text(citation.label, 250);
    return id && label ? [{ id, label }] : [];
  }).slice(0, 20) : [];
  const requestMessageId = text(value.requestMessageId, 200);
  const requestBody = text(value.requestBody, 4_000);
  const requestCreatedAt = text(value.requestCreatedAt, 40);
  if (!draft || !status || !requestMessageId || !requestBody || Number.isNaN(new Date(requestCreatedAt).valueOf())) return null;
  return {
    schemaVersion: 1 as const,
    type: ACTION_TYPE as typeof ACTION_TYPE,
    status,
    draft,
    citations,
    requestMessageId,
    requestBody,
    requestCreatedAt,
    threadId: text(value.threadId, 200) || null,
    runningStartedAt: text(value.runningStartedAt, 40) || null,
    hiddenAt: (() => {
      const hiddenAt = text(value.hiddenAt, 40);
      return hiddenAt && !Number.isNaN(new Date(hiddenAt).valueOf()) ? hiddenAt : null;
    })(),
    stats: {
      queriesUsed: number(statsValue.queriesUsed),
      pagesFetched: number(statsValue.pagesFetched),
      candidatesFound: number(statsValue.candidatesFound),
      rowsCreated: number(statsValue.rowsCreated),
      rowsUpdated: number(statsValue.rowsUpdated),
    },
    nextQueryOffset: number(value.nextQueryOffset),
    exhausted: value.exhausted === true,
  };
}

function actionFromRow(row: { id: string; payload: unknown; createdAt: Date }) {
  const stored = decodeAction(row.payload);
  return stored ? { id: row.id, createdAt: row.createdAt, ...stored } : null;
}

export async function listCompanyContextProspectingActions(
  context: CompanyContextAccess,
  workspaceId: string,
) {
  if (customerAccess(context)) return [];
  const workspace = await companyWorkspace(context, workspaceId, "view");
  const actions: ContextProspectingAction[] = [];
  let visibleCount = 0;
  let scannedRows = 0;
  let cursorId: string | null = null;
  while (visibleCount < MAX_ACTIONS && scannedRows < MAX_ACTION_SCAN_ROWS) {
    const rows: Array<{ id: string; payload: unknown; createdAt: Date }> = await prisma.companyContext.findMany({
      where: {
        officeId: context.officeId,
        companyId: workspace.companyId,
        kind: "ACTION",
        ...companyContextVisibilityWhere(context),
      },
      select: { id: true, payload: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_ACTIONS,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    scannedRows += rows.length;
    cursorId = rows[rows.length - 1].id;
    for (const row of rows) {
      const action = actionFromRow(row);
      if (!action) continue;
      actions.push(action);
      if (action.status !== "DISMISSED" && !action.hiddenAt) visibleCount += 1;
      if (visibleCount >= MAX_ACTIONS) break;
    }
    if (rows.length < MAX_ACTIONS) break;
  }
  return actions.reverse();
}

export async function createCompanyContextProspectingActions(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  items: Array<{ draft: ProspectingDraft; citations: CompanyContextCitation[] }>;
  requestMessageId: string;
  requestBody: string;
  requestCreatedAt: Date;
  threadId?: string | null;
}) {
  if (customerAccess(args.context)) return [];
  if (!args.items.length) return [];
  const workspace = await companyWorkspace(args.context, args.workspaceId, "edit");
  const storedItems = args.items.map((item) => ({
    schemaVersion: 1 as const,
    type: ACTION_TYPE,
    status: "PENDING" as const,
    draft: item.draft,
    citations: item.citations.slice(0, 20),
    requestMessageId: args.requestMessageId,
    requestBody: args.requestBody.slice(0, 4_000),
    requestCreatedAt: args.requestCreatedAt.toISOString(),
    threadId: args.threadId ?? null,
    runningStartedAt: null,
    hiddenAt: null,
    stats: { queriesUsed: 0, pagesFetched: 0, candidatesFound: 0, rowsCreated: 0, rowsUpdated: 0 },
    nextQueryOffset: 0,
    exhausted: false,
  }));
  const rows = await prisma.$transaction(storedItems.map((stored) => prisma.companyContext.create({
    data: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: "ACTION",
      name: `Prospecting - ${stored.draft.objective}`,
      payload: stored,
      processingState: stored.status,
      ...companyContextActorData(args.context),
    },
    select: { id: true, payload: true, createdAt: true },
  })));
  const actions = rows.map(actionFromRow);
  if (actions.some((action) => !action)) {
    throw new SupplyPersistenceError("The prospecting action could not be read.", "conflict");
  }
  return actions as ContextProspectingAction[];
}

async function ensureResearchList(officeId: string, draft: ProspectingDraft) {
  const existing = (await listResearchLists(officeId)).find((list) => list.slug === draft.listSlug);
  if (existing) return existing;
  try {
    return await createResearchList(officeId, {
      name: draft.listSlug.replace(/-/g, " "),
      slug: draft.listSlug,
      description: draft.objective,
      fields: LIST_FIELDS,
    });
  } catch (error) {
    const retry = (await listResearchLists(officeId)).find((list) => list.slug === draft.listSlug);
    if (retry) return retry;
    throw error;
  }
}

function candidateRows(records: readonly ProspectingBatchCandidate[]) {
  return records.flatMap(({ candidate, verifications, region, directoryRow }, index) => {
    if (directoryRow) return [];
    const verification = verifications[0] ?? null;
    const email = candidate.emails[0] ?? null;
    const evidenceUrls = candidate.evidence.map((item) => item.url).slice(0, 8).join("\n");
    const row: ResearchInputRow = {
      company_name: candidate.companyName,
      website: candidate.website,
      domain: candidate.domain,
      country: region,
      city: candidate.city,
      segment: candidate.fit.matchedSegments.join(", ") || candidate.segmentKey,
      buys: candidate.fit.matchedSignals.join(", "),
      contact_name: null,
      contact_title: null,
      email,
      phone: candidate.phones[0] ?? null,
      fit_score: candidate.fit.score,
      email_verdict: verification?.verdict ?? "unknown",
      evidence_urls: evidenceUrls,
      source_query: candidate.discoveredVia,
    };
    return { row: { row, sourceRow: index + 1 }, dedupeField: email ? "email" : "domain" };
  });
}

export type ProspectingResearchRow = {
  row: ResearchInputRow | ParsedResearchRow;
  dedupeField: string;
};

function directoryInputRows(records: readonly ProspectingBatchCandidate[]): ProspectingResearchRow[] {
  return records.flatMap(({ candidate, directoryRow, verifications, region }, index) => {
    if (!directoryRow) return [];
    const email = directoryRow.emails[0] ?? null;
    const domain = directoryRow.domain;
    const rawLine = directoryRow.rawLine.slice(0, 300);
    const row: ResearchInputRow = {
      company_name: directoryRow.companyName,
      website: domain ? `https://${domain}` : null,
      domain,
      country: region,
      city: directoryRow.city,
      segment: candidate.segmentKey,
      buys: `Directory row ${directoryRow.rowIndex}; needsResolution=${directoryRow.needsResolution}; ${rawLine}`,
      contact_name: null,
      contact_title: null,
      email,
      phone: directoryRow.phones[0] ?? null,
      fit_score: candidate.fit.score,
      email_verdict: verifications[0]?.verdict ?? "unknown",
      evidence_urls: directoryRow.sourceUrl,
      source_query: candidate.discoveredVia,
    };
    return [{
      row: { row, sourceRow: index + 1 },
      dedupeField: email ? "email" : domain ? "domain" : "company_name",
    }];
  });
}

export function groupProspectingResearchRows(items: readonly ProspectingResearchRow[]) {
  const groups = new Map<string, Array<ResearchInputRow | ParsedResearchRow>>();
  for (const item of items) {
    const rows = groups.get(item.dedupeField) ?? [];
    rows.push(item.row);
    groups.set(item.dedupeField, rows);
  }
  return groups;
}

async function persistCandidates(officeId: string, draft: ProspectingDraft, records: readonly ProspectingBatchCandidate[]) {
  await ensureResearchList(officeId, draft);
  const groups = groupProspectingResearchRows([...candidateRows(records), ...directoryInputRows(records)]);
  let created = 0;
  let updated = 0;
  const persistedRecordIndexes = new Set<number>();
  for (const [field, rows] of groups) {
    for (let index = 0; index < rows.length; index += RESEARCH_MAX_ROWS) {
      const result = await upsertResearchRecords(officeId, draft.listSlug, rows.slice(index, index + RESEARCH_MAX_ROWS), {
        dedupeField: field,
        resetStatus: false,
      });
      created += result.created;
      updated += result.updated;
      const errors = new Set((result.errorRows ?? result.errors).map((error) => error.row));
      for (const input of rows.slice(index, index + RESEARCH_MAX_ROWS)) {
        const sourceRow = "sourceRow" in input && typeof input.sourceRow === "number" ? input.sourceRow : 0;
        if (sourceRow > 0 && !errors.has(sourceRow)) persistedRecordIndexes.add(sourceRow - 1);
      }
    }
  }
  return {
    created,
    updated,
    contactsCreated: 0,
    persistedRecordIndexes,
    skipped: records.length - persistedRecordIndexes.size,
  };
}

async function discardLeadGenRunDiscoveries(officeId: string, runId: string) {
  try {
    await prisma.leadDiscovery.deleteMany({ where: { officeId, runId } });
  } catch {
    return;
  }
}

export async function runCompanyContextProspectingAction(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  actionId: string;
  search?: ProspectingSearch;
  fetchPage?: typeof defaultFetcher;
  resolveMx?: VerifyOptions["resolveMx"];
  runBatch?: (input: {
    profile: ReturnType<typeof profileFromProspectingDraft>;
    queryOffset: number;
    search: ProspectingSearch;
    fetchPage: typeof defaultFetcher;
    resolveMx?: VerifyOptions["resolveMx"];
  }) => Promise<ProspectingBatchResult>;
}) {
  const workspace = await companyWorkspace(args.context, args.workspaceId, "edit");
  const row = await prisma.companyContext.findFirst({
    where: {
      id: args.actionId,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: "ACTION",
      ...companyContextVisibilityWhere(args.context),
    },
    select: { id: true, payload: true, createdAt: true },
  });
  const initial = row ? actionFromRow(row) : null;
  if (!initial) throw new SupplyPersistenceError("Prospecting action not found.", "not_found");
  const claimed = await prisma.$transaction(async (tx) => {
    await lockCompanyContextAction(tx, initial.id);
    const lockedRow = await tx.companyContext.findFirst({
      where: {
        id: initial.id,
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: "ACTION",
        ...companyContextVisibilityWhere(args.context),
      },
      select: { id: true, payload: true, createdAt: true },
    });
    const found = lockedRow ? actionFromRow(lockedRow) : null;
    if (!found) throw new SupplyPersistenceError("Prospecting action not found.", "not_found");
    if (found.status === "DISMISSED") throw new SupplyPersistenceError("This prospecting action was dismissed.", "conflict");
    if (found.status === "COMPLETED" && found.exhausted) return { action: found, alreadyDone: true as const };
    if (found.status === "RUNNING") {
      const started = found.runningStartedAt ? new Date(found.runningStartedAt).valueOf() : 0;
      if (started && Date.now() - started < STALE_RUN_MS) {
        throw new SupplyPersistenceError("This prospecting run is already in progress. Retry shortly.", "conflict");
      }
    }
    const claim: StoredProspectingAction & { id: string; createdAt: Date } = {
      ...found,
      status: "RUNNING",
      runningStartedAt: new Date().toISOString(),
    };
    const { id: _claimId, createdAt: _claimCreatedAt, ...claimPayload } = claim;
    const updated = await tx.companyContext.updateMany({
      where: {
        id: found.id,
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: "ACTION",
        processingState: found.status,
        ...companyContextVisibilityWhere(args.context),
      },
      data: { payload: claimPayload, processingState: claimPayload.status },
    });
    if (updated.count !== 1) throw new SupplyPersistenceError("This prospecting run is already in progress. Retry shortly.", "conflict");
    return { action: claim, alreadyDone: false as const };
  });
  if (claimed.alreadyDone) return claimed.action;
  const running = claimed.action;

  let leadGenRunId: string | null = null;
  let batchStats: ProspectingBatchStats | null = null;
  try {
    const profile = profileFromProspectingDraft(running.draft);
    const leadGenRun = await createLeadGenRun(prisma, {
      officeId: args.context.officeId,
      profileSlug: profile.slug,
      campaignTag: running.draft.listSlug,
      workspaceId: args.workspaceId,
    });
    leadGenRunId = leadGenRun.id;
    const result = await (args.runBatch ?? runProspectingBatch)({
      profile,
      queryOffset: running.nextQueryOffset,
      search: args.search ?? defaultProspectingSearch,
      fetchPage: args.fetchPage ?? defaultFetcher,
      resolveMx: args.resolveMx,
    });
    batchStats = result.stats;
    const persisted = await persistCandidates(args.context.officeId, running.draft, result.candidates);
    await recordLeadDiscoveries(prisma, {
      officeId: args.context.officeId,
      runId: leadGenRunId,
      campaignTag: running.draft.listSlug,
      profileSlug: profile.slug,
      records: result.candidates.map((record, index) => ({
        ...record,
        persisted: persisted.persistedRecordIndexes.has(index),
      })),
    });
    await finishLeadGenRun(prisma, {
      officeId: args.context.officeId,
      runId: leadGenRunId,
      status: "COMPLETED",
      counters: {
        ...result.stats,
        companiesCreated: persisted.created,
        companiesUpdated: persisted.updated,
        contactsCreated: persisted.contactsCreated,
        skipped: persisted.skipped,
        providerStats: result.stats.providerStats ?? {},
      },
    });
    const completed: StoredProspectingAction = {
      ...running,
      status: "COMPLETED",
      runningStartedAt: null,
      stats: {
        queriesUsed: running.stats.queriesUsed + result.stats.queriesUsed,
        pagesFetched: running.stats.pagesFetched + result.stats.pagesFetched,
        candidatesFound: running.stats.candidatesFound + result.stats.candidatesFound,
        rowsCreated: running.stats.rowsCreated + persisted.created,
        rowsUpdated: running.stats.rowsUpdated + persisted.updated,
      },
      nextQueryOffset: result.nextQueryOffset,
      exhausted: result.exhausted,
    };
    await prisma.companyContext.updateMany({
      where: {
        id: running.id,
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: "ACTION",
        processingState: "RUNNING",
        ...companyContextVisibilityWhere(args.context),
      },
      data: { payload: completed, processingState: completed.status },
    });
    return { id: running.id, createdAt: running.createdAt, ...completed };
  } catch (error) {
    if (leadGenRunId) {
      await finishLeadGenRun(prisma, {
        officeId: args.context.officeId,
        runId: leadGenRunId,
        status: "FAILED",
        counters: {
          queriesUsed: batchStats?.queriesUsed ?? 0,
          pagesFetched: batchStats?.pagesFetched ?? 0,
          candidatesFound: batchStats?.candidatesFound ?? 0,
          companiesCreated: 0,
          companiesUpdated: 0,
          contactsCreated: 0,
          skipped: 0,
          providerStats: batchStats?.providerStats ?? {},
        },
        error: error instanceof Error ? error.message.slice(0, 500) : "Prospecting run failed.",
      });
      await discardLeadGenRunDiscoveries(args.context.officeId, leadGenRunId);
    }
    const failed: StoredProspectingAction = {
      ...running,
      status: "FAILED",
      runningStartedAt: null,
    };
    await prisma.companyContext.updateMany({
      where: {
        id: running.id,
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: "ACTION",
        processingState: "RUNNING",
        ...companyContextVisibilityWhere(args.context),
      },
      data: { payload: failed, processingState: failed.status, processingError: "Prospecting run failed." },
    });
    throw error;
  }
}

export async function dismissCompanyContextProspectingAction(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  actionId: string;
}) {
  const workspace = await companyWorkspace(args.context, args.workspaceId, "edit");
  const row = await prisma.companyContext.findFirst({
    where: {
      id: args.actionId,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: "ACTION",
      ...companyContextVisibilityWhere(args.context),
    },
    select: { id: true, payload: true, createdAt: true },
  });
  const action = row ? actionFromRow(row) : null;
  if (!action) throw new SupplyPersistenceError("Prospecting action not found.", "not_found");
  if (action.status === "DISMISSED") return action;
  if (action.status === "RUNNING") {
    const started = action.runningStartedAt ? new Date(action.runningStartedAt).valueOf() : 0;
    if (started && Date.now() - started < STALE_RUN_MS) {
      throw new SupplyPersistenceError("This prospecting action cannot be dismissed now.", "conflict");
    }
  } else if (action.status === "COMPLETED") {
    throw new SupplyPersistenceError("This prospecting action cannot be dismissed now.", "conflict");
  }
  const dismissed: StoredProspectingAction = { ...action, status: "DISMISSED", runningStartedAt: null };
  const updated = await prisma.companyContext.updateMany({
    where: {
      id: action.id,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: "ACTION",
      processingState: action.status,
      ...companyContextVisibilityWhere(args.context),
    },
    data: { payload: dismissed, processingState: dismissed.status },
  });
  if (updated.count !== 1) throw new SupplyPersistenceError("This prospecting action changed before it could be dismissed.", "conflict");
  return dismissed;
}

export async function hideCompanyContextProspectingAction(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  actionId: string;
}) {
  const workspace = await companyWorkspace(args.context, args.workspaceId, "edit");
  const row = await prisma.companyContext.findFirst({
    where: {
      id: args.actionId,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: "ACTION",
      ...companyContextVisibilityWhere(args.context),
    },
    select: { id: true, payload: true, createdAt: true },
  });
  const found = row ? actionFromRow(row) : null;
  if (!found) throw new SupplyPersistenceError("Prospecting action not found.", "not_found");
  return prisma.$transaction(async (tx) => {
    await lockCompanyContextAction(tx, found.id);
    const lockedRow = await tx.companyContext.findFirst({
      where: {
        id: found.id,
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: "ACTION",
        ...companyContextVisibilityWhere(args.context),
      },
      select: { id: true, payload: true, createdAt: true },
    });
    const action = lockedRow ? actionFromRow(lockedRow) : null;
    if (!action) throw new SupplyPersistenceError("Prospecting action not found.", "not_found");
    if (action.hiddenAt) return action;
    if (action.status !== "COMPLETED") {
      throw new SupplyPersistenceError("Only completed prospect research can be hidden. Dismiss it instead.", "conflict");
    }
    const { id: actionRowId, createdAt: actionCreatedAt, ...storedAction } = action;
    const hidden: StoredProspectingAction = { ...storedAction, hiddenAt: new Date().toISOString() };
    const updated = await tx.companyContext.updateMany({
      where: {
        id: actionRowId,
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: "ACTION",
        processingState: action.status,
        ...companyContextVisibilityWhere(args.context),
      },
      data: { payload: hidden, processingState: hidden.status },
    });
    if (updated.count !== 1) throw new SupplyPersistenceError("This prospecting action changed before it could be hidden.", "conflict");
    return { id: actionRowId, createdAt: actionCreatedAt, ...hidden };
  });
}
