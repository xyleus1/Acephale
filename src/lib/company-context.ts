import "server-only";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { readStoredDocument } from "@/lib/document-storage";
import {
  companyContextActorData,
  companyContextActorWhere,
  companyContextVisibilityWhere,
  isCustomerContextAccess,
  requireCompanyContextWorkspace,
  type CompanyContextAccess,
  type CustomerContextAccess,
} from "@/lib/customer-context-access";
import {
  contextDocumentHash,
  ingestContextDocument,
  validateContextDocumentUpload,
} from "@/lib/supply-os/context-documents";
import { SupplyPersistenceError } from "@/lib/supply-os/persistence";

const MAX_MESSAGE_CHARS = 12_000;
const MAX_AGENT_DOCUMENT_CHARS = 120_000;
const MAX_AGENT_DOCUMENT_CHARS_PER_FILE = 40_000;
const MAX_UPLOAD_CHUNKS = 4;
const UPLOAD_CHUNK_TTL_MS = 24 * 60 * 60 * 1_000;
const UPLOAD_CHUNK_PREFIX = "upload:";
const UPLOAD_REQUEST_KIND = "UPLOAD_REQUEST";
const UPLOAD_RESERVATION_KIND = "UPLOAD_RESERVATION";
const UPLOAD_RESERVATION_TTL_MS = 30 * 60 * 1_000;
export const CUSTOMER_CONTEXT_UPLOADS_PER_DAY = 40;
export const CUSTOMER_CONTEXT_DOCUMENTS_MAX = 50;
export const CUSTOMER_CONTEXT_STORAGE_MAX_BYTES = 50 * 1024 * 1024;
export const CONTEXT_DOCUMENT_CHUNK_BYTES = 3 * 1024 * 1024;

type ProcessingState = "READY" | "UNSUPPORTED" | "FAILED";

export type CompanyContextCitation = {
  id: string;
  label: string;
};

export type CompanyContextQuestion = {
  question: string;
  kind: "yes_no" | "options";
  options: string[];
};

const CHAT_THREAD_KIND = "CHAT_THREAD";
const COMPANY_MEMORY_KIND = "MEMORY_NOTE";
const MAX_COMPANY_MEMORY_NOTES = 80;
const MAX_COMPANY_MEMORY_NOTE_CHARS = 500;
const MAX_CHAT_THREADS = 100;
const MAX_AGENT_THREAD_MESSAGES = 200;
const MAX_QUESTIONS = 6;
const MAX_QUESTION_OPTIONS = 6;

export class CompanyContextLimitError extends Error {
  constructor(
    message: string,
    public readonly code: "message_rate" | "upload_rate" | "document_storage" | "document_count",
  ) {
    super(message);
    this.name = "CompanyContextLimitError";
  }
}

function cleanMarkdown(value: unknown, maxLength = MAX_MESSAGE_CHARS) {
  return typeof value === "string"
    ? value.replace(/\u2014/g, "-").replace(/\0/g, "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength)
    : "";
}

function dataUrl(bytes: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function decodeDataUrl(value: string) {
  const match = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([\s\S]+)$/i.exec(value);
  if (!match) return null;
  try {
    return {
      contentType: match[1].toLowerCase(),
      bytes: Buffer.from(match[2].replace(/\s+/g, ""), "base64"),
    };
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function questionsFromPayload(payload: unknown): CompanyContextQuestion[] | null {
  if (!isObject(payload) || !Array.isArray(payload.questions)) return null;
  const questions = payload.questions.flatMap((entry) => {
    if (!isObject(entry) || typeof entry.question !== "string" || !entry.question.trim()) return [];
    const kind = entry.kind === "yes_no" ? "yes_no" as const : entry.kind === "options" ? "options" as const : null;
    if (!kind) return [];
    const options = Array.isArray(entry.options)
      ? entry.options.filter((option): option is string => typeof option === "string" && Boolean(option.trim())).slice(0, MAX_QUESTION_OPTIONS)
      : [];
    if (kind === "options" && options.length < 2) return [];
    return [{ question: entry.question.trim().slice(0, 500), kind, options }];
  }).slice(0, MAX_QUESTIONS);
  return questions.length ? questions : null;
}

function threadIdFromPayload(payload: unknown) {
  return isObject(payload) && typeof payload.threadId === "string" && payload.threadId ? payload.threadId : null;
}

function citationsFromPayload(payload: unknown) {
  if (!isObject(payload) || !Array.isArray(payload.citations)) return null;
  const citations = payload.citations.flatMap((entry) => {
    if (!isObject(entry)) return [];
    return typeof entry.id === "string" && typeof entry.label === "string"
      ? [{ id: entry.id, label: entry.label }]
      : [];
  }).slice(0, 20);
  return citations.length ? citations : null;
}

function parseMessage(row: {
  id: string;
  markdown: string | null;
  payload: unknown;
  createdAt: Date;
  createdByPortalUserId: string | null;
}) {
  const role = isObject(row.payload) && row.payload.role === "AGENT"
    ? "AGENT"
    : row.createdByPortalUserId
      ? "CUSTOMER"
      : "OPERATOR";
  return {
    id: row.id,
    role,
    body: row.markdown ?? "",
    citations: citationsFromPayload(row.payload),
    questions: questionsFromPayload(row.payload),
    threadId: threadIdFromPayload(row.payload),
    createdAt: row.createdAt,
  };
}

export function normalizeCompanyContextQuestions(value: unknown): CompanyContextQuestion[] {
  return questionsFromPayload({ questions: Array.isArray(value) ? value : [] }) ?? [];
}

export async function saveCompanyContextMemory(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  notes: unknown;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const notes = (Array.isArray(args.notes) ? args.notes : [])
    .map((note) => cleanMarkdown(note, MAX_COMPANY_MEMORY_NOTE_CHARS))
    .filter(Boolean)
    .slice(0, 10);
  if (!notes.length) return { saved: [], skippedExisting: 0, droppedForCapacity: 0 };
  return prisma.$transaction(async (tx) => {
    const existing = await tx.companyContext.findMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: COMPANY_MEMORY_KIND,
      },
      select: { markdown: true },
      take: MAX_COMPANY_MEMORY_NOTES,
    });
    const known = new Set(existing.map((row) => (row.markdown ?? "").trim().toLowerCase()));
    const saved: Array<{ id: string; note: string; createdAt: Date }> = [];
    let skippedExisting = 0;
    let droppedForCapacity = 0;
    let room = MAX_COMPANY_MEMORY_NOTES - existing.length;
    for (const note of notes) {
      const key = note.toLowerCase();
      if (known.has(key)) {
        skippedExisting += 1;
        continue;
      }
      if (room <= 0) {
        droppedForCapacity += 1;
        continue;
      }
      known.add(key);
      room -= 1;
      const row = await tx.companyContext.create({
        data: {
          officeId: args.context.officeId,
          companyId: workspace.companyId,
          kind: COMPANY_MEMORY_KIND,
          name: "Company memory",
          markdown: note,
          processingState: "READY",
          ...companyContextActorData(args.context),
        },
        select: { id: true, markdown: true, createdAt: true },
      });
      saved.push({ id: row.id, note: row.markdown ?? "", createdAt: row.createdAt });
    }
    return { saved, skippedExisting, droppedForCapacity };
  });
}

export async function deleteCompanyContextMemory(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  memoryId: unknown;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  if (typeof args.memoryId !== "string" || !args.memoryId) {
    throw new SupplyPersistenceError("The memory note is invalid.", "invalid_input");
  }
  const removed = await prisma.companyContext.deleteMany({
    where: {
      id: args.memoryId,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: COMPANY_MEMORY_KIND,
      ...companyContextVisibilityWhere(args.context),
    },
  });
  if (!removed.count) throw new SupplyPersistenceError("The memory note was not found.", "not_found");
}

export async function requireCompanyContextThread(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  threadId: unknown;
}) {
  if (args.threadId === null || args.threadId === undefined || args.threadId === "") return null;
  if (typeof args.threadId !== "string") {
    throw new SupplyPersistenceError("The chat thread is invalid.", "invalid_input");
  }
  const workspace = await contextWorkspace(args.context, args.workspaceId, "view");
  const thread = await prisma.companyContext.findFirst({
    where: {
      id: args.threadId,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: CHAT_THREAD_KIND,
      ...companyContextVisibilityWhere(args.context),
    },
    select: { id: true },
  });
  if (!thread) throw new SupplyPersistenceError("The chat thread was not found.", "not_found");
  return thread.id;
}

export async function createCompanyContextChatThread(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  title: unknown;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const title = cleanMarkdown(args.title, 120) || "New chat";
  const existing = await prisma.companyContext.count({
    where: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: CHAT_THREAD_KIND,
    },
  });
  if (existing >= MAX_CHAT_THREADS) {
    throw new CompanyContextLimitError(`Companies can keep up to ${MAX_CHAT_THREADS} chats.`, "document_count");
  }
  const row = await prisma.companyContext.create({
    data: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: CHAT_THREAD_KIND,
      name: title,
      processingState: "READY",
      ...companyContextActorData(args.context),
    },
    select: { id: true, name: true, createdAt: true },
  });
  return { id: row.id, title: row.name, createdAt: row.createdAt };
}

export async function renameDefaultCompanyContextChatThread(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  threadId: string;
  title: unknown;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const title = cleanMarkdown(args.title, 120);
  if (!title) return;
  await prisma.companyContext.updateMany({
    where: {
      id: args.threadId,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: CHAT_THREAD_KIND,
      name: "New chat",
      ...companyContextVisibilityWhere(args.context),
    },
    data: { name: title },
  });
}

async function contextWorkspace(context: CompanyContextAccess, workspaceId: string, mode: "view" | "edit") {
  const workspace = await requireCompanyContextWorkspace(context, workspaceId, mode);
  if (!workspace.companyId) {
    throw new SupplyPersistenceError("Context requires a company-linked workspace.", "invalid_input");
  }
  return { ...workspace, companyId: workspace.companyId };
}

async function itemScope(officeId: string, companyId: string, value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new SupplyPersistenceError("The context item is invalid.", "invalid_input");
  }
  const item = await prisma.item.findFirst({
    where: { id: value, officeId, companyId },
    select: { id: true, name: true },
  });
  if (!item) throw new SupplyPersistenceError("The context item was not found for this company.", "not_found");
  return item;
}

function customerUploadQuotaLockKey(officeId: string, companyId: string) {
  return `customer-context-upload:${officeId}:${companyId}`;
}

export async function reserveCustomerContextUploadRequest(args: {
  context: CustomerContextAccess;
  workspaceId: string;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const lockKey = customerUploadQuotaLockKey(args.context.officeId, workspace.companyId);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
    await tx.companyContext.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: UPLOAD_REQUEST_KIND,
        createdAt: { lt: cutoff },
      },
    });
    const recentRequests = await tx.companyContext.count({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: UPLOAD_REQUEST_KIND,
        createdAt: { gte: cutoff },
      },
    });
    if (recentRequests >= CUSTOMER_CONTEXT_UPLOADS_PER_DAY) {
      throw new CompanyContextLimitError("Too many document uploads. Try again tomorrow.", "upload_rate");
    }
    await tx.companyContext.create({
      data: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: UPLOAD_REQUEST_KIND,
        name: "Document upload request",
        processingState: "READY",
        ...companyContextActorData(args.context),
      },
    });
  });
}

async function reserveCustomerContextDocumentStorage(args: {
  context: CustomerContextAccess;
  companyId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
}) {
  const quotaLockKey = customerUploadQuotaLockKey(args.context.officeId, args.companyId);
  const contentLockKey = `${args.context.officeId}:${args.companyId}:${args.contentHash}`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${quotaLockKey}, 0))
    `;
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${contentLockKey}, 0))
    `;
    await tx.companyContext.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: args.companyId,
        kind: UPLOAD_RESERVATION_KIND,
        createdAt: { lt: new Date(Date.now() - UPLOAD_RESERVATION_TTL_MS) },
      },
    });
    const duplicate = await tx.companyContext.findFirst({
      where: {
        officeId: args.context.officeId,
        companyId: args.companyId,
        contentHash: args.contentHash,
      },
      select: { id: true },
    });
    if (duplicate) throw new SupplyPersistenceError("This document is already attached to the company.", "conflict");
    const [storage, documentCount] = await Promise.all([
      tx.companyContext.aggregate({
        where: {
          officeId: args.context.officeId,
          companyId: args.companyId,
          kind: { in: ["DOCUMENT", "UPLOAD_CHUNK", UPLOAD_RESERVATION_KIND] },
        },
        _sum: { sizeBytes: true },
      }),
      tx.companyContext.count({
        where: {
          officeId: args.context.officeId,
          companyId: args.companyId,
          kind: { in: ["DOCUMENT", UPLOAD_RESERVATION_KIND] },
        },
      }),
    ]);
    if (documentCount >= CUSTOMER_CONTEXT_DOCUMENTS_MAX) {
      throw new CompanyContextLimitError(
        `Companies can store up to ${CUSTOMER_CONTEXT_DOCUMENTS_MAX} context documents.`,
        "document_count",
      );
    }
    if ((storage._sum.sizeBytes ?? 0) + args.sizeBytes > CUSTOMER_CONTEXT_STORAGE_MAX_BYTES) {
      throw new CompanyContextLimitError("Company context storage is limited to 50 MB.", "document_storage");
    }
    return tx.companyContext.create({
      data: {
        officeId: args.context.officeId,
        companyId: args.companyId,
        kind: UPLOAD_RESERVATION_KIND,
        name: args.name,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        contentHash: args.contentHash,
        processingState: "PENDING",
        payload: { quotaReservation: true },
        ...companyContextActorData(args.context),
      },
      select: { id: true },
    });
  });
}

function companyContextThreadWhere(threadFilter: string | null | undefined): Prisma.CompanyContextWhereInput {
  if (threadFilter === undefined) return {};
  return threadFilter === null
    ? { payload: { path: ["threadId"], equals: Prisma.AnyNull } }
    : { payload: { path: ["threadId"], equals: threadFilter } };
}

export async function loadCompanyContext(
  context: CompanyContextAccess,
  workspaceId: string,
  options?: { threadId?: string | null },
) {
  const workspace = await contextWorkspace(context, workspaceId, "view");
  const rowSelect = {
    id: true,
    itemId: true,
    kind: true,
    name: true,
    description: true,
    mimeType: true,
    sizeBytes: true,
    contentHash: true,
    markdown: true,
    processingState: true,
    processingError: true,
    payload: true,
    createdByPortalUserId: true,
    createdAt: true,
    item: { select: { name: true } },
  } as const;
  const rowWhere = (kind: string) => ({
    officeId: context.officeId,
    companyId: workspace.companyId,
    kind,
    ...companyContextVisibilityWhere(context),
  });
  const [threadRows, memoryRows, documentRows, messageRows] = await Promise.all([
    prisma.companyContext.findMany({
      where: rowWhere(CHAT_THREAD_KIND),
      select: rowSelect,
      orderBy: { createdAt: "asc" },
      take: MAX_CHAT_THREADS,
    }),
    prisma.companyContext.findMany({
      where: rowWhere(COMPANY_MEMORY_KIND),
      select: rowSelect,
      orderBy: { createdAt: "asc" },
      take: MAX_COMPANY_MEMORY_NOTES,
    }),
    prisma.companyContext.findMany({
      where: rowWhere("DOCUMENT"),
      select: rowSelect,
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.companyContext.findMany({
      where: { ...rowWhere("MESSAGE"), ...companyContextThreadWhere(options?.threadId) },
      select: rowSelect,
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);

  return {
    workspace: { id: workspace.id, name: workspace.name },
    threads: threadRows.map((row) => ({
      id: row.id,
      title: row.name,
      createdAt: row.createdAt,
    })),
    memory: memoryRows.map((row) => ({
      id: row.id,
      note: row.markdown ?? "",
      createdAt: row.createdAt,
    })),
    documents: documentRows.map((row) => ({
      id: row.id,
      itemId: row.itemId,
      itemName: row.item?.name ?? null,
      name: row.name,
      mimeType: row.mimeType ?? "application/octet-stream",
      sizeBytes: row.sizeBytes ?? 0,
      contentHash: row.contentHash ?? "",
      summary: row.description,
      processingState: (row.processingState ?? "FAILED") as ProcessingState,
      processingError: row.processingError,
      createdAt: row.createdAt,
    })),
    messages: messageRows.reverse().map(parseMessage),
  };
}

export async function loadCompanyContextActivity(
  context: CompanyContextAccess,
  workspaceId: string,
) {
  const workspace = await contextWorkspace(context, workspaceId, "view");
  const messageWhere = {
    officeId: context.officeId,
    companyId: workspace.companyId,
    kind: "MESSAGE" as const,
    ...companyContextVisibilityWhere(context),
  };
  const agentRow = await prisma.companyContext.findFirst({
    where: { ...messageWhere, payload: { path: ["role"], equals: "AGENT" } },
    select: { id: true, payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (!agentRow) return { lastAgentMessageAt: null, openQuestions: 0 };
  // One row per chat thread, so an unanswered question stays counted however
  // much newer traffic other threads carry. The empty key is the legacy
  // conversation that predates thread ids.
  const latestPerThread = await prisma.$queryRaw<{ payload: unknown }[]>(Prisma.sql`
    SELECT DISTINCT ON (COALESCE(payload->>'threadId', ''))
      payload
    FROM "CompanyContext"
    WHERE "officeId" = ${context.officeId}
      AND "companyId" = ${workspace.companyId}
      AND "kind" = 'MESSAGE'
      ${isCustomerContextAccess(context) ? Prisma.sql`AND "customerVisible" = true` : Prisma.empty}
    ORDER BY COALESCE(payload->>'threadId', ''), "createdAt" DESC, "id" DESC
  `);
  let openQuestions = 0;
  for (const row of latestPerThread) {
    if (!isObject(row.payload) || row.payload.role !== "AGENT") continue;
    openQuestions += questionsFromPayload(row.payload)?.length ?? 0;
  }
  return { lastAgentMessageAt: agentRow.createdAt, openQuestions };
}

export async function uploadCompanyContextDocument(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  file: File;
  itemId?: unknown;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const item = await itemScope(
    args.context.officeId,
    workspace.companyId,
    isCustomerContextAccess(args.context) ? null : args.itemId,
  );
  let metadata: ReturnType<typeof validateContextDocumentUpload>;
  try {
    metadata = validateContextDocumentUpload(args.file);
  } catch (error) {
    throw new SupplyPersistenceError(error instanceof Error ? error.message : "The document is invalid.", "invalid_input");
  }
  const bytes = Buffer.from(await args.file.arrayBuffer());
  const contentHash = contextDocumentHash(bytes);
  const reservation = isCustomerContextAccess(args.context)
    ? await reserveCustomerContextDocumentStorage({
        context: args.context,
        companyId: workspace.companyId,
        name: metadata.name,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        contentHash,
      })
    : null;
  const result = await ingestContextDocument(bytes, metadata.mimeType, metadata.name).catch(() => ({
    state: "FAILED" as const,
    markdown: null,
    summary: null,
    error: "Document processing did not finish. The original file remains available.",
    version: 1,
  }));
  const processingState: ProcessingState = result.state === "READY"
    ? "READY"
    : result.state === "UNSUPPORTED"
      ? "UNSUPPORTED"
      : "FAILED";

  let document;
  try {
    document = await prisma.$transaction(async (tx) => {
      const lockKey = `${args.context.officeId}:${workspace.companyId}:${contentHash}`;
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::integer AS "locked"
        FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `;
      const duplicate = await tx.companyContext.findFirst({
        where: {
          officeId: args.context.officeId,
          companyId: workspace.companyId,
          contentHash,
          ...(reservation ? { id: { not: reservation.id } } : {}),
        },
        select: { id: true },
      });
      if (duplicate) throw new SupplyPersistenceError("This document is already attached to the company.", "conflict");
      const placeholder = await tx.companyContext.findFirst({
        where: {
          officeId: args.context.officeId,
          companyId: workspace.companyId,
          kind: "DOCUMENT",
          contentHash: null,
          storageUrl: { startsWith: "metadata-only://" },
          payload: { path: ["importSource", "contentHash"], equals: contentHash },
          ...companyContextVisibilityWhere(args.context),
        },
        select: { id: true, itemId: true },
      });
      const data = {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        itemId: item?.id ?? placeholder?.itemId ?? null,
        kind: "DOCUMENT",
        name: metadata.name,
        description: result.summary,
        storageUrl: dataUrl(bytes, metadata.mimeType),
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        contentHash,
        markdown: result.markdown,
        processingState,
        processingError: result.error,
        payload: { extractionVersion: result.version },
        ...companyContextActorData(args.context),
      };
      if (reservation) {
        if (placeholder) await tx.companyContext.delete({ where: { id: placeholder.id } });
        return tx.companyContext.update({
          where: { id: reservation.id },
          data,
          select: { id: true, itemId: true, name: true, createdAt: true, item: { select: { name: true } } },
        });
      }
      return placeholder
        ? tx.companyContext.update({
          where: { id: placeholder.id },
          data,
          select: { id: true, itemId: true, name: true, createdAt: true, item: { select: { name: true } } },
        })
        : tx.companyContext.create({
          data,
          select: { id: true, itemId: true, name: true, createdAt: true, item: { select: { name: true } } },
        });
    });
  } catch (error) {
    if (reservation) {
      await prisma.companyContext.deleteMany({
        where: { id: reservation.id, kind: UPLOAD_RESERVATION_KIND },
      }).catch(() => undefined);
    }
    throw error;
  }

  const { item: linkedItem, ...safeDocument } = document;

  return {
    ...safeDocument,
    itemName: linkedItem?.name ?? null,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    contentHash,
    summary: result.summary,
    processingState,
    processingError: result.error,
  };
}

export async function uploadCompanyContextDocumentChunk(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  uploadId: unknown;
  chunkIndex: unknown;
  chunkCount: unknown;
  fileName: unknown;
  fileType: unknown;
  fileSize: unknown;
  chunk: File;
  itemId?: unknown;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const item = await itemScope(
    args.context.officeId,
    workspace.companyId,
    isCustomerContextAccess(args.context) ? null : args.itemId,
  );
  const uploadId = typeof args.uploadId === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(args.uploadId)
    ? args.uploadId
    : null;
  const chunkIndex = Number(args.chunkIndex);
  const chunkCount = Number(args.chunkCount);
  const fileSize = Number(args.fileSize);
  const fileName = typeof args.fileName === "string" ? args.fileName.trim().slice(0, 180) : "";
  const fileType = typeof args.fileType === "string" ? args.fileType.trim().slice(0, 120) : "";
  if (
    !uploadId || !fileName || !Number.isSafeInteger(chunkIndex) || !Number.isSafeInteger(chunkCount)
    || !Number.isSafeInteger(fileSize) || chunkIndex < 0 || chunkCount < 2
    || chunkCount > MAX_UPLOAD_CHUNKS || chunkIndex >= chunkCount || fileSize < 1
    || fileSize > 10 * 1024 * 1024 || args.chunk.size < 1
    || args.chunk.size > CONTEXT_DOCUMENT_CHUNK_BYTES
  ) {
    throw new SupplyPersistenceError("The chunked document upload is invalid.", "invalid_input");
  }

  const prefix = `${UPLOAD_CHUNK_PREFIX}${uploadId}:`;
  const chunkKey = `${prefix}${chunkIndex}:${chunkCount}`;
  const bytes = Buffer.from(await args.chunk.arrayBuffer());
  await prisma.$transaction(async (tx) => {
    if (isCustomerContextAccess(args.context)) {
      const lockKey = customerUploadQuotaLockKey(args.context.officeId, workspace.companyId);
      await tx.$queryRaw<Array<{ locked: number }>>`
        SELECT 1::integer AS "locked"
        FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `;
    }
    await tx.companyContext.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        ...companyContextActorWhere(args.context),
        kind: "UPLOAD_CHUNK",
        createdAt: { lt: new Date(Date.now() - UPLOAD_CHUNK_TTL_MS) },
      },
    });
    await tx.companyContext.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        ...companyContextActorWhere(args.context),
        kind: "UPLOAD_CHUNK",
        contentHash: chunkKey,
      },
    });
    if (isCustomerContextAccess(args.context)) {
      const storage = await tx.companyContext.aggregate({
        where: {
          officeId: args.context.officeId,
          companyId: workspace.companyId,
          kind: { in: ["DOCUMENT", "UPLOAD_CHUNK", UPLOAD_RESERVATION_KIND] },
        },
        _sum: { sizeBytes: true },
      });
      if ((storage._sum.sizeBytes ?? 0) + bytes.length > CUSTOMER_CONTEXT_STORAGE_MAX_BYTES) {
        throw new CompanyContextLimitError("Company context storage is limited to 50 MB.", "document_storage");
      }
    }
    await tx.companyContext.create({
      data: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        itemId: item?.id ?? null,
        kind: "UPLOAD_CHUNK",
        name: `${fileName}.part-${chunkIndex + 1}`,
        storageUrl: dataUrl(bytes, "application/octet-stream"),
        mimeType: "application/octet-stream",
        sizeBytes: bytes.length,
        contentHash: chunkKey,
        processingState: "PENDING",
        ...companyContextActorData(args.context),
      },
    });
  });

  const rows = await prisma.companyContext.findMany({
    where: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      ...companyContextActorWhere(args.context),
      kind: "UPLOAD_CHUNK",
      contentHash: { startsWith: prefix },
    },
    select: { contentHash: true, storageUrl: true },
  });
  const chunks = new Map<number, Buffer>();
  for (const row of rows) {
    const match = new RegExp(`^${UPLOAD_CHUNK_PREFIX}${uploadId}:(\\d+):(\\d+)$`).exec(row.contentHash ?? "");
    const decoded = row.storageUrl ? decodeDataUrl(row.storageUrl) : null;
    if (!match || Number(match[2]) !== chunkCount || !decoded) continue;
    chunks.set(Number(match[1]), decoded.bytes);
  }
  if (chunks.size !== chunkCount) return { complete: false as const };

  const ordered = Array.from({ length: chunkCount }, (_, index) => chunks.get(index));
  if (ordered.some((chunk) => !chunk)) {
    throw new SupplyPersistenceError("The chunked document upload is incomplete.", "invalid_input");
  }
  const assembled = Buffer.concat(ordered as Buffer[]);
  try {
    if (assembled.length !== fileSize) {
      throw new SupplyPersistenceError("The uploaded document size changed during transfer.", "invalid_input");
    }
    await prisma.companyContext.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        ...companyContextActorWhere(args.context),
        kind: "UPLOAD_CHUNK",
        contentHash: { startsWith: prefix },
      },
    });
    const document = await uploadCompanyContextDocument({
      context: args.context,
      workspaceId: args.workspaceId,
      itemId: item?.id,
      file: new File([new Uint8Array(assembled)], fileName, { type: fileType }),
    });
    return { complete: true as const, document };
  } finally {
    await prisma.companyContext.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        ...companyContextActorWhere(args.context),
        kind: "UPLOAD_CHUNK",
        contentHash: { startsWith: prefix },
      },
    }).catch(() => undefined);
  }
}

export async function readCompanyContextDocument(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  documentId: string;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "view");
  const document = await prisma.companyContext.findFirst({
    where: {
      id: args.documentId,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      kind: "DOCUMENT",
      ...companyContextVisibilityWhere(args.context),
    },
    select: { name: true, mimeType: true, storageUrl: true },
  });
  if (!document?.storageUrl) throw new SupplyPersistenceError("Document not found.", "not_found");
  const embedded = decodeDataUrl(document.storageUrl);
  if (embedded) {
    return {
      name: document.name,
      mimeType: document.mimeType ?? embedded.contentType,
      bytes: embedded.bytes,
    };
  }
  const stored = await readStoredDocument(document.storageUrl).catch(() => null);
  if (!stored) throw new SupplyPersistenceError("Document file is unavailable.", "not_found");
  return {
    name: document.name,
    mimeType: document.mimeType ?? stored.contentType,
    bytes: stored.bytes,
  };
}

export async function appendCompanyContextMessage(args: {
  context: CompanyContextAccess;
  workspaceId: string;
  role: "OPERATOR" | "AGENT";
  body: unknown;
  citations?: CompanyContextCitation[];
  itemId?: unknown;
  threadId?: string | null;
  questions?: CompanyContextQuestion[];
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const item = await itemScope(
    args.context.officeId,
    workspace.companyId,
    isCustomerContextAccess(args.context) ? null : args.itemId,
  );
  const body = cleanMarkdown(args.body);
  if (!body) throw new SupplyPersistenceError("Message is required.", "invalid_input");
  const citations = args.citations?.slice(0, 20) ?? [];
  const questions = args.role === "AGENT" ? (args.questions ?? []).slice(0, MAX_QUESTIONS) : [];
  const row = await prisma.companyContext.create({
    data: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      itemId: item?.id ?? null,
      kind: "MESSAGE",
      name: args.role === "AGENT" ? "Derya reply" : "Operator message",
      markdown: body,
      processingState: "READY",
      payload: { role: args.role, citations, threadId: args.threadId ?? null, questions },
      ...companyContextActorData(args.context),
    },
    select: { id: true, markdown: true, payload: true, createdByPortalUserId: true, createdAt: true },
  });
  return parseMessage(row);
}

export async function appendRateLimitedCustomerContextMessage(args: {
  context: CustomerContextAccess;
  workspaceId: string;
  body: unknown;
  maxMessages: number;
  windowMs: number;
  threadId?: string | null;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const body = cleanMarkdown(args.body);
  if (!body) throw new SupplyPersistenceError("Message is required.", "invalid_input");
  const windowStart = new Date(Date.now() - args.windowMs);
  const lockKey = `customer-context-message:${args.context.officeId}:${workspace.companyId}:${args.context.portalUserId}`;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
    const recentMessages = await tx.companyContext.count({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        createdByPortalUserId: args.context.portalUserId,
        customerVisible: true,
        kind: "MESSAGE",
        createdAt: { gte: windowStart },
        payload: { path: ["role"], equals: "OPERATOR" },
      },
    });
    if (recentMessages >= args.maxMessages) {
      throw new CompanyContextLimitError("Too many messages. Try again later.", "message_rate");
    }
    const row = await tx.companyContext.create({
      data: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: "MESSAGE",
        name: "Operator message",
        markdown: body,
        processingState: "READY",
        payload: { role: "OPERATOR", citations: [], threadId: args.threadId ?? null, questions: [] },
        ...companyContextActorData(args.context),
      },
      select: { id: true, markdown: true, payload: true, createdByPortalUserId: true, createdAt: true },
    });
    return parseMessage(row);
  });
}

export async function assembleCompanyContextForAgent(
  context: CompanyContextAccess,
  workspaceId: string,
  options?: { threadId?: string | null },
) {
  const workspace = await contextWorkspace(context, workspaceId, "view");
  const agentSelect = {
    id: true,
    itemId: true,
    kind: true,
    name: true,
    description: true,
    markdown: true,
    processingState: true,
    payload: true,
    createdByPortalUserId: true,
    createdAt: true,
    item: { select: { name: true } },
  } as const;
  const threadFilter = options?.threadId === undefined ? undefined : options.threadId;
  const messageThreadWhere = companyContextThreadWhere(threadFilter);
  const [memoryRows, documentRows, messageRows] = await Promise.all([
    prisma.companyContext.findMany({
      where: {
        officeId: context.officeId,
        companyId: workspace.companyId,
        kind: COMPANY_MEMORY_KIND,
        ...companyContextVisibilityWhere(context),
      },
      select: { id: true, markdown: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: MAX_COMPANY_MEMORY_NOTES,
    }),
    prisma.companyContext.findMany({
      where: {
        officeId: context.officeId,
        companyId: workspace.companyId,
        kind: "DOCUMENT",
        ...companyContextVisibilityWhere(context),
      },
      select: agentSelect,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.companyContext.findMany({
      where: {
        officeId: context.officeId,
        companyId: workspace.companyId,
        kind: "MESSAGE",
        ...companyContextVisibilityWhere(context),
        ...messageThreadWhere,
      },
      select: agentSelect,
      orderBy: { createdAt: "desc" },
      take: MAX_AGENT_THREAD_MESSAGES,
    }),
  ]);

  let remaining = MAX_AGENT_DOCUMENT_CHARS;
  const documents = documentRows.flatMap((row) => {
    if (row.processingState !== "READY" || !row.markdown || remaining <= 0) return [];
    const markdown = row.markdown.slice(0, Math.min(MAX_AGENT_DOCUMENT_CHARS_PER_FILE, remaining));
    remaining -= markdown.length;
    return [{
      citationId: `document:${row.id}`,
      itemId: row.itemId,
      itemName: row.item?.name ?? null,
      name: row.name,
      summary: row.description,
      markdown,
      processedAt: row.createdAt,
    }];
  });
  const messages = messageRows.map(parseMessage)
    .filter((message) => threadFilter === undefined || message.threadId === threadFilter)
    .reverse()
    .map((message) => ({
      citationId: `message:${message.id}`,
      role: message.role,
      body: message.body,
      questionCount: message.questions?.length ?? 0,
      createdAt: message.createdAt,
    }));
  return {
    company: { id: workspace.companyId, name: workspace.name },
    memory: memoryRows.map((row) => ({
      note: row.markdown ?? "",
      savedAt: row.createdAt,
    })),
    documents,
    messages,
  };
}
