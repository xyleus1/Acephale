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

const FILE_PREFIX = "company_context_file:";
const MARKDOWN_PREFIX = "company_context_markdown:";
const MESSAGE_PREFIX = "company_context_message:";
const UPLOAD_CHUNK_PREFIX = "company_context_upload_chunk:";
const PROCESSING_META_PATTERN = /^<!-- context-processing\n([\s\S]*?)\n-->\n?/;
const CITATIONS_PATTERN = /\n?<!-- context-citations\n([\s\S]*?)\n-->\s*$/;
const MAX_MESSAGE_CHARS = 12_000;
const MAX_AGENT_DOCUMENT_CHARS = 120_000;
const MAX_AGENT_DOCUMENT_CHARS_PER_FILE = 40_000;
export const CONTEXT_DOCUMENT_CHUNK_BYTES = 3 * 1024 * 1024;
const MAX_UPLOAD_CHUNKS = 4;
const UPLOAD_CHUNK_TTL_MS = 24 * 60 * 60 * 1_000;

export type CompanyContextCitation = {
  id: string;
  label: string;
};

type ProcessingState = "READY" | "UNSUPPORTED" | "FAILED";

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

function fileDocType(contentHash: string, mimeType: string, sizeBytes: number) {
  return `${FILE_PREFIX}${contentHash}:${encodeURIComponent(mimeType)}:${sizeBytes}`;
}

function fileMetadata(docType: string | null) {
  if (!docType?.startsWith(FILE_PREFIX)) return null;
  const [contentHash, encodedMimeType, sizeText] = docType.slice(FILE_PREFIX.length).split(":");
  const sizeBytes = Number(sizeText);
  if (!contentHash || !encodedMimeType || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) return null;
  try {
    return { contentHash, mimeType: decodeURIComponent(encodedMimeType), sizeBytes };
  } catch {
    return null;
  }
}

function markdownDocType(documentId: string, state: ProcessingState) {
  return `${MARKDOWN_PREFIX}${documentId}:${state}`;
}

function markdownMetadata(docType: string | null) {
  if (!docType?.startsWith(MARKDOWN_PREFIX)) return null;
  const remainder = docType.slice(MARKDOWN_PREFIX.length);
  const separator = remainder.lastIndexOf(":");
  if (separator < 1) return null;
  const state = remainder.slice(separator + 1);
  if (!(["READY", "UNSUPPORTED", "FAILED"] as string[]).includes(state)) return null;
  return { documentId: remainder.slice(0, separator), state: state as ProcessingState };
}

function processingMarkdown(args: {
  name: string;
  state: ProcessingState;
  markdown: string | null;
  summary: string | null;
  error: string | null;
}) {
  const metadata = JSON.stringify({ state: args.state, summary: args.summary, error: args.error });
  const title = args.name.replace(/[\r\n#]+/g, " ").trim() || "Document";
  const body = args.markdown || `# ${title}\n\n${args.error || "Text extraction is not available for this file."}`;
  return `<!-- context-processing\n${metadata}\n-->\n${body}`;
}

function parseProcessingMarkdown(url: string, fallbackState: ProcessingState) {
  const decoded = decodeDataUrl(url);
  const raw = decoded?.bytes.toString("utf8") || "";
  const match = PROCESSING_META_PATTERN.exec(raw);
  let state = fallbackState;
  let summary: string | null = null;
  let error: string | null = null;
  if (match) {
    try {
      const metadata = JSON.parse(match[1]) as { state?: unknown; summary?: unknown; error?: unknown };
      if ((["READY", "UNSUPPORTED", "FAILED"] as unknown[]).includes(metadata.state)) state = metadata.state as ProcessingState;
      if (typeof metadata.summary === "string") summary = metadata.summary;
      if (typeof metadata.error === "string") error = metadata.error;
    } catch {}
  }
  return { state, summary, error, markdown: raw.replace(PROCESSING_META_PATTERN, "").trim() };
}

function messageMarkdown(body: string, citations: CompanyContextCitation[]) {
  if (!citations.length) return body;
  return `${body}\n\n<!-- context-citations\n${JSON.stringify(citations)}\n-->`;
}

function parseMessage(row: { id: string; docType: string | null; url: string; createdAt: Date }) {
  const decoded = decodeDataUrl(row.url);
  const raw = decoded?.bytes.toString("utf8") || "";
  const citationMatch = CITATIONS_PATTERN.exec(raw);
  let citations: CompanyContextCitation[] | null = null;
  if (citationMatch) {
    try {
      const parsed = JSON.parse(citationMatch[1]);
      if (Array.isArray(parsed)) {
        citations = parsed.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const item = entry as Record<string, unknown>;
          return typeof item.id === "string" && typeof item.label === "string"
            ? [{ id: item.id, label: item.label }]
            : [];
        }).slice(0, 20);
      }
    } catch {}
  }
  const role = row.docType?.slice(MESSAGE_PREFIX.length) || "OPERATOR";
  return {
    id: row.id,
    role: role === "AGENT" ? "AGENT" : "OPERATOR",
    body: raw.replace(CITATIONS_PATTERN, "").trim(),
    citations,
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

export async function loadCompanyContext(context: SupplyAccessContext, workspaceId: string) {
  const workspace = await contextWorkspace(context, workspaceId, "view");
  const [files, parsedDocuments, messageRows] = await Promise.all([
    prisma.companyDocument.findMany({
      where: { officeId: context.officeId, companyId: workspace.companyId, docType: { startsWith: FILE_PREFIX } },
      select: { id: true, name: true, docType: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 400,
    }),
    prisma.companyDocument.findMany({
      where: { officeId: context.officeId, companyId: workspace.companyId, docType: { startsWith: MARKDOWN_PREFIX } },
      select: { docType: true, url: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 400,
    }),
    prisma.companyDocument.findMany({
      where: { officeId: context.officeId, companyId: workspace.companyId, docType: { startsWith: MESSAGE_PREFIX } },
      select: { id: true, docType: true, url: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 400,
    }),
  ]);

  const parsedByDocument = new Map<string, ReturnType<typeof parseProcessingMarkdown>>();
  for (const parsed of parsedDocuments) {
    const metadata = markdownMetadata(parsed.docType);
    if (!metadata || parsedByDocument.has(metadata.documentId)) continue;
    parsedByDocument.set(metadata.documentId, parseProcessingMarkdown(parsed.url, metadata.state));
  }

  return {
    workspace: { id: workspace.id, name: workspace.name },
    documents: files.flatMap((file) => {
      const metadata = fileMetadata(file.docType);
      if (!metadata) return [];
      const parsed = parsedByDocument.get(file.id);
      return [{
        id: file.id,
        name: file.name,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        contentHash: metadata.contentHash,
        summary: parsed?.summary ?? null,
        processingState: parsed?.state ?? "FAILED",
        processingError: parsed?.error ?? (parsed ? null : "Parsed Markdown is missing."),
        createdAt: file.createdAt,
      }];
    }),
    messages: messageRows.reverse().map(parseMessage),
  };
}

export async function uploadCompanyContextDocument(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  file: File;
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  let metadata: ReturnType<typeof validateContextDocumentUpload>;
  try {
    metadata = validateContextDocumentUpload(args.file);
  } catch (error) {
    throw new SupplyPersistenceError(error instanceof Error ? error.message : "The document is invalid.", "invalid_input");
  }
  const bytes = Buffer.from(await args.file.arrayBuffer());
  const contentHash = contextDocumentHash(bytes);
  const duplicate = await prisma.companyDocument.findFirst({
    where: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      docType: { startsWith: `${FILE_PREFIX}${contentHash}:` },
    },
    select: { id: true },
  });
  if (duplicate) throw new SupplyPersistenceError("This document is already attached to the company.", "conflict");

  const result = await ingestContextDocument(bytes, metadata.mimeType, metadata.name).catch(() => ({
    state: "FAILED" as const,
    markdown: null,
    summary: null,
    error: "Document processing did not finish. The original file remains available.",
    version: 1,
  }));
  const state: ProcessingState = result.state === "READY"
    ? "READY"
    : result.state === "UNSUPPORTED"
      ? "UNSUPPORTED"
      : "FAILED";
  const original = await prisma.$transaction(async (tx) => {
    const lockKey = `${args.context.officeId}:${workspace.companyId}:${contentHash}`;
    await tx.$queryRaw<Array<{ locked: number }>>`
      SELECT 1::integer AS "locked"
      FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;
    const concurrentDuplicate = await tx.companyDocument.findFirst({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        docType: { startsWith: `${FILE_PREFIX}${contentHash}:` },
      },
      select: { id: true },
    });
    if (concurrentDuplicate) {
      throw new SupplyPersistenceError("This document is already attached to the company.", "conflict");
    }
    const file = await tx.companyDocument.create({
      data: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        name: metadata.name,
        url: dataUrl(bytes, metadata.mimeType),
        docType: fileDocType(contentHash, metadata.mimeType, metadata.sizeBytes),
        uploadedByUserId: args.context.userId,
      },
      select: { id: true, name: true, createdAt: true },
    });
    const markdown = processingMarkdown({
      name: metadata.name,
      state,
      markdown: result.markdown,
      summary: result.summary,
      error: result.error,
    });
    await tx.companyDocument.create({
      data: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        name: `${metadata.name}.md`,
        url: dataUrl(Buffer.from(markdown, "utf8"), "text/markdown"),
        docType: markdownDocType(file.id, state),
        uploadedByUserId: args.context.userId,
      },
    });
    return file;
  });

  return {
    ...original,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    contentHash,
    summary: result.summary,
    processingState: state,
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
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const uploadId = typeof args.uploadId === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(args.uploadId)
    ? args.uploadId
    : null;
  const chunkIndex = Number(args.chunkIndex);
  const chunkCount = Number(args.chunkCount);
  const fileSize = Number(args.fileSize);
  const fileName = typeof args.fileName === "string" ? args.fileName.trim().slice(0, 180) : "";
  const fileType = typeof args.fileType === "string" ? args.fileType.trim().slice(0, 120) : "";
  if (
    !uploadId ||
    !fileName ||
    !Number.isSafeInteger(chunkIndex) ||
    !Number.isSafeInteger(chunkCount) ||
    !Number.isSafeInteger(fileSize) ||
    chunkIndex < 0 ||
    chunkCount < 2 ||
    chunkCount > MAX_UPLOAD_CHUNKS ||
    chunkIndex >= chunkCount ||
    fileSize < 1 ||
    fileSize > 10 * 1024 * 1024 ||
    args.chunk.size < 1 ||
    args.chunk.size > CONTEXT_DOCUMENT_CHUNK_BYTES
  ) {
    throw new SupplyPersistenceError("The chunked document upload is invalid.", "invalid_input");
  }

  const prefix = `${UPLOAD_CHUNK_PREFIX}${uploadId}:`;
  const chunkType = `${prefix}${chunkIndex}:${chunkCount}`;
  const bytes = Buffer.from(await args.chunk.arrayBuffer());
  await prisma.$transaction(async (tx) => {
    await tx.companyDocument.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        uploadedByUserId: args.context.userId,
        docType: chunkType,
      },
    });
    await tx.companyDocument.create({
      data: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        name: `${fileName}.part-${chunkIndex + 1}`,
        url: dataUrl(bytes, "application/octet-stream"),
        docType: chunkType,
        uploadedByUserId: args.context.userId,
      },
    });
    await tx.companyDocument.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        uploadedByUserId: args.context.userId,
        docType: { startsWith: UPLOAD_CHUNK_PREFIX },
        createdAt: { lt: new Date(Date.now() - UPLOAD_CHUNK_TTL_MS) },
      },
    });
  });

  const rows = await prisma.companyDocument.findMany({
    where: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      uploadedByUserId: args.context.userId,
      docType: { startsWith: prefix },
    },
    select: { docType: true, url: true },
  });
  const chunks = new Map<number, Buffer>();
  for (const row of rows) {
    const match = new RegExp(`^${UPLOAD_CHUNK_PREFIX}${uploadId}:(\\d+):(\\d+)$`).exec(row.docType ?? "");
    const decoded = decodeDataUrl(row.url);
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
      file: new File([new Uint8Array(assembled)], fileName, { type: fileType }),
    });
    return { complete: true as const, document };
  } finally {
    await prisma.companyDocument.deleteMany({
      where: {
        officeId: args.context.officeId,
        companyId: workspace.companyId,
        uploadedByUserId: args.context.userId,
        docType: { startsWith: prefix },
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
  const document = await prisma.companyDocument.findFirst({
    where: {
      id: args.documentId,
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      docType: { startsWith: FILE_PREFIX },
    },
    select: { name: true, docType: true, url: true },
  });
  const metadata = fileMetadata(document?.docType ?? null);
  if (!document || !metadata) throw new SupplyPersistenceError("Document not found.", "not_found");
  const embedded = decodeDataUrl(document.url);
  if (embedded) return { name: document.name, mimeType: metadata.mimeType, bytes: embedded.bytes };
  const stored = await readStoredDocument(document.url).catch(() => null);
  if (!stored) throw new SupplyPersistenceError("Document file is unavailable.", "not_found");
  return { name: document.name, mimeType: metadata.mimeType || stored.contentType, bytes: stored.bytes };
}

export async function appendCompanyContextMessage(args: {
  context: SupplyAccessContext;
  workspaceId: string;
  role: "OPERATOR" | "AGENT";
  body: unknown;
  citations?: CompanyContextCitation[];
}) {
  const workspace = await contextWorkspace(args.context, args.workspaceId, "edit");
  const body = cleanMarkdown(args.body);
  if (!body) throw new SupplyPersistenceError("Message is required.", "invalid_input");
  const citations = args.citations?.slice(0, 20) ?? [];
  const row = await prisma.companyDocument.create({
    data: {
      officeId: args.context.officeId,
      companyId: workspace.companyId,
      name: args.role === "AGENT" ? "Derya reply.md" : "Operator message.md",
      url: dataUrl(Buffer.from(messageMarkdown(body, citations), "utf8"), "text/markdown"),
      docType: `${MESSAGE_PREFIX}${args.role}`,
      uploadedByUserId: args.context.userId,
    },
    select: { id: true, docType: true, url: true, createdAt: true },
  });
  return parseMessage(row);
}

export async function assembleCompanyContextForAgent(context: SupplyAccessContext, workspaceId: string) {
  const workspace = await contextWorkspace(context, workspaceId, "view");
  const [files, parsedRows, messageRows] = await Promise.all([
    prisma.companyDocument.findMany({
      where: { officeId: context.officeId, companyId: workspace.companyId, docType: { startsWith: FILE_PREFIX } },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    prisma.companyDocument.findMany({
      where: { officeId: context.officeId, companyId: workspace.companyId, docType: { startsWith: MARKDOWN_PREFIX } },
      select: { docType: true, url: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    prisma.companyDocument.findMany({
      where: { officeId: context.officeId, companyId: workspace.companyId, docType: { startsWith: MESSAGE_PREFIX } },
      select: { id: true, docType: true, url: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
  ]);

  const filesById = new Map(files.map((file) => [file.id, file]));
  let remaining = MAX_AGENT_DOCUMENT_CHARS;
  const documents = parsedRows.flatMap((row) => {
    const metadata = markdownMetadata(row.docType);
    const file = metadata ? filesById.get(metadata.documentId) : null;
    if (!metadata || metadata.state !== "READY" || !file || remaining <= 0) return [];
    const parsed = parseProcessingMarkdown(row.url, metadata.state);
    if (!parsed.markdown) return [];
    const markdown = parsed.markdown.slice(0, Math.min(MAX_AGENT_DOCUMENT_CHARS_PER_FILE, remaining));
    remaining -= markdown.length;
    return [{
      citationId: `document:${file.id}`,
      name: file.name,
      summary: parsed.summary,
      markdown,
      processedAt: row.createdAt,
    }];
  });
  const messages = messageRows.reverse().map(parseMessage).map((message) => ({
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
