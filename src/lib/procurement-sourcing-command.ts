import "server-only";

import { enqueueBackgroundJob } from "@/lib/background-jobs";
import {
  BULK_RFQ_MAX_PER_RUN,
  runProcurementBulkRfq,
  type BulkRfqRunResult,
} from "@/lib/procurement-bulk-rfq";
import {
  MAX_DISCOVERY_CALL_MS,
  runProcurementSupplierSourcingWave,
  SOURCING_WAVE_MAX_TARGET,
  SupplierSourcingError,
  type SourcingWaveResult,
} from "@/lib/procurement-supplier-sourcing";
import { listProcurementRequests } from "@/lib/procurement-workflow";
import {
  classifySupplierSourcingCategory,
  type SupplierSourcingCategoryKey,
} from "@/lib/supply-os/supplier-sourcing-category";

// "find 100 more in each category and send" has to mean exactly one thing, so
// the phrase is parsed deterministically into a bounded plan: one supplier wave
// per sourcing category the workspace actually has, then the RFQ campaign for
// the suppliers that wave added, carrying that request's own files. Sending
// stays behind the confirmation the operator command already requires.

export const SOURCING_COMMAND_CONFIRMATION = "SEND SUPPLIER FILES";
export const SOURCING_COMMAND_MAX_PER_CATEGORY = SOURCING_WAVE_MAX_TARGET;
// A hundred crawls plus a hundred sends per category outlive a serverless
// invocation, so a queued wave runs in slices and re-queues its remainder.
export const SOURCING_COMMAND_SLICE = 10;
// A slice has to hand its result back before the invocation is killed, so the
// wave work stops here and the remainder is queued instead. The rest of the
// three hundred second invocation pays for the RFQ sends the slice earned and
// for queueing the remainder, so this stays well under that limit.
export const SOURCING_COMMAND_SLICE_BUDGET_MS = 230_000;
// How many times a slice that lost every discovery provider may be retried
// before the wave gives up, and how long it waits between those attempts.
export const SOURCING_OUTAGE_RETRIES = 3;
export const SOURCING_OUTAGE_RETRY_DELAY_MS = 10 * 60_000;

export type SourcingCommandIntent = {
  perCategory: number;
  send: boolean;
  scope: "each-category";
};

const COMMAND_PATTERN =
  /\bfind\s+(\d{1,3})\s+(?:more\s+)?(?:new\s+)?(?:suppliers?\s+|vendors?\s+|shops?\s+|manufacturers?\s+|companies\s+|producers?\s+)?(?:more\s+)?(?:in|for|per)\s+each\s+categor(?:y|ies)\b/i;
// The object of the send decides this, because "and send me a summary" asks for
// a report and must never be read as authorization to mail suppliers.
const SEND_PATTERN =
  /\b(?:and|then)\s+(?:also\s+)?(?:send|mail|email|reach out to|contact)\s+(?:them|those|the\s+(?:rfqs?|suppliers?|vendors?|emails?|new\s+\w+))\b|\b(?:and|then)\s+(?:also\s+)?(?:send|mail|email|reach out|contact)\s*$/i;

/**
 * Recognize the operator phrase. Anything that does not clearly state a count
 * and the each-category scope returns null, so an ambiguous instruction never
 * turns into supplier mail.
 */
export function parseSourcingCommand(text: unknown): SourcingCommandIntent | null {
  if (typeof text !== "string") return null;
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = COMMAND_PATTERN.exec(normalized);
  if (!match) return null;
  const perCategory = Number(match[1]);
  if (!Number.isFinite(perCategory) || perCategory < 1) return null;
  return {
    perCategory: Math.min(SOURCING_COMMAND_MAX_PER_CATEGORY, Math.trunc(perCategory)),
    send: SEND_PATTERN.test(normalized),
    scope: "each-category",
  };
}

export type SourcingCommandCategoryOutcome = {
  category: SupplierSourcingCategoryKey | "unsupported";
  orderId: string;
  material: string;
  wave: SourcingWaveResult | null;
  send: BulkRfqRunResult | null;
  error: string | null;
};

export type SourcingCommandResult = {
  perCategory: number;
  send: boolean;
  categories: SourcingCommandCategoryOutcome[];
  added: number;
  sent: number;
};

export type SourcingCommandPlanEntry = {
  orderId: string;
  material: string;
  category: SupplierSourcingCategoryKey;
};

/**
 * One request per category. When a workspace has two requests in the same
 * category the newest is used, because a wave is scoped to a single request and
 * splitting the count between them would contact the same shops twice.
 */
export async function planSourcingCommand(args: {
  customerId: string;
  workspaceId?: string | null;
  list?: typeof listProcurementRequests;
}): Promise<SourcingCommandPlanEntry[]> {
  const requests = await (args.list ?? listProcurementRequests)(args.customerId, 50, undefined, {
    ...(args.workspaceId ? { sourceWorkspaceId: args.workspaceId } : {}),
    activeOnly: true,
  });
  const plan = new Map<SupplierSourcingCategoryKey, SourcingCommandPlanEntry>();
  for (const request of requests) {
    const category = classifySupplierSourcingCategory({
      material: request.material,
      specification: request.specification,
      notes: request.notes,
    });
    if (!category || plan.has(category.key)) continue;
    plan.set(category.key, { orderId: request.id, material: request.material, category: category.key });
  }
  return [...plan.values()];
}

export type QueuedSourcingWave = {
  jobId: string;
  perCategory: number;
  send: boolean;
  plan: SourcingCommandPlanEntry[];
};

/**
 * The chat path recognizes the phrase itself and queues the wave, because a
 * hundred crawls per category outlive any request. The operator who typed the
 * phrase is recorded on the job, which is the authorization for the sends it
 * asks for.
 */
export async function queueSourcingCommandFromChat(args: {
  officeId: string;
  customerId: string;
  workspaceId: string;
  instruction: unknown;
  requestedByUserId: string;
  dependencies?: {
    plan?: typeof planSourcingCommand;
    enqueue?: typeof enqueueBackgroundJob;
  };
}): Promise<QueuedSourcingWave | null> {
  const intent = parseSourcingCommand(args.instruction);
  if (!intent) return null;
  const plan = await (args.dependencies?.plan ?? planSourcingCommand)({
    customerId: args.customerId,
    workspaceId: args.workspaceId,
  });
  if (!plan.length) return null;
  const enqueue = args.dependencies?.enqueue ?? enqueueBackgroundJob;
  const job = await enqueue({
    officeId: args.officeId,
    type: "PROCUREMENT_SOURCING_WAVE",
    payload: {
      customerId: args.customerId,
      workspaceId: args.workspaceId,
      perCategory: intent.perCategory,
      send: intent.send,
      // The operator asking for the send inside their own authenticated chat is
      // the authorization, and the instruction plus their user id are stored on
      // the job as the record of it. The admin API keeps its separate
      // confirmation phrase, because a secret is not a person.
      confirmed: intent.send,
      requestedByUserId: args.requestedByUserId,
      instruction: typeof args.instruction === "string" ? args.instruction.slice(0, 500) : "",
    },
    // One wave per workspace at a time, so a repeated phrase does not double
    // the crawl or the outreach.
    dedupeKey: `procurement-sourcing-wave:${args.workspaceId}`,
    maxAttempts: 1,
  });
  return { jobId: job.id, perCategory: intent.perCategory, send: intent.send, plan };
}

export async function runQueuedSourcingWaveJob(args: {
  officeId: string;
  // The running job holds the wave dedupe key, so its own continuation has to
  // be allowed past that key while this job is still RUNNING.
  jobId?: string | null;
  payload: unknown;
  dependencies?: {
    run?: typeof runSourcingCommand;
    enqueue?: typeof enqueueBackgroundJob;
  };
}) {
  const payload = args.payload && typeof args.payload === "object" && !Array.isArray(args.payload)
    ? args.payload as Record<string, unknown>
    : {};
  const customerId = typeof payload.customerId === "string" ? payload.customerId : "";
  if (!customerId) throw new Error("Missing sourcing wave customer.");
  const perCategoryValue = typeof payload.perCategory === "number" ? Math.trunc(payload.perCategory) : 0;
  if (perCategoryValue < 1) throw new Error("Missing sourcing wave target.");
  const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId : null;
  const remaining = Math.min(SOURCING_COMMAND_MAX_PER_CATEGORY, perCategoryValue);
  const slice = Math.min(SOURCING_COMMAND_SLICE, remaining);
  const onlyCategory = payload.category === "pcba" || payload.category === "molded-foam"
    ? payload.category
    : null;
  const result = await (args.dependencies?.run ?? runSourcingCommand)({
    customerId,
    workspaceId,
    onlyCategory,
    budgetMs: SOURCING_COMMAND_SLICE_BUDGET_MS,
    intent: {
      perCategory: slice,
      send: payload.send === true,
      scope: "each-category",
    },
    confirmed: payload.confirmed === true,
  });
  // Only keep going while the last slice still found qualified suppliers or ran
  // out of time before it could, otherwise a category with nothing left to find
  // would re-queue forever.
  const stillFinding = result.categories.some(
    (entry) => (entry.wave?.added ?? 0) > 0 || entry.wave?.timedOut === true,
  );
  // Credit the progress actually made, not the slice size, because a slice that
  // ran out of time added fewer suppliers than it asked for and the rest of the
  // count is still owed. Counting at least one keeps the chain finite.
  const progressed = Math.max(1, ...result.categories.map((entry) => entry.wave?.added ?? 0));
  const left = remaining - Math.min(slice, progressed);
  // A slice where every discovery provider threw made no progress and did not
  // run out of time, so treat it as a transient outage: retry the same count a
  // few times on a delay instead of abandoning the wave, and stop retrying once
  // the attempts are spent so the chain stays finite.
  const outage = !stillFinding
    && result.categories.some((entry) => (entry.wave?.providerFailures?.length ?? 0) > 0)
    && result.categories.every((entry) => (entry.wave?.added ?? 0) === 0);
  const retriesUsed = typeof payload.providerRetries === "number" ? Math.trunc(payload.providerRetries) : 0;
  const retryOutage = outage && retriesUsed < SOURCING_OUTAGE_RETRIES;
  if (left > 0 && (stillFinding || retryOutage)) {
    await (args.dependencies?.enqueue ?? enqueueBackgroundJob)({
      officeId: args.officeId,
      type: "PROCUREMENT_SOURCING_WAVE",
      payload: retryOutage
        ? { ...payload, perCategory: remaining, providerRetries: retriesUsed + 1 }
        : { ...payload, perCategory: left, providerRetries: 0 },
      runAfter: retryOutage ? new Date(Date.now() + SOURCING_OUTAGE_RETRY_DELAY_MS) : undefined,
      dedupeKey: typeof payload.workspaceId === "string"
        ? `procurement-sourcing-wave:${payload.workspaceId}${onlyCategory ? `:${onlyCategory}` : ""}`
        : null,
      ignoreJobId: args.jobId ?? null,
      maxAttempts: 1,
    });
  }
  return result;
}

export async function runSourcingCommand(args: {
  customerId: string;
  workspaceId?: string | null;
  intent: SourcingCommandIntent;
  // Only source this category, so a failed or slow category can be retried on
  // its own instead of re-running the whole plan.
  onlyCategory?: SupplierSourcingCategoryKey | null;
  // Total wall clock the whole run may use, shared across the plan.
  budgetMs?: number | null;
  // Sending supplier mail needs the same explicit confirmation the operator
  // send commands require, whatever asked for the run.
  confirmed: boolean;
  dependencies?: {
    plan?: typeof planSourcingCommand;
    sourcing?: typeof runProcurementSupplierSourcingWave;
    rfq?: typeof runProcurementBulkRfq;
  };
}): Promise<SourcingCommandResult> {
  const fullPlan = await (args.dependencies?.plan ?? planSourcingCommand)({
    customerId: args.customerId,
    workspaceId: args.workspaceId ?? null,
  });
  const plan = args.onlyCategory
    ? fullPlan.filter((entry) => entry.category === args.onlyCategory)
    : fullPlan;
  const sourcing = args.dependencies?.sourcing ?? runProcurementSupplierSourcingWave;
  const rfq = args.dependencies?.rfq ?? runProcurementBulkRfq;
  const result: SourcingCommandResult = {
    perCategory: args.intent.perCategory,
    send: args.intent.send && args.confirmed,
    categories: [],
    added: 0,
    sent: 0,
  };
  const startedAt = Date.now();
  const budget = typeof args.budgetMs === "number" && args.budgetMs > 0 ? args.budgetMs : null;

  let ran = 0;
  for (const entry of plan) {
    // A category needs room for at least one discovery call, so the budget is
    // handed over whole and a later category that no longer fits is left to the
    // continuation slice. Splitting it evenly starved every category below the
    // discovery cap, and the wave added nobody. The first category always runs,
    // so a small budget still does the work it can.
    const categoryDeadline = budget ? startedAt + budget : null;
    if (ran && categoryDeadline && categoryDeadline - Date.now() < MAX_DISCOVERY_CALL_MS) break;
    ran += 1;
    const outcome: SourcingCommandCategoryOutcome = {
      category: entry.category,
      orderId: entry.orderId,
      material: entry.material,
      wave: null,
      send: null,
      error: null,
    };
    try {
      outcome.wave = await sourcing({
        orderId: entry.orderId,
        target: args.intent.perCategory,
        deadlineAt: categoryDeadline,
      });
      result.added += outcome.wave.added;
    } catch (error) {
      outcome.error = error instanceof SupplierSourcingError
        ? error.message
        : "The supplier wave failed for this request.";
      result.categories.push(outcome);
      continue;
    }
    if (result.send && outcome.wave.added > 0) {
      try {
        outcome.send = await rfq({
          orderId: entry.orderId,
          limit: Math.min(BULK_RFQ_MAX_PER_RUN, outcome.wave.added),
          // Contact the suppliers this wave found, not whichever uncontacted
          // rows happen to be oldest on the request.
          vendorIds: outcome.wave.additions.map((addition) => addition.vendorId),
        });
        result.sent += outcome.send.sent;
      } catch {
        outcome.error = "The RFQ campaign failed for this request.";
      }
    }
    result.categories.push(outcome);
  }
  return result;
}
