import "server-only";
import type { BackgroundJob, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { analyzeJobDocument } from "./doc-analyze";
import { prewarmAllOpenInquiries, prewarmInquirySummary } from "./prewarm-summary";
import { maybeNotifyCustomerOnMilestone, maybeNotifyCustomerOnStatusChange } from "./customer-notify";

type BackgroundJobType =
  | "ANALYZE_JOB_DOCUMENT"
  | "PREWARM_OPEN_SOURCING"
  | "PREWARM_INQUIRY_SUMMARY"
  | "CUSTOMER_STATUS_NOTIFY"
  | "CUSTOMER_MILESTONE_NOTIFY";

type EnqueueInput = {
  officeId: string;
  type: BackgroundJobType;
  payload: Record<string, unknown>;
  dedupeKey?: string | null;
  runAfter?: Date;
  maxAttempts?: number;
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

async function executeBackgroundJob(type: string, payload: Record<string, unknown>) {
  if (type === "ANALYZE_JOB_DOCUMENT") {
    const documentId = stringValue(payload.documentId);
    if (!documentId) throw new Error("Missing documentId.");
    await analyzeJobDocument({ documentId, force: booleanValue(payload.force) });
    return;
  }

  if (type === "PREWARM_OPEN_SOURCING") {
    const officeId = stringValue(payload.officeId);
    if (!officeId) throw new Error("Missing officeId.");
    await prewarmAllOpenInquiries(officeId);
    return;
  }

  if (type === "PREWARM_INQUIRY_SUMMARY") {
    const inquiryId = stringValue(payload.inquiryId);
    if (!inquiryId) throw new Error("Missing inquiryId.");
    await prewarmInquirySummary(inquiryId);
    return;
  }

  if (type === "CUSTOMER_STATUS_NOTIFY") {
    const jobId = stringValue(payload.jobId);
    const fromStatus = stringValue(payload.fromStatus);
    const toStatus = stringValue(payload.toStatus);
    if (!jobId || !fromStatus || !toStatus) throw new Error("Missing status notification payload.");
    await maybeNotifyCustomerOnStatusChange(jobId, fromStatus, toStatus);
    return;
  }

  if (type === "CUSTOMER_MILESTONE_NOTIFY") {
    const jobId = stringValue(payload.jobId);
    const milestoneType = stringValue(payload.milestoneType);
    const isActual = booleanValue(payload.isActual);
    if (!jobId || !milestoneType) throw new Error("Missing milestone notification payload.");
    await maybeNotifyCustomerOnMilestone(jobId, milestoneType, isActual);
    return;
  }

  throw new Error(`Unknown background job type: ${type}`);
}

export async function runDueBackgroundJobs(input: { limit?: number } = {}): Promise<RunResult> {
  const limit = Math.min(50, Math.max(1, input.limit ?? 10));
  const now = new Date();
  const offices = await prisma.office.findMany({ select: { id: true } });
  const jobs: BackgroundJob[] = [];
  for (const office of offices) {
    if (jobs.length >= limit) break;
    const batch = await prisma.backgroundJob.findMany({
      where: {
        officeId: office.id,
        status: "QUEUED",
        runAfter: { lte: now },
      },
      orderBy: { runAfter: "asc" },
      take: limit - jobs.length,
    });
    jobs.push(...batch);
  }

  const result: RunResult = { scanned: jobs.length, completed: 0, failed: 0, retried: 0, skipped: 0 };

  for (const job of jobs) {
    const claimed = await prisma.backgroundJob.updateMany({
      where: { id: job.id, officeId: job.officeId, status: "QUEUED" },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        lockedAt: new Date(),
        startedAt: new Date(),
        lastError: null,
      },
    });
    if (claimed.count !== 1) {
      result.skipped++;
      continue;
    }

    const attempt = job.attempts + 1;
    try {
      await executeBackgroundJob(job.type, asRecord(job.payload));
      await prisma.backgroundJob.updateMany({
        where: { id: job.id, officeId: job.officeId },
        data: {
          status: "DONE",
          completedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
      result.completed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = attempt >= job.maxAttempts;
      await prisma.backgroundJob.updateMany({
        where: { id: job.id, officeId: job.officeId },
        data: {
          status: exhausted ? "FAILED" : "QUEUED",
          runAfter: exhausted ? job.runAfter : new Date(Date.now() + Math.min(60, attempt * attempt * 5) * 60_000),
          lockedAt: null,
          failedAt: exhausted ? new Date() : null,
          lastError: message.slice(0, 1000),
        },
      });
      if (exhausted) result.failed++;
      else result.retried++;
    }
  }

  return result;
}
