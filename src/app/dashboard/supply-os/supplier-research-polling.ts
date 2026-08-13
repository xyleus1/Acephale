import type { SavedSourcingResearchRun } from "./supply-os-sourcing-research-types";

export const SUPPLIER_RESEARCH_POLL_DEADLINE_MS = 3 * 60_000;
const ACTIVE_POLL_INTERVAL_MS = 2_500;
const SLOW_POLL_INTERVAL_MS = 5_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type SupplierResearchPollOutcome =
  | { state: "terminal"; run: SavedSourcingResearchRun }
  | { state: "background"; run: SavedSourcingResearchRun };

function abortError() {
  return new DOMException("Supplier research polling stopped.", "AbortError");
}

async function waitForPoll(delayMs: number, signal: AbortSignal) {
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(abortError());
    }, { once: true });
  });
}

function runStatus(run: SavedSourcingResearchRun) {
  return run.status.toUpperCase();
}

export function isTerminalSupplierResearchRun(run: SavedSourcingResearchRun) {
  return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(runStatus(run));
}

export async function pollSupplierResearchRun(args: {
  run: SavedSourcingResearchRun;
  workspaceId?: string | null;
  signal: AbortSignal;
  fetchImpl?: FetchLike;
  deadlineMs?: number;
  onRun?: (run: SavedSourcingResearchRun) => void;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}): Promise<SupplierResearchPollOutcome> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const wait = args.wait ?? waitForPoll;
  const startedAt = Date.now();
  const deadlineMs = args.deadlineMs ?? SUPPLIER_RESEARCH_POLL_DEADLINE_MS;
  let run = args.run;
  if (isTerminalSupplierResearchRun(run)) return { state: "terminal", run };

  while (Date.now() - startedAt < deadlineMs) {
    const elapsed = Date.now() - startedAt;
    await wait(elapsed < 60_000 ? ACTIVE_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS, args.signal);
    const params = new URLSearchParams({ runId: run.id });
    if (args.workspaceId) params.set("workspaceId", args.workspaceId);
    const response = await fetchImpl(`/api/supply-os/supplier-research?${params.toString()}`, {
      cache: "no-store",
      signal: args.signal,
      headers: { accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({})) as { run?: SavedSourcingResearchRun; error?: string };
    if (!response.ok || !payload.run) throw new Error(payload.error ?? "Supplier research status is unavailable.");
    run = payload.run;
    args.onRun?.(run);
    if (isTerminalSupplierResearchRun(run)) return { state: "terminal", run };
  }

  return { state: "background", run };
}
