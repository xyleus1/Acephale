import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { runBackgroundJobById } from "@/lib/background-jobs";
import { reconcileDemoEmailCapabilityJob } from "@/lib/demo-email-capability";
import { prisma } from "@/lib/prisma";

type TriggerJob = {
  id: string;
  type: string;
  status: string;
  payload: Prisma.JsonValue;
};

type CompletedJob = {
  status: string;
  payload: Prisma.JsonValue;
  lastError: string | null;
};

export type DemoEmailTriggerDependencies = {
  findJob: (jobId: string) => Promise<TriggerJob | null>;
  runJob: (jobId: string) => Promise<{ found: boolean; outcome: string }>;
  findCompletedJob: (jobId: string) => Promise<CompletedJob | null>;
  consumeReconciliationToken: (jobId: string, expectedHash: string, payload: Prisma.InputJsonValue) => Promise<boolean>;
  reconcileJob: (jobId: string) => ReturnType<typeof reconcileDemoEmailCapabilityJob>;
};

const defaultDependencies: DemoEmailTriggerDependencies = {
  findJob: (jobId) => prisma.backgroundJob.findUnique({
    where: { id: jobId },
    select: { id: true, type: true, status: true, payload: true },
  }),
  runJob: (jobId) => runBackgroundJobById({
    jobId,
    expectedType: "DEMO_EMAIL_CAPABILITY_TEST",
  }),
  findCompletedJob: (jobId) => prisma.backgroundJob.findUnique({
    where: { id: jobId },
    select: { status: true, payload: true, lastError: true },
  }),
  consumeReconciliationToken: async (jobId, expectedHash, payload) => {
    const consumed = await prisma.backgroundJob.updateMany({
      where: {
        id: jobId,
        type: "DEMO_EMAIL_CAPABILITY_TEST",
        status: { in: ["DONE", "FAILED"] },
        payload: { path: ["reconciliationTokenHash"], equals: expectedHash },
      },
      data: { payload },
    });
    return consumed.count === 1;
  },
  reconcileJob: (jobId) => reconcileDemoEmailCapabilityJob({ backgroundJobId: jobId }),
};

function record(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function validToken(token: string, expectedHash: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || token.length < 32 || token.length > 256) return false;
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function inputJson(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function executeDemoEmailTrigger(
  input: { jobId: string; token: string; mode?: "run" | "reconcile" },
  dependencies: DemoEmailTriggerDependencies = defaultDependencies,
) {
  if (!/^[a-z0-9-]{20,160}$/i.test(input.jobId)) {
    return { status: 400, body: { error: "Invalid demo job." } } as const;
  }

  const job = await dependencies.findJob(input.jobId);
  const payload = job ? record(job.payload) : {};
  if (input.mode === "reconcile") {
    const expectedHash = typeof payload.reconciliationTokenHash === "string"
      ? payload.reconciliationTokenHash
      : "";
    if (!job || job.type !== "DEMO_EMAIL_CAPABILITY_TEST"
      || !["DONE", "FAILED"].includes(job.status)
      || !validToken(input.token, expectedHash)) {
      return {
        status: 404,
        body: { error: "Demo reconciliation not found or authorization expired." },
      } as const;
    }
    const nextPayload = { ...payload };
    delete nextPayload.reconciliationTokenHash;
    if (!await dependencies.consumeReconciliationToken(job.id, expectedHash, inputJson(nextPayload))) {
      return {
        status: 404,
        body: { error: "Demo reconciliation not found or authorization expired." },
      } as const;
    }
    try {
      const result = await dependencies.reconcileJob(job.id);
      return {
        status: 200,
        body: {
          accepted: true,
          outcome: "reconciled",
          status: job.status,
          result,
          error: null,
        },
      } as const;
    } catch {
      return {
        status: 500,
        body: { error: "Demo mailbox reconciliation failed." },
      } as const;
    }
  }

  const expectedHash = typeof payload.triggerTokenHash === "string" ? payload.triggerTokenHash : "";
  if (!job || job.type !== "DEMO_EMAIL_CAPABILITY_TEST" || job.status !== "QUEUED"
    || !validToken(input.token, expectedHash)) {
    return {
      status: 404,
      body: { error: "Demo job not found or authorization expired." },
    } as const;
  }

  const run = await dependencies.runJob(job.id);
  const completed = await dependencies.findCompletedJob(job.id);
  const completedPayload = completed ? record(completed.payload) : {};
  return {
    status: 200,
    body: {
      accepted: run.found,
      outcome: run.outcome,
      status: completed?.status ?? "UNKNOWN",
      result: completedPayload.result ?? null,
      error: completed?.lastError ?? null,
    },
  } as const;
}
