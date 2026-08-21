import "server-only";

import { prisma } from "@/lib/prisma";
import { readStoredDocument } from "@/lib/document-storage";
import {
  contextDocumentHash,
  ingestContextDocument,
  validateContextDocumentUpload,
} from "@/lib/supply-os/context-documents";
import {
  requireSupplyWorkspace,
  SupplyPersistenceError,
  type SupplyAccessContext,
} from "@/lib/supply-os/persistence";

const MAX_MESSAGE_CHARS = 12_000;
const MAX_AGENT_DOCUMENT_CHARS = 120_000;
const MAX_AGENT_DOCUMENT_CHARS_PER_FILE = 40_000;
const MAX_UPLOAD_CHUNKS = 4;
const UPLOAD_CHUNK_TTL_MS = 24 * 60 * 60 * 1_000;
const UPLOAD_CHUNK_PREFIX = "upload:";
export const CONTEXT_DOCUMENT_CHUNK_BYTES = 3 * 1024 * 1024;

type ProcessingState = "READY" | "UNSUPPORTED" | "FAILED";

export type CompanyContextCitation = {
  id: string;
  label: string;
};

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

function parseMessage(row: { id: string; markdown: string | null; payload: unknown; createdAt: Date }) {
  const role = isObject(row.payload) && row.payload.role === "AGENT" ? "AGENT" : "OPERATOR";
  return {
    id: row.id,
    role,
    body: row.markdown ?? "",
    citations: citationsFromPayload(row.payload),
    createdAt: row.createdAt,
  };
}

async function contextWorkspace(context: SupplyAccessContext, workspaceId: string, mode: "view" | "edit") {
  const workspace = await requireSupplyWorkspace(context, workspaceId, mode);
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

export async function loadCompanyContext(context: SupplyAccessContext, workspaceId: string) {
  const workspace = await contextWorkspace(context, workspaceId, "view");
  const rows = await prisma.companyContext.findMany({
    where: {
      officeId: context.officeId,
      companyId: workspace.companyId,
      kind: { in: ["DOCUMENT", "MESSAGE"] },
    },
    select: {
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
      createdAt: true,
      item: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 800,
  });

  return {
    workspace: { id: workspace.id, name: workspace.name },
    documents: rows.filter((row) => row.kind === "DOCUMENT").reverse().map((row) => ({
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
    messages: rows.filter((row) => row.kind === "MESSAGE").map(parseMessage),
  };
}

export async function uploadCompanyContextDocument(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  file: File;
  itemId?: unknown;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const item = await itemScope(args.context.officeId, workspace.companyId, args.itemId);
  let metadata: ReturnType<typeof validateContextDocumentUpload>;
  try {
    metadata = validateContextDocumentUpload(args.file);
  } catch (error) {
    throw new SupplyPersistenceError(error instanceof Error ? error.message : "The document is invalid.", "invalid_input");
  }
  const bytes = Buffer.from(await args.file.arrayBuffer());
  const contentHash = contextDocumentHash(bytes);
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

  const document = await prisma.$transaction(async (tx) => {
    const lockKey = `${args.context.officeId}:${workspace.companyId}:${contentHash}`;
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
    const duplicate = await tx.companyContext.findFirst({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        kind: "DOCUMENT",
        contentHash,
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
      createdByUserId: args.context.userId,
    };
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
  context: SupplyAccessContext;
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
  const item = await itemScope(args.context.officeId, workspace.companyId, args.itemId);
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
    await tx.companyContext.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        createdByUserId: args.context.userId,
        kind: "UPLOAD_CHUNK",
        contentHash: chunkKey,
      },
    });
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
        createdByUserId: args.context.userId,
      },
    });
    await tx.companyContext.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        createdByUserId: args.context.userId,
        kind: "UPLOAD_CHUNK",
        createdAt: { lt: new Date(Date.now() - UPLOAD_CHUNK_TTL_MS) },
      },
    });
  });

  const rows = await prisma.companyContext.findMany({
    where: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      createdByUserId: args.context.userId,
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
        createdByUserId: args.context.userId,
        kind: "UPLOAD_CHUNK",
        contentHash: { startsWith: prefix },
      },
    }).catch(() => undefined);
  }
}

export async function readCompanyContextDocument(args: {
  context: SupplyAccessContext;
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
  context: SupplyAccessContext;
  workspaceId: string;
  role: "OPERATOR" | "AGENT";
  body: unknown;
  citations?: CompanyContextCitation[];
  itemId?: unknown;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const item = await itemScope(args.context.officeId, workspace.companyId, args.itemId);
  const body = cleanMarkdown(args.body);
  if (!body) throw new SupplyPersistenceError("Message is required.", "invalid_input");
  const citations = args.citations?.slice(0, 20) ?? [];
  const row = await prisma.companyContext.create({
    data: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      itemId: item?.id ?? null,
      kind: "MESSAGE",
      name: args.role === "AGENT" ? "Derya reply" : "Operator message",
      markdown: body,
      processingState: "READY",
      payload: { role: args.role, citations },
      createdByUserId: args.context.userId,
    },
    select: { id: true, markdown: true, payload: true, createdAt: true },
  });
  return parseMessage(row);
}

export async function assembleCompanyContextForAgent(context: SupplyAccessContext, workspaceId: string) {
  const workspace = await contextWorkspace(context, workspaceId, "view");
  const rows = await prisma.companyContext.findMany({
    where: {
      officeId: context.officeId,
      companyId: workspace.companyId,
      kind: { in: ["DOCUMENT", "MESSAGE"] },
    },
    select: {
      id: true,
      itemId: true,
      kind: true,
      name: true,
      description: true,
      markdown: true,
      processingState: true,
      payload: true,
      createdAt: true,
      item: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 200,
  });

  let remaining = MAX_AGENT_DOCUMENT_CHARS;
  const documents = rows.filter((row) => row.kind === "DOCUMENT").reverse().flatMap((row) => {
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
  const messages = rows.filter((row) => row.kind === "MESSAGE").map(parseMessage).map((message) => ({
    citationId: `message:${message.id}`,
    role: message.role,
    body: message.body,
    createdAt: message.createdAt,
  }));
  return {
    company: { id: workspace.companyId, name: workspace.name },
    documents,
    messages,
  };
}
