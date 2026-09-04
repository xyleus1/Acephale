import "server-only";

import { prisma } from "@/lib/prisma";
import { procurementWorkflowDatabase } from "@/lib/procurement-workflow";

// The lifecycle status of a sourcing request used to be written only by the
// external procurement worker, so a request the application sourced itself sat
// on its submitted status while suppliers were being found and contacted, and
// the customer portal read that as nothing happening. Derya now writes it from
// the progress it already detects. The ladder is fixed and forward only, and
// the three statuses below are the only ones the automation may set: placing,
// cancelling and flagging a request stay with the operator.

export type ProcurementOrderProgressEvent =
  | "supplier_discovered"
  | "rfq_sent"
  | "quote_recorded";

export type ProcurementOrderProgressFacts = {
  vendors: number;
  contacted: number;
  quoted: number;
};

export const PROCUREMENT_ORDER_STATUS_LADDER: Record<string, number> = {
  new: 0,
  researching: 1,
  // The worker's shortlist review is not a stage Derya produces, so it ranks
  // with research: a request parked there advances once an RFQ goes out.
  awaiting_shortlist_approval: 1,
  sourcing: 2,
  awaiting_order_approval: 3,
  ordered: 4,
};

const EVENT_STATUS: Record<ProcurementOrderProgressEvent, string> = {
  supplier_discovered: "researching",
  rfq_sent: "sourcing",
  // A recorded quote is a decision waiting for the operator, not a completed
  // order: the supplier choice and the spend are still theirs.
  quote_recorded: "awaiting_order_approval",
};

export function procurementOrderProgressEventForFacts(
  facts: ProcurementOrderProgressFacts,
): ProcurementOrderProgressEvent | null {
  if (facts.quoted > 0) return "quote_recorded";
  if (facts.contacted > 0) return "rfq_sent";
  if (facts.vendors > 0) return "supplier_discovered";
  return null;
}

// The status the event would move the request to, or null when the request is
// already at or past it, or sits outside the ladder because it was cancelled,
// completed or flagged for attention. Pure, so callers and tests can reason
// about the ladder without a database.
export function nextProcurementOrderStatus(
  currentStatus: string | null | undefined,
  event: ProcurementOrderProgressEvent,
): string | null {
  const target = EVENT_STATUS[event];
  const current = currentStatus?.trim() ?? "";
  const currentRank = PROCUREMENT_ORDER_STATUS_LADDER[current];
  if (typeof currentRank !== "number") return null;
  return PROCUREMENT_ORDER_STATUS_LADDER[target] > currentRank ? target : null;
}

// The dashboard role holds no update privilege on the order table, so the write
// goes through the tenant scoped database function, which re-checks the customer
// and the ladder itself. Sourcing progress must never fail because the status
// could not be written, so this reports the outcome and swallows the error.
export async function advanceProcurementOrderStatus(
  args: {
    customerId: string;
    orderId: string;
    event: ProcurementOrderProgressEvent;
  },
  dependencies?: {
    database?: {
      $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
    };
  },
): Promise<string | null> {
  const target = EVENT_STATUS[args.event];
  try {
    const database = dependencies?.database ?? procurementWorkflowDatabase();
    const rows = await database.$queryRawUnsafe<Array<{ status: string | null }>>(
      "SELECT advance_order_status($1::uuid, $2::uuid, $3::text) AS status",
      args.customerId,
      args.orderId,
      target,
    );
    return rows[0]?.status ?? null;
  } catch (error) {
    console.warn("procurement order status advance failed", {
      orderId: args.orderId,
      event: args.event,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return null;
  }
}

export async function reconcileProcurementOrderStatus(
  args: { customerId: string; orderId: string; officeId: string },
  dependencies?: {
    database?: {
      $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
    };
    advance?: typeof advanceProcurementOrderStatus;
    countRecordedSends?: (officeId: string, orderId: string) => Promise<number>;
  },
): Promise<string | null> {
  try {
    const database = dependencies?.database ?? procurementWorkflowDatabase();
    const rows = await database.$queryRawUnsafe<Array<ProcurementOrderProgressFacts>>(`
      SELECT
        count(*)::int AS "vendors",
        count(*) FILTER (
          WHERE coalesce(
            NULLIF(to_jsonb(order_vendors)->>'last_email_message_id', ''),
            NULLIF(to_jsonb(order_vendors)->>'gmail_message_id', '')
          ) IS NOT NULL
        )::int AS "contacted",
        count(*) FILTER (
          WHERE jsonb_typeof(to_jsonb(order_vendors)->'quote') = 'object'
            AND to_jsonb(order_vendors)->'quote' <> '{}'::jsonb
        )::int AS "quoted"
      FROM order_vendors
      WHERE order_vendors.order_id = $1::uuid
    `, args.orderId);
    const facts = rows[0] ?? { vendors: 0, contacted: 0, quoted: 0 };
    const countRecordedSends = dependencies?.countRecordedSends ?? (async (
      officeId: string,
      orderId: string,
    ) => prisma.emailSenderReservation.count({
      where: {
        officeId,
        status: "RECORDED",
        idempotencyKey: { startsWith: `procurement-bulk-rfq:${orderId}:` },
      },
    }));
    const recordedSends = await countRecordedSends(args.officeId, args.orderId);
    const event = procurementOrderProgressEventForFacts({
      ...facts,
      contacted: Math.max(facts.contacted, recordedSends),
    });
    if (!event) return null;
    const advance = dependencies?.advance ?? advanceProcurementOrderStatus;
    return await advance({
      customerId: args.customerId,
      orderId: args.orderId,
      event,
    }, { database });
  } catch (error) {
    console.warn("procurement order status advance failed", {
      orderId: args.orderId,
      event: "reconcile",
      message: error instanceof Error ? error.message : "unknown error",
    });
    return null;
  }
}
