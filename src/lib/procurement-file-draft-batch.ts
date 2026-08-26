import "server-only";

import { prisma } from "@/lib/prisma";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import {
  getProcurementFileDeliveryDraft,
  saveProcurementFileDeliveryDraft,
} from "@/lib/procurement-file-delivery-draft";
import {
  eligibleFileDraftTargets,
  fileDraftSkipReason,
  type FileDraftTarget,
} from "@/lib/procurement-file-draft-selection";
import { supplierInboundKind } from "@/lib/procurement-inbound-triage";
import { getProcurementRequest, type ProcurementOrderDetail } from "@/lib/procurement-workflow";
import { SupplyPersistenceError, type SupplyAccessContext } from "@/lib/supply-os/persistence";

// Suppliers that replied to the RFQ campaign asked for the technical package.
// This module walks those conversations from an operator command instead of the
// dashboard, and only ever saves drafts: no provider is contacted here.

export const FILE_DRAFT_MAX_PER_RUN = 25;

export type FileDraftOutcome = {
  vendorId: string;
  vendorName: string;
  recipient: string;
  state: "DRAFTED" | "FAILED";
  attachments: string[];
  withheld: Array<{ name: string; reason: string }>;
  error: string | null;
};

export type FileDraftRunResult = {
  orderId: string;
  material: string;
  candidates: number;
  drafted: number;
  skipped: number;
  failed: number;
  remaining: number;
  outcomes: FileDraftOutcome[];
};

// Drafting writes an execution task and a supply event, both of which record an
// acting user, so the batch runs as the office operator who owns the request.
async function operatorAccessContext(officeId: string): Promise<SupplyAccessContext> {
  const user = await prisma.user.findFirst({
    where: {
      officeId,
      isActive: true,
      customerPortalIdentity: null,
      OR: [{ role: "ADMIN" }, { role: "MANAGER" }, { canViewWholeOffice: true }],
    },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true, role: true, canViewWholeOffice: true },
  });
  if (!user) {
    throw new SupplyPersistenceError("This office has no active operator who can draft supplier replies.", "forbidden");
  }
  return {
    officeId,
    userId: user.id,
    role: user.role,
    canViewWholeOffice: user.canViewWholeOffice,
    accessKind: "operator",
  };
}

async function loadContext(orderId: string) {
  const summary = await loadBulkRfqOrder(orderId);
  if (!summary) return null;
  const order = await getProcurementRequest(summary.customerId, orderId);
  if (!order) return null;
  return { summary, order };
}

async function vendorTarget(args: {
  officeId: string;
  customerId: string;
  order: ProcurementOrderDetail;
  vendorId: string;
  vendorName: string;
}): Promise<FileDraftTarget | null> {
  const conversation = await procurementVendorConversation({
    officeId: args.officeId,
    customerId: args.customerId,
    orderId: args.order.id,
    vendorId: args.vendorId,
  });
  const latest = conversation.messages.at(-1);
  if (!latest || latest.direction !== "INBOUND") return null;
  const inboundKind = supplierInboundKind(latest.subject ?? "", latest.body);
  const existing = await getProcurementFileDeliveryDraft({
    officeId: args.officeId,
    order: args.order,
    vendorId: args.vendorId,
  });
  return {
    vendorId: args.vendorId,
    vendorName: args.vendorName,
    recipient: latest.fromEmail,
    sourceMessageId: latest.id,
    conversationSubject: latest.subject ?? null,
    inboundKind,
    hasDraft: Boolean(existing),
    skipReason: fileDraftSkipReason(inboundKind),
  };
}

async function draftTargets(context: NonNullable<Awaited<ReturnType<typeof loadContext>>>) {
  const targets: FileDraftTarget[] = [];
  for (const vendor of context.order.vendors) {
    const target = await vendorTarget({
      officeId: context.summary.officeId,
      customerId: context.summary.customerId,
      order: context.order,
      vendorId: vendor.id,
      vendorName: vendor.name,
    });
    if (target) targets.push(target);
  }
  return targets;
}

export async function listProcurementFileDraftTargets(orderId: string) {
  const context = await loadContext(orderId);
  if (!context) return null;
  return { order: context.summary, targets: await draftTargets(context) };
}

export async function runProcurementFileDraftBatch(args: {
  orderId: string;
  limit?: number;
  redraft?: boolean;
}): Promise<FileDraftRunResult | null> {
  const context = await loadContext(args.orderId);
  if (!context) return null;
  const targets = await draftTargets(context);
  const access = await operatorAccessContext(context.summary.officeId);
  const limit = Math.min(FILE_DRAFT_MAX_PER_RUN, Math.max(1, Math.trunc(args.limit ?? FILE_DRAFT_MAX_PER_RUN)));
  const eligible = eligibleFileDraftTargets(targets, { redraft: args.redraft });
  const batch = eligible.slice(0, limit);
  const outcomes: FileDraftOutcome[] = [];
  for (const target of batch) {
    const vendor = context.order.vendors.find((candidate) => candidate.id === target.vendorId);
    if (!vendor) continue;
    try {
      const draft = await saveProcurementFileDeliveryDraft({
        context: access,
        customerId: context.summary.customerId,
        order: context.order,
        vendor,
        sourceMessageId: target.sourceMessageId,
        recipient: target.recipient,
        conversationSubject: target.conversationSubject,
      });
      outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.vendorName,
        recipient: target.recipient,
        state: "DRAFTED",
        attachments: draft.attachments.map((attachment) => attachment.name),
        withheld: draft.withheld,
        error: null,
      });
    } catch (error) {
      outcomes.push({
        vendorId: target.vendorId,
        vendorName: target.vendorName,
        recipient: target.recipient,
        state: "FAILED",
        attachments: [],
        withheld: [],
        error: error instanceof Error ? error.message : "The supplier file draft failed.",
      });
    }
  }
  const drafted = outcomes.filter((outcome) => outcome.state === "DRAFTED").length;
  const failed = outcomes.filter((outcome) => outcome.state === "FAILED").length;
  return {
    orderId: context.summary.orderId,
    material: context.summary.material,
    candidates: eligible.length,
    drafted,
    skipped: targets.filter((target) => target.skipReason).length,
    failed,
    remaining: Math.max(0, eligible.length - drafted),
    outcomes,
  };
}
