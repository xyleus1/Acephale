import "server-only";

import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import {
  getProcurementFileDeliveryDraft,
  procurementFileDraftCurrentStateKey,
  saveProcurementFileDeliveryDraft,
} from "@/lib/procurement-file-delivery-draft";
import {
  eligibleFileDraftTargets,
  fileDraftSkipReason,
  type FileDraftTarget,
} from "@/lib/procurement-file-draft-selection";
import {
  procurementReplyFacts,
  supplierInboundKind,
  triageSupplierInbound,
} from "@/lib/procurement-inbound-triage";
import { stripEmDashes } from "@/lib/no-em-dash";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import { rotateAutopilotQueue } from "@/lib/procurement-autopilot-plan";
import { procurementRepliedVendors } from "@/lib/procurement-reply-scope";
import { getProcurementRequest, type ProcurementOrderDetail } from "@/lib/procurement-workflow";

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
  bestEffort: boolean;
  // The request state a fresh draft would repeat, read once per run. Null when
  // it cannot be computed, in which case draft staleness is left to the other
  // signals and the send path still refuses what it cannot recheck.
  currentStateKey: string | null;
}): Promise<(FileDraftTarget & { answers: string[] }) | null> {
  const conversation = await procurementVendorConversation({
    officeId: args.officeId,
    customerId: args.customerId,
    orderId: args.order.id,
    vendorId: args.vendorId,
  });
  const latest = conversation.messages.at(-1);
  if (!latest || latest.direction !== "INBOUND") return null;
  const inboundKind = supplierInboundKind(latest.subject ?? "", latest.body);
  // Under best effort a question the request answers only partly still gets an
  // answer, so the reply carries it. The caller chooses that mode; a plain run
  // answers only what the request actually records.
  const triage = triageSupplierInbound({
    subject: latest.subject ?? null,
    body: latest.body,
    facts: procurementReplyFacts(args.order),
    bestEffort: args.bestEffort,
  });
  const existing = await getProcurementFileDeliveryDraft({
    officeId: args.officeId,
    order: args.order,
    vendorId: args.vendorId,
  });
  const answers = triage.answered.map((entry) => entry.answer);
  // A draft saved before these answers existed would go out without them, so it
  // counts as stale even on the same supplier message. The saved body is em dash
  // stripped and length capped, so the comparison runs on the same canonical
  // text and ignores answers the cap would have cut anyway.
  const savedBody = stripEmDashes(existing?.body ?? "");
  const missesAnswers = answers.length > 0
    && !answers.every((answer) => savedBody.includes(stripEmDashes(answer)));
  // The request itself can move after a draft is saved: quantity, needed by
  // date, specification, or the stored file set. The send path refuses such a
  // draft, so it is redrafted here rather than left to be refused later.
  const staleState = Boolean(existing)
    && args.currentStateKey != null
    && existing?.stateKey !== args.currentStateKey;
  return {
    vendorId: args.vendorId,
    vendorName: args.vendorName,
    recipient: latest.fromEmail,
    sourceMessageId: latest.id,
    conversationSubject: latest.subject ?? null,
    inboundKind,
    hasDraft: Boolean(existing),
    staleDraft: Boolean(existing) && (existing?.sourceMessageId !== latest.id || missesAnswers || staleState),
    skipReason: fileDraftSkipReason(inboundKind),
    answers,
  };
}

async function draftTargets(
  context: NonNullable<Awaited<ReturnType<typeof loadContext>>>,
  bestEffort: boolean,
  outOfTime?: () => boolean,
  rotateFrom?: number,
  // Conversations waiting out their own backoff after a failed draft. Drafting
  // is a retry too, so a thread that keeps refusing to draft is left alone
  // until its next attempt is due instead of holding the batch every pass.
  skipVendorIds?: ReadonlySet<string>,
) {
  const targets: Array<FileDraftTarget & { answers: string[] }> = [];
  const access = await procurementOperatorAccess(context.summary.officeId);
  const currentStateKey = await procurementFileDraftCurrentStateKey({
    context: access,
    order: context.order,
  }).catch(() => null);
  // Walking every supplier row costs one conversation read each, which on a
  // large campaign runs past the invocation limit before the repliers at the
  // end are ever reached. Only a supplier that answered can hold a reply to
  // draft against, so the scan is proportional to the replies received.
  const replied = await procurementRepliedVendors({
    officeId: context.summary.officeId,
    orderId: context.summary.orderId,
    vendors: skipVendorIds?.size
      ? context.order.vendors.filter((vendor) => !skipVendorIds.has(vendor.id))
      : context.order.vendors,
    outOfTime,
  });
  // The read itself rotates, not only the targets it produced: a scan the
  // deadline cuts short would otherwise read the same prefix of repliers on
  // every pass, so the repliers past the cut would never become targets, never
  // be drafted, and so never be answered.
  const ordered = typeof rotateFrom === "number"
    ? rotateAutopilotQueue(replied.vendors, rotateFrom)
    : replied.vendors;
  for (const vendor of ordered) {
    // Reading a thread is a bounded unit like writing a draft, so the selection
    // stops at the deadline too rather than spending the invocation before a
    // single draft is written. What it did not reach is a candidate next pass.
    if (outOfTime?.()) break;
    const target = await vendorTarget({
      officeId: context.summary.officeId,
      customerId: context.summary.customerId,
      order: context.order,
      vendorId: vendor.id,
      vendorName: vendor.name,
      bestEffort,
      currentStateKey,
    });
    if (target) targets.push(target);
  }
  return targets;
}

export async function listProcurementFileDraftTargets(orderId: string, options: { bestEffort?: boolean } = {}) {
  const context = await loadContext(orderId);
  if (!context) return null;
  return { order: context.summary, targets: await draftTargets(context, options.bestEffort === true) };
}

export async function runProcurementFileDraftBatch(args: {
  orderId: string;
  limit?: number;
  redraft?: boolean;
  bestEffort?: boolean;
  // Writing one draft is a bounded unit of work, and a scheduled caller has a
  // function limit to return inside, so the batch stops between drafts instead
  // of running that limit out. The drafts it did not write are candidates again
  // on the next pass.
  outOfTime?: () => boolean;
  // A scheduled caller passes the time its pass started. The repliers are then
  // read in an order rotated by window, so a target that fails on every attempt,
  // or a batch that never fits, cannot hold the same first replies forever while
  // later ones are never drafted at all.
  rotateFrom?: number;
  // Conversations held back by their own conversation task backoff.
  skipVendorIds?: ReadonlySet<string>;
}): Promise<FileDraftRunResult | null> {
  const context = await loadContext(args.orderId);
  if (!context) return null;
  const targets = await draftTargets(
    context,
    args.bestEffort === true,
    args.outOfTime,
    args.rotateFrom,
    args.skipVendorIds,
  );
  const access = await procurementOperatorAccess(context.summary.officeId);
  const limit = Math.min(FILE_DRAFT_MAX_PER_RUN, Math.max(1, Math.trunc(args.limit ?? FILE_DRAFT_MAX_PER_RUN)));
  // Rotation is applied once, on the reads inside `draftTargets`, and the
  // eligible targets keep that order: rotating the same window twice would
  // cancel itself out on some queue lengths and leave a replier undrafted for
  // good, which is what a second rotation here used to do.
  const eligible = eligibleFileDraftTargets(targets, { redraft: args.redraft });
  const batch = eligible.slice(0, limit);
  const outcomes: FileDraftOutcome[] = [];
  for (const target of batch) {
    if (args.outOfTime?.()) break;
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
        answers: target.answers,
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
