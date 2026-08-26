import "server-only";

import { isManagedDocumentUrl, mimeFromName, readStoredDocument } from "@/lib/document-storage";
import {
  OUTBOUND_ATTACHMENT_ALLOWED_TYPES,
  OUTBOUND_ATTACHMENT_MAX_BYTES,
  baseContentType,
  sanitizeAttachmentFilename,
  type OutboundEmailAttachment,
} from "@/lib/outbound-email-attachments";
import { prisma } from "@/lib/prisma";

// Supplier-facing attachments are only ever taken from stored company context
// documents, never from an operator supplied path, and every candidate is
// checked for credentials before it can leave the building.

export type RequestDocumentAttachment = OutboundEmailAttachment & {
  documentId: string;
  storedName: string;
};

export type RequestDocumentAttachmentSkip = {
  documentId: string;
  name: string;
  reason: string;
};

export type RequestDocumentAttachmentSelection = {
  attachments: RequestDocumentAttachment[];
  skipped: RequestDocumentAttachmentSkip[];
};

const SENSITIVE_NAME_PATTERN = /(^|[^a-z])(\.env|env\.local|credential|credentials|password|passwd|secret|secrets|token|api[-_ ]?key|private[-_ ]?key|id_rsa|mailbox[-_ ]?export)([^a-z]|$)/i;

const SENSITIVE_CONTENT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: "the file contains a private key block" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/, reason: "the file contains an AWS access key id" },
  { pattern: /\bsk-[A-Za-z0-9]{20,}\b/, reason: "the file contains an API key" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, reason: "the file contains a code hosting token" },
  { pattern: /\bapp[-_ ]?password\b/i, reason: "the file references mailbox app passwords" },
  { pattern: /\bsmtp_(host|port|password)\b/i, reason: "the file contains mailbox connection settings" },
  { pattern: /\b(password|passwd|api[-_ ]?key|secret|access[-_ ]token)\b\s*[:=]\s*\S+/i, reason: "the file contains a credential assignment" },
];

const TEXT_LIKE_TYPES = new Set(["text/csv", "text/plain", "text/markdown", "application/json"]);

const CONTENT_SIGNATURES: Array<{ type: string; matches: (bytes: Buffer) => boolean }> = [
  { type: "image/png", matches: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/jpeg", matches: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 },
  { type: "application/pdf", matches: (bytes) => bytes.subarray(0, 5).toString("latin1") === "%PDF-" },
  { type: "application/zip", matches: (bytes) => bytes.subarray(0, 2).toString("latin1") === "PK" },
];

// A binary STL declares its triangle count in the header, and an ASCII STL
// starts with "solid", so a mislabelled file is caught before it is attached.
function looksLikeStl(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("latin1").toLowerCase() === "solid") return true;
  if (bytes.length < 84) return false;
  const triangles = bytes.readUInt32LE(80);
  return bytes.length === 84 + triangles * 50;
}

export function screenAttachmentContent(input: {
  name: string;
  contentType: string;
  bytes: Buffer;
}): { safe: true } | { safe: false; reason: string } {
  if (SENSITIVE_NAME_PATTERN.test(input.name)) {
    return { safe: false, reason: "the file name marks it as credential or secret material" };
  }
  const contentType = baseContentType(input.contentType);
  const text = TEXT_LIKE_TYPES.has(contentType)
    ? input.bytes.toString("utf-8")
    : input.bytes.toString("latin1");
  for (const entry of SENSITIVE_CONTENT_PATTERNS) {
    if (entry.pattern.test(text)) return { safe: false, reason: entry.reason };
  }
  return { safe: true };
}

export function prepareRequestDocumentAttachment(input: {
  documentId: string;
  name: string;
  mimeType: string | null;
  bytes: Buffer;
}): { ok: true; attachment: RequestDocumentAttachment } | { ok: false; reason: string } {
  const storedName = sanitizeAttachmentFilename(input.name);
  const declared = baseContentType(input.mimeType ?? mimeFromName(storedName));
  const fromName = baseContentType(mimeFromName(storedName));
  if (!OUTBOUND_ATTACHMENT_ALLOWED_TYPES.has(declared)) {
    return { ok: false, reason: `${declared} is not an allowed supplier attachment type` };
  }
  if (fromName !== declared) {
    return { ok: false, reason: "the stored content type does not match the file extension" };
  }
  if (!input.bytes.length) return { ok: false, reason: "the stored file is empty" };
  if (input.bytes.length > OUTBOUND_ATTACHMENT_MAX_BYTES) {
    return { ok: false, reason: "the stored file is larger than the attachment limit" };
  }
  const signature = CONTENT_SIGNATURES.find((entry) => entry.type === declared);
  if (signature && !signature.matches(input.bytes)) {
    return { ok: false, reason: "the file content does not match its declared type" };
  }
  if (declared === "model/stl" && !looksLikeStl(input.bytes)) {
    return { ok: false, reason: "the file content does not match its declared type" };
  }
  const screened = screenAttachmentContent({ name: storedName, contentType: declared, bytes: input.bytes });
  if (!screened.safe) return { ok: false, reason: screened.reason };
  return {
    ok: true,
    attachment: {
      documentId: input.documentId,
      storedName,
      filename: storedName,
      contentType: declared,
      bytes: input.bytes,
    },
  };
}

// Older context rows keep small uploads inline as a data URL, newer rows point
// at managed storage. Everything else is refused so no arbitrary path or remote
// URL can be turned into a supplier attachment.
export async function readContextDocumentBytes(storageUrl: string | null) {
  if (!storageUrl) return null;
  if (storageUrl.startsWith("data:")) {
    const comma = storageUrl.indexOf(",");
    if (comma < 0) return null;
    const meta = storageUrl.slice(5, comma);
    if (!meta.endsWith(";base64")) return null;
    return {
      bytes: Buffer.from(storageUrl.slice(comma + 1), "base64"),
      contentType: baseContentType(meta.replace(/;base64$/, "")) || "application/octet-stream",
    };
  }
  if (!isManagedDocumentUrl(storageUrl)) return null;
  return readStoredDocument(storageUrl);
}

export async function loadRequestDocumentAttachments(args: {
  officeId: string;
  companyId: string;
  documentIds: readonly string[];
  read?: typeof readContextDocumentBytes;
}): Promise<RequestDocumentAttachmentSelection> {
  const read = args.read ?? readContextDocumentBytes;
  const rows = await prisma.companyContext.findMany({
    where: {
      id: { in: [...args.documentIds] },
      officeId: args.officeId,
      companyId: args.companyId,
      kind: "DOCUMENT",
    },
    select: { id: true, name: true, mimeType: true, storageUrl: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const attachments: RequestDocumentAttachment[] = [];
  const skipped: RequestDocumentAttachmentSkip[] = [];
  for (const documentId of args.documentIds) {
    const row = byId.get(documentId);
    if (!row) {
      skipped.push({ documentId, name: documentId, reason: "the document is not stored on this request" });
      continue;
    }
    const stored = await read(row.storageUrl);
    if (!stored) {
      skipped.push({ documentId, name: row.name, reason: "the stored file could not be read" });
      continue;
    }
    const prepared = prepareRequestDocumentAttachment({
      documentId,
      name: row.name,
      mimeType: row.mimeType ?? stored.contentType,
      bytes: stored.bytes,
    });
    if (!prepared.ok) {
      skipped.push({ documentId, name: row.name, reason: prepared.reason });
      continue;
    }
    attachments.push(prepared.attachment);
  }
  return { attachments, skipped };
}
