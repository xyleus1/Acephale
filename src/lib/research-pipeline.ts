import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { humanReplyMessageFilter, isHumanReplyMessage } from "@/lib/outreach-campaign-copy";
import { isPositiveReply } from "@/lib/supply-os/positive-reply";
import { operationFromRow, rowHasEmail, rowHasPhone, selectPurgeRows } from "@/lib/supply-os/context-research-ops";
import { hasEmailForStage, isUnscreenedVerdict } from "@/lib/research-record-stages";
import type { ResearchRecordData } from "@/lib/research-lists";

export type PipelineStageKey = "found" | "screened" | "target" | "enriched" | "sent" | "replied" | "positive";

export type LeadPipelineReport = {
  generatedAt: string;
  project: { id: string | null; name: string };
  lists: Array<{ id: string; slug: string; name: string; rows: number }>;
  live: {
    activeJobs: number;
    pausedJobs: number;
    finishedJobs: number;
    target: number | null;
    lastBatchAt: string | null;
    rejectedBeforePersist: number;
    pendingOperations: number;
  };
  funnel: {
    found: number;
    unscreened: number;
    target: number;
    notTarget: number;
    withEmail: number;
    deliverable: number;
    withPhone: number;
    sent: number;
    replied: number;
    positive: number;
    bounced: number;
  };
  stages: Array<{ key: PipelineStageKey; label: string; count: number; of: number }>;
  sources: Array<{ label: string; rows: number }>;
  replies: Array<{
    recordId: string;
    company: string;
    receivedAt: string;
    snippet: string;
    positive: boolean;
  }>;
  actions: {
    unscreened: number;
    missingContacts: number;
    purgeable: {
      duplicates: number;
      nonCompanies: number;
      notTarget: number;
      belowFloor: number;
    };
    pausable: number;
    resumable: number;
  };
  operations: Array<{
    id: string;
    status: "PENDING" | "RUNNING" | "FAILED";
    kind: "pause" | "resume" | "purge" | "expand_regions" | "requalify" | "enrich";
    projectName: string;
    regions: string[];
    note: string;
    preview: string[];
    result: string[];
    lastError: string | null;
    stale: boolean;
    createdAt: string;
  }>;
  sankey: {
    nodes: Array<{ name: string }>;
    links: Array<{ source: number; target: number; value: number }>;
  };
};

export type PipelineRow = {
  id: string;
  data: ResearchRecordData;
};

export type PipelineJob = {
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "DISMISSED";
  exhausted: boolean;
  autoContinue: boolean;
  rowsCreated: number;
  rowTarget: number | null;
  lastBackgroundRunAt: string | null;
  updatedAt: string;
  rejectedBeforePersist: number;
};

export type PipelineReply = {
  recordId: string;
  company: string;
  receivedAt: string;
  bodyText: string;
  positive: boolean;
};

export function pipelineReplyReceivedAt(sentAt: Date | null, createdAt: Date) {
  return (sentAt ?? createdAt).toISOString();
}

export type PipelineActionInput = {
  purgeable: {
    duplicate: number;
    non_company: number;
    not_target: number;
    below_floor: number;
  };
};

type PipelineOperationStatus = "PENDING" | "RUNNING" | "FAILED";

export function selectPipelineOperations<T extends {
  status: PipelineOperationStatus;
  createdAt: Date;
}>(operations: readonly T[]) {
  const statusOrder: Record<PipelineOperationStatus, number> = {
    PENDING: 0,
    RUNNING: 1,
    FAILED: 2,
  };
  const ordered = [...operations].sort((left, right) => (
    statusOrder[left.status] - statusOrder[right.status]
    || right.createdAt.valueOf() - left.createdAt.valueOf()
  ));
  return {
    pendingOperations: operations.filter((operation) => operation.status === "PENDING" || operation.status === "RUNNING").length,
    operations: ordered.slice(0, 5),
  };
}

type PipelineSets = {
  sentIds: ReadonlySet<string>;
  repliedIds: ReadonlySet<string>;
  positiveIds: ReadonlySet<string>;
  bouncedIds: ReadonlySet<string>;
};

const DELIVERABLE_VERDICTS = new Set(["deliverable_likely"]);
const STAGE_LABELS: Record<PipelineStageKey, string> = {
  found: "Found",
  screened: "Screened",
  target: "Target",
  enriched: "Enriched",
  sent: "Sent",
  replied: "Replied",
  positive: "Positive",
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function verdictFor(row: PipelineRow): "target" | "not_target" | "unscreened" {
  const value = row.data.fit_verdict;
  return isUnscreenedVerdict(value) ? "unscreened" : value as "target" | "not_target";
}

function addLink(
  links: Map<string, number>,
  source: string,
  target: string,
  value: number,
) {
  if (value <= 0) return;
  const key = `${source}\u0000${target}`;
  links.set(key, (links.get(key) ?? 0) + value);
}

function buildSankey(rows: readonly PipelineRow[], sets: PipelineSets) {
  const countryCounts = new Map<string, number>();
  for (const row of rows) {
    const country = text(row.data.country) || "Unknown";
    countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
  }
  const topCountries = new Set(
    [...countryCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([country]) => country),
  );
  const sourceFor = (row: PipelineRow) => {
    const country = text(row.data.country) || "Unknown";
    return topCountries.has(country) ? country : "Other";
  };
  const links = new Map<string, number>();
  for (const row of rows) {
    const screening = verdictFor(row);
    const screeningLabel = screening === "target" ? "Screened target" : screening === "not_target" ? "Not a target" : "Unscreened";
    const hasEmail = hasEmailForStage(row.data);
    const sent = sets.sentIds.has(row.id);
    const replied = sets.repliedIds.has(row.id);
    const positive = sets.positiveIds.has(row.id);
    addLink(links, sourceFor(row), screeningLabel, 1);
    addLink(links, screeningLabel, hasEmail ? "Has email" : "No email", 1);
    addLink(links, hasEmail ? "Has email" : "No email", sent ? "Sent" : "Not sent", 1);
    addLink(links, sent ? "Sent" : "Not sent", replied ? "Replied" : "No reply", 1);
    if (replied) addLink(links, "Replied", positive ? "Positive" : "Other reply", 1);
  }
  const orderedNames: string[] = [];
  const ensureNode = (name: string) => {
    if (!orderedNames.includes(name)) orderedNames.push(name);
  };
  for (const [key, value] of links) {
    if (value <= 0) continue;
    const [source, target] = key.split("\u0000");
    ensureNode(source!);
    ensureNode(target!);
  }
  const nodeIndex = new Map(orderedNames.map((name, index) => [name, index]));
  return {
    nodes: orderedNames.map((name) => ({ name })),
    links: [...links.entries()].flatMap(([key, value]) => {
      const [source, target] = key.split("\u0000");
      const sourceIndex = nodeIndex.get(source!);
      const targetIndex = nodeIndex.get(target!);
      return sourceIndex === undefined || targetIndex === undefined || value <= 0
        ? []
        : [{ source: sourceIndex, target: targetIndex, value }];
    }),
  };
}

export function derivePipeline(
  rows: readonly PipelineRow[],
  sentIds: ReadonlySet<string>,
  repliedIds: ReadonlySet<string>,
  positiveIds: ReadonlySet<string>,
  bouncedIds: ReadonlySet<string>,
  jobs: readonly PipelineJob[],
  details: {
    replies?: readonly PipelineReply[];
    actionInput?: PipelineActionInput;
  } = {},
): Pick<LeadPipelineReport, "live" | "funnel" | "stages" | "sources" | "sankey" | "replies" | "actions"> {
  const targetRows = rows.filter((row) => verdictFor(row) === "target");
  const notTargetRows = rows.filter((row) => verdictFor(row) === "not_target");
  const unscreenedRows = rows.filter((row) => verdictFor(row) === "unscreened");
  const withEmail = rows.filter((row) => hasEmailForStage(row.data)).length;
  const deliverable = rows.filter((row) => DELIVERABLE_VERDICTS.has(text(row.data.email_verdict).toLowerCase())).length;
  const withPhone = rows.filter((row) => rowHasPhone(row.data)).length;
  const sent = rows.filter((row) => sentIds.has(row.id)).length;
  const replied = rows.filter((row) => repliedIds.has(row.id)).length;
  const positive = rows.filter((row) => positiveIds.has(row.id)).length;
  const bounced = rows.filter((row) => bouncedIds.has(row.id)).length;
  const funnel = {
    found: rows.length,
    unscreened: unscreenedRows.length,
    target: targetRows.length,
    notTarget: notTargetRows.length,
    withEmail,
    deliverable,
    withPhone,
    sent,
    replied,
    positive,
    bounced,
  };
  const screened = targetRows.length + notTargetRows.length;
  const stages = ([
    ["found", funnel.found, funnel.target || funnel.found],
    ["screened", screened, funnel.found],
    ["target", funnel.target, screened],
    ["enriched", targetRows.filter((row) => hasEmailForStage(row.data)).length, funnel.target],
    ["sent", sent, withEmail],
    ["replied", replied, sent],
    ["positive", positive, replied],
  ] as Array<[PipelineStageKey, number, number]>).map(([key, count, of]) => ({
    key,
    label: STAGE_LABELS[key],
    count,
    of,
  }));
  const sourceCounts = new Map<string, number>();
  for (const row of rows) {
    const label = text(row.data.country) || "Unknown";
    sourceCounts.set(label, (sourceCounts.get(label) ?? 0) + 1);
  }
  const sources = [...sourceCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8);
  const remainingRows = [...sourceCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(8)
    .reduce((total, [, count]) => total + count, 0);
  if (remainingRows) sources.push(["Other", remainingRows]);
  const dates = jobs.filter((job) => job.status !== "DISMISSED").map((job) => job.lastBackgroundRunAt)
    .filter((value): value is string => typeof value === "string" && !Number.isNaN(new Date(value).valueOf()))
    .sort((left, right) => new Date(right).valueOf() - new Date(left).valueOf());
  const progressable = (job: PipelineJob) => (
    !job.exhausted
    && job.rowsCreated < (job.rowTarget ?? Number.POSITIVE_INFINITY)
  );
  const activeJobs = jobs.filter((job) => job.status !== "DISMISSED" && (
    job.status === "PENDING"
    || job.status === "RUNNING"
    || ((job.status === "COMPLETED" || job.status === "FAILED") && job.autoContinue && progressable(job))
  )).length;
  const pausedJobs = jobs.filter((job) => job.status !== "DISMISSED" && (
    (job.status === "COMPLETED" || job.status === "FAILED") && !job.autoContinue && progressable(job)
  )).length;
  const finishedJobs = jobs.filter((job) => job.status !== "DISMISSED" && (job.exhausted || (job.rowTarget !== null && job.rowsCreated >= job.rowTarget))).length;
  const activeStateJobs = jobs.filter((job) => job.status !== "DISMISSED");
  const targets = activeStateJobs.map((job) => job.rowTarget).filter((value): value is number => value !== null && Number.isFinite(value));
  const actionInput = details.actionInput ?? {
    purgeable: { duplicate: 0, non_company: 0, not_target: 0, below_floor: 0 },
  };
  return {
    live: {
      activeJobs,
      pausedJobs,
      finishedJobs,
      target: targets.length ? targets.reduce((total, value) => total + value, 0) : null,
      lastBatchAt: dates[0] ?? null,
      rejectedBeforePersist: activeStateJobs.reduce((total, job) => total + job.rejectedBeforePersist, 0),
      pendingOperations: 0,
    },
    funnel,
    stages,
    sources: sources.map(([label, rows]) => ({ label, rows })),
    sankey: buildSankey(rows, { sentIds, repliedIds, positiveIds, bouncedIds }),
    replies: [...(details.replies ?? [])]
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
      .slice(0, 6)
      .map((reply) => ({
        recordId: reply.recordId,
        company: reply.company,
        receivedAt: reply.receivedAt,
        snippet: reply.bodyText.replace(/\s+/g, " ").trim().slice(0, 140),
        positive: reply.positive,
      })),
    actions: {
      unscreened: unscreenedRows.length,
      missingContacts: rows.filter((row) => Boolean(text(row.data.website)) && (!rowHasEmail(row.data) || !rowHasPhone(row.data))).length,
      purgeable: {
        duplicates: actionInput.purgeable.duplicate,
        nonCompanies: actionInput.purgeable.non_company,
        notTarget: actionInput.purgeable.not_target,
        belowFloor: actionInput.purgeable.below_floor,
      },
      pausable: jobs.filter((job) => (
        job.status !== "DISMISSED"
        && !job.exhausted
        && !(job.status === "COMPLETED" && job.rowsCreated >= (job.rowTarget ?? Number.POSITIVE_INFINITY))
        && job.autoContinue
      )).length,
      resumable: jobs.filter((job) => (
        job.status === "COMPLETED" || job.status === "FAILED"
      )).filter(progressable).filter((job) => !job.autoContinue).length,
    },
  };
}

function decodeJob(payload: Prisma.JsonValue | null, updatedAt: Date): PipelineJob | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  const draft = value.draft && typeof value.draft === "object" && !Array.isArray(value.draft)
    ? value.draft as Record<string, unknown>
    : {};
  const stats = value.stats && typeof value.stats === "object" && !Array.isArray(value.stats)
    ? value.stats as Record<string, unknown>
    : {};
  const qualification = stats.qualification && typeof stats.qualification === "object" && !Array.isArray(stats.qualification)
    ? stats.qualification as Record<string, unknown>
    : {};
  if (value.type !== "PROSPECTING") return null;
  const status = text(value.status);
  if (!["PENDING", "RUNNING", "COMPLETED", "FAILED", "DISMISSED"].includes(status)) return null;
  return {
    status: status as PipelineJob["status"],
    exhausted: value.exhausted === true,
    rowTarget: typeof draft.rowTarget === "number" && Number.isFinite(draft.rowTarget) ? draft.rowTarget : null,
    autoContinue: value.autoContinue === true,
    rowsCreated: typeof stats.rowsCreated === "number" && Number.isFinite(stats.rowsCreated) ? stats.rowsCreated : 0,
    lastBackgroundRunAt: typeof value.lastBackgroundRunAt === "string" ? value.lastBackgroundRunAt : null,
    updatedAt: updatedAt.toISOString(),
    rejectedBeforePersist: Object.values(qualification.rejected ?? {}).reduce(
      (total, current) => total + (typeof current === "number" && Number.isFinite(current) ? current : 0),
      0,
    ),
  };
}

async function loadRows(officeId: string, listIds: readonly string[]) {
  const rows: PipelineRow[] = [];
  let cursor: string | undefined;
  while (true) {
    const page = await prisma.researchRecord.findMany({
      where: { officeId, listId: { in: [...listIds] } },
      select: { id: true, data: true },
      orderBy: [{ id: "asc" }],
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    rows.push(...page.map((row) => ({
      id: row.id,
        data: row.data && typeof row.data === "object" && !Array.isArray(row.data)
        ? row.data as ResearchRecordData
        : {},
    })));
    cursor = page[page.length - 1]?.id;
    if (page.length < 500) break;
  }
  return rows;
}

export async function buildLeadPipelineReport(args: {
  officeId: string;
  companyId: string | null;
  projectId: string | null;
  listSlug?: string | null;
}): Promise<LeadPipelineReport> {
  const project = args.projectId
    ? await prisma.researchProject.findFirst({
        where: {
          id: args.projectId,
          officeId: args.officeId,
          ...(args.companyId ? { OR: [{ companyId: null }, { companyId: args.companyId }] } : {}),
        },
        select: { id: true, name: true },
      })
    : null;
  if (args.projectId && !project) {
    const { SupplyPersistenceError } = await import("@/lib/supply-os/persistence");
    throw new SupplyPersistenceError("Project is not available in this workspace.", "forbidden");
  }
  const lists = await prisma.researchList.findMany({
    where: {
      officeId: args.officeId,
      projectId: args.projectId,
      ...(args.listSlug ? { slug: args.listSlug } : {}),
    },
    select: { id: true, slug: true, name: true, _count: { select: { records: true } } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  const listIds = lists.map((list) => list.id);
  const rows = listIds.length ? await loadRows(args.officeId, listIds) : [];
  const sentRows = listIds.length
    ? await prisma.outreachCampaignSend.findMany({
        where: { officeId: args.officeId, campaign: { listId: { in: listIds } }, status: "SENT", sentAt: { not: null } },
        select: { recordId: true, localThreadId: true },
      })
    : [];
  const sentIds = new Set(sentRows.map((row) => row.recordId));
  const threadIds = [...new Set(sentRows.flatMap((row) => row.localThreadId ? [row.localThreadId] : []))];
  const inbound = threadIds.length
    ? await prisma.emailMessage.findMany({
        where: humanReplyMessageFilter(args.officeId, threadIds),
        select: { threadId: true, bodyText: true, deliveryKind: true, classification: true, sentAt: true, createdAt: true },
      })
    : [];
  const repliedThreadIds = new Set(inbound.filter(isHumanReplyMessage).map((message) => message.threadId));
  const repliedIds = new Set(sentRows.filter((row) => row.localThreadId && repliedThreadIds.has(row.localThreadId)).map((row) => row.recordId));
  const positiveThreadIds = new Set(inbound.filter((message) => isPositiveReply(message.bodyText)).map((message) => message.threadId));
  const positiveIds = new Set(sentRows.filter((row) => row.localThreadId && positiveThreadIds.has(row.localThreadId)).map((row) => row.recordId));
  const bouncedThreadIds = new Set(
    (threadIds.length
      ? await prisma.emailMessage.findMany({
          where: { officeId: args.officeId, threadId: { in: threadIds }, direction: "INBOUND", deliveryKind: "BOUNCE" },
          select: { threadId: true },
        })
      : []).map((message) => message.threadId),
  );
  const bouncedIds = new Set(sentRows.filter((row) => row.localThreadId && bouncedThreadIds.has(row.localThreadId)).map((row) => row.recordId));
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const replies = inbound
    .filter(isHumanReplyMessage)
    .map((message) => {
      const send = sentRows.find((candidate) => candidate.localThreadId === message.threadId);
      const row = send ? rowById.get(send.recordId) : undefined;
      return send && row ? {
        recordId: send.recordId,
        company: text(row.data.company_name) || text(row.data.name) || "Unknown company",
        receivedAt: pipelineReplyReceivedAt(message.sentAt, message.createdAt),
        bodyText: message.bodyText ?? "",
        positive: isPositiveReply(message.bodyText),
      } : null;
    })
    .filter((reply): reply is NonNullable<typeof reply> => Boolean(reply))
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
    .slice(0, 6);
  const actionRows = await prisma.companyContext.findMany({
    where: {
      officeId: args.officeId,
      ...(args.companyId ? { companyId: args.companyId } : {}),
      kind: "ACTION",
      payload: { path: ["type"], equals: "PROSPECTING" },
    },
    select: { payload: true, updatedAt: true },
  });
  const listSlugs = new Set(lists.map((list) => list.slug));
  const jobs = actionRows.flatMap((row) => {
    const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload as Record<string, unknown>
      : {};
    const draft = payload.draft && typeof payload.draft === "object" && !Array.isArray(payload.draft)
      ? payload.draft as Record<string, unknown>
      : {};
    return typeof draft.listSlug === "string" && listSlugs.has(draft.listSlug)
      ? (decodeJob(row.payload, row.updatedAt) ? [decodeJob(row.payload, row.updatedAt)!] : [])
      : [];
  });
  const pendingOperationRows = listIds.length
    ? await prisma.companyContext.findMany({
        where: {
          officeId: args.officeId,
          ...(args.companyId ? { companyId: args.companyId } : {}),
          kind: "ACTION",
          processingState: { in: ["PENDING", "RUNNING", "FAILED"] },
        },
        select: { id: true, payload: true, createdAt: true },
      })
    : [];
  const allOperations = pendingOperationRows.flatMap((row) => {
    const operation = operationFromRow(row);
    return operation && listIds.includes(operation.listId)
      && ["PENDING", "RUNNING", "FAILED"].includes(operation.status)
      ? [{ ...operation, status: operation.status as "PENDING" | "RUNNING" | "FAILED" }]
      : [];
  });
  const operationSummary = selectPipelineOperations(allOperations);
  const purgeable = selectPurgeRows(rows.map((row) => ({
    ...row,
    sourceRefs: null,
    status: "new",
    createdAt: new Date(),
  })));
  const derived = derivePipeline(rows, sentIds, repliedIds, positiveIds, bouncedIds, jobs, {
    replies,
    actionInput: { purgeable: {
      duplicate: purgeable.filter((row) => row.reason === "duplicate").length,
      non_company: purgeable.filter((row) => row.reason === "non_company").length,
      not_target: purgeable.filter((row) => row.reason === "not_target").length,
      below_floor: purgeable.filter((row) => row.reason === "below_floor").length,
    } },
  });
  return {
    generatedAt: new Date().toISOString(),
    project: { id: args.projectId, name: project?.name ?? "Other lists" },
    lists: lists.map((list) => ({ id: list.id, slug: list.slug, name: list.name, rows: list._count.records })),
    ...derived,
    live: { ...derived.live, pendingOperations: operationSummary.pendingOperations },
    operations: operationSummary.operations.map((operation) => ({
      ...operation,
      createdAt: operation.createdAt.toISOString(),
    })),
  };
}
