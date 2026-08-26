import "server-only";

import {
  autopilotEscalations,
  autopilotRequestStage,
  planAutopilotVendorAction,
  type AutopilotAction,
  type AutopilotStage,
  type AutopilotVendorState,
} from "@/lib/procurement-autopilot-plan";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import { getProcurementFileDeliveryDraft } from "@/lib/procurement-file-delivery-draft";
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
  sent: number;
  alreadySent: number;
  failed: number;
  failures: Array<{ vendorId: string; vendorName: string; error: string }>;
  autoSend: boolean;
  escalations: Array<{ vendorId: string; vendorName: string; reason: string }>;
  plan: AutopilotVendorPlan[];
};

async function vendorStates(args: {
  officeId: string;
  customerId: string;
  order: ProcurementOrderDetail;
}): Promise<AutopilotVendorState[]> {
  const facts = procurementReplyFacts({
    material: args.order.material,
    quantity: args.order.quantity,
    unit: args.order.unit,
    neededBy: args.order.neededBy,
    specification: args.order.specification,
    requestContext: args.order.requestContext,
  });
  const states: AutopilotVendorState[] = [];
  for (const vendor of args.order.vendors) {
    const conversation = await procurementVendorConversation({
      officeId: args.officeId,
      customerId: args.customerId,
      orderId: args.order.id,
      vendorId: vendor.id,
    });
    const latest = conversation.messages.at(-1);
    const inbound = latest?.direction === "INBOUND" ? latest : null;
    const triage = inbound
      ? triageSupplierInbound({ subject: inbound.subject ?? null, body: inbound.body, facts })
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
    });
  }
  return states;
}

export async function runProcurementAutopilot(args: {
  orderId: string;
  autoSend?: boolean;
  limit?: number;
}): Promise<AutopilotRunResult | null> {
  const summary = await loadBulkRfqOrder(args.orderId);
  if (!summary) return null;
  const limit = Math.min(AUTOPILOT_MAX_PER_RUN, Math.max(1, Math.trunc(args.limit ?? AUTOPILOT_MAX_PER_RUN)));
  const autoSend = args.autoSend === true;
  const draftRun = await runProcurementFileDraftBatch({ orderId: args.orderId, limit });
  if (!draftRun) return null;
  const order = await getProcurementRequest(summary.customerId, args.orderId);
  if (!order) return null;
  const states = await vendorStates({
    officeId: summary.officeId,
    customerId: summary.customerId,
    order,
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
  const deliverable = plan
    .filter((entry) => entry.action.kind === "SEND_DRAFT")
    .map((entry) => entry.vendorId);
  const sendRun = autoSend && deliverable.length
    ? await runProcurementFileDraftSendBatch({ orderId: args.orderId, limit, vendorIds: deliverable })
    : null;
  const quotes = states.filter((state) => state.hasQuote).length;
  return {
    orderId: summary.orderId,
    material: summary.material,
    stage: autopilotRequestStage({ quotes }),
    quotes,
    replied: states.filter((state) => state.lastDirection === "INBOUND").length,
    drafted: draftRun.drafted,
    sent: sendRun?.sent ?? 0,
    alreadySent: sendRun?.alreadySent ?? 0,
    failed: sendRun?.failed ?? 0,
    // A delivery that fails needs an operator, so it is reported next to the
    // escalations instead of being reduced to a count.
    failures: (sendRun?.outcomes ?? [])
      .filter((outcome) => outcome.state === "FAILED")
      .map((outcome) => ({
        vendorId: outcome.vendorId,
        vendorName: outcome.vendorName,
        error: outcome.error ?? "The supplier send failed.",
      })),
    autoSend,
    escalations: autopilotEscalations(plan),
    plan,
  };
}
