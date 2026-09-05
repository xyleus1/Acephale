import "server-only";

import type { Prisma } from "@prisma/client";
import { enqueueBackgroundJob } from "@/lib/background-jobs";
import { registrableDomain } from "@/lib/leadgen/extract";
import { prisma } from "@/lib/prisma";
import {
  BULK_RFQ_MAX_PER_RUN,
  loadBulkRfqOrder,
  runProcurementBulkRfq,
  type BulkRfqRunResult,
} from "@/lib/procurement-bulk-rfq";
import {
  applyCampaignOverrides,
  classifyCampaign,
  readCampaignPlan,
  type CampaignPlan,
} from "@/lib/procurement-campaign-class";
import {
  campaignConvergence,
  type CampaignConvergence,
  type CampaignProgress,
} from "@/lib/procurement-campaign-convergence";
import {
  MAX_DISCOVERY_CALL_MS,
  runProcurementSupplierSourcingWave,
  SOURCING_WAVE_MAX_TARGET,
  failureReason,
  supplierSourcingErrorCode,
  type SourcingWaveResult,
} from "@/lib/procurement-supplier-sourcing";
import {
  listProcurementRequests,
  procurementOfficeIdFromServerMetadata,
  procurementWorkflowDatabase,
} from "@/lib/procurement-workflow";
import type { SupplierSourcingCategoryKey } from "@/lib/supply-os/supplier-sourcing-category";
import {
  isSourcingCategoryKey,
  resolveSupplierSourcingCategory,
} from "@/lib/supply-os/supplier-sourcing-profile";

function readSourcingCategoryKey(value: unknown): SupplierSourcingCategoryKey | null {
  const category = typeof value === "string" ? value.trim() : "";
  return isSourcingCategoryKey(category)
    ? category
    : null;
}

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
  // Whether the failure is worth another slice. A missing request or a category
  // the engine does not support will fail the same way forever.
  errorRetryable: boolean;
  // Why an unexpected failure happened, for the operator reading the command
  // result. Without it a wave that threw looked identical whatever broke.
  errorReason: string | null;
};

export type SourcingCommandResult = {
  perCategory: number;
  send: boolean;
  categories: SourcingCommandCategoryOutcome[];
  added: number;
  sent: number;
  // Categories the budget could not reach, so the continuation slice knows who
  // is still owed a turn.
  skipped: SupplierSourcingCategoryKey[];
};

export type SourcingCommandPlanEntry = {
  orderId: string;
  material: string;
  category: SupplierSourcingCategoryKey;
};

export async function loadCampaignProgress(
  orderId: string,
): Promise<Omit<CampaignProgress, "discoveryExhausted">> {
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<Array<{
    website: string | null;
    contactEmail: string | null;
    email: string | null;
    hasCapabilityEvidence: boolean;
    hasQuote: boolean;
  }>>(`
    SELECT
      order_vendors.website AS "website",
      order_vendors.contact_email AS "contactEmail",
      order_vendors.email AS "email",
      (
        jsonb_typeof(research->'capabilityEvidence') = 'array'
        AND jsonb_array_length(research->'capabilityEvidence') > 0
      ) AS "hasCapabilityEvidence",
      (
        jsonb_typeof(to_jsonb(order_vendors)->'quote') = 'object'
        AND to_jsonb(order_vendors)->'quote' <> '{}'::jsonb
      ) AS "hasQuote"
    FROM order_vendors
    WHERE order_id = $1::uuid
  `, orderId);
  const goodDomains = new Set<string>();
  let quotesRecorded = 0;
  for (const row of rows) {
    if (row.hasCapabilityEvidence) {
      const websiteDomain = row.website ? registrableDomain(row.website) : "";
      const emailDomain = row.contactEmail?.includes("@")
        ? registrableDomain(row.contactEmail.split("@").at(1) ?? "")
        : row.email?.includes("@")
          ? registrableDomain(row.email.split("@").at(1) ?? "")
          : "";
      if (websiteDomain || emailDomain) goodDomains.add(websiteDomain || emailDomain);
    }
    if (row.hasQuote) quotesRecorded += 1;
  }
  return {
    goodLeads: goodDomains.size,
    quotesRecorded,
  };
}

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
    const category = resolveSupplierSourcingCategory({
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
  campaign: CampaignPlan;
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
    order?: typeof loadBulkRfqOrder;
    classify?: typeof classifyCampaign;
    progress?: typeof loadCampaignProgress;
  };
}): Promise<QueuedSourcingWave | null> {
  const intent = parseSourcingCommand(args.instruction);
  if (!intent) return null;
  const plan = await (args.dependencies?.plan ?? planSourcingCommand)({
    customerId: args.customerId,
    workspaceId: args.workspaceId,
  });
  if (!plan.length) return null;
  const order = await (args.dependencies?.order ?? loadBulkRfqOrder)(plan[0]!.orderId);
  if (!order) return null;
  const campaign = applyCampaignOverrides(
    (args.dependencies?.classify ?? classifyCampaign)({
      material: order.material,
      specification: order.specification,
      notes: order.notes,
      quantity: order.quantity,
    }),
    {
      targetGoodCompanies: (
        await (args.dependencies?.progress ?? loadCampaignProgress)(order.orderId)
      ).goodLeads + intent.perCategory,
    },
  );
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
      campaign,
    },
    // One wave per workspace at a time, so a repeated phrase does not double
    // the crawl or the outreach.
    dedupeKey: `procurement-sourcing-wave:${args.workspaceId}`,
    maxAttempts: 1,
  });
  return { jobId: job.id, perCategory: intent.perCategory, send: intent.send, plan, campaign };
}

function readStartRounds(value: unknown): Partial<Record<SupplierSourcingCategoryKey, number>> {
  const rounds: Partial<Record<SupplierSourcingCategoryKey, number>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return rounds;
  const record = value as Record<string, unknown>;
  for (const [rawKey, value] of Object.entries(record)) {
    const key = readSourcingCategoryKey(rawKey);
    if (!key) continue;
    const round = value;
    if (typeof round === "number" && Number.isFinite(round) && round > 0) {
      rounds[key] = Math.trunc(round);
    }
  }
  return rounds;
}

function readCategoryCounts(value: unknown): Partial<Record<SupplierSourcingCategoryKey, number>> {
  const counts: Partial<Record<SupplierSourcingCategoryKey, number>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return counts;
  const record = value as Record<string, unknown>;
  for (const [rawKey, value] of Object.entries(record)) {
    const key = readSourcingCategoryKey(rawKey);
    if (!key) continue;
    const count = value;
    if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
      counts[key] = Math.trunc(count);
    }
  }
  return counts;
}

function readCampaignStops(
  value: unknown,
): Partial<Record<SupplierSourcingCategoryKey, CampaignStopReason>> {
  const stops: Partial<Record<SupplierSourcingCategoryKey, CampaignStopReason>> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return stops;
  const record = value as Record<string, unknown>;
  for (const [rawKey, reason] of Object.entries(record)) {
    const key = readSourcingCategoryKey(rawKey);
    if (!key) continue;
    if (
      reason === "quote_goal_reached"
      || reason === "good_lead_target_reached"
      || reason === "discovery_exhausted"
    ) {
      stops[key] = reason;
    }
  }
  return stops;
}

/**
 * What a queued job still owes each category. Counts written by an earlier slice
 * win, including an explicit zero for a category that is finished, and any
 * category the job will still source falls back to the job target.
 */
function queuedRemainingByCategory(
  payload: Record<string, unknown>,
  planned: readonly SupplierSourcingCategoryKey[],
): Partial<Record<SupplierSourcingCategoryKey, number>> {
  const counts = readCategoryCounts(payload.remaining);
  const target = typeof payload.perCategory === "number" && payload.perCategory > 0
    ? Math.trunc(payload.perCategory)
    : null;
  if (target === null) return counts;
  const onlyCategory = readSourcingCategoryKey(payload.category);
  for (const category of planned) {
    if (onlyCategory && category !== onlyCategory) continue;
    if (counts[category] === undefined) counts[category] = target;
  }
  return counts;
}

/**
 * Keep the reason a wave chain stopped. A slice failure is handled inside the
 * job, so the job completes and drops out of the queued view with nothing to
 * explain it. The reason is written onto the job payload, and the status reads
 * the last finished job as well as the active ones.
 */
async function recordSourcingWavePayload(args: {
  jobId: string | null;
  officeId: string;
  payload: Record<string, unknown>;
  patch: Record<string, unknown>;
}) {
  if (!args.jobId) return;
  await prisma.backgroundJob.updateMany({
    where: { id: args.jobId, officeId: args.officeId },
    data: { payload: { ...args.payload, ...args.patch } as Prisma.InputJsonValue },
  });
}

function isSpentSourcingWave(
  wave: Pick<SourcingWaveResult, "discoveryExhausted" | "timedOut" | "added" | "providerFailures"> | null | undefined,
): boolean {
  return Boolean(
    wave?.discoveryExhausted
      && !wave.timedOut
      && wave.added === 0
      && (wave.providerFailures?.length ?? 0) === 0,
  );
}

type CampaignStopReason = Exclude<CampaignConvergence["reason"], "collecting">;

function firstCampaignStopReason(
  entries: readonly SourcingCommandPlanEntry[],
  stops: Partial<Record<SupplierSourcingCategoryKey, CampaignStopReason>>,
): CampaignStopReason | null {
  for (const entry of entries) {
    const reason = stops[entry.category];
    if (reason) return reason;
  }
  return null;
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
    record?: typeof recordSourcingWavePayload;
    plan?: typeof planSourcingCommand;
    progress?: typeof loadCampaignProgress;
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
  const onlyCategory = readSourcingCategoryKey(payload.category);
  const startRounds = readStartRounds(payload.startRounds);
  const firstCategory = readSourcingCategoryKey(payload.firstCategory);
  // Each category owns its own count. A slice usually runs one category, so a
  // single shared remainder would let the category that ran spend the other
  // category's suppliers and both would stop around half the target.
  const owedByCategory = readCategoryCounts(payload.remaining);
  const campaign = readCampaignPlan(payload.campaign);
  const campaignStops = readCampaignStops(payload.campaignStops);
  const campaignStopPayload = campaign ? { campaignStops } : {};
  const campaignEntries = campaign
    ? (await (args.dependencies?.plan ?? planSourcingCommand)({
      customerId,
      workspaceId,
    })).filter((entry) => !onlyCategory || entry.category === onlyCategory)
    : [];
  const campaignProgress = args.dependencies?.progress ?? loadCampaignProgress;
  const preConvergence = new Map<SupplierSourcingCategoryKey, ReturnType<typeof campaignConvergence>>();
  if (campaign && campaignEntries.length) {
    for (const entry of campaignEntries) {
      const stoppedReason = campaignStops[entry.category];
      if (stoppedReason) {
        preConvergence.set(entry.category, {
          done: true,
          reason: stoppedReason,
          remainingGoodLeads: 0,
        });
        owedByCategory[entry.category] = 0;
        continue;
      }
      const progress = await campaignProgress(entry.orderId);
      const convergence = campaignConvergence(campaign, {
        ...progress,
        discoveryExhausted: false,
      });
      preConvergence.set(entry.category, convergence);
      if (convergence.done) campaignStops[entry.category] = convergence.reason;
      owedByCategory[entry.category] = convergence.done
        ? 0
        : Math.min(owedByCategory[entry.category] ?? remaining, convergence.remainingGoodLeads);
    }
    if ([...preConvergence.values()].every((convergence) => convergence.done)) {
      const reason = firstCampaignStopReason(campaignEntries, campaignStops)
        ?? "discovery_exhausted";
      await (args.dependencies?.record ?? recordSourcingWavePayload)({
        jobId: args.jobId ?? null,
        officeId: args.officeId,
        payload,
        patch: { campaignStops, lastStop: reason },
      });
      return {
        perCategory: slice,
        send: payload.send === true && payload.confirmed === true,
        categories: [],
        added: 0,
        sent: 0,
        skipped: [],
      };
    }
  }
  const result = await (args.dependencies?.run ?? runSourcingCommand)({
    customerId,
    workspaceId,
    onlyCategory,
    budgetMs: SOURCING_COMMAND_SLICE_BUDGET_MS,
    startRounds,
    firstCategory,
    categoryTargets: owedByCategory,
    campaign,
    intent: {
      perCategory: slice,
      send: payload.send === true,
      scope: "each-category",
    },
    confirmed: payload.confirmed === true,
  });
  // Only keep going while the last slice found qualified suppliers, ran out of
  // time before it could, still has unsearched phrases left, or never got its
  // turn at the budget. A category whose curated phrases are spent reports
  // discovery exhausted and the chain ends, so nothing re-queues forever.
  const skipped = result.skipped ?? [];
  const stillFinding = skipped.length > 0 || result.categories.some(
    (entry) => (entry.wave?.added ?? 0) > 0
      || entry.wave?.timedOut === true
      || (entry.wave ? !entry.wave.discoveryExhausted : false),
  );
  const nextStartRounds = { ...startRounds };
  for (const entry of result.categories) {
    if (!entry.wave) continue;
    nextStartRounds[entry.category] = Math.max(
      nextStartRounds[entry.category] ?? 0,
      entry.wave.nextRound,
    );
  }
  // Credit the progress actually made, not the slice size, because a slice that
  // ran out of time added fewer suppliers than it asked for and the rest of the
  // count is still owed. Counting at least one keeps the chain finite, and a
  // category whose curated phrases are spent is owed nothing more.
  const nextOwed: Partial<Record<SupplierSourcingCategoryKey, number>> = { ...owedByCategory };
  for (const entry of result.categories) {
    const owed = nextOwed[entry.category] ?? remaining;
    // A category whose sourcing threw never searched, so it is charged nothing.
    // A slice stopped by a failing database is charged exactly what it stored,
    // with no floor, because it is about to be retried from the same cursor and
    // the floor exists only to keep ordinary continuations finite.
    const unsaved = (entry.wave?.persistenceFailures?.length ?? 0) > 0;
    const progressed = entry.wave
      ? unsaved
        ? Math.min(slice, entry.wave.added)
        : Math.min(slice, Math.max(1, entry.wave.added))
      : 0;
    // A category that ran out of curated phrases is owed nothing more, but a
    // barren round where the providers themselves failed is an outage, not an
    // exhausted category, so its count survives for the retry.
    const exhausted = isSpentSourcingWave(entry.wave);
    // A category that failed the same way forever is owed nothing either, so a
    // wave kept alive by its other category stops re-running the failure.
    const permanent = !entry.wave && !entry.errorRetryable;
    nextOwed[entry.category] = exhausted || permanent ? 0 : Math.max(0, owed - progressed);
  }
  for (const category of skipped) {
    nextOwed[category] = nextOwed[category] ?? remaining;
  }
  let postStopReason: ReturnType<typeof campaignConvergence>["reason"] | null = null;
  if (campaign && campaignEntries.length) {
    const postConvergence = new Map<SupplierSourcingCategoryKey, ReturnType<typeof campaignConvergence>>();
    for (const entry of campaignEntries) {
      const stoppedReason = campaignStops[entry.category];
      if (stoppedReason) {
        postConvergence.set(entry.category, {
          done: true,
          reason: stoppedReason,
          remainingGoodLeads: 0,
        });
        nextOwed[entry.category] = 0;
        continue;
      }
      const categoryResult = result.categories.find((candidate) => candidate.category === entry.category);
      const progress = await campaignProgress(entry.orderId);
      const convergence = campaignConvergence(campaign, {
        ...progress,
        discoveryExhausted: isSpentSourcingWave(categoryResult?.wave),
      });
      postConvergence.set(entry.category, convergence);
      if (convergence.done) campaignStops[entry.category] = convergence.reason;
      nextOwed[entry.category] = convergence.done
        ? 0
        : Math.min(nextOwed[entry.category] ?? remaining, convergence.remainingGoodLeads);
    }
    if ([...postConvergence.values()].every((convergence) => convergence.done)) {
      postStopReason = firstCampaignStopReason(campaignEntries, campaignStops)
        ?? "discovery_exhausted";
    }
  }
  const left = Math.max(0, ...Object.values(nextOwed).map((value) => value ?? 0));
  // A slice where every discovery provider threw, or where a category threw
  // before it could search at all, made no progress and did not run out of
  // time, so treat it as a transient outage: retry the same count a few times on
  // a delay instead of abandoning the wave, and stop retrying once the attempts
  // are spent so the chain stays finite.
  // A slice that qualified suppliers and could not store them is an outage even
  // though its phrases are not spent, because continuing would search new
  // phrases while the suppliers it already found were never saved.
  const saveOutage = result.categories.some(
    (entry) => (entry.wave?.persistenceFailures?.length ?? 0) > 0,
  );
  const outage = saveOutage
    || (!stillFinding
      && result.categories.some((entry) => (entry.wave?.providerFailures?.length ?? 0) > 0
        || (!entry.wave && entry.errorRetryable))
      && result.categories.every((entry) => (entry.wave?.added ?? 0) === 0));
  const retriesUsed = typeof payload.providerRetries === "number" ? Math.trunc(payload.providerRetries) : 0;
  // Carry why the last slice failed, because a queued wave runs unattended for
  // an hour and the operator only ever sees its status, not the slice result.
  const failed = result.categories.find((entry) => entry.error);
  const unsavedCategory = result.categories.find(
    (entry) => (entry.wave?.persistenceFailures?.length ?? 0) > 0,
  );
  const lastFailure = failed
    ? `${failed.category}: ${failed.errorReason ?? failed.error}`.slice(0, 300)
    : unsavedCategory
      ? `${unsavedCategory.category}: qualified suppliers could not be saved`
      : null;
  const retryOutage = outage && retriesUsed < SOURCING_OUTAGE_RETRIES;
  // An outage retry keeps the count and the cursor, so it takes precedence over
  // a normal continuation that would move the cursor past unsaved work.
  const continues = !postStopReason && left > 0 && (retryOutage || (stillFinding && !saveOutage));
  if (postStopReason) {
    await (args.dependencies?.record ?? recordSourcingWavePayload)({
      jobId: args.jobId ?? null,
      officeId: args.officeId,
      payload,
      patch: { campaignStops, lastStop: postStopReason },
    });
  } else if (!continues && lastFailure) {
    // The chain stops here, and a job that stops is filtered out of the queue
    // view, so the reason is written where the status can still read it.
    await (args.dependencies?.record ?? recordSourcingWavePayload)({
      jobId: args.jobId ?? null,
      officeId: args.officeId,
      payload,
      patch: { lastFailure },
    });
  }
  if (continues) {
    await (args.dependencies?.enqueue ?? enqueueBackgroundJob)({
      officeId: args.officeId,
      type: "PROCUREMENT_SOURCING_WAVE",
      // An outage retry keeps the phrases it never got to search, while a normal
      // continuation moves on to the phrases this slice did not reach.
      payload: retryOutage
        ? {
          ...payload,
          // A save outage can follow suppliers that were stored before the
          // database failed, so those are credited. A provider outage stored
          // nobody and keeps its whole count.
          perCategory: saveOutage ? left : remaining,
          ...(saveOutage ? { remaining: nextOwed } : {}),
          providerRetries: retriesUsed + 1,
          startRounds,
          lastFailure,
          ...campaignStopPayload,
        }
        : {
          ...payload,
          perCategory: left,
          lastFailure,
          remaining: nextOwed,
          providerRetries: 0,
          startRounds: nextStartRounds,
          // Hand the budget to the category that lost it, otherwise the plan
          // order alone decides and the second category is never sourced.
          firstCategory: skipped.at(0) ?? null,
          ...campaignStopPayload,
        },
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
  // Where each category should resume its curated search phrases, so a
  // continuation slice searches something new instead of the first phrases
  // again.
  startRounds?: Readonly<Partial<Record<SupplierSourcingCategoryKey, number>>> | null;
  // Which category takes the budget first. A slice hands the whole budget to
  // one category, so without rotation the same category would always run and
  // the other would never be sourced at all.
  firstCategory?: SupplierSourcingCategoryKey | null;
  // How many suppliers each category is still owed. A category owed nothing is
  // skipped entirely, and a category owed less than the slice is capped, so
  // alternating slices cannot spend one category's count on the other.
  categoryTargets?: Readonly<Partial<Record<SupplierSourcingCategoryKey, number>>> | null;
  campaign?: CampaignPlan | null;
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
  const scoped = args.onlyCategory
    ? fullPlan.filter((entry) => entry.category === args.onlyCategory)
    : fullPlan;
  const categoryTarget = (category: SupplierSourcingCategoryKey) => Math.min(
    args.intent.perCategory,
    args.categoryTargets?.[category] ?? args.intent.perCategory,
  );
  const owed = scoped.filter((entry) => categoryTarget(entry.category) > 0);
  // Rotate so the category that lost the previous budget goes first.
  const pivot = args.firstCategory
    ? owed.findIndex((entry) => entry.category === args.firstCategory)
    : -1;
  const plan = pivot > 0 ? [...owed.slice(pivot), ...owed.slice(0, pivot)] : owed;
  const sourcing = args.dependencies?.sourcing ?? runProcurementSupplierSourcingWave;
  const rfq = args.dependencies?.rfq ?? runProcurementBulkRfq;
  const result: SourcingCommandResult = {
    perCategory: args.intent.perCategory,
    send: args.intent.send && args.confirmed,
    categories: [],
    added: 0,
    sent: 0,
    skipped: [],
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
    if (ran && categoryDeadline && categoryDeadline - Date.now() < MAX_DISCOVERY_CALL_MS) {
      result.skipped = plan.slice(plan.indexOf(entry)).map((pending) => pending.category);
      break;
    }
    ran += 1;
    const outcome: SourcingCommandCategoryOutcome = {
      category: entry.category,
      orderId: entry.orderId,
      material: entry.material,
      wave: null,
      send: null,
      error: null,
      errorRetryable: false,
      errorReason: null,
    };
    try {
      outcome.wave = await sourcing({
        orderId: entry.orderId,
        target: categoryTarget(entry.category),
        deadlineAt: categoryDeadline,
        startRound: args.startRounds?.[entry.category] ?? 0,
        contactsPerCompany: args.campaign?.contactsPerCompany,
      });
      result.added += outcome.wave.added;
    } catch (error) {
      const code = supplierSourcingErrorCode(error);
      outcome.error = code && error instanceof Error
        ? error.message
        : "The supplier wave failed for this request.";
      outcome.errorReason = code ? null : failureReason(error);
      console.error("procurement sourcing wave failed", {
        orderId: entry.orderId,
        category: entry.category,
        reason: outcome.errorReason ?? code,
      });
      // A missing request or an unsupported category fails the same way forever,
      // so only an unavailable provider or an unexpected error earns another
      // slice.
      outcome.errorRetryable = code === null || code === "discovery_unavailable";
      result.categories.push(outcome);
      continue;
    }
    if (result.send && outcome.wave.added > 0) {
      try {
        const contactsAdded = outcome.wave.contactsAdded ?? outcome.wave.added;
        outcome.send = await rfq({
          orderId: entry.orderId,
          limit: Math.min(BULK_RFQ_MAX_PER_RUN, contactsAdded),
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

/**
 * The workflow write-back that stamps `last_email_message_id` is best effort,
 * because the deployed workflow role cannot always update `order_vendors`, so a
 * send that really happened can leave no workflow receipt. A RECORDED local
 * reservation is the second proof of delivery, so a supplier counts as
 * contacted when either store says so, and never twice.
 *
 * A RESERVED reservation is not proof: the pool reserves the sender before the
 * provider call, and an UNKNOWN delivery outcome is deliberately left RESERVED
 * for reconciliation. Those suppliers are reported as pending instead, so the
 * status never claims mail that may not have left.
 */
export function countSupplierDeliveries(
  vendors: ReadonlyArray<{ vendorId: string; lastEmailMessageId: string | null }>,
  receipts: { recorded: ReadonlySet<string>; reserved: ReadonlySet<string> },
) {
  let contacted = 0;
  let pending = 0;
  for (const vendor of vendors) {
    if (vendor.lastEmailMessageId || receipts.recorded.has(vendor.vendorId)) {
      contacted += 1;
      continue;
    }
    if (receipts.reserved.has(vendor.vendorId)) pending += 1;
  }
  return { contacted, pending };
}

async function supplierContactCounts(args: { orderId: string; officeId: string }) {
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<Array<{
    vendorId: string;
    lastEmailMessageId: string | null;
  }>>(`
    SELECT
      order_vendors.id AS "vendorId",
      order_vendors.last_email_message_id AS "lastEmailMessageId"
    FROM order_vendors
    WHERE order_vendors.order_id = $1::uuid
  `, args.orderId);
  const reservations = await prisma.emailSenderReservation.findMany({
    where: {
      officeId: args.officeId,
      status: { in: ["RESERVED", "RECORDED"] },
      idempotencyKey: { startsWith: `procurement-bulk-rfq:${args.orderId}:` },
    },
    select: { idempotencyKey: true, status: true },
  });
  const recorded = new Set<string>();
  const reserved = new Set<string>();
  for (const entry of reservations) {
    const vendorId = entry.idempotencyKey.split(":").at(-1);
    if (!vendorId) continue;
    if (entry.status === "RECORDED") recorded.add(vendorId);
    else reserved.add(vendorId);
  }
  return {
    suppliers: rows.length,
    ...countSupplierDeliveries(rows, { recorded, reserved }),
  };
}

const SOURCING_JOB_FIELDS = {
  id: true,
  status: true,
  payload: true,
  runAfter: true,
  lastError: true,
} as const;

async function queuedSourcingWaveJobs(args: { officeId: string; workspaceId: string }) {
  const where = {
    officeId: args.officeId,
    type: "PROCUREMENT_SOURCING_WAVE",
    dedupeKey: { startsWith: `procurement-sourcing-wave:${args.workspaceId}` },
  };
  const active = await prisma.backgroundJob.findMany({
    where: { ...where, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { runAfter: "asc" },
    take: 10,
    select: SOURCING_JOB_FIELDS,
  });
  if (active.length) return active;
  // With nothing queued the operator needs to know whether the wave finished or
  // stopped on a failure, and a finished job is the only record of that.
  return prisma.backgroundJob.findMany({
    where: { ...where, status: { in: ["DONE", "FAILED"] } },
    orderBy: { updatedAt: "desc" },
    take: 1,
    select: SOURCING_JOB_FIELDS,
  });
}

export type SourcingCommandStatusCategory = SourcingCommandPlanEntry & {
  suppliers: number;
  contacted: number;
  pendingDelivery: number;
  uncontacted: number;
};

export type SourcingCommandStatus = {
  categories: SourcingCommandStatusCategory[];
  queued: Array<{
    jobId: string;
    status: string;
    remainingPerCategory: number | null;
    startRounds: Partial<Record<SupplierSourcingCategoryKey, number>>;
    remainingByCategory: Partial<Record<SupplierSourcingCategoryKey, number>>;
    firstCategory: SupplierSourcingCategoryKey | null;
    providerRetries: number;
    runAfter: string;
    lastError: string | null;
    // Why the previous slice failed, if it did. A slice failure is handled
    // inside the job, so it never reaches `lastError`.
    lastFailure: string | null;
    lastStop: string | null;
    campaign: CampaignPlan | null;
  }>;
};

/**
 * A queued wave runs in slices for an hour or more, so the operator needs the
 * standing counts instead of a per-slice queue tally: how many suppliers each
 * category holds, how many of them were mailed, and whether a continuation is
 * still owed.
 */
export async function sourcingCommandStatus(args: {
  customerId: string;
  workspaceId?: string | null;
  officeId?: string | null;
  plan?: typeof planSourcingCommand;
  counts?: (args: { orderId: string; officeId: string }) =>
    Promise<{ suppliers: number; contacted: number; pending: number }>;
  jobs?: (args: { officeId: string; workspaceId: string }) => Promise<Array<{
    id: string;
    status: string;
    payload: unknown;
    runAfter: Date;
    lastError: string | null;
  }>>;
}): Promise<SourcingCommandStatus> {
  const plan = await (args.plan ?? planSourcingCommand)({
    customerId: args.customerId,
    workspaceId: args.workspaceId ?? null,
  });
  // Both reads stay inside the office that owns this customer, so an operator
  // secret cannot surface another tenant's suppliers or queued work.
  const officeId = args.officeId ?? procurementOfficeIdFromServerMetadata(args.customerId);
  const counts = args.counts ?? supplierContactCounts;
  const categories: SourcingCommandStatusCategory[] = [];
  for (const entry of plan) {
    const { suppliers, contacted, pending } = await counts({ orderId: entry.orderId, officeId });
    categories.push({
      ...entry,
      suppliers,
      contacted,
      pendingDelivery: pending,
      uncontacted: Math.max(0, suppliers - contacted - pending),
    });
  }
  const workspaceId = args.workspaceId?.trim() || null;
  const jobs = workspaceId
    ? await (args.jobs ?? queuedSourcingWaveJobs)({ officeId, workspaceId })
    : [];
  return {
    categories,
    queued: jobs.map((job) => {
      const payload = job.payload && typeof job.payload === "object" && !Array.isArray(job.payload)
        ? job.payload as Record<string, unknown>
        : {};
      return {
        jobId: job.id,
        status: job.status,
        remainingPerCategory: typeof payload.perCategory === "number" ? payload.perCategory : null,
        startRounds: readStartRounds(payload.startRounds),
        // A job queued for the first time carries only `perCategory`, so fill
        // the categories it will actually source from that target, otherwise the
        // status reads as no work owed while the whole wave is still ahead.
        remainingByCategory: queuedRemainingByCategory(payload, categories.map((entry) => entry.category)),
        firstCategory: readSourcingCategoryKey(payload.firstCategory),
        providerRetries: typeof payload.providerRetries === "number" ? payload.providerRetries : 0,
        runAfter: job.runAfter.toISOString(),
        lastError: job.lastError,
        lastFailure: typeof payload.lastFailure === "string" ? payload.lastFailure : null,
        lastStop: typeof payload.lastStop === "string" ? payload.lastStop : null,
        campaign: readCampaignPlan(payload.campaign),
      };
    }),
  };
}
