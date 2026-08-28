import "server-only";
import type { BackgroundJob, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type BackgroundJobType =
  | "ANALYZE_JOB_DOCUMENT"
  | "GMAIL_SYNC_WINDOW"
  | "PREWARM_OPEN_SOURCING"
  | "PREWARM_INQUIRY_SUMMARY"
  | "CUSTOMER_STATUS_NOTIFY"
  | "CUSTOMER_MILESTONE_NOTIFY"
  | "DEMO_EMAIL_CAPABILITY_TEST"
  | "PROCUREMENT_SOURCING_WAVE";

type EnqueueInput = {
  officeId: string;
  type: BackgroundJobType;
  payload: Record<string, unknown>;
  dedupeKey?: string | null;
  runAfter?: Date;
  maxAttempts?: number;
  // A job that continues its own work re-uses its dedupe key, so it has to be
  // able to exclude itself from the check while it is still RUNNING.
  ignoreJobId?: string | null;
};

type RunResult = {
  scanned: number;
  completed: number;
  failed: number;
  retried: number;
  skipped: number;
};

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

export async function enqueueBackgroundJob(input: EnqueueInput) {
  if (input.dedupeKey) {
    const existing = await prisma.backgroundJob.findFirst({
      where: {
        officeId: input.officeId,
        dedupeKey: input.dedupeKey,
        status: { in: ["QUEUED", "RUNNING"] },
        ...(input.ignoreJobId ? { id: { not: input.ignoreJobId } } : {}),
      },
      select: { id: true },
    });
    if (existing) return existing;
  }

  return prisma.backgroundJob.create({
    data: {
      officeId: input.officeId,
      type: input.type,
      payload: toJson(input.payload),
      dedupeKey: input.dedupeKey ?? null,
      runAfter: input.runAfter ?? new Date(),
      maxAttempts: input.maxAttempts ?? 3,
    },
    select: { id: true },
  });
}

async function executeBackgroundJob(job: BackgroundJob) {
  const type = job.type;
  const payload = asRecord(job.payload);
  if (type === "ANALYZE_JOB_DOCUMENT") {
    const { analyzeJobDocument } = await import("./doc-analyze");
    const documentId = stringValue(payload.documentId);
    if (!documentId) throw new Error("Missing documentId.");
    await analyzeJobDocument({ documentId, force: booleanValue(payload.force) });
    return;
  }

  if (type === "GMAIL_SYNC_WINDOW") {
    const accountId = stringValue(payload.accountId);
    const officeId = stringValue(payload.officeId);
    const query = stringValue(payload.query);
    const threadFetchLimitRaw = typeof payload.threadFetchLimit === "number" ? payload.threadFetchLimit : null;
    if (!accountId || !officeId || !query) throw new Error("Missing Gmail sync window payload.");
    const { syncEmailAccountWindowInternal } = await import("./gmail-sync");
    const result = await syncEmailAccountWindowInternal({
      accountId,
      officeId,
      query,
      threadFetchLimit: threadFetchLimitRaw ?? undefined,
    });
    if ("error" in result) throw new Error(result.error);
    return;
  }

  if (type === "PREWARM_OPEN_SOURCING") {
    const { prewarmAllOpenInquiries } = await import("./prewarm-summary");
    const officeId = stringValue(payload.officeId);
    if (!officeId) throw new Error("Missing officeId.");
    await prewarmAllOpenInquiries(officeId);
    return;
  }

  if (type === "PREWARM_INQUIRY_SUMMARY") {
    const { prewarmInquirySummary } = await import("./prewarm-summary");
    const inquiryId = stringValue(payload.inquiryId);
    if (!inquiryId) throw new Error("Missing inquiryId.");
    await prewarmInquirySummary(inquiryId);
    return;
  }

  if (type === "CUSTOMER_STATUS_NOTIFY") {
    const { maybeNotifyCustomerOnStatusChange } = await import("./customer-notify");
    const jobId = stringValue(payload.jobId);
    const fromStatus = stringValue(payload.fromStatus);
    const toStatus = stringValue(payload.toStatus);
    if (!jobId || !fromStatus || !toStatus) throw new Error("Missing status notification payload.");
    await maybeNotifyCustomerOnStatusChange(jobId, fromStatus, toStatus);
    return;
  }

  if (type === "CUSTOMER_MILESTONE_NOTIFY") {
    const { maybeNotifyCustomerOnMilestone } = await import("./customer-notify");
    const jobId = stringValue(payload.jobId);
    const milestoneType = stringValue(payload.milestoneType);
    const isActual = booleanValue(payload.isActual);
    if (!jobId || !milestoneType) throw new Error("Missing milestone notification payload.");
    await maybeNotifyCustomerOnMilestone(jobId, milestoneType, isActual);
    return;
  }

  if (type === "DEMO_EMAIL_CAPABILITY_TEST") {
    const { runDemoEmailCapabilityJob } = await import("./demo-email-capability");
    await runDemoEmailCapabilityJob({
      backgroundJobId: job.id,
      officeId: job.officeId,
      payload: job.payload,
    });
    return;
  }

  if (type === "PROCUREMENT_SOURCING_WAVE") {
    const { runQueuedSourcingWaveJob } = await import("./procurement-sourcing-command");
    await runQueuedSourcingWaveJob({ officeId: job.officeId, jobId: job.id, payload: job.payload });
    return;
  }

  throw new Error(`Unknown background job type: ${type}`);
}

type RunOneResult = "completed" | "failed" | "retried" | "skipped";

export type BackgroundJobExecutionDependencies = {
  updateMany: typeof prisma.backgroundJob.updateMany;
  execute: (job: BackgroundJob) => Promise<void>;
  now: () => Date;
};

const defaultExecutionDependencies: BackgroundJobExecutionDependencies = {
  updateMany: (args) => prisma.backgroundJob.updateMany(args),
  execute: executeBackgroundJob,
  now: () => new Date(),
};

export async function runOneBackgroundJob(
  job: BackgroundJob,
  dependencies: BackgroundJobExecutionDependencies = defaultExecutionDependencies,
): Promise<RunOneResult> {
  const claimedAt = dependencies.now();
  const claimed = await dependencies.updateMany({
    where: { id: job.id, officeId: job.officeId, status: "QUEUED" },
    data: {
      status: "RUNNING",
      attempts: { increment: 1 },
      lockedAt: claimedAt,
      startedAt: claimedAt,
      lastError: null,
    },
  });
  if (claimed.count !== 1) return "skipped";

  const attempt = job.attempts + 1;
  try {
    await dependencies.execute(job);
    await dependencies.updateMany({
      where: { id: job.id, officeId: job.officeId },
      data: {
        status: "DONE",
        completedAt: dependencies.now(),
        lockedAt: null,
        lastError: null,
      },
    });
    return "completed";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exhausted = attempt >= job.maxAttempts;
    const failedAt = dependencies.now();
    await dependencies.updateMany({
      where: { id: job.id, officeId: job.officeId },
      data: {
        status: exhausted ? "FAILED" : "QUEUED",
        runAfter: exhausted
          ? job.runAfter
          : new Date(failedAt.getTime() + Math.min(60, attempt * attempt * 5) * 60_000),
        lockedAt: null,
        failedAt: exhausted ? failedAt : null,
        lastError: message.slice(0, 1000),
      },
    });
    return exhausted ? "failed" : "retried";
  }
}

export async function runBackgroundJobById(input: {
  jobId: string;
  expectedType: BackgroundJobType;
}) {
  const job = await prisma.backgroundJob.findUnique({ where: { id: input.jobId } });
  if (!job || job.type !== input.expectedType) {
    return { found: false as const, outcome: "skipped" as const };
  }
  const outcome = await runOneBackgroundJob(job);
  return { found: true as const, outcome };
}

// A serverless invocation can be killed mid-job, which leaves the row RUNNING
// with nothing running it, holding its dedupe key and stalling any wave that
// continues itself. Such a row is handed back to the queue after this long.
export const STALE_RUNNING_JOB_MS = 15 * 60_000;
const MAX_STALE_RECLAIMS = 5;

async function reclaimStaleRunningJobs(input: {
  onlyTypes?: readonly BackgroundJobType[];
  now: Date;
}) {
  const reclaimed = await prisma.backgroundJob.updateMany({
    where: {
      status: "RUNNING",
      lockedAt: { lt: new Date(input.now.getTime() - STALE_RUNNING_JOB_MS) },
      // A row that keeps dying is left alone rather than cycled forever.
      attempts: { lt: MAX_STALE_RECLAIMS },
      ...(input.onlyTypes?.length ? { type: { in: [...input.onlyTypes] } } : {}),
    },
    data: {
      status: "QUEUED",
      lockedAt: null,
      runAfter: input.now,
      lastError: "The previous attempt did not finish, so the job was queued again.",
    },
  });
  return reclaimed.count;
}

export async function runDueBackgroundJobs(
  input: { limit?: number; onlyTypes?: readonly BackgroundJobType[] } = {},
): Promise<RunResult> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 10));
  const typeFilter = input.onlyTypes?.length
    ? { in: [...input.onlyTypes] }
    : { not: "DEMO_EMAIL_CAPABILITY_TEST" };
  const now = new Date();
  await reclaimStaleRunningJobs({ onlyTypes: input.onlyTypes, now }).catch(() => 0);
  const offices = await prisma.office.findMany({ select: { id: true } });
  const jobs: BackgroundJob[] = [];
  for (const office of offices) {
    if (jobs.length >= limit) break;
    const batch = await prisma.backgroundJob.findMany({
      where: {
        officeId: office.id,
        status: "QUEUED",
        runAfter: { lte: now },
        type: typeFilter,
      },
      orderBy: { runAfter: "asc" },
      take: limit - jobs.length,
    });
    jobs.push(...batch);
  }

  const result: RunResult = { scanned: jobs.length, completed: 0, failed: 0, retried: 0, skipped: 0 };

  for (const job of jobs) {
    const outcome = await runOneBackgroundJob(job);
    if (outcome === "completed") result.completed++;
    else if (outcome === "failed") result.failed++;
    else if (outcome === "retried") result.retried++;
    else result.skipped++;
  }

  return result;
}
