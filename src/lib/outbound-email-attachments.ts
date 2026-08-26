import { randomUUID } from "node:crypto";

// Supplier requests carry technical files, and every send path before this
// module built a text-only MIME body, so attachments were silently dropped.
// Attachment construction, limits, and metadata live here so the Gmail API
// path, the SMTP path, and the stored message ledger agree on one shape.

export type OutboundEmailAttachment = {
  filename: string;
  contentType: string;
  bytes: Buffer;
};

export type OutboundAttachmentMetadata = {
  name: string;
  mimeType: string;
  size: number;
};

export const OUTBOUND_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const OUTBOUND_ATTACHMENT_TOTAL_MAX_BYTES = 20 * 1024 * 1024;
export const OUTBOUND_ATTACHMENT_MAX_COUNT = 10;

// Gmail and most supplier gateways accept these types, and every other type an
// operator could stage would need its own review before it reaches a supplier.
export const OUTBOUND_ATTACHMENT_ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "image/jpeg",
  "image/png",
  "image/webp",
  "model/stl",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

export class OutboundAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundAttachmentError";
  }
}

export function baseContentType(value: string) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

// Header injection and path traversal both arrive through the file name, so it
// is reduced to a flat ASCII name before it reaches a Content-Disposition line.
export function sanitizeAttachmentFilename(value: string) {
  const flattened = value
    .replace(/[\r\n]+/g, " ")
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^[.-]+/, "")
    .slice(0, 120);
  return flattened || "attachment";
}

export function validateOutboundAttachments(
  attachments: readonly OutboundEmailAttachment[],
): OutboundEmailAttachment[] {
  if (attachments.length > OUTBOUND_ATTACHMENT_MAX_COUNT) {
    throw new OutboundAttachmentError(`A message carries at most ${OUTBOUND_ATTACHMENT_MAX_COUNT} attachments.`);
  }
  let total = 0;
  const names = new Set<string>();
  return attachments.map((attachment) => {
    const filename = sanitizeAttachmentFilename(attachment.filename);
    const contentType = baseContentType(attachment.contentType);
    if (!OUTBOUND_ATTACHMENT_ALLOWED_TYPES.has(contentType)) {
      throw new OutboundAttachmentError(`${filename} has an attachment type that is not allowed for supplier mail.`);
    }
    if (!Buffer.isBuffer(attachment.bytes) || attachment.bytes.length < 1) {
      throw new OutboundAttachmentError(`${filename} is empty.`);
    }
    if (attachment.bytes.length > OUTBOUND_ATTACHMENT_MAX_BYTES) {
      throw new OutboundAttachmentError(`${filename} is larger than the ${OUTBOUND_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB attachment limit.`);
    }
    total += attachment.bytes.length;
    if (total > OUTBOUND_ATTACHMENT_TOTAL_MAX_BYTES) {
      throw new OutboundAttachmentError("The attachments exceed the total message size limit.");
    }
    if (names.has(filename.toLowerCase())) {
      throw new OutboundAttachmentError(`${filename} is attached twice.`);
    }
    names.add(filename.toLowerCase());
    return { filename, contentType, bytes: attachment.bytes };
  });
}

export function outboundAttachmentMetadata(
  attachments: readonly OutboundEmailAttachment[],
): OutboundAttachmentMetadata[] {
  return attachments.map((attachment) => ({
    name: sanitizeAttachmentFilename(attachment.filename),
    mimeType: baseContentType(attachment.contentType),
    size: attachment.bytes.length,
  }));
}

export function outboundAttachmentMetadataJson(
  attachments: readonly OutboundEmailAttachment[],
): string | null {
  if (!attachments.length) return null;
  return JSON.stringify(outboundAttachmentMetadata(attachments));
}

function base64Lines(bytes: Buffer) {
  return (bytes.toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

// RFC 2047 keeps non-ASCII names readable, and the sanitizer already removed
// the characters that would break the encoded word.
function encodedFilename(filename: string) {
  return filename.replace(/"/g, "");
}

export function buildMimeMessage(args: {
  headers: readonly string[];
  text: string;
  attachments?: readonly OutboundEmailAttachment[];
}) {
  const attachments = args.attachments?.length ? validateOutboundAttachments(args.attachments) : [];
  const headers = args.headers
    .filter((header) => !/^(mime-version|content-type|content-transfer-encoding):/i.test(header))
    // A folded or injected header line could add its own recipients, so every
    // caller supplied header is flattened to a single line.
    .map((header) => header.replace(/[\r\n]+/g, " ").trim())
    .filter(Boolean);
  if (!attachments.length) {
    return [
      ...headers,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(Buffer.from(args.text, "utf-8")),
      "",
    ].join("\r\n");
  }
  const boundary = `derya-${randomUUID()}`;
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(args.text, "utf-8")),
  ];
  for (const attachment of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${encodedFilename(attachment.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${encodedFilename(attachment.filename)}"`,
      "",
      base64Lines(attachment.bytes),
    );
  }
  parts.push(`--${boundary}--`, "");
  return [
    ...headers,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts,
  ].join("\r\n");
}

export function encodeGmailRawMessage(raw: string) {
  return Buffer.from(raw, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
