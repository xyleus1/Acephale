import "server-only";
import crypto from "crypto";
import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";

type StoredDocument = {
  url: string;
};

type ReadDocument = {
  bytes: Buffer;
  contentType: string;
};

type S3Config = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | null;
  endpoint: string | null;
  forcePathStyle: boolean;
};

const LOCAL_SCHEME = "local-upload://job-documents/";
const CONTEXT_LOCAL_SCHEME = "local-upload://context-documents/";
const S3_SCHEME = "s3://";

export function mimeFromName(name: string) {
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".md": "text/markdown",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".zip": "application/zip",
    ".stl": "model/stl",
  };
  return map[ext] ?? "application/octet-stream";
}

export function safeUploadName(name: string) {
  const ext = path.extname(name).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
  const base = path.basename(name, path.extname(name)).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "document";
  return `${base}${ext}`;
}

function storageDriver() {
  return (process.env.DOCUMENT_STORAGE_DRIVER ?? "local").toLowerCase();
}

function localRoot() {
  return path.resolve(process.cwd(), process.env.DOCUMENT_STORAGE_LOCAL_ROOT ?? ".local-uploads/job-documents");
}

function assertLocalAllowed() {
  if (
    process.env.NODE_ENV === "production" &&
    storageDriver() === "local" &&
    process.env.DOCUMENT_STORAGE_ALLOW_LOCAL_IN_PRODUCTION !== "1"
  ) {
    throw new Error(
      "DOCUMENT_STORAGE_DRIVER=local is not allowed in production. Configure DOCUMENT_STORAGE_DRIVER=s3 or set DOCUMENT_STORAGE_ALLOW_LOCAL_IN_PRODUCTION=1 explicitly."
    );
  }
}

function requireS3Config(): S3Config {
  const bucket = process.env.DOCUMENT_STORAGE_S3_BUCKET;
  const region = process.env.DOCUMENT_STORAGE_S3_REGION ?? "us-east-1";
  const accessKeyId = process.env.DOCUMENT_STORAGE_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("S3 document storage is missing bucket or credentials.");
  }
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.DOCUMENT_STORAGE_S3_SESSION_TOKEN ?? null,
    endpoint: process.env.DOCUMENT_STORAGE_S3_ENDPOINT ?? null,
    forcePathStyle: process.env.DOCUMENT_STORAGE_S3_FORCE_PATH_STYLE !== "false",
  };
}

function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function s3Url(config: S3Config, key: string) {
  const encodedKey = encodeKey(key);
  if (config.endpoint) {
    const endpoint = config.endpoint.replace(/\/+$/, "");
    if (config.forcePathStyle) return `${endpoint}/${encodeURIComponent(config.bucket)}/${encodedKey}`;
    const url = new URL(endpoint);
    url.hostname = `${config.bucket}.${url.hostname}`;
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${encodedKey}`;
    return url.toString();
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${encodedKey}`;
}

function hmac(key: Buffer | string, value: string) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function hashHex(value: Buffer | string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function amzDate(now = new Date()) {
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signedS3Headers(args: {
  method: "GET" | "PUT";
  url: string;
  config: S3Config;
  payload: Buffer;
  contentType?: string;
}) {
  const now = new Date();
  const dateTime = amzDate(now);
  const date = dateTime.slice(0, 8);
  const parsed = new URL(args.url);
  const payloadHash = hashHex(args.payload);
  const headers: Record<string, string> = {
    host: parsed.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": dateTime,
  };
  if (args.contentType) headers["content-type"] = args.contentType;
  if (args.config.sessionToken) headers["x-amz-security-token"] = args.config.sessionToken;

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys.map((key) => `${key}:${headers[key].trim()}\n`).join("");
  const canonicalRequest = [
    args.method,
    parsed.pathname,
    parsed.searchParams.toString(),
    canonicalHeaders,
    signedHeaderKeys.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${date}/${args.config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateTime,
    scope,
    hashHex(canonicalRequest),
  ].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${args.config.secretAccessKey}`, date), args.config.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${args.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaderKeys.join(";")}, Signature=${signature}`,
  };
}

function s3Location(url: string) {
  if (!url.startsWith(S3_SCHEME)) return null;
  const rest = url.slice(S3_SCHEME.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) };
}

export async function storeJobDocumentFile(args: {
  officeId: string;
  jobId: string;
  preferredName: string;
  bytes: Buffer;
  contentType?: string | null;
}): Promise<StoredDocument> {
  const storedName = `${crypto.randomUUID()}-${safeUploadName(args.preferredName)}`;
  const key = `${args.officeId}/${args.jobId}/${storedName}`;
  const contentType = args.contentType || mimeFromName(storedName);

  if (storageDriver() === "s3") {
    const config = requireS3Config();
    const objectKey = `job-documents/${key}`;
    const url = s3Url(config, objectKey);
    const res = await fetch(url, {
      method: "PUT",
      headers: signedS3Headers({ method: "PUT", url, config, payload: args.bytes, contentType }),
      body: new Uint8Array(args.bytes),
    });
    if (!res.ok) {
      throw new Error(`S3 document upload failed (${res.status}).`);
    }
    return { url: `${S3_SCHEME}${config.bucket}/${objectKey}` };
  }

  assertLocalAllowed();
  const root = localRoot();
  const absoluteDir = path.resolve(root, args.officeId, args.jobId);
  if (!absoluteDir.startsWith(root + path.sep)) throw new Error("Bad local document path.");
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(absoluteDir, storedName), args.bytes);
  return { url: `${LOCAL_SCHEME}${key}` };
}

export async function storeContextDocumentFile(args: {
  officeId: string;
  workspaceId: string;
  preferredName: string;
  bytes: Buffer;
  contentType?: string | null;
}): Promise<StoredDocument> {
  const storedName = `${crypto.randomUUID()}-${safeUploadName(args.preferredName)}`;
  const key = `${args.officeId}/${args.workspaceId}/${storedName}`;
  const contentType = args.contentType || mimeFromName(storedName);

  if (storageDriver() === "s3") {
    const config = requireS3Config();
    const objectKey = `context-documents/${key}`;
    const url = s3Url(config, objectKey);
    const res = await fetch(url, {
      method: "PUT",
      headers: signedS3Headers({ method: "PUT", url, config, payload: args.bytes, contentType }),
      body: new Uint8Array(args.bytes),
    });
    if (!res.ok) throw new Error(`S3 document upload failed (${res.status}).`);
    return { url: `${S3_SCHEME}${config.bucket}/${objectKey}` };
  }

  assertLocalAllowed();
  const root = localRoot();
  const absoluteDir = path.resolve(root, "context", args.officeId, args.workspaceId);
  if (!absoluteDir.startsWith(root + path.sep)) throw new Error("Bad local document path.");
  await mkdir(absoluteDir, { recursive: true });
  await writeFile(path.join(absoluteDir, storedName), args.bytes);
  return { url: `${CONTEXT_LOCAL_SCHEME}${key}` };
}

export async function readStoredJobDocument(url: string): Promise<ReadDocument | null> {
  if (url.startsWith(LOCAL_SCHEME) || url.startsWith(CONTEXT_LOCAL_SCHEME)) {
    const isContext = url.startsWith(CONTEXT_LOCAL_SCHEME);
    const relative = url.slice(isContext ? CONTEXT_LOCAL_SCHEME.length : LOCAL_SCHEME.length);
    const root = localRoot();
    const absolute = path.resolve(root, isContext ? "context" : "", relative);
    if (!absolute.startsWith(root + path.sep)) return null;
    const bytes = await readFile(absolute);
    return { bytes, contentType: mimeFromName(absolute) };
  }

  const location = s3Location(url);
  if (location) {
    const config = { ...requireS3Config(), bucket: location.bucket };
    const objectUrl = s3Url(config, location.key);
    const res = await fetch(objectUrl, {
      headers: signedS3Headers({ method: "GET", url: objectUrl, config, payload: Buffer.alloc(0) }),
    });
    if (!res.ok) return null;
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? mimeFromName(location.key),
    };
  }

  return null;
}

export function isManagedDocumentUrl(url: string) {
  return url.startsWith(LOCAL_SCHEME) || url.startsWith(CONTEXT_LOCAL_SCHEME) || url.startsWith(S3_SCHEME);
}

export const readStoredDocument = readStoredJobDocument;
