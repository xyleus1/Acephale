import "server-only";

import { createHash, randomUUID } from "node:crypto";
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
  assignResearchListProject,
  listResearchLists,
  RESEARCH_MAX_ROWS,
  rekeyResearchRecords,
  slugify,
  upsertResearchRecords,
  type ParsedResearchRow,
  type ResearchInputRow,
} from "@/lib/research-lists";
import { normalizeDedupeValue } from "@/lib/research-dedupe";
import { ensureResearchProject } from "@/lib/research-projects";
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
import { selectPrimaryContact } from "@/lib/leadgen/enrich";
import { defaultFetcher } from "@/lib/leadgen/harvest";
import { createLeadGenRun, finishLeadGenRun, recordLeadDiscoveries } from "@/lib/leadgen/persist";
import type { VerifyOptions } from "@/lib/leadgen/verify";
import { SupplyPersistenceError } from "@/lib/supply-os/persistence";
import { lockCompanyContextAction, type CompanyContextCitation } from "@/lib/company-context";
import { QUERY_PLAN_VERSION } from "@/lib/leadgen/query-plan";
import { STALE_RUN_MS } from "@/lib/supply-os/context-prospecting-constants";
export { STALE_RUN_MS };

const MAX_ACTIONS = 50;
const MAX_ACTION_SCAN_ROWS = 500;
const ACTION_TYPE = "PROSPECTING";
const MAX_BACKGROUND_ATTEMPTS = 3;
const BACKGROUND_SCAN_CAP = 500;
const LOST_CLAIM_MESSAGE = "This prospecting run is already in progress. Retry shortly.";
/** Matches the leadgen persist default: only tier A/B candidates reach the list. */
export const PROSPECTING_MIN_FIT_SCORE = 50;
/**
 * Company identity fields in precedence order: a row keyed by an earlier field
 * is the company's row, and a later field never re-keys or duplicates it.
 */
export const PROSPECTING_DEDUPE_FIELDS = ["domain", "company_name"] as const;
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

export type StoredProspectingAction = {
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
  planVersion: number;
  nextQueryOffset: number;
  exhausted: boolean;
  autoContinue: boolean;
  workspaceId: string | null;
  claimToken: string | null;
  attempts: number;
  lastError: string | null;
  lastBackgroundRunAt: string | null;
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
  const projectName = text(input.projectName, 120);
  const listSlug = slugify(text(input.listSlug, 80) || objective);
  const notes = text(input.notes, 2_000);
  const rowTarget = typeof input.rowTarget === "number" && Number.isFinite(input.rowTarget)
    ? Math.min(5_000, Math.max(50, Math.floor(input.rowTarget)))
    : 500;
  if (!objective || !segments.length || !regions.length || !productFocus || !listSlug) return null;
  return { objective, segments, regions, productFocus, projectName, listSlug, notes, rowTarget };
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
  const isoText = (item: unknown) => {
    const value = text(item, 40);
    const date = new Date(value);
    return value && !Number.isNaN(date.valueOf()) ? date.toISOString() : null;
  };
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
    planVersion: number(value.planVersion),
    nextQueryOffset: number(value.nextQueryOffset),
    exhausted: value.exhausted === true,
    autoContinue: value.autoContinue === true,
    workspaceId: text(value.workspaceId, 200) || null,
    claimToken: text(value.claimToken, 200) || null,
    attempts: number(value.attempts),
    lastError: text(value.lastError, 500) || null,
    lastBackgroundRunAt: isoText(value.lastBackgroundRunAt),
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
    planVersion: QUERY_PLAN_VERSION,
    nextQueryOffset: 0,
    exhausted: false,
    autoContinue: false,
    workspaceId: null,
    claimToken: null,
    attempts: 0,
    lastError: null,
    lastBackgroundRunAt: null,
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

function projectScopedListSlug(projectId: string, listSlug: string) {
  const digest = createHash("sha256").update(`${projectId}:${listSlug}`).digest("hex").slice(0, 10);
  return slugify(`${listSlug.slice(0, 69)}-${digest}`);
}

async function ensureResearchList(officeId: string, companyId: string, draft: ProspectingDraft) {
  const project = draft.projectName
    ? await ensureResearchProject(officeId, { name: draft.projectName, companyId })
    : null;
  const lists = await listResearchLists(officeId);
  let listSlug = draft.listSlug;
  let existing = lists.find((list) => list.slug === listSlug);
  if (existing && project && existing.projectId !== null && existing.projectId !== project.id) {
    listSlug = projectScopedListSlug(project.id, draft.listSlug);
    existing = lists.find((list) => list.slug === listSlug);
  }
  if (existing && (!project || existing.projectId === null || existing.projectId === project.id)) {
    if (project && existing.projectId === null) {
      return assignResearchListProject(officeId, existing.id, project.id);
    }
    return existing;
  }
  try {
    return await createResearchList(officeId, {
      name: listSlug.replace(/-/g, " "),
      slug: listSlug,
      description: draft.objective,
      fields: LIST_FIELDS,
      projectId: project?.id,
    });
  } catch (error) {
    const retry = (await listResearchLists(officeId)).find((list) => list.slug === listSlug);
    if (retry) {
      if (project && retry.projectId === null) {
        return assignResearchListProject(officeId, retry.id, project.id);
      }
      if (project && retry.projectId !== project.id) throw error;
      return retry;
    }
    throw error;
  }
}

/** Search-provider counters plus paid enrichment/verification usage, stored on the run. */
function runProviderStats(stats: Pick<ProspectingBatchStats, "providerStats" | "usage"> | null | undefined) {
  return {
    ...(stats?.providerStats ?? {}),
    ...(stats?.usage ? { usage: stats.usage } : {}),
  };
}

export function candidateRows(records: readonly ProspectingBatchCandidate[]) {
  return records.flatMap(({ candidate, verifications, region, directoryRow }, index) => {
    if (candidate.fit.score < PROSPECTING_MIN_FIT_SCORE) return [];
    if (directoryRow) return [];
    const primary = selectPrimaryContact({ contacts: candidate.contacts, emails: candidate.emails, verifications });
    const verification = primary.verification;
    const email = primary.email;
    const primarySources = candidate.contacts?.find((contact) => contact.email === email)?.sourceUrls ?? [];
    const evidenceUrls = [
      ...candidate.evidence.map((item) => item.url),
      ...primarySources,
    ].slice(0, 8).join("\n");
    const row: ResearchInputRow = {
      company_name: candidate.companyName,
      website: candidate.website,
      domain: candidate.domain,
      country: region,
      city: candidate.city,
      segment: candidate.fit.matchedSegments.join(", ") || candidate.segmentKey,
      buys: candidate.fit.matchedSignals.join(", "),
      contact_name: primary.name,
      contact_title: primary.title,
      email,
      phone: candidate.phones[0] ?? null,
      fit_score: candidate.fit.score,
      email_verdict: verification?.verdict ?? "unknown",
      evidence_urls: evidenceUrls,
      source_query: candidate.discoveredVia,
    };
    // Company rows dedupe on the domain: the shown email moves as enrichment or
    // verification changes the best contact, and must update the same row.
    return { row: { row, sourceRow: index + 1 }, dedupeField: candidate.domain ? "domain" : "company_name" };
  });
}

export type ProspectingResearchRow = {
  row: ResearchInputRow | ParsedResearchRow;
  dedupeField: string;
};

function directoryInputRows(records: readonly ProspectingBatchCandidate[]): ProspectingResearchRow[] {
  return records.flatMap(({ candidate, directoryRow, verifications, region }, index) => {
    if (candidate.fit.score < PROSPECTING_MIN_FIT_SCORE) return [];
    if (!directoryRow) return [];
    const primary = selectPrimaryContact({ contacts: candidate.contacts, emails: candidate.emails, verifications });
    const email = primary.email;
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
      contact_name: primary.name,
      contact_title: primary.title,
      email,
      phone: directoryRow.phones[0] ?? null,
      fit_score: candidate.fit.score,
      email_verdict: primary.verification?.verdict ?? "unknown",
      evidence_urls: [
        directoryRow.sourceUrl,
        ...(candidate.contacts?.find((contact) => contact.email === email)?.sourceUrls ?? []),
      ].slice(0, 8).join("\n"),
      source_query: candidate.discoveredVia,
    };
    return [{
      row: { row, sourceRow: index + 1 },
      dedupeField: domain ? "domain" : "company_name",
    }];
  });
}

function inputRow(input: ResearchInputRow | ParsedResearchRow): ResearchInputRow {
  return "sourceRow" in input && "row" in input
    ? (input as ParsedResearchRow).row
    : (input as ResearchInputRow);
}

export function groupProspectingResearchRows(items: readonly ProspectingResearchRow[]) {
  const groups = new Map<string, Array<ResearchInputRow | ParsedResearchRow>>();
  const order = (field: string) => {
    const index = PROSPECTING_DEDUPE_FIELDS.indexOf(field as (typeof PROSPECTING_DEDUPE_FIELDS)[number]);
    return index === -1 ? PROSPECTING_DEDUPE_FIELDS.length : index;
  };
  for (const item of [...items].sort((a, b) => order(a.dedupeField) - order(b.dedupeField))) {
    const rows = groups.get(item.dedupeField) ?? [];
    rows.push(item.row);
    groups.set(item.dedupeField, rows);
  }
  return groups;
}

async function persistCandidates(officeId: string, listSlug: string, records: readonly ProspectingBatchCandidate[]) {
  const groups = groupProspectingResearchRows([...candidateRows(records), ...directoryInputRows(records)]);
  let created = 0;
  let updated = 0;
  const persistedRecordIndexes = new Set<number>();
  for (const [field, allRows] of groups) {
    // Rows written before company-keyed dedupe carry an email-derived (or no)
    // dedupeKey; move them onto the company key so the upsert updates them. A
    // row already keyed by a higher-precedence field (domain) is the company's
    // row: it keeps its key and the lower-precedence input is not written, so
    // a domainless sighting cannot erase the domain.
    const precedence = PROSPECTING_DEDUPE_FIELDS.indexOf(field as (typeof PROSPECTING_DEDUPE_FIELDS)[number]);
    const { keyedElsewhere } = await rekeyResearchRecords(
      officeId,
      listSlug,
      field,
      allRows.map((input) => inputRow(input)[field]),
      { keepKeyedBy: precedence > 0 ? PROSPECTING_DEDUPE_FIELDS.slice(0, precedence) : [] },
    );
    const skipKeys = new Set(keyedElsewhere);
    const rows = allRows.filter((input) => {
      const key = normalizeDedupeValue(inputRow(input)[field]);
      if (!key || !skipKeys.has(key)) return true;
      const sourceRow = "sourceRow" in input && typeof input.sourceRow === "number" ? input.sourceRow : 0;
      if (sourceRow > 0) persistedRecordIndexes.add(sourceRow - 1);
      return false;
    });
    for (let index = 0; index < rows.length; index += RESEARCH_MAX_ROWS) {
      const result = await upsertResearchRecords(officeId, listSlug, rows.slice(index, index + RESEARCH_MAX_ROWS), {
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

type ProspectingBatchRunner = (
  input: Parameters<typeof runProspectingBatch>[0],
) => Promise<ProspectingBatchResult>;

type ProspectingBookkeeping = {
  recordLeadDiscoveries?: typeof recordLeadDiscoveries;
  finishLeadGenRun?: typeof finishLeadGenRun;
};

function boundedErrorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Prospecting run failed.")
    .replace(/\u2014/g, "-")
    .replace(/\0/g, "")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(authorization|token|secret|password|api[-_]?key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function lostClaimError() {
  return new SupplyPersistenceError(LOST_CLAIM_MESSAGE, "conflict");
}

function isLostClaimError(error: unknown) {
  return error instanceof SupplyPersistenceError && error.code === "conflict" && error.message === LOST_CLAIM_MESSAGE;
}

async function claimProspectingAction(args: {
  context: CompanyContextAccess;
  workspace: { companyId: string };
  workspaceId: string;
  actionId: string;
  resetAttempts: boolean;
  background: boolean;
}) {
  const row = await prisma.companyContext.findFirst({
    where: {
      id: args.actionId,
      officeId: args.context.officeId,
      companyId: args.workspace.companyId,
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
        companyId: args.workspace.companyId,
        kind: "ACTION",
        ...companyContextVisibilityWhere(args.context),
      },
      select: { id: true, payload: true, createdAt: true },
    });
    const found = lockedRow ? actionFromRow(lockedRow) : null;
    if (!found) throw new SupplyPersistenceError("Prospecting action not found.", "not_found");
    if (args.background && !shouldContinueProspectingInBackground(found, { now: Date.now() })) {
      return { action: found, ineligible: true as const, alreadyDone: false as const };
    }
    if (found.status === "DISMISSED") throw new SupplyPersistenceError("This prospecting action was dismissed.", "conflict");
    if (found.status === "COMPLETED" && found.exhausted) {
      return { action: found, alreadyDone: true as const, ineligible: false as const };
    }
    if (found.status === "RUNNING") {
      const started = found.runningStartedAt ? new Date(found.runningStartedAt).valueOf() : 0;
      if (started && Date.now() - started < STALE_RUN_MS) {
        throw lostClaimError();
      }
    }
    const claim: StoredProspectingAction & { id: string; createdAt: Date } = {
      ...found,
      status: "RUNNING",
      workspaceId: args.workspaceId,
      autoContinue: args.background ? found.autoContinue : true,
      attempts: args.resetAttempts ? 0 : found.attempts,
      lastError: args.resetAttempts ? null : found.lastError,
      claimToken: randomUUID(),
      runningStartedAt: new Date().toISOString(),
    };
    const claimPayload = { ...claim };
    delete (claimPayload as { id?: string }).id;
    delete (claimPayload as { createdAt?: Date }).createdAt;
    const updated = await tx.companyContext.updateMany({
      where: {
        id: found.id,
        officeId: args.context.officeId,
        companyId: args.workspace.companyId,
        kind: "ACTION",
        processingState: found.status,
        ...companyContextVisibilityWhere(args.context),
      },
      data: { payload: claimPayload, processingState: claimPayload.status },
    });
    if (updated.count !== 1) throw lostClaimError();
    return { action: claim, alreadyDone: false as const, ineligible: false as const };
  });
  return claimed;
}

async function executeProspectingAction(args: {
  context: CompanyContextAccess;
  workspace: { companyId: string };
  workspaceId: string;
  action: ContextProspectingAction;
  search?: ProspectingSearch;
  fetchPage?: typeof defaultFetcher;
  resolveMx?: VerifyOptions["resolveMx"];
  runBatch?: ProspectingBatchRunner;
  batchBudgetMs?: number;
  backgroundNow?: number;
  bookkeeping?: ProspectingBookkeeping;
}) {
  const claimToken = args.action.claimToken;
  if (!claimToken) throw lostClaimError();
  let leadGenRunId: string | null = null;
  let batchStats: ProspectingBatchStats | null = null;
  let progressCommitted = false;
  let completedAction: (StoredProspectingAction & { id: string; createdAt: Date }) | null = null;
  const recordDiscoveries = args.bookkeeping?.recordLeadDiscoveries ?? recordLeadDiscoveries;
  const finishRun = args.bookkeeping?.finishLeadGenRun ?? finishLeadGenRun;
  try {
    const list = await ensureResearchList(args.context.officeId, args.workspace.companyId, args.action.draft);
    const draft = { ...args.action.draft, listSlug: list.slug };
    const profile = profileFromProspectingDraft(draft);
    const leadGenRun = await createLeadGenRun(prisma, {
      officeId: args.context.officeId,
      profileSlug: profile.slug,
      campaignTag: draft.listSlug,
      workspaceId: args.workspaceId,
    });
    leadGenRunId = leadGenRun.id;
    const result = await (args.runBatch ?? runProspectingBatch)({
      profile,
      queryOffset: args.action.planVersion === QUERY_PLAN_VERSION ? args.action.nextQueryOffset : 0,
      search: args.search ?? defaultProspectingSearch,
      fetchPage: args.fetchPage ?? defaultFetcher,
      resolveMx: args.resolveMx,
      budgetMs: args.batchBudgetMs,
    });
    batchStats = result.stats;
    const persisted = await persistCandidates(args.context.officeId, draft.listSlug, result.candidates);
    const completed: StoredProspectingAction = {
      ...args.action,
      draft,
      status: "COMPLETED",
      runningStartedAt: null,
      stats: {
        queriesUsed: args.action.stats.queriesUsed + result.stats.queriesUsed,
        pagesFetched: args.action.stats.pagesFetched + result.stats.pagesFetched,
        candidatesFound: args.action.stats.candidatesFound + result.stats.candidatesFound,
        rowsCreated: args.action.stats.rowsCreated + persisted.created,
        rowsUpdated: args.action.stats.rowsUpdated + persisted.updated,
      },
      planVersion: QUERY_PLAN_VERSION,
      nextQueryOffset: result.nextQueryOffset,
      exhausted: result.exhausted,
      attempts: args.backgroundNow === undefined ? args.action.attempts : 0,
      lastError: args.backgroundNow === undefined ? args.action.lastError : null,
      lastBackgroundRunAt: args.backgroundNow === undefined
        ? args.action.lastBackgroundRunAt
        : new Date(args.backgroundNow).toISOString(),
      autoContinue: result.exhausted ||
        args.action.stats.rowsCreated + persisted.created >= draft.rowTarget
        ? false
        : args.action.autoContinue,
    };
    const updated = await prisma.companyContext.updateMany({
      where: {
        id: args.action.id,
        officeId: args.context.officeId,
        companyId: args.workspace.companyId,
        kind: "ACTION",
        processingState: "RUNNING",
        payload: { path: ["claimToken"], equals: claimToken },
        ...companyContextVisibilityWhere(args.context),
      },
      data: { payload: completed, processingState: completed.status },
    });
    if (updated.count !== 1) throw lostClaimError();
    progressCommitted = true;
    completedAction = { id: args.action.id, createdAt: args.action.createdAt, ...completed };
    try {
      await recordDiscoveries(prisma, {
        officeId: args.context.officeId,
        runId: leadGenRunId,
        campaignTag: draft.listSlug,
        profileSlug: profile.slug,
        records: result.candidates.map((record, index) => ({
          ...record,
          persisted: persisted.persistedRecordIndexes.has(index),
        })),
      });
      await finishRun(prisma, {
        officeId: args.context.officeId,
        runId: leadGenRunId,
        status: "COMPLETED",
        counters: {
          ...result.stats,
          companiesCreated: persisted.created,
          companiesUpdated: persisted.updated,
          contactsCreated: persisted.contactsCreated,
          skipped: persisted.skipped,
          providerStats: runProviderStats(result.stats),
        },
      });
    } catch (bookkeepingError) {
      await finishRun(prisma, {
        officeId: args.context.officeId,
        runId: leadGenRunId,
        status: "FAILED",
        counters: {
          queriesUsed: result.stats.queriesUsed,
          pagesFetched: result.stats.pagesFetched,
          candidatesFound: result.stats.candidatesFound,
          companiesCreated: persisted.created,
          companiesUpdated: persisted.updated,
          contactsCreated: persisted.contactsCreated,
          skipped: persisted.skipped,
          providerStats: runProviderStats(result.stats),
        },
        error: boundedErrorMessage(bookkeepingError),
      }).catch(() => undefined);
    }
    return { id: args.action.id, createdAt: args.action.createdAt, ...completed };
  } catch (error) {
    if (progressCommitted && completedAction) return completedAction;
    if (leadGenRunId) {
      await finishRun(prisma, {
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
          providerStats: runProviderStats(batchStats),
        },
        error: boundedErrorMessage(error),
      });
      await discardLeadGenRunDiscoveries(args.context.officeId, leadGenRunId);
    }
    const failed: StoredProspectingAction = {
      ...args.action,
      status: "FAILED",
      runningStartedAt: null,
    };
    const updated = await prisma.companyContext.updateMany({
      where: {
        id: args.action.id,
        officeId: args.context.officeId,
        companyId: args.workspace.companyId,
        kind: "ACTION",
        processingState: "RUNNING",
        payload: { path: ["claimToken"], equals: claimToken },
        ...companyContextVisibilityWhere(args.context),
      },
      data: { payload: failed, processingState: failed.status, processingError: "Prospecting run failed." },
    });
    if (updated.count !== 1) throw lostClaimError();
    throw error;
  }
}

export function shouldContinueProspectingInBackground(
  action: StoredProspectingAction,
  options: { now: number; maxAttempts?: number },
) {
  if (!action.autoContinue || action.exhausted || action.stats.rowsCreated >= action.draft.rowTarget) return false;
  if (action.status === "COMPLETED") return true;
  if (action.status === "FAILED") {
    const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
    return action.attempts < maxAttempts;
  }
  if (action.status !== "RUNNING") return false;
  const started = action.runningStartedAt ? Date.parse(action.runningStartedAt) : Number.NaN;
  return !Number.isFinite(started) || options.now - started >= STALE_RUN_MS;
}

async function recordBackgroundFailure(args: {
  context: CompanyContextAccess;
  workspace: { companyId: string };
  actionId: string;
  claimToken: string;
  now: number;
  error: unknown;
}) {
  const row = await prisma.companyContext.findFirst({
    where: {
      id: args.actionId,
      officeId: args.context.officeId,
      companyId: args.workspace.companyId,
      kind: "ACTION",
      ...companyContextVisibilityWhere(args.context),
    },
    select: { id: true, payload: true, createdAt: true },
  });
  const current = row ? actionFromRow(row) : null;
  if (!current) return false;
  const failed: StoredProspectingAction = {
    ...current,
    status: "FAILED",
    runningStartedAt: null,
    attempts: current.attempts + 1,
    autoContinue: current.attempts + 1 >= MAX_BACKGROUND_ATTEMPTS ? false : current.autoContinue,
    lastError: boundedErrorMessage(args.error),
    lastBackgroundRunAt: new Date(args.now).toISOString(),
  };
  const updated = await prisma.companyContext.updateMany({
    where: {
      id: current.id,
      officeId: args.context.officeId,
      companyId: args.workspace.companyId,
      kind: "ACTION",
      processingState: current.status,
      payload: { path: ["claimToken"], equals: args.claimToken },
      ...companyContextVisibilityWhere(args.context),
    },
    data: { payload: failed, processingState: failed.status, processingError: "Prospecting run failed." },
  });
  return updated.count === 1;
}

async function revokeBackgroundAction(args: {
  id: string;
  officeId: string;
  companyId: string;
}) {
  return prisma.$transaction(async (tx) => {
    await lockCompanyContextAction(tx, args.id);
    const row = await tx.companyContext.findFirst({
      where: {
        id: args.id,
        officeId: args.officeId,
        companyId: args.companyId,
        kind: "ACTION",
        processingState: { in: ["COMPLETED", "FAILED", "RUNNING"] },
        payload: { path: ["autoContinue"], equals: true },
      },
      select: { id: true, payload: true, createdAt: true },
    });
    const current = row ? actionFromRow(row) : null;
    if (!current) return false;
    const revoked: StoredProspectingAction = {
      ...current,
      autoContinue: false,
      claimToken: null,
    };
    const updated = await tx.companyContext.updateMany({
      where: {
        id: current.id,
        officeId: args.officeId,
        companyId: args.companyId,
        kind: "ACTION",
        processingState: current.status,
        payload: { path: ["autoContinue"], equals: true },
      },
      data: { payload: revoked },
    });
    return updated.count === 1;
  });
}

export async function runProspectingBackgroundTick(options?: {
  now?: () => number;
  budgetMs?: number;
  maxJobs?: number;
  batchBudgetMs?: number;
  runBatch?: ProspectingBatchRunner;
  search?: ProspectingSearch;
  fetchPage?: typeof defaultFetcher;
  resolveMx?: VerifyOptions["resolveMx"];
  bookkeeping?: ProspectingBookkeeping;
  beforeClaim?: (action: StoredProspectingAction) => Promise<void>;
}) {
  const now = options?.now ?? Date.now;
  const budgetMs = Math.max(0, Math.floor(options?.budgetMs ?? 240_000));
  const batchBudgetMs = Math.max(1_000, Math.floor(options?.batchBudgetMs ?? 110_000));
  const maxJobs = Math.max(1, Math.floor(options?.maxJobs ?? 20));
  const startedAt = now();
  const pageSize = maxJobs * 4;
  const eligibleRows: Array<{
    id: string;
    officeId: string;
    companyId: string;
    payload: unknown;
    createdAt: Date;
    createdByUserId: string | null;
  }> = [];
  let scanned = 0;
  let cursorId: string | undefined;
  while (eligibleRows.length < maxJobs && scanned < BACKGROUND_SCAN_CAP) {
    const page = await prisma.companyContext.findMany({
      where: {
        kind: "ACTION",
        AND: [
          { payload: { path: ["type"], equals: ACTION_TYPE } },
          { payload: { path: ["autoContinue"], equals: true } },
        ],
        processingState: { in: ["COMPLETED", "FAILED", "RUNNING"] },
      },
      select: {
        id: true,
        officeId: true,
        companyId: true,
        payload: true,
        createdAt: true,
        createdByUserId: true,
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: Math.min(pageSize, BACKGROUND_SCAN_CAP - scanned),
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    scanned += page.length;
    cursorId = page[page.length - 1]?.id;
    for (const row of page) {
      const action = actionFromRow(row);
      if (action && shouldContinueProspectingInBackground(action, { now: now() })) {
        eligibleRows.push(row);
        if (eligibleRows.length >= maxJobs) break;
      }
    }
  }
  let ran = 0;
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  let lostClaims = 0;
  let revoked = 0;
  let budgetExhausted = false;
  for (const row of eligibleRows) {
    const action = actionFromRow(row);
    if (!action) {
      skipped += 1;
      continue;
    }
    if (ran >= maxJobs) break;
    if (options?.beforeClaim) await options.beforeClaim(action);
    const creator = row.createdByUserId
      ? await prisma.user.findFirst({
          where: { id: row.createdByUserId, officeId: row.officeId, isActive: true },
          select: { id: true },
        })
      : null;
    if (!creator) {
      await revokeBackgroundAction({
        id: row.id,
        officeId: row.officeId,
        companyId: row.companyId,
      });
      revoked += 1;
      continue;
    }
    const workspace = action.workspaceId
      ? await prisma.supplyWorkspace.findFirst({
          where: {
            id: action.workspaceId,
            officeId: row.officeId,
            companyId: row.companyId,
            status: "ACTIVE",
          },
          select: { id: true, companyId: true },
        })
      : await prisma.supplyWorkspace.findFirst({
          where: {
            officeId: row.officeId,
            companyId: row.companyId,
            status: "ACTIVE",
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, companyId: true },
        });
    if (!workspace?.companyId) {
      skipped += 1;
      continue;
    }
    const resolvedWorkspace = { id: workspace.id, companyId: workspace.companyId };
    const remaining = budgetMs - (now() - startedAt);
    if (remaining < batchBudgetMs + 20_000) {
      budgetExhausted = true;
      break;
    }
    const context: CompanyContextAccess = {
      officeId: row.officeId,
      userId: row.createdByUserId ?? "",
      role: "OWNER",
      canViewWholeOffice: true,
      accessKind: "operator",
    };
    let claimedAction: ContextProspectingAction | null = null;
    let claimToken: string | null = null;
    try {
      const claimed = await claimProspectingAction({
        context,
        workspace: resolvedWorkspace,
        workspaceId: resolvedWorkspace.id,
        actionId: action.id,
        resetAttempts: false,
        background: true,
      });
      if (claimed.ineligible) {
        skipped += 1;
        continue;
      }
      if (claimed.alreadyDone) {
        skipped += 1;
        continue;
      }
      claimedAction = claimed.action;
      claimToken = claimedAction.claimToken;
      if (!claimToken) {
        lostClaims += 1;
        continue;
      }
      ran += 1;
      await executeProspectingAction({
        context,
        workspace: resolvedWorkspace,
        workspaceId: resolvedWorkspace.id,
        action: claimed.action,
        search: options?.search,
        fetchPage: options?.fetchPage,
        resolveMx: options?.resolveMx,
        runBatch: options?.runBatch,
        batchBudgetMs,
        backgroundNow: now(),
        bookkeeping: options?.bookkeeping,
      });
      completed += 1;
    } catch (error) {
      if (!claimedAction) {
        skipped += 1;
        continue;
      }
      if (!claimToken) {
        lostClaims += 1;
        continue;
      }
      if (isLostClaimError(error)) {
        lostClaims += 1;
        continue;
      }
      failed += 1;
      await recordBackgroundFailure({
        context,
        workspace: resolvedWorkspace,
        actionId: claimedAction.id,
        claimToken,
        now: now(),
        error,
      }).then((updated) => {
        if (!updated) lostClaims += 1;
      }).catch(() => undefined);
    }
  }
  return {
    scanned,
    ran,
    completed,
    failed,
    skipped,
    lostClaims,
    revoked,
    budgetExhausted,
  };
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
  bookkeeping?: ProspectingBookkeeping;
}) {
  const workspace = await companyWorkspace(args.context, args.workspaceId, "edit");
  const claimed = await claimProspectingAction({
    context: args.context,
    workspace,
    workspaceId: args.workspaceId,
    actionId: args.actionId,
    resetAttempts: true,
    background: false,
  });
  if (claimed.alreadyDone) return claimed.action;
  return executeProspectingAction({
    ...args,
    workspace,
    action: claimed.action,
    runBatch: args.runBatch
      ? (input) => args.runBatch!({
          profile: input.profile,
          queryOffset: input.queryOffset ?? 0,
          search: input.search,
          fetchPage: input.fetchPage,
          resolveMx: input.resolveMx,
        })
      : undefined,
  });
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
