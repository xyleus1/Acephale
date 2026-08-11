import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { stripEmDashes } from "@/lib/no-em-dash";
import { prisma } from "@/lib/prisma";
import { SupplyPersistenceError, type SupplyAccessContext } from "./persistence";
import { currentSupplierQualification } from "./supplier-qualification";

export function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

export function requiredText(value: unknown, label: string, max: number) {
  if (typeof value !== "string") throw new SupplyPersistenceError(`${label} is required.`, "invalid_input");
  const normalized = stripEmDashes(value).replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > max) throw new SupplyPersistenceError(`${label} must contain 1 to ${max} characters.`, "invalid_input");
  return normalized;
}

export function optionalText(value: unknown, label: string, max: number) {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, label, max);
}

export function messageBody(value: unknown) {
  if (typeof value !== "string") throw new SupplyPersistenceError("Email body is required.", "invalid_input");
  const normalized = stripEmDashes(value).replace(/\r\n/g, "\n").trim();
  if (!normalized || normalized.length > 8_000) throw new SupplyPersistenceError("Email body must contain 1 to 8,000 characters.", "invalid_input");
  return normalized;
}

export function singleEmail(value: unknown, label: string) {
  const email = requiredText(value, label, 320).toLowerCase();
  if (!/^[^\s@,;:"<>()[\]]+@[^\s@,;:"<>()[\]]+\.[A-Za-z]{2,}$/.test(email)) {
    throw new SupplyPersistenceError(`${label} must be one email address.`, "invalid_input");
  }
  return email;
}

export function nonNegativeInteger(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new SupplyPersistenceError(`${label} must be a non-negative integer.`, "invalid_input");
  }
  return value;
}

export function requireCurrentSupplierQualification(value: unknown, message: string) {
  if (!currentSupplierQualification(value)) throw new SupplyPersistenceError(message, "conflict");
}

export function qualificationFromProcurementResult(value: unknown) {
  return record(record(value).reviews).sourceEvidence;
}

export function retryableTransactionError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError
    && (error.code === "P2002"
      || error.code === "P2034"
      || (error.code === "P2010" && record(error.meta).code === "40001"));
}

export async function withSerializableRetry<T>(operation: () => Promise<T>, conflictMessage: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!retryableTransactionError(error) || attempt === 2) {
        if (retryableTransactionError(error)) throw new SupplyPersistenceError(conflictMessage, "conflict");
        throw error;
      }
    }
  }
  throw new SupplyPersistenceError(conflictMessage, "conflict");
}

export async function currentAccessContext(context: SupplyAccessContext): Promise<SupplyAccessContext> {
  const user = await prisma.user.findFirst({
    where: { id: context.userId, officeId: context.officeId, isActive: true },
    select: { role: true, canViewWholeOffice: true },
  });
  if (!user) throw new SupplyPersistenceError("Your current user no longer has access to this office.", "forbidden");
  return { ...context, role: user.role, canViewWholeOffice: user.canViewWholeOffice };
}

export async function appendSupplierCommunicationEvent(args: {
  tx: Prisma.TransactionClient;
  taskId: string;
  officeId: string;
  workspaceId: string;
  actorUserId: string;
  eventType: string;
  status: string;
  message: string;
  payload: Prisma.InputJsonObject;
}) {
  const aggregate = await args.tx.supplyExecutionEvent.aggregate({
    where: { executionTaskId: args.taskId },
    _max: { sequence: true },
  });
  const sequence = (aggregate._max.sequence ?? 0) + 1;
  await args.tx.supplyExecutionEvent.create({
    data: {
      officeId: args.officeId,
      workspaceId: args.workspaceId,
      executionTaskId: args.taskId,
      actorUserId: args.actorUserId,
      sequence,
      eventType: args.eventType,
      status: args.status,
      message: args.message,
      payload: args.payload,
      payloadHash: digest(args.payload),
      idempotencyKey: `${args.eventType.toLowerCase()}:${sequence}:${digest(args.payload)}`,
    },
  });
}

export const supplierCommunicationTaskSelect = {
  id: true,
  parentTaskId: true,
  status: true,
  taskKey: true,
  taskType: true,
  capabilityKey: true,
  input: true,
  inputHash: true,
  result: true,
  resultHash: true,
  externalSystem: true,
  externalRef: true,
  createdAt: true,
  updatedAt: true,
  approvals: {
    orderBy: { requestedAt: "desc" },
    take: 1,
    select: {
      id: true,
      status: true,
      requiredRole: true,
      scopeHash: true,
      requestReason: true,
      requestedByUserId: true,
      decidedByUserId: true,
      decisionNote: true,
      requestedAt: true,
      decidedAt: true,
      expiresAt: true,
    },
  },
} satisfies Prisma.SupplyExecutionTaskSelect;

export type SupplierCommunicationTask = Prisma.SupplyExecutionTaskGetPayload<{ select: typeof supplierCommunicationTaskSelect }>;
