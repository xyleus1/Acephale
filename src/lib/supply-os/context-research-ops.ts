import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { registrableDomain, htmlToText } from "@/lib/leadgen/extract";
import { profileFromProspectingDraft } from "@/lib/leadgen/run";
import { classifyByRule, cleanCompanyName, qualifyCandidates, createOpenAiQualifier, type QualificationInput } from "@/lib/leadgen/qualify";
import { defaultFetcher, harvestSite } from "@/lib/leadgen/harvest";
import type { ContextProspectingAction } from "@/lib/supply-os/context-prospecting";
import type { CompanyContextAccess } from "@/lib/customer-context-access";
import { PROSPECTING_MIN_FIT_SCORE } from "@/lib/supply-os/context-prospecting-constants";
import { isUnscreenedVerdict } from "@/lib/research-record-stages";

import type { ResearchRecordData } from "@/lib/research-lists";
const serverModules = async () => ({
  prospecting: await import("@/lib/supply-os/context-prospecting"),
  access: await import("@/lib/customer-context-access"),
  persistence: await import("@/lib/supply-os/persistence"),
});

export type ResearchOperationKind = "status" | "audit" | "pause" | "resume" | "purge" | "expand_regions" | "requalify" | "enrich";
export type ResearchOperationRequest = {
  kind: ResearchOperationKind;
  projectName: string | null;
  regions: string[];
  note: string;
};

export type StoredResearchOperation = {
  schemaVersion: 1;
  type: "research_operation";
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "DISMISSED";
  kind: Exclude<ResearchOperationKind, "status" | "audit">;
  projectId: string;
  projectName: string;
  listId: string;
  listSlug: string;
  regions: string[];
  note: string;
  preview: string[];
  result: string[];
  requestMessageId: string;
  requestBody: string;
  requestCreatedAt: string;
  threadId: string | null;
  runningStartedAt: string | null;
  lastError: string | null;
  workspaceId: string | null;
  force?: boolean;
  approvedIds?: string[];
  approvedReasons?: Record<string, PurgeReason>;
};

export type ContextResearchOperation = StoredResearchOperation & { id: string; createdAt: Date; stale: boolean };
type ResearchRow = {
  id: string;
  data: ResearchRecordData;
  sourceRefs: Prisma.JsonValue | null;
  status: string;
  createdAt: Date;
};
export type ResearchListChoice = { id: string; slug: string; name: string; recordCount: number };

const OPERATION_KINDS = new Set<ResearchOperationKind>(["status", "audit", "pause", "resume", "purge", "expand_regions", "requalify", "enrich"]);
export const RESEARCH_OPERATION_STALE_MS = 10 * 60_000;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.replace(/\u2014/g, "-").replace(/\0/g, "").trim().slice(0, max) : "";
}

export function normalizeResearchOperation(value: unknown): ResearchOperationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const kind = text(input.kind, 30) as ResearchOperationKind;
  if (!OPERATION_KINDS.has(kind)) return null;
  const projectText = text(input.projectName, 160);
  const regions = Array.isArray(input.regions)
    ? input.regions.map((entry) => text(entry, 100)).filter(Boolean).slice(0, 20)
    : [];
  return { kind, projectName: projectText || null, regions, note: text(input.note, 300) };
}

export async function projectLists(officeId: string, projectId: string): Promise<ResearchListChoice[]> {
  const lists = await prisma.researchList.findMany({
    where: { officeId, projectId },
    select: { id: true, slug: true, name: true, _count: { select: { records: true } } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  return lists.map((list) => ({ id: list.id, slug: list.slug, name: list.name, recordCount: list._count.records }));
}

export function selectProjectList(lists: ResearchListChoice[]) {
  return [...lists].sort((a, b) => b.recordCount - a.recordCount || a.id.localeCompare(b.id))[0] ?? null;
}

async function chooseProjectList(officeId: string, projectId: string) {
  return selectProjectList(await projectLists(officeId, projectId));
}

export async function projectJobs(context: CompanyContextAccess, workspaceId: string, listSlug: string) {
  const { prospecting } = await serverModules();
  return (await prospecting.listCompanyContextProspectingActions(context, workspaceId))
    .filter((action) => action.status !== "DISMISSED" && action.draft.listSlug === listSlug);
}

async function loadRows(officeId: string, listId: string): Promise<ResearchRow[]> {
  const rows: ResearchRow[] = [];
  let cursor: string | undefined;
  while (true) {
    const page = await prisma.researchRecord.findMany({
      where: { officeId, listId },
      select: { id: true, data: true, sourceRefs: true, status: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    rows.push(...page.map((row) => ({
      ...row,
      data: (row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {}) as ResearchRecordData,
    })));
    cursor = page[page.length - 1]?.id;
    if (page.length < 500) break;
  }
  return rows;
}

export function rowDomain(data: ResearchRecordData) {
  return registrableDomain(String(data.website ?? data.domain ?? ""));
}

export function rowEvidenceUrls(data: ResearchRecordData, sourceRefs: Prisma.JsonValue | null) {
  const values = Array.isArray(data.evidence_urls)
    ? data.evidence_urls.map(String)
    : typeof data.evidence_urls === "string" ? data.evidence_urls.split(/\r?\n/) : [];
  const refs = sourceRefs && typeof sourceRefs === "object" && !Array.isArray(sourceRefs)
    ? Object.values(sourceRefs as Record<string, unknown>).flatMap((value) => Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : [])
    : Array.isArray(sourceRefs) ? sourceRefs.map(String) : [];
  return [...new Set([...values, ...refs].map((value) => value.trim()).filter((value) => /^https?:\/\//i.test(value)))];
}

export function rowFitScore(data: ResearchRecordData) {
  const value = typeof data.fit_score === "number" ? data.fit_score : Number(data.fit_score);
  return Number.isFinite(value) && String(data.fit_score ?? "").trim() !== "" ? value : null;
}

export function rowHasEmail(data: ResearchRecordData) {
  return typeof data.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim());
}

export function rowHasPhone(data: ResearchRecordData) {
  return typeof data.phone === "string" && data.phone.trim().length >= 5;
}

function country(row: ResearchRow) {
  const value = String(row.data.country ?? "").trim() || "Unknown";
  return value;
}

export type ResearchAudit = {
  total: number;
  byCountry: Array<[string, number]>;
  fit: { a: number; b: number; belowFloor: number; unknown: number };
  withEmail: number;
  withPhone: number;
  withEvidence: number;
  status: Record<"new" | "reviewed" | "rejected", number>;
  verdict: { target: number; notTarget: number; unverified: number; unscreened: number };
  entityTypes: Array<[string, number]>;
  ruleNonCompanies: Array<{ id: string; domain: string; entityType: import("@/lib/leadgen/qualify").EntityType }>;
  duplicates: Array<{ keepId: string; dropIds: string[]; domain: string }>;
  nameArtifacts: number;
};

export function auditResearchRows(rows: ResearchRow[]): ResearchAudit {
  const countries = new Map<string, number>();
  const entities = new Map<string, number>();
  const status = { new: 0, reviewed: 0, rejected: 0 };
  const fit = { a: 0, b: 0, belowFloor: 0, unknown: 0 };
  const verdict = { target: 0, notTarget: 0, unverified: 0, unscreened: 0 };
  let withEmail = 0;
  let withPhone = 0;
  let withEvidence = 0;
  let nameArtifacts = 0;
  const ruleNonCompanies: ResearchAudit["ruleNonCompanies"] = [];
  const groups = new Map<string, ResearchRow[]>();
  for (const row of rows) {
    countries.set(country(row), (countries.get(country(row)) ?? 0) + 1);
    if (rowHasEmail(row.data)) withEmail += 1;
    if (rowHasPhone(row.data)) withPhone += 1;
    if (rowEvidenceUrls(row.data, row.sourceRefs).length) withEvidence += 1;
    if (row.status === "new" || row.status === "reviewed" || row.status === "rejected") status[row.status] += 1;
    const score = rowFitScore(row.data);
    if (score === null) fit.unknown += 1;
    else if (score >= 70) fit.a += 1;
    else if (score >= 50) fit.b += 1;
    else fit.belowFloor += 1;
    const rawVerdict = String(row.data.fit_verdict ?? "").trim();
    if (rawVerdict === "target") verdict.target += 1;
    else if (rawVerdict === "not_target") verdict.notTarget += 1;
    else if (rawVerdict === "unverified") verdict.unverified += 1;
    else verdict.unscreened += 1;
    const entity = String(row.data.entity_type ?? "").trim();
    if (entity) entities.set(entity, (entities.get(entity) ?? 0) + 1);
    const domain = rowDomain(row.data);
    if (domain) {
      groups.set(domain, [...(groups.get(domain) ?? []), row]);
      const rule = classifyByRule({
        id: row.id,
        companyName: String(row.data.company_name ?? ""),
        domain,
        website: String(row.data.website ?? ""),
        country: String(row.data.country ?? "") || null,
        pageExcerpt: "",
        evidenceUrls: rowEvidenceUrls(row.data, row.sourceRefs),
      });
      if (rule && !rule.isTarget) ruleNonCompanies.push({ id: row.id, domain, entityType: rule.entityType });
    }
    const name = String(row.data.company_name ?? "");
    if (name && cleanCompanyName(name, domain) !== name.trim()) nameArtifacts += 1;
  }
  const duplicates = [...groups.entries()].flatMap(([domain, group]) => {
    if (group.length < 2) return [];
    const sorted = [...group].sort((a, b) =>
      Number(rowHasEmail(b.data)) - Number(rowHasEmail(a.data))
      || Number(rowHasPhone(b.data)) - Number(rowHasPhone(a.data))
      || a.createdAt.valueOf() - b.createdAt.valueOf()
      || a.id.localeCompare(b.id));
    return [{ keepId: sorted[0]!.id, dropIds: sorted.slice(1).map((row) => row.id), domain }];
  });
  return {
    total: rows.length,
    byCountry: [...countries.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
    fit,
    withEmail,
    withPhone,
    withEvidence,
    status,
    verdict,
    entityTypes: [...entities.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8),
    ruleNonCompanies,
    duplicates,
    nameArtifacts,
  };
}

function listParts(items: Array<[string, number]>) {
  return items.map(([name, count]) => `${name} ${count}`).join(", ") || "none";
}

export function renderResearchAudit(projectName: string, audit: ResearchAudit, purgeCount: number) {
  const duplicateDrops = audit.duplicates.reduce((sum, item) => sum + item.dropIds.length, 0);
  return [
    `${projectName}: Rows ${audit.total}. Countries: ${listParts(audit.byCountry)}.`,
    `Fit: A ${audit.fit.a}, B ${audit.fit.b}, below floor ${audit.fit.belowFloor}, unknown ${audit.fit.unknown}.`,
    `Contacts: email ${audit.withEmail}, phone ${audit.withPhone}. Evidence on ${audit.withEvidence}.`,
    `Screening: ${audit.verdict.target + audit.verdict.notTarget + audit.verdict.unverified} screened, ${audit.verdict.unscreened} unscreened. Rule non-companies: ${audit.ruleNonCompanies.length}${audit.ruleNonCompanies.length ? ` (${listParts([...new Map(audit.ruleNonCompanies.map((row) => [row.entityType, (audit.ruleNonCompanies.filter((item) => item.entityType === row.entityType).length)]))])})` : ""}.`,
    `Duplicates: ${duplicateDrops} extra rows across ${audit.duplicates.length} domains.`,
    `Name artifacts: ${audit.nameArtifacts}.`,
    `Purge would remove ${purgeCount} rows; requalify would screen ${audit.verdict.unscreened + audit.verdict.unverified} rows.`,
  ];
}

export type PurgeReason = "non_company" | "not_target" | "below_floor" | "duplicate";
export function selectPurgeRows(rows: ResearchRow[]) {
  const audit = auditResearchRows(rows);
  const reasons = new Map<string, PurgeReason>();
  for (const item of audit.ruleNonCompanies) reasons.set(item.id, "non_company");
  for (const row of rows) if (!reasons.has(row.id) && row.data.fit_verdict === "not_target") reasons.set(row.id, "not_target");
  for (const row of rows) if (!reasons.has(row.id) && (rowFitScore(row.data) ?? PROSPECTING_MIN_FIT_SCORE) < PROSPECTING_MIN_FIT_SCORE) reasons.set(row.id, "below_floor");
  for (const group of audit.duplicates) for (const id of group.dropIds) if (!reasons.has(id)) reasons.set(id, "duplicate");
  return [...reasons.entries()].map(([id, reason]) => ({ id, reason }));
}

export function intersectApprovedPurge(
  selected: ReturnType<typeof selectPurgeRows>,
  approvedIds: string[],
  approvedReasons?: Record<string, PurgeReason>,
) {
  const approved = new Set(approvedIds);
  const current = new Map(selected.map((row) => [row.id, row.reason]));
  return {
    rows: selected.filter((row) => approved.has(row.id) && (!approvedReasons || approvedReasons[row.id] === row.reason)),
    skipped: approvedIds.filter((id) => {
      const reason = current.get(id);
      return reason === undefined || (approvedReasons !== undefined && approvedReasons[id] !== reason);
    }).length
      + selected.filter((row) => !approved.has(row.id)).length,
  };
}

export function remainingRequalificationRows(rows: ResearchRow[], force: boolean, resolved: number) {
  const eligible = force ? rows.length : rows.filter((row) => isUnscreenedVerdict(row.data.fit_verdict)).length;
  return Math.max(0, eligible - resolved);
}

export function orderRequalificationRows(rows: ResearchRow[], force: boolean) {
  const eligible = force ? [...rows] : rows.filter((row) => isUnscreenedVerdict(row.data.fit_verdict));
  return eligible.sort((a, b) => {
    const aTimestamp = typeof a.data.fit_screened_at === "string" ? Date.parse(a.data.fit_screened_at) : Number.NaN;
    const bTimestamp = typeof b.data.fit_screened_at === "string" ? Date.parse(b.data.fit_screened_at) : Number.NaN;
    const aUnscreened = Number.isFinite(aTimestamp) ? 1 : 0;
    const bUnscreened = Number.isFinite(bTimestamp) ? 1 : 0;
    return aUnscreened - bUnscreened
      || (Number.isFinite(aTimestamp) && Number.isFinite(bTimestamp) ? aTimestamp - bTimestamp : 0)
      || a.createdAt.valueOf() - b.createdAt.valueOf()
      || a.id.localeCompare(b.id);
  });
}

export function rowsCreatedAfterPurge(rowsCreated: number, remaining: number) {
  return Math.min(rowsCreated, remaining);
}

function ageText(value: string | null) {
  if (!value) return "unknown";
  const age = Math.max(0, Date.now() - Date.parse(value));
  if (age < 60_000) return "just now";
  const minutes = Math.round(age / 60_000);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} hr ago`;
}

export function renderResearchStatus(args: { projectName: string; list: { name: string; recordCount: number }; jobs: ContextProspectingAction[] }) {
  if (!args.jobs.length) return [`${args.projectName}: 0 jobs, ${args.list.recordCount} rows`];
  return args.jobs.flatMap((job, index) => {
    let state = "paused";
    if (job.status === "PENDING") state = "pending confirmation";
    else if (job.status === "FAILED") state = `failed: ${job.lastError ?? "unknown error"}`;
    else if (job.exhausted) state = "exhausted (current regions used up)";
    else if (job.status === "COMPLETED" && job.stats.rowsCreated >= job.draft.rowTarget) state = "finished (target reached)";
    else if (job.status === "RUNNING" || (job.status === "COMPLETED" && job.autoContinue && job.stats.rowsCreated < job.draft.rowTarget)) state = "running in background";
    return [
      `${args.projectName}: ${args.list.recordCount} rows in list, job ${index + 1} of ${args.jobs.length}`,
      `  State: ${state}`,
      `  Progress: ${job.stats.rowsCreated} / ${job.draft.rowTarget} target, ${job.stats.queriesUsed} queries, ${job.stats.pagesFetched.toLocaleString()} pages, screened ${job.stats.qualification.evaluated}: ${job.stats.qualification.accepted} kept, ${Object.values(job.stats.qualification.rejected).reduce((a, b) => a + b, 0)} rejected (${Object.entries(job.stats.qualification.rejected).map(([key, value]) => `${key} ${value}`).join(", ") || "none"}), ${job.stats.qualification.fallback} unscreened fallbacks`,
      `  Regions: ${job.draft.regions.join(", ")}. Last batch: ${ageText(job.lastBackgroundRunAt)}.`,
    ];
  });
}

async function workspaceFor(context: CompanyContextAccess, workspaceId: string, mode: "view" | "edit" = "edit") {
  const { access } = await serverModules();
  if (access.isCustomerContextAccess(context) || context.accessKind === "customer") throw new Error("Research operations are not available for customer access.");
  const workspace = await access.requireCompanyContextWorkspace(context, workspaceId, mode);
  if (!workspace.companyId) throw new Error("Context requires a company-linked workspace.");
  return { ...workspace, companyId: workspace.companyId };
}

export function operationFromRow(row: { id: string; payload: unknown; createdAt: Date }): ContextResearchOperation | null {
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) return null;
  const value = row.payload as Record<string, unknown>;
  if (value.type !== "research_operation") return null;
  if (typeof value.projectId !== "string" || typeof value.listId !== "string" || typeof value.kind !== "string") return null;
  const runningStartedAt = typeof value.runningStartedAt === "string" ? value.runningStartedAt : null;
  const stale = value.status === "RUNNING"
    && runningStartedAt !== null
    && Date.now() - new Date(runningStartedAt).valueOf() >= RESEARCH_OPERATION_STALE_MS;
  return { ...(value as unknown as StoredResearchOperation), id: row.id, createdAt: row.createdAt, stale };
}

function storedOperation(operation: ContextResearchOperation): StoredResearchOperation {
  return Object.fromEntries(
    Object.entries(operation).filter(([key]) => key !== "id" && key !== "createdAt" && key !== "stale"),
  ) as unknown as StoredResearchOperation;
}

export async function listCompanyContextResearchOperations(context: CompanyContextAccess, workspaceId: string) {
  const { access } = await serverModules();
  if (access.isCustomerContextAccess(context) || context.accessKind === "customer") return [];
  const workspace = await workspaceFor(context, workspaceId, "view");
  const rows = await prisma.companyContext.findMany({
    where: { officeId: context.officeId, companyId: workspace.companyId, kind: "ACTION", ...access.companyContextVisibilityWhere(context) },
    select: { id: true, payload: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 500,
  });
  return rows.flatMap((row) => {
    const operation = operationFromRow(row);
    return operation ? [operation] : [];
  });
}

async function projectContext(args: { context: CompanyContextAccess; workspaceId: string; projectId: string; companyId: string; listSlug?: string }) {
  const selectedList = args.listSlug
    ? await prisma.researchList.findFirst({
        where: { officeId: args.context.officeId, projectId: args.projectId, slug: args.listSlug },
        select: { id: true, slug: true, name: true, _count: { select: { records: true } } },
      })
    : await chooseProjectList(args.context.officeId, args.projectId);
  if (!selectedList) {
    if (args.listSlug) {
      const { persistence } = await serverModules();
      throw new persistence.SupplyPersistenceError("The research list is not available for this project.", "not_found");
    }
    throw new Error("The project has no research list.");
  }
  return projectContextForList(args, selectedList.id, selectedList.slug);
}

async function projectContextForList(
  args: { context: CompanyContextAccess; workspaceId: string; projectId: string; companyId: string },
  listId: string,
  listSlug: string,
) {
  const project = await prisma.researchProject.findFirst({
    where: {
      id: args.projectId,
      officeId: args.context.officeId,
      OR: [{ companyId: null }, { companyId: args.companyId }],
    },
    select: { id: true },
  });
  if (!project) {
    const { persistence } = await serverModules();
    throw new persistence.SupplyPersistenceError("Project is not available in this workspace.", "forbidden");
  }
  const list = await prisma.researchList.findFirst({
    where: { id: listId, officeId: args.context.officeId, projectId: args.projectId },
    select: { id: true, slug: true, name: true, _count: { select: { records: true } } },
  });
  if (!list) throw new Error("The approved list no longer exists for this project.");
  const selectedList = { id: list.id, slug: list.slug, name: list.name, recordCount: list._count.records };
  const [rows, jobs] = await Promise.all([
    loadRows(args.context.officeId, selectedList.id),
    projectJobs(args.context, args.workspaceId, listSlug),
  ]);
  return { list: selectedList, rows, jobs };
}

export async function createCompanyContextResearchOperations(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  items: Array<{ request: ResearchOperationRequest; projectId: string; projectName: string }>;
  requestMessageId: string;
  requestBody: string;
  requestCreatedAt: Date;
  threadId?: string | null;
  listSlug?: string;
}) {
  if (!args.items.length) return [];
  const { access } = await serverModules();
  const workspace = await workspaceFor(args.context, args.workspaceId);
  const storedItems: StoredResearchOperation[] = [];
  for (const item of args.items) {
    const current = await projectContext({
      context: args.context,
      workspaceId: args.workspaceId,
      projectId: item.projectId,
      companyId: workspace.companyId,
      listSlug: args.listSlug,
    });
    const kind = item.request.kind;
    const forceRequalification = /\b(all|again|re-?screen everything)\b/i.test(item.request.note);
    if (kind === "expand_regions" && !item.request.regions.length) throw new Error("Which regions?");
    const selectedPurge = kind === "purge" ? selectPurgeRows(current.rows) : [];
    const approvedIds = kind === "purge" ? selectedPurge.map((row) => row.id) : undefined;
    const approvedReasons = kind === "purge"
      ? Object.fromEntries(selectedPurge.map((row) => [row.id, row.reason]))
      : undefined;
    const preview = kind === "purge"
      ? (() => {
          const selected = selectedPurge;
          const counts = Object.fromEntries(["non_company", "not_target", "below_floor", "duplicate"].map((reason) => [reason, selected.filter((row) => row.reason === reason).length]));
          return [`Would delete ${selected.length} of ${current.rows.length} rows: ${counts.non_company} non-companies, ${counts.not_target} model non-targets, ${counts.below_floor} below fit floor, ${counts.duplicate} duplicates.`, ...selected.slice(0, 8).map((row) => {
            const fixture = current.rows.find((entry) => entry.id === row.id)!;
            return `${fixture.data.company_name ?? "Unnamed"} (${rowDomain(fixture.data) || "no domain"}): ${row.reason}`;
          })];
        })()
      : kind === "expand_regions"
        ? [`Starts a new research job for ${current.jobs[0]?.draft.segments.join(", ") || item.projectName} in ${item.request.regions.join(", ")} toward the remaining ${Math.max(0, (current.jobs[0]?.draft.rowTarget ?? 0) - current.rows.length)} rows, into the same list.`]
        : kind === "pause"
          ? [`Pauses ${current.jobs.filter((job) => job.status !== "DISMISSED" && !job.exhausted && !(job.status === "COMPLETED" && job.stats.rowsCreated >= job.draft.rowTarget)).length} jobs.`]
          : kind === "resume"
            ? ["Continues paused, failed, or finished research jobs."]
            : kind === "requalify"
              ? [`Screens ${orderRequalificationRows(current.rows, forceRequalification).length} rows without deleting them.`]
              : [`Checks up to 25 sites for missing email and phone without paid enrichment.`];
    storedItems.push({
      schemaVersion: 1,
      type: "research_operation",
      status: "PENDING",
      kind: kind as Exclude<ResearchOperationKind, "status" | "audit">,
      projectId: item.projectId,
      projectName: item.projectName,
      listId: current.list.id,
      listSlug: current.list.slug,
      regions: item.request.regions,
      note: item.request.note,
      preview,
      result: [],
      requestMessageId: args.requestMessageId,
      requestBody: text(args.requestBody, 4_000),
      requestCreatedAt: args.requestCreatedAt.toISOString(),
      threadId: args.threadId ?? null,
      runningStartedAt: null,
      lastError: null,
      workspaceId: workspace.id,
      force: forceRequalification,
      ...(approvedIds ? { approvedIds, approvedReasons } : {}),
    });
  }
  const rows = await prisma.$transaction(storedItems.map((stored) => prisma.companyContext.create({
    data: { officeId: args.context.officeId, companyId: workspace.companyId, kind: "ACTION", name: `${stored.kind}: ${stored.projectName}`, payload: stored, processingState: stored.status, ...access.companyContextActorData(args.context) },
    select: { id: true, payload: true, createdAt: true },
  })));
  return rows.flatMap((row) => {
    const operation = operationFromRow(row);
    return operation ? [operation] : [];
  });
}

async function updateProspectingJob(context: CompanyContextAccess, companyId: string, job: ContextProspectingAction, patch: Partial<ContextProspectingAction>) {
  const { access } = await serverModules();
  const payload = { ...job, ...patch, status: job.status, claimToken: job.claimToken };
  const updated = await prisma.companyContext.updateMany({
    where: {
      id: job.id,
      officeId: context.officeId,
      companyId,
      kind: "ACTION",
      processingState: job.status,
      ...(job.status === "RUNNING" && job.claimToken
        ? { payload: { path: ["claimToken"], equals: job.claimToken } }
        : {}),
      ...access.companyContextVisibilityWhere(context),
    },
    data: { payload, processingState: job.status },
  });
  return updated.count === 1;
}

async function executeResearchOperation(args: { operation: ContextResearchOperation; context: CompanyContextAccess; workspaceId: string }) {
  const workspace = await workspaceFor(args.context, args.workspaceId);
  const companyId = workspace.companyId;
  const current = await projectContextForList(
    { context: args.context, workspaceId: args.workspaceId, projectId: args.operation.projectId, companyId },
    args.operation.listId,
    args.operation.listSlug,
  );
  const jobs = current.jobs;
  const rows = current.rows;
  if (args.operation.kind === "pause") {
    let affected = 0;
    for (const job of jobs) {
      if (job.status === "DISMISSED" || job.exhausted || (job.status === "COMPLETED" && job.stats.rowsCreated >= job.draft.rowTarget)) continue;
      if (await updateProspectingJob(args.context, companyId, job, { autoContinue: false })) affected += 1;
    }
    return [`Paused ${affected} job${affected === 1 ? "" : "s"}. Rows already found stay in the list.`];
  }
  if (args.operation.kind === "resume") {
    if (jobs.length && jobs.every((job) => job.exhausted)) return [`All jobs used up their queries for ${jobs[0]!.draft.regions.join(", ")}. Use expand_regions with new countries.`];
    if (jobs.length && jobs.every((job) => job.stats.rowsCreated >= job.draft.rowTarget)) return ["Target reached; raise the target or expand regions."];
    let resumed = 0;
    for (const job of jobs) {
      if (job.status === "DISMISSED") continue;
      if (await updateProspectingJob(args.context, companyId, job, { autoContinue: true, ...(job.status === "FAILED" ? { attempts: 0, lastError: null } : {}) })) resumed += 1;
    }
    return [`Resumed ${resumed} job${resumed === 1 ? "" : "s"}.`];
  }
  if (args.operation.kind === "purge") {
    const selectedNow = selectPurgeRows(rows);
    const approved = args.operation.approvedIds
      ? intersectApprovedPurge(selectedNow, args.operation.approvedIds, args.operation.approvedReasons)
      : { rows: selectedNow, skipped: 0 };
    const selected = approved.rows;
    for (let index = 0; index < selected.length; index += 200) {
      await prisma.researchRecord.deleteMany({ where: { officeId: args.context.officeId, listId: current.list.id, id: { in: selected.slice(index, index + 200).map((row) => row.id) } } });
    }
    const remaining = await prisma.researchRecord.count({ where: { officeId: args.context.officeId, listId: current.list.id } });
    for (const job of jobs) {
      if (job.status === "DISMISSED") continue;
      await updateProspectingJob(args.context, companyId, job, {
        stats: { ...job.stats, rowsCreated: rowsCreatedAfterPurge(job.stats.rowsCreated, remaining) },
      });
    }
    const backgroundJob = jobs.find((job) => job.status === "RUNNING" || (job.status === "COMPLETED" && job.autoContinue && job.stats.rowsCreated < job.draft.rowTarget));
    const targetJob = jobs[0];
    return [
      `Deleted ${selected.length} rows: ${selected.filter((row) => row.reason === "non_company").length} non-companies, ${selected.filter((row) => row.reason === "not_target").length} model non-targets, ${selected.filter((row) => row.reason === "below_floor").length} below fit floor, ${selected.filter((row) => row.reason === "duplicate").length} duplicates.`,
      `Remaining rows: ${remaining}.`,
      ...(approved.skipped ? [`Skipped ${approved.skipped} rows added or changed since the preview; run audit and purge again to review them.`] : []),
      ...(!backgroundJob && targetJob && remaining < targetJob.draft.rowTarget
        ? [`Job target ${targetJob.draft.rowTarget} with ${remaining} rows; say resume to continue.`]
        : []),
    ];
  }
  const latest = [...jobs].filter((job) => job.status !== "DISMISSED").sort((a, b) => b.createdAt.valueOf() - a.createdAt.valueOf())[0];
  if (args.operation.kind === "expand_regions") {
    if (!latest) return ["No existing research job is available to expand."];
    const existing = jobs.find((job) =>
      job.requestMessageId === args.operation.requestMessageId
      && job.draft.regions.length === args.operation.regions.length
      && job.draft.regions.every((region, index) => region === args.operation.regions[index]),
    );
    if (existing) {
      const { prospecting } = await serverModules();
      const ran = await prospecting.runCompanyContextProspectingAction({ context: args.context, workspaceId: args.workspaceId, actionId: existing.id });
      return [`Started job ${ran.id}: first batch saved ${ran.stats.rowsCreated} rows. Continues in the background.`];
    }
    const draft = { ...latest.draft, regions: args.operation.regions, rowTarget: rows.length >= latest.draft.rowTarget ? 250 : Math.max(50, latest.draft.rowTarget - rows.length) };
    const created = await (await import("@/lib/supply-os/context-prospecting")).createCompanyContextProspectingActions({ context: args.context, workspaceId: args.workspaceId, items: [{ draft, citations: latest.citations }], requestMessageId: args.operation.requestMessageId, requestBody: args.operation.requestBody, requestCreatedAt: new Date(args.operation.requestCreatedAt), threadId: args.operation.threadId });
    const first = created[0];
    if (!first) return ["No research job was created."];
    const { prospecting } = await serverModules();
    const ran = await prospecting.runCompanyContextProspectingAction({ context: args.context, workspaceId: args.workspaceId, actionId: first.id });
    return [`Started job ${ran.id}: first batch saved ${ran.stats.rowsCreated} rows. Continues in the background.`];
  }
  if (!latest) return ["No existing research job contains the project brief needed for screening."];
  const { prospecting } = await serverModules();
  const { buildResearchSearchText } = await import("@/lib/research-lists");
  const brief = prospecting.briefFromProspectingDraft(latest.draft);
  const deadlineAt = Date.now() + 200_000;
  const candidates = args.operation.kind === "requalify"
    ? orderRequalificationRows(rows, Boolean(args.operation.force)).slice(0, 40)
    : rows.filter((row) => (!rowHasEmail(row.data) || !rowHasPhone(row.data)) && row.data.website).slice(0, 25);
  if (args.operation.kind === "requalify") {
    const inputs: QualificationInput[] = [];
    let truncatedByTime = 0;
    for (const row of candidates) {
      if (Date.now() > deadlineAt - 60_000) {
        truncatedByTime = candidates.length - inputs.length;
        break;
      }
      let pageExcerpt = "";
      if (row.data.website) {
        const page = await defaultFetcher(String(row.data.website));
        pageExcerpt = page?.body ? htmlToText(page.body).replace(/\s+/g, " ").slice(0, 2_000) : "";
      }
      inputs.push({ id: row.id, companyName: String(row.data.company_name ?? ""), domain: rowDomain(row.data), website: String(row.data.website ?? ""), country: String(row.data.country ?? "") || null, pageExcerpt, evidenceUrls: rowEvidenceUrls(row.data, row.sourceRefs) });
    }
    const results = await qualifyCandidates(brief, inputs, createOpenAiQualifier(), { deadlineAt });
    const counts = new Map<string, number>();
    let target = 0;
    let fallback = 0;
    for (const row of candidates) {
      const result = results.get(row.id);
      if (!result) continue;
      const data: ResearchRecordData = { ...row.data, company_name: result.displayName || row.data.company_name, entity_type: result.entityType, fit_reason: result.reason, fit_verdict: result.source === "fallback" ? "unverified" : result.isTarget ? "target" : "not_target" };
      data.fit_screened_at = new Date().toISOString();
      await prisma.researchRecord.updateMany({
        where: { id: row.id, officeId: args.context.officeId, listId: current.list.id },
        data: {
          data: data as Prisma.InputJsonValue,
          searchText: buildResearchSearchText(data),
        },
      });
      if (result.isTarget) target += 1; else counts.set(result.entityType, (counts.get(result.entityType) ?? 0) + 1);
      if (result.source === "fallback") fallback += 1;
    }
    const remaining = remainingRequalificationRows(rows, Boolean(args.operation.force), args.operation.force ? inputs.length : inputs.length - fallback);
    return [
      `Screened ${inputs.length} of ${rows.length}: ${target} targets, ${inputs.length - target - fallback} not targets${counts.size ? ` (${[...counts.entries()].map(([key, value]) => `${key} ${value}`).join(", ")})` : ""}, ${fallback} unverified.`,
      `${remaining} left; ask to requalify again to continue.`,
      ...(truncatedByTime ? [`Stopped homepage fetching with ${truncatedByTime} selected rows not screened due to the time limit.`] : []),
    ];
  }
  let newEmails = 0;
  let newPhones = 0;
  let nothing = 0;
  const profile = profileFromProspectingDraft(latest.draft);
  for (const row of candidates) {
    const harvested = await harvestSite(profile, String(row.data.website), { fetcher: defaultFetcher });
    if (!harvested || Array.isArray(harvested)) { nothing += 1; continue; }
    const data = { ...row.data };
    if (!rowHasEmail(data) && harvested.emails[0]) { data.email = harvested.emails[0]; newEmails += 1; }
    if (!rowHasPhone(data) && harvested.phones[0]) { data.phone = harvested.phones[0]; newPhones += 1; }
    const urls = [...new Set([...rowEvidenceUrls(data, row.sourceRefs), ...harvested.evidence.map((item) => item.url)])];
    data.evidence_urls = urls.join("\n");
    if (!harvested.emails.length && !harvested.phones.length) nothing += 1;
    const existingRefs = row.sourceRefs && typeof row.sourceRefs === "object" && !Array.isArray(row.sourceRefs)
      ? row.sourceRefs as Record<string, unknown>
      : {};
    await prisma.researchRecord.updateMany({
      where: { id: row.id, officeId: args.context.officeId, listId: current.list.id },
      data: {
        data: data as Prisma.InputJsonValue,
        searchText: buildResearchSearchText(data),
        sourceRefs: { ...existingRefs, evidenceUrls: urls } as Prisma.InputJsonValue,
      },
    });
  }
  const remainingMissing = rows.filter((row) => !rowHasEmail(row.data) || !rowHasPhone(row.data)).length;
  return [`Checked ${candidates.length} sites: ${newEmails} new emails, ${newPhones} new phones, ${nothing} nothing found.`, `${remainingMissing} rows still missing contacts.`];
}

export async function runCompanyContextResearchOperation(args: { context: CompanyContextAccess; workspaceId: string; actionId: string }) {
  const { access } = await serverModules();
  const workspace = await workspaceFor(args.context, args.workspaceId);
  const row = await prisma.companyContext.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, companyId: workspace.companyId, kind: "ACTION", ...access.companyContextVisibilityWhere(args.context) }, select: { id: true, payload: true, createdAt: true } });
  const initial = row ? operationFromRow(row) : null;
  if (!initial) throw new (await serverModules()).persistence.SupplyPersistenceError("Research operation not found.", "not_found");
  if (initial.status === "DISMISSED") throw new Error("This research operation was dismissed.");
  if (initial.status === "COMPLETED") return initial;
  const staleRunning = initial.status === "RUNNING" && initial.stale;
  if (initial.status !== "PENDING" && initial.status !== "FAILED" && !staleRunning) throw new Error("This research operation is not ready to run.");
  const running = { ...initial, status: "RUNNING" as const, runningStartedAt: new Date().toISOString(), lastError: null };
  const claimed = await prisma.companyContext.updateMany({
    where: {
      id: initial.id,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: "ACTION",
      processingState: initial.status,
      ...(staleRunning && initial.runningStartedAt ? { payload: { path: ["runningStartedAt"], equals: initial.runningStartedAt } } : {}),
      ...access.companyContextVisibilityWhere(args.context),
    },
    data: { payload: storedOperation(running), processingState: running.status },
  });
  if (claimed.count !== 1) throw new Error("This research operation is already running. Retry shortly.");
  try {
    const result = await executeResearchOperation({ operation: running, context: args.context, workspaceId: args.workspaceId });
    const completed = { ...running, status: "COMPLETED" as const, runningStartedAt: null, result };
    const updated = await prisma.companyContext.updateMany({ where: { id: initial.id, officeId: args.context.officeId, companyId: workspace.companyId, kind: "ACTION", processingState: "RUNNING", payload: { path: ["runningStartedAt"], equals: running.runningStartedAt }, ...access.companyContextVisibilityWhere(args.context) }, data: { payload: storedOperation(completed), processingState: completed.status } });
    if (updated.count !== 1) throw new Error("The research operation changed before completion.");
    return completed;
  } catch (error) {
    const failed = { ...running, status: "FAILED" as const, runningStartedAt: null, lastError: error instanceof Error ? error.message.replace(/\u2014/g, "-").slice(0, 500) : "Research operation failed." };
    await prisma.companyContext.updateMany({ where: { id: initial.id, officeId: args.context.officeId, companyId: workspace.companyId, kind: "ACTION", processingState: "RUNNING", payload: { path: ["runningStartedAt"], equals: running.runningStartedAt }, ...access.companyContextVisibilityWhere(args.context) }, data: { payload: storedOperation(failed), processingState: failed.status } });
    return failed;
  }
}

export async function dismissCompanyContextResearchOperation(args: { context: CompanyContextAccess; workspaceId: string; actionId: string }) {
  const { access } = await serverModules();
  const workspace = await workspaceFor(args.context, args.workspaceId);
  const row = await prisma.companyContext.findFirst({ where: { id: args.actionId, officeId: args.context.officeId, companyId: workspace.companyId, kind: "ACTION", ...access.companyContextVisibilityWhere(args.context) }, select: { id: true, payload: true, createdAt: true } });
  const operation = row ? operationFromRow(row) : null;
  if (!operation) throw new (await serverModules()).persistence.SupplyPersistenceError("Research operation not found.", "not_found");
  if (operation.status === "DISMISSED") return operation;
  if (operation.status !== "PENDING" && operation.status !== "FAILED" && !(operation.status === "RUNNING" && operation.stale)) throw new Error("Only pending, failed, or timed-out research operations can be dismissed.");
  const dismissed = { ...operation, status: "DISMISSED" as const, runningStartedAt: null };
  const updated = await prisma.companyContext.updateMany({ where: { id: operation.id, officeId: args.context.officeId, companyId: workspace.companyId, kind: "ACTION", processingState: operation.status, ...(operation.status === "RUNNING" && operation.runningStartedAt ? { payload: { path: ["runningStartedAt"], equals: operation.runningStartedAt } } : {}), ...access.companyContextVisibilityWhere(args.context) }, data: { payload: storedOperation(dismissed), processingState: dismissed.status } });
  if (updated.count !== 1) throw new Error("This research operation changed before it could be dismissed.");
  return dismissed;
}

export async function researchProjectReport(args: { context: CompanyContextAccess; workspaceId: string; projectId: string; projectName: string; kind: "status" | "audit" }) {
  const workspace = await workspaceFor(args.context, args.workspaceId, "view");
  const current = await projectContext({ ...args, companyId: workspace.companyId });
  if (args.kind === "status") return renderResearchStatus({ projectName: args.projectName, list: current.list, jobs: current.jobs });
  return renderResearchAudit(args.projectName, auditResearchRows(current.rows), selectPurgeRows(current.rows).length);
}
