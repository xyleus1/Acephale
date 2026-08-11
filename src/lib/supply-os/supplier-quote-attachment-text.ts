import "server-only";

import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

const MAX_PDF_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ENCODED_ATTACHMENT_CHARS = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4;
const MAX_PROVIDER_RESPONSE_BYTES = MAX_ENCODED_ATTACHMENT_CHARS + 16_384;
const MAX_TOTAL_TEXT_CHARS = 30_000;
const MAX_PDF_PAGES = 25;
const ATTACHMENT_FETCH_TIMEOUT_MS = 10_000;
const PDF_PARSE_TIMEOUT_MS = 10_000;
const PDF_WORKER_MEMORY_MB = 128;

const PDF_PARSE_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: Buffer.from(workerData.bytes) });
  try {
    const info = await parser.getInfo({ parsePageInfo: false });
    const pageLimit = Math.min(info.total, workerData.maxPages);
    let text = "";
    let textTruncated = false;
    let parsedPages = 0;
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await parser.getText({ partial: [pageNumber], pageJoiner: "" });
      parsedPages = pageNumber;
      const remaining = workerData.maxTextChars - text.length;
      if (remaining <= 0) {
        textTruncated = true;
        break;
      }
      if (page.text.length > remaining) {
        text += page.text.slice(0, remaining);
        textTruncated = true;
        break;
      }
      text += page.text;
    }
    parentPort.postMessage({ ok: true, text, pagesTruncated: info.total > parsedPages, textTruncated });
  } finally {
    await parser.destroy();
  }
})().catch(() => parentPort.postMessage({ ok: false }));
`;

export type SupplierQuoteAttachmentMetadata = {
  attachmentId: string | null;
  name: string;
  mimeType: string | null;
  size: number | null;
};

export type SupplierQuoteAttachmentText = {
  sourceId: string;
  name: string;
  text: string;
  contentHash: string;
};

export type SupplierQuoteAttachmentReadResult = {
  sources: SupplierQuoteAttachmentText[];
  warnings: string[];
};

export type SupplierQuoteAttachmentReader = (input: {
  accountId: string;
  gmailMessageId: string;
  attachments: SupplierQuoteAttachmentMetadata[];
}) => Promise<SupplierQuoteAttachmentReadResult>;

export class SupplierQuoteAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierQuoteAttachmentError";
  }
}

class SupplierQuoteAttachmentLimitError extends Error {}

function digest(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function supportedPdf(attachment: SupplierQuoteAttachmentMetadata) {
  return attachment.mimeType?.toLowerCase() === "application/pdf"
    || attachment.name.toLowerCase().endsWith(".pdf");
}

function decodeBase64Url(value: string) {
  if (value.length > MAX_ENCODED_ATTACHMENT_CHARS) throw new SupplierQuoteAttachmentLimitError();
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) {
    throw new SupplierQuoteAttachmentError("Gmail returned invalid attachment encoding. Retry the extraction.");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 ? "=".repeat(4 - normalized.length % 4) : "";
  return Buffer.from(`${normalized}${padding}`, "base64");
}

async function readBoundedProviderPayload(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new SupplierQuoteAttachmentLimitError();
  }
  if (!response.body) throw new SupplierQuoteAttachmentError("Gmail returned an unreadable attachment response. Retry the extraction.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new SupplierQuoteAttachmentLimitError();
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch {
    throw new SupplierQuoteAttachmentError("Gmail returned an unreadable attachment response. Retry the extraction.");
  }
  return payload as { data?: unknown };
}

async function extractPdfText(bytes: Buffer, maxTextChars: number) {
  const transferable = Uint8Array.from(bytes);
  return new Promise<{ text: string; pagesTruncated: boolean; textTruncated: boolean }>((resolve, reject) => {
    const worker = new Worker(PDF_PARSE_WORKER_SOURCE, {
      eval: true,
      workerData: { bytes: transferable, maxPages: MAX_PDF_PAGES, maxTextChars },
      transferList: [transferable.buffer],
      resourceLimits: {
        maxOldGenerationSizeMb: PDF_WORKER_MEMORY_MB,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const timeout = setTimeout(() => finish(() => {
      void worker.terminate();
      reject(new SupplierQuoteAttachmentLimitError());
    }), PDF_PARSE_TIMEOUT_MS);
    worker.once("message", (result: { ok?: unknown; text?: unknown; pagesTruncated?: unknown; textTruncated?: unknown }) => finish(() => {
      void worker.terminate();
      if (result.ok === true && typeof result.text === "string") {
        resolve({ text: result.text, pagesTruncated: result.pagesTruncated === true, textTruncated: result.textTruncated === true });
      } else {
        reject(new Error("PDF parsing failed"));
      }
    }));
    worker.once("error", () => finish(() => reject(new SupplierQuoteAttachmentLimitError())));
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(new SupplierQuoteAttachmentLimitError()));
    });
  });
}

export async function readSupplierQuoteAttachmentsWithAccessToken(
  input: Parameters<SupplierQuoteAttachmentReader>[0],
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<SupplierQuoteAttachmentReadResult> {
  const candidates = input.attachments.filter(supportedPdf).slice(0, MAX_PDF_ATTACHMENTS);
  if (!candidates.length) {
    return {
      sources: [],
      warnings: input.attachments.length
        ? ["No supported PDF quote attachment was available for text extraction."]
        : [],
    };
  }

  const sources: SupplierQuoteAttachmentText[] = [];
  const warnings: string[] = [];
  let remainingTextChars = MAX_TOTAL_TEXT_CHARS;

  for (const [index, attachment] of candidates.entries()) {
    if (!attachment.attachmentId) {
      warnings.push(`${attachment.name} is missing its connected-provider attachment identifier and could not be read.`);
      continue;
    }
    if (attachment.size !== null && attachment.size > MAX_ATTACHMENT_BYTES) {
      warnings.push(`${attachment.name} exceeds the 8 MB extraction limit and was not read.`);
      continue;
    }
    if (remainingTextChars <= 0) {
      warnings.push("Additional quote attachments were not read because the extraction text limit was reached.");
      break;
    }

    const endpoint = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input.gmailMessageId)}/attachments/${encodeURIComponent(attachment.attachmentId)}`;
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new SupplierQuoteAttachmentError(`Gmail did not return ${attachment.name}. Retry the extraction.`);
    }
    if (!response.ok) {
      throw new SupplierQuoteAttachmentError(`Gmail attachment retrieval failed for ${attachment.name} with status ${response.status}. Retry the extraction.`);
    }
    let payload: { data?: unknown };
    try {
      payload = await readBoundedProviderPayload(response);
    } catch (error) {
      if (error instanceof SupplierQuoteAttachmentLimitError) {
        warnings.push(`${attachment.name} exceeds the 8 MB extraction limit and was not read.`);
        continue;
      }
      throw error;
    }
    if (typeof payload.data !== "string" || !payload.data) {
      throw new SupplierQuoteAttachmentError(`Gmail returned an empty attachment payload for ${attachment.name}. Retry the extraction.`);
    }
    let bytes: Buffer;
    try {
      bytes = decodeBase64Url(payload.data);
    } catch (error) {
      if (error instanceof SupplierQuoteAttachmentLimitError) {
        warnings.push(`${attachment.name} exceeds the 8 MB extraction limit and was not read.`);
        continue;
      }
      throw error;
    }
    if (!bytes.length) {
      throw new SupplierQuoteAttachmentError(`Gmail returned an empty attachment for ${attachment.name}. Retry the extraction.`);
    }
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      warnings.push(`${attachment.name} exceeds the 8 MB extraction limit and was not read.`);
      continue;
    }

    let extracted = { text: "", pagesTruncated: false, textTruncated: false };
    try {
      extracted = await extractPdfText(bytes, remainingTextChars);
    } catch (error) {
      if (error instanceof SupplierQuoteAttachmentLimitError) {
        warnings.push(`${attachment.name} exceeded the PDF processing limits and was not read.`);
        continue;
      }
      warnings.push(`${attachment.name} could not be parsed as a text PDF. It may be scanned, encrypted, or malformed.`);
      continue;
    }
    const normalized = extracted.text.replace(/\0/g, "").replace(/\r\n?/g, "\n").trim();
    if (!normalized) {
      warnings.push(`${attachment.name} contains no extractable text. Scanned-image OCR is not supported yet.`);
      continue;
    }
    const text = normalized.slice(0, remainingTextChars);
    remainingTextChars -= text.length;
    sources.push({
      sourceId: `ATTACHMENT_${index + 1}`,
      name: attachment.name,
      text,
      contentHash: digest(text),
    });
    if (extracted.textTruncated || normalized.length > text.length) {
      warnings.push(`${attachment.name} was truncated to the supported extraction text limit.`);
    }
    if (extracted.pagesTruncated) {
      warnings.push(`${attachment.name} was limited to the first ${MAX_PDF_PAGES} pages.`);
    }
  }

  return { sources, warnings: [...new Set(warnings)].slice(0, 8) };
}

export const readConnectedSupplierQuoteAttachments: SupplierQuoteAttachmentReader = async (input) => {
  const needsProviderAccess = input.attachments
    .filter(supportedPdf)
    .slice(0, MAX_PDF_ATTACHMENTS)
    .some((attachment) => attachment.attachmentId && (attachment.size === null || attachment.size <= MAX_ATTACHMENT_BYTES));
  if (!needsProviderAccess) {
    return readSupplierQuoteAttachmentsWithAccessToken(input, "");
  }
  let accessToken: string;
  try {
    const { getValidAccessToken } = await import("@/lib/gmail-oauth");
    accessToken = await getValidAccessToken(input.accountId);
  } catch {
    throw new SupplierQuoteAttachmentError("The connected Gmail account could not authorize attachment access. Reconnect it and retry.");
  }
  return readSupplierQuoteAttachmentsWithAccessToken(input, accessToken);
};
