import "server-only";

import { prisma } from "@/lib/prisma";
import { storeJobDocumentFile } from "@/lib/document-storage";
import { recordMemoryEvent } from "@/lib/memory/record-event";
import type { CustomerPortalPrincipal } from "@/lib/customer-portal-data";

const QUOTE_ACTION_TYPES = ["QUOTE_ACCEPTED", "QUOTE_CHANGES_REQUESTED"] as const;
type QuoteActionType = typeof QUOTE_ACTION_TYPES[number];

function membershipFor(principal: CustomerPortalPrincipal, companyId: string) {
  return principal.memberships.find((membership) =>
    membership.companyId === companyId && membership.role !== "VIEWER"
  ) ?? null;
}

async function recordPortalActionMemory(args: {
  actionId: string;
  officeId: string;
  companyId: string;
  jobId?: string | null;
  inquiryId?: string | null;
  portalUserId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const entityType = args.jobId ? "job" : args.inquiryId ? "rfq" : "company";
  const entityId = args.jobId ?? args.inquiryId ?? args.companyId;
  await recordMemoryEvent({
    officeId: args.officeId,
    sourceType: args.jobId ? "JOB" : args.inquiryId ? "INQUIRY" : "CRM",
    sourceExternalId: `customer_portal_action:${args.actionId}`,
    eventType: args.eventType,
    entityType,
    entityId,
    actorType: "customer_portal_user",
    actorId: args.portalUserId,
    occurredAt: new Date(),
    payloadVersion: 1,
    payload: {
      actionId: args.actionId,
      companyId: args.companyId,
      jobId: args.jobId ?? null,
      inquiryId: args.inquiryId ?? null,
      ...args.payload,
    },
    provenance: {
      source: "customer_portal",
      operation: args.eventType,
      path: "src/lib/customer-portal-actions.ts",
      function: "recordPortalActionMemory",
      sourceRecordId: args.actionId,
      actorType: "customer_portal_user",
      actorId: args.portalUserId,
    },
    idempotencyKey: `customer_portal_action:${args.actionId}:${args.eventType}`,
  }).catch(() => null);
}

export async function submitCustomerQuoteResponse(args: {
  principal: CustomerPortalPrincipal;
  companyId: string;
  jobId: string;
  type: QuoteActionType;
  message?: string | null;
}) {
  const membership = membershipFor(args.principal, args.companyId);
  if (!membership || !QUOTE_ACTION_TYPES.includes(args.type)) {
    return { ok: false as const, error: "not_allowed" as const };
  }
  const message = args.message?.trim().slice(0, 2000) || null;
  if (args.type === "QUOTE_CHANGES_REQUESTED" && !message) {
    return { ok: false as const, error: "message_required" as const };
  }

  const job = await prisma.job.findFirst({
    where: {
      id: args.jobId,
      officeId: args.principal.officeId,
      companyId: args.companyId,
      status: "QUOTED",
    },
    select: { id: true, reference: true, inquiryId: true, quoteLines: true },
  });
  if (!job?.quoteLines) return { ok: false as const, error: "quote_unavailable" as const };

  const existing = await prisma.customerPortalAction.findFirst({
    where: {
      officeId: args.principal.officeId,
      companyId: args.companyId,
      jobId: job.id,
      type: { in: [...QUOTE_ACTION_TYPES] },
      status: { in: ["PENDING", "ACKNOWLEDGED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  const action = existing
    ? await prisma.customerPortalAction.update({
        where: { id: existing.id },
        data: {
          type: args.type,
          status: "PENDING",
          message,
          portalUserId: args.principal.id,
          payload: { reference: job.reference, notBookedAutomatically: true },
        },
      })
    : await prisma.customerPortalAction.create({
        data: {
          officeId: args.principal.officeId,
          companyId: args.companyId,
          jobId: job.id,
          inquiryId: job.inquiryId,
          portalUserId: args.principal.id,
          type: args.type,
          message,
          payload: { reference: job.reference, notBookedAutomatically: true },
        },
      });

  await recordPortalActionMemory({
    actionId: action.id,
    officeId: args.principal.officeId,
    companyId: args.companyId,
    jobId: job.id,
    inquiryId: job.inquiryId,
    portalUserId: args.principal.id,
    eventType: args.type === "QUOTE_ACCEPTED"
      ? "customer_portal.quote_accepted"
      : "customer_portal.quote_changes_requested",
    payload: { reference: job.reference, message, operationalStatusChanged: false },
  });
  return { ok: true as const, actionId: action.id };
}

export async function uploadCustomerPortalDocument(args: {
  principal: CustomerPortalPrincipal;
  companyId: string;
  jobId: string;
  documentId: string;
  file: File;
}) {
  const membership = membershipFor(args.principal, args.companyId);
  if (!membership) return { ok: false as const, error: "not_allowed" as const };
  if (!(args.file instanceof File) || args.file.size === 0) {
    return { ok: false as const, error: "file_required" as const };
  }
  const maxBytes = 25 * 1024 * 1024;
  if (args.file.size > maxBytes) return { ok: false as const, error: "file_too_large" as const };

  const document = await prisma.jobDocument.findFirst({
    where: {
      id: args.documentId,
      officeId: args.principal.officeId,
      jobId: args.jobId,
      customerRequested: true,
      job: { companyId: args.companyId },
    },
    select: { id: true, jobId: true, name: true, docType: true },
  });
  if (!document) return { ok: false as const, error: "document_not_found" as const };

  const stored = await storeJobDocumentFile({
    officeId: args.principal.officeId,
    jobId: args.jobId,
    preferredName: args.file.name || document.name,
    bytes: Buffer.from(await args.file.arrayBuffer()),
    contentType: args.file.type || null,
  });

  const action = await prisma.$transaction(async (tx) => {
    await tx.jobDocument.update({
      where: { id: document.id },
      data: {
        url: stored.url,
        status: "UPLOADED",
        uploadedByUserId: null,
        uploadedByPortalUserId: args.principal.id,
        customerVisible: false,
        aiSummary: null,
        aiFlags: null,
        aiKeyFields: null,
        aiAnalyzedAt: null,
      },
    });
    return tx.customerPortalAction.create({
      data: {
        officeId: args.principal.officeId,
        companyId: args.companyId,
        jobId: args.jobId,
        portalUserId: args.principal.id,
        type: "DOCUMENT_UPLOADED",
        payload: {
          documentId: document.id,
          documentName: document.name,
          fileName: args.file.name,
          contentType: args.file.type || null,
          size: args.file.size,
          requiresOperatorApproval: true,
        },
      },
    });
  });

  await recordPortalActionMemory({
    actionId: action.id,
    officeId: args.principal.officeId,
    companyId: args.companyId,
    jobId: args.jobId,
    portalUserId: args.principal.id,
    eventType: "customer_portal.document_uploaded",
    payload: {
      documentId: document.id,
      documentName: document.name,
      fileName: args.file.name,
      contentType: args.file.type || null,
      size: args.file.size,
      customerVisible: false,
    },
  });
  return { ok: true as const, actionId: action.id };
}
