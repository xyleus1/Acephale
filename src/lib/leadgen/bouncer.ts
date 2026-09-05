// Bouncer (usebouncer.com) real-time mailbox verification. One GET per address,
// bounded by a timeout, with a per-process memo so a batch never pays twice for
// the same mailbox. Failures are thrown and the caller keeps its heuristic
// verdict; a 402 (no credits) flips the exhausted flag so usage reports show
// the free tier ran dry instead of silently degrading to heuristics.

import type { MailboxStatus, MailboxVerdict, MailboxVerifier, MailboxVerifierUsage } from "./verify";

export const BOUNCER_API_URL = "https://api.usebouncer.com/v1.1/email/verify";
const DEFAULT_TIMEOUT_MS = 12_000;
const MEMO_LIMIT = 5_000;
const STATUSES: ReadonlySet<MailboxStatus> = new Set(["deliverable", "risky", "undeliverable", "unknown"]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const BOUNCER_CREDITS_URL = "https://api.usebouncer.com/v1.1/credits";
export type BouncerVerifierOptions = {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  now?: () => Date;
};

export async function fetchBouncerCredits(options: {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<
  { credits: number }
  | { error: "http" | "payload" | "timeout" | "network"; status: number | null }
> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 8_000;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(BOUNCER_CREDITS_URL, {
        method: "GET",
        headers: { "x-api-key": options.apiKey, accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = timedOut || (error instanceof Error && error.name === "AbortError");
      return { error: aborted ? "timeout" : "network", status: null };
    }
    if (!response.ok) return { error: "http", status: response.status };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      const aborted = timedOut || (error instanceof Error && error.name === "AbortError");
      return { error: aborted ? "timeout" : "payload", status: response.status };
    }
    if (
      !payload
      || typeof payload !== "object"
      || Array.isArray(payload)
      || typeof (payload as { credits?: unknown }).credits !== "number"
      || !Number.isFinite((payload as { credits: number }).credits)
    ) {
      return { error: "payload", status: response.status };
    }
    return { credits: (payload as { credits: number }).credits };
  } finally {
    clearTimeout(timer);
  }
}

export class MailboxVerifierError extends Error {
  readonly code: "http" | "payload" | "timeout" | "network" | "exhausted";
  readonly status: number | null;
  constructor(code: MailboxVerifierError["code"], message: string, status: number | null = null) {
    super(message);
    this.name = "MailboxVerifierError";
    this.code = code;
    this.status = status;
  }
}

function yesNo(value: unknown): boolean | null {
  if (value === "yes" || value === true) return true;
  if (value === "no" || value === false) return false;
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parseBouncerResponse(payload: unknown, checkedAt: Date): MailboxVerdict {
  const body = record(payload);
  const status = typeof body.status === "string" && STATUSES.has(body.status as MailboxStatus)
    ? (body.status as MailboxStatus)
    : null;
  if (!status) throw new MailboxVerifierError("payload", "unexpected verification payload");
  const domain = record(body.domain);
  const account = record(body.account);
  const score = typeof body.score === "number" && Number.isFinite(body.score)
    ? Math.max(0, Math.min(100, Math.round(body.score)))
    : null;
  return {
    provider: "bouncer",
    status,
    reason: typeof body.reason === "string" && body.reason ? body.reason : "unknown",
    score,
    acceptAll: yesNo(domain.acceptAll),
    disposable: yesNo(domain.disposable),
    free: yesNo(domain.free),
    role: yesNo(account.role),
    disabled: yesNo(account.disabled),
    fullMailbox: yesNo(account.fullMailbox),
    checkedAt: checkedAt.toISOString(),
  };
}

export function createBouncerVerifier(options: BouncerVerifierOptions): MailboxVerifier {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const memo = new Map<string, Promise<MailboxVerdict>>();
  const usage: MailboxVerifierUsage = { provider: "bouncer", calls: 0, cached: 0, failures: 0, exhausted: false };

  async function request(email: string): Promise<MailboxVerdict> {
    if (usage.exhausted) throw new MailboxVerifierError("exhausted", "no credits left", 402);
    usage.calls += 1;
    const url = `${BOUNCER_API_URL}?email=${encodeURIComponent(email)}&timeout=${Math.max(1, Math.floor(timeoutMs / 1000) - 1)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { "x-api-key": options.apiKey, accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      usage.failures += 1;
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new MailboxVerifierError(aborted ? "timeout" : "network", aborted ? "timed out" : "network error");
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 402) {
      usage.failures += 1;
      usage.exhausted = true;
      throw new MailboxVerifierError("exhausted", "no credits left", 402);
    }
    if (!response.ok) {
      usage.failures += 1;
      throw new MailboxVerifierError("http", `http ${response.status}`, response.status);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      usage.failures += 1;
      throw new MailboxVerifierError("payload", "response was not json");
    }
    try {
      return parseBouncerResponse(payload, now());
    } catch (error) {
      usage.failures += 1;
      throw error;
    }
  }

  return {
    name: "bouncer",
    async verify(email) {
      const key = email.trim().toLowerCase();
      const cached = memo.get(key);
      if (cached) {
        usage.cached += 1;
        return cached;
      }
      const pending = request(key);
      if (memo.size >= MEMO_LIMIT) memo.clear();
      memo.set(key, pending);
      try {
        return await pending;
      } catch (error) {
        memo.delete(key);
        throw error;
      }
    },
    usage: () => ({ ...usage }),
  };
}
