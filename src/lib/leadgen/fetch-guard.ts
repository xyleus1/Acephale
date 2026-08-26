// Egress guard for the harvest stage. Candidate URLs come from third-party
// search-result HTML, so before any request leaves the process the target has
// to be a public web origin: no non-http schemes, no credentials, no odd
// ports, and no address that resolves into private or loopback space. Redirects
// are followed manually so every hop is checked, not just the first one.

import { lookup } from "dns/promises";
import { lookup as lookupCallback, type LookupAddress } from "dns";
import http from "http";
import https from "https";
import zlib from "zlib";

export type UrlRejection =
  | "bad_url"
  | "scheme"
  | "credentials"
  | "port"
  | "private_host"
  | "unresolvable"
  | "too_many_redirects";

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: UrlRejection };

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localdomain", ".home.arpa"];

export type HostResolver = (host: string) => Promise<string[]>;

export const defaultResolver: HostResolver = async (host) => {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
};

export function isPrivateAddress(address: string) {
  const value = address.trim().toLowerCase();
  if (!value) return true;
  if (value.includes(":")) {
    if (value === "::" || value === "::1") return true;
    // Unique local (fc00::/7), link local (fe80::/10) and IPv4-mapped space.
    if (/^f[cd][0-9a-f]{2}:/.test(value)) return true;
    if (/^fe[89ab][0-9a-f]:/.test(value)) return true;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function hasBlockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost") return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export async function checkPublicUrl(
  rawUrl: string,
  resolver: HostResolver = defaultResolver,
): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: "scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials" };
  if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: "port" };
  if (hasBlockedHostname(url.hostname)) return { ok: false, reason: "private_host" };

  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(literal) || literal.includes(":")) {
    return isPrivateAddress(literal) ? { ok: false, reason: "private_host" } : { ok: true, url };
  }

  let addresses: string[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    return { ok: false, reason: "unresolvable" };
  }
  if (addresses.length === 0) return { ok: false, reason: "unresolvable" };
  if (addresses.some(isPrivateAddress)) return { ok: false, reason: "private_host" };
  return { ok: true, url };
}

export type GuardedResponse = {
  url: string;
  status: number;
  headers: Record<string, string>;
  location: string | null;
  body: Buffer;
};

export type GuardedRequestOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

// Checking the host and then handing the hostname to a fetch that resolves DNS
// again leaves a rebinding window, so the connect-time lookup is where the
// address check has to happen: the address this returns is the one dialed.
function guardedLookup(
  hostname: string,
  options: unknown,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
) {
  lookupCallback(hostname, { all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    const permitted = addresses.filter((entry) => !isPrivateAddress(entry.address));
    if (permitted.length === 0) {
      const blocked: NodeJS.ErrnoException = new Error(
        `Refusing to connect to ${hostname}: resolves to a non-public address.`,
      );
      blocked.code = "EACCES";
      callback(blocked, "", 0);
      return;
    }
    const wantsAll = typeof options === "object" && options !== null && "all" in options
      ? Boolean((options as { all?: boolean }).all)
      : false;
    if (wantsAll) {
      callback(null, permitted);
      return;
    }
    callback(null, permitted[0].address, permitted[0].family);
  });
}

function decodeBody(buffer: Buffer, encoding: string | undefined) {
  try {
    if (encoding === "gzip") return zlib.gunzipSync(buffer);
    if (encoding === "deflate") return zlib.inflateSync(buffer);
    if (encoding === "br") return zlib.brotliDecompressSync(buffer);
  } catch {
    return buffer;
  }
  return buffer;
}

// Single-hop request. Redirects are returned to the caller so each new target
// goes back through checkPublicUrl instead of being followed blindly.
export function guardedRequest(
  url: URL,
  options: GuardedRequestOptions = {},
): Promise<GuardedResponse> {
  const transport = url.protocol === "https:" ? https : http;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: options.method ?? "GET",
        headers: {
          "accept-encoding": "gzip, deflate, br",
          ...(options.body ? { "content-length": String(Buffer.byteLength(options.body)) } : {}),
          ...options.headers,
        },
        lookup: guardedLookup,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        signal: options.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            reject(new Error("Response exceeded the maximum allowed size."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers[key] = value;
            else if (Array.isArray(value)) headers[key] = value.join(", ");
          }
          resolve({
            url: url.toString(),
            status: response.statusCode ?? 0,
            headers,
            location: typeof response.headers.location === "string" ? response.headers.location : null,
            body: decodeBody(Buffer.concat(chunks), response.headers["content-encoding"]),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Request timed out.")));
    request.on("error", reject);
    request.end(options.body);
  });
}
