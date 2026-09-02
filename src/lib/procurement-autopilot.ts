import "server-only";

import {
  autopilotEscalations,
  autopilotFailures,
  autopilotRequestStage,
  planAutopilotVendorAction,
  type AutopilotAction,
  type AutopilotStage,
  type AutopilotVendorState,
} from "@/lib/procurement-autopilot-plan";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import {
  getProcurementFileDeliveryDraft,
  saveProcurementFileDeliveryDraft,
} from "@/lib/procurement-file-delivery-draft";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import { chasesSentAfterLastReply } from "@/lib/procurement-supplier-chase";
import {
  listSupplierNudgeTargets,
  runProcurementSupplierNudges,
} from "@/lib/procurement-supplier-nudge";
import { sweepSupplierQuoteCapture } from "@/lib/procurement-supplier-quote";
import { runProcurementFileDraftBatch } from "@/lib/procurement-file-draft-batch";
import { runProcurementFileDraftSendBatch } from "@/lib/procurement-file-draft-send";
import { procurementReplyFacts, triageSupplierInbound } from "@/lib/procurement-inbound-triage";
import {
  getProcurementRequest,
  procurementWorkflowDatabase,
  type ProcurementOrderDetail,
} from "@/lib/procurement-workflow";

// One pass of the sourcing loop for a single request: read every supplier
// thread, draft the replies the stored request files answer, deliver them when
// the operator turned sending on, and report everything a human has to decide.
// Every reply is built from the request's own linked documents, so a follow up
// carries the same screened files and the same derived facts the first reply
// did, without an operator restating the context.

export const AUTOPILOT_MAX_PER_RUN = 25;
export const AUTOPILOT_MAX_ORDERS_PER_RUN = 10;

// Only requests that already reached suppliers can have a supplier thread to
// work, and a closed request is never touched again.
export async function listAutopilotOrderIds(limit = AUTOPILOT_MAX_ORDERS_PER_RUN): Promise<string[]> {
  const bounded = Math.min(AUTOPILOT_MAX_ORDERS_PER_RUN, Math.max(1, Math.trunc(limit)));
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<Array<{ orderId: string }>>(`
    SELECT DISTINCT orders.id AS "orderId", orders.created_at
    FROM orders
    JOIN order_vendors
      ON order_vendors.order_id = orders.id
      AND order_vendors.last_email_message_id IS NOT NULL
    WHERE orders.status NOT IN ('ordered', 'cancelled')
    ORDER BY orders.created_at ASC, orders.id ASC
    LIMIT ${bounded}
  `);
  return rows.map((row) => row.orderId);
}

export type AutopilotVendorPlan = {
  vendorId: string;
  vendorName: string;
  state: AutopilotVendorState;
  action: AutopilotAction;
};

export type AutopilotRunResult = {
  orderId: string;
  material: string;
  stage: AutopilotStage;
  quotes: number;
  replied: number;
  drafted: number;
  chased: number;
  // A supplier that never answered the first RFQ cannot be chased through the
  // reply path, so those follow ups are counted separately.
  nudgeCandidates: number;
  nudged: number;
  // Quotes read out of supplier replies during this pass, so a request can
  // reach a purchase order without an operator retyping a price.
  quotesRecorded: number;
  sent: number;
  alreadySent: number;
  failed: number;
  failures: Array<{ vendorId: string; vendorName: string; error: string }>;
  autoSend: boolean;
  escalations: Array<{ vendorId: string; vendorName: string; reason: string }>;
  plan: AutopilotVendorPlan[];
};

// What a chase has to be built from: the supplier's newest reply anchors the
// follow up, exactly as the first answer was anchored.
type ChaseAnchor = {
  sourceMessageId: string;
  recipient: string;
  conversationSubject: string | null;
};

async function vendorStates(args: {
  officeId: string;
  customerId: string;
  order: ProcurementOrderDetail;
  // Best effort answers every question the request can speak to, so only price,
  // terms, and legal questions are left for the operator.
  bestEffort?: boolean;
}): Promise<{ states: AutopilotVendorState[]; anchors: Map<string, ChaseAnchor> }> {
  const facts = procurementReplyFacts({
    material: args.order.material,
    quantity: args.order.quantity,
    unit: args.order.unit,
    neededBy: args.order.neededBy,
    specification: args.order.specification,
    requestContext: args.order.requestContext,
  });
  const states: AutopilotVendorState[] = [];
  const anchors = new Map<string, ChaseAnchor>();
  for (const vendor of args.order.vendors) {
    const conversation = await procurementVendorConversation({
      officeId: args.officeId,
      customerId: args.customerId,
      orderId: args.order.id,
      vendorId: vendor.id,
    });
    const latest = conversation.messages.at(-1);
    const inbound = latest?.direction === "INBOUND" ? latest : null;
    const newestReply = [...conversation.messages].reverse().find((message) => message.direction === "INBOUND") ?? null;
    if (newestReply) {
      anchors.set(vendor.id, {
        sourceMessageId: newestReply.id,
        recipient: newestReply.fromEmail,
        conversationSubject: newestReply.subject ?? null,
      });
    }
    const triage = inbound
      ? triageSupplierInbound({
        subject: inbound.subject ?? null,
        body: inbound.body,
        facts,
        bestEffort: args.bestEffort,
      })
      : null;
    const draft = await getProcurementFileDeliveryDraft({
      officeId: args.officeId,
      order: args.order,
      vendorId: vendor.id,
    });
    states.push({
      vendorId: vendor.id,
      vendorName: vendor.name,
      lastDirection: latest?.direction ?? null,
      inboundKind: triage?.kind ?? null,
      triageDecision: triage?.decision ?? null,
      hasDraft: Boolean(draft),
      hasQuote: Boolean(vendor.quote),
      lastMessageAt: latest?.sentAt ?? null,
      chasesSent: chasesSentAfterLastReply(conversation.messages),
    });
  }
  return { states, anchors };
}

// A supplier that answered once and then went quiet gets the same files again
// on the same thread. The draft is saved first either way, so an operator sees
// exactly what a chase would say before sending is ever turned on.
async function draftChases(args: {
  officeId: string;
  customerId: string;
  order: ProcurementOrderDetail;
  vendorIds: readonly string[];
  anchors: Map<string, ChaseAnchor>;
}) {
  const drafted: string[] = [];
  const failures: AutopilotRunResult["failures"] = [];
  if (!args.vendorIds.length) return { drafted, failures };
  const access = await procurementOperatorAccess(args.officeId);
  for (const vendorId of args.vendorIds) {
    const vendor = args.order.vendors.find((candidate) => candidate.id === vendorId);
    const anchor = args.anchors.get(vendorId);
    if (!vendor || !anchor) continue;
    try {
      await saveProcurementFileDeliveryDraft({
        context: access,
        customerId: args.customerId,
        order: args.order,
        vendor,
        sourceMessageId: anchor.sourceMessageId,
        recipient: anchor.recipient,
        conversationSubject: anchor.conversationSubject,
        variant: "CHASE",
      });
      drafted.push(vendorId);
    } catch (error) {
      failures.push({
        vendorId,
        vendorName: vendor.name,
        error: error instanceof Error ? error.message : "The supplier follow up draft failed.",
      });
    }
  }
  return { drafted, failures };
}

export async function runProcurementAutopilot(args: {
  orderId: string;
  autoSend?: boolean;
  bestEffort?: boolean;
  limit?: number;
}): Promise<AutopilotRunResult | null> {
  const summary = await loadBulkRfqOrder(args.orderId);
  if (!summary) return null;
  const limit = Math.min(AUTOPILOT_MAX_PER_RUN, Math.max(1, Math.trunc(args.limit ?? AUTOPILOT_MAX_PER_RUN)));
  const autoSend = args.autoSend === true;
  // A priced answer is worth nothing until it is recorded against the supplier,
  // because the request reads its quotes, not its inbox. Recording mails nobody,
  // so it runs in draft only passes too and only writes supplier stated facts.
  // The send limit does not bound reading, so a pass looks at every respondent
  // it can afford rather than rereading the same first few every time. It runs
  // before the plan so a supplier whose newest reply is a quote is read as
  // quoted in this same pass and is neither chased nor answered.
  // The sweep carries its own cursor across pages, so a request whose first
  // pages of respondents stay unquoted cannot hide the priced replies behind
  // them from every later pass.
  const quoteRun = await sweepSupplierQuoteCapture({ orderId: args.orderId });
  const draftRun = await runProcurementFileDraftBatch({
    orderId: args.orderId,
    limit,
    bestEffort: args.bestEffort,
  });
  if (!draftRun) return null;
  const order = await getProcurementRequest(summary.customerId, args.orderId);
  if (!order) return null;
  const { states, anchors } = await vendorStates({
    officeId: summary.officeId,
    customerId: summary.customerId,
    order,
    bestEffort: args.bestEffort,
  });
  const plan = states.map((state) => ({
    vendorId: state.vendorId,
    vendorName: state.vendorName,
    state,
    action: planAutopilotVendorAction(state, { autoSend }),
  }));
  // Drafts exist for threads the plan escalates, so delivery is restricted to
  // the suppliers the plan chose. The plan is therefore computed before the
  // send, never after it.
  const chaseRun = await draftChases({
    officeId: summary.officeId,
    customerId: summary.customerId,
    order,
    vendorIds: plan.filter((entry) => entry.action.kind === "CHASE").map((entry) => entry.vendorId),
    anchors,
  });
  const deliverable = [
    ...plan.filter((entry) => entry.action.kind === "SEND_DRAFT").map((entry) => entry.vendorId),
    ...chaseRun.drafted,
  ];
  // Suppliers that never replied have no inbound message to answer, so their
  // follow up rides on our own RFQ thread instead of being silently skipped.
  const nudgeRun = autoSend
    ? await runProcurementSupplierNudges({ orderId: args.orderId, limit })
    : null;
  const nudgePlan = nudgeRun
    ? null
    : await listSupplierNudgeTargets({ order: summary, limit });
  const sendRun = autoSend && deliverable.length
    ? await runProcurementFileDraftSendBatch({ orderId: args.orderId, limit, vendorIds: deliverable })
    : null;
  // Quotes recorded earlier in this pass are already on the vendor rows the
  // plan was built from, so counting the states counts them once.
  const quotes = states.filter((state) => state.hasQuote).length;
  return {
    orderId: summary.orderId,
    material: summary.material,
    stage: autopilotRequestStage({ quotes }),
    quotes,
    replied: states.filter((state) => state.lastDirection === "INBOUND").length,
    drafted: draftRun.drafted,
    chased: chaseRun.drafted.length,
    nudgeCandidates: nudgeRun?.candidates ?? nudgePlan?.targets.length ?? 0,
    nudged: nudgeRun?.sent ?? 0,
    quotesRecorded: quoteRun?.recorded ?? 0,
    sent: sendRun?.sent ?? 0,
    alreadySent: sendRun?.alreadySent ?? 0,
    // Both delivery paths count toward one failure total, so a run where every
    // follow up failed cannot report zero.
    failed: (sendRun?.failed ?? 0) + (nudgeRun?.failed ?? 0) + (quoteRun?.failed ?? 0),
    // A delivery that fails needs an operator, so it is reported next to the
    // escalations instead of being reduced to a count. A quote that cannot be
    // written counts too, since it leaves a priced reply invisible.
    failures: autopilotFailures({
      chase: chaseRun.failures,
      nudge: nudgeRun?.outcomes,
      send: sendRun?.outcomes,
      quote: quoteRun?.outcomes,
    }),
    autoSend,
    escalations: autopilotEscalations(plan),
    plan,
  };
}
