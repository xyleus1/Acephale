import type { ProcurementInboundTriage, SupplierInboundKind } from "@/lib/procurement-inbound-triage";
import { supplierChaseDecision } from "@/lib/procurement-supplier-chase";

// The autopilot decides what a sourcing request needs next from the state of
// each supplier thread. The decision is a pure function so the loop is
// reproducible and reviewable, and so no supplier facing action can be taken
// for a reason that is not written down here.

export const AUTOPILOT_QUOTES_FOR_PO = 3;

export type AutopilotPolicy = {
  // Off by default. Only an explicit operator instruction turns supplier
  // facing sending on, and even then it covers file delivery and answers the
  // stored facts fully support, never price, terms, dates or legal replies.
  autoSend: boolean;
  // Injected by tests so a chase decision is reproducible.
  now?: number;
};

export type AutopilotVendorState = {
  vendorId: string;
  vendorName: string;
  lastDirection: "INBOUND" | "OUTBOUND" | null;
  inboundKind: SupplierInboundKind | null;
  triageDecision: ProcurementInboundTriage["decision"] | null;
  hasDraft: boolean;
  hasQuote: boolean;
  // Set for threads that can be chased. Left out by callers that only report a
  // plan, in which case a quiet thread stays untouched.
  lastMessageAt?: string | null;
  chasesSent?: number;
};

export type AutopilotAction =
  | { kind: "SEND_DRAFT"; reason: string }
  | { kind: "DRAFT_REPLY"; reason: string }
  | { kind: "CHASE"; reason: string }
  | { kind: "AWAIT_APPROVAL"; reason: string }
  | { kind: "ESCALATE"; reason: string }
  | { kind: "NONE"; reason: string };

export function planAutopilotVendorAction(
  state: AutopilotVendorState,
  policy: AutopilotPolicy,
): AutopilotAction {
  if (state.hasQuote) return { kind: "NONE", reason: "A supplier quote is already recorded." };
  if (state.inboundKind === "BOUNCE") {
    return { kind: "ESCALATE", reason: "Delivery bounced, so this supplier needs a new address." };
  }
  if (state.inboundKind === "AUTO_REPLY") {
    return { kind: "NONE", reason: "The last message is an automatic out of office notice." };
  }
  if (state.inboundKind === "WRONG_RECIPIENT") {
    return { kind: "ESCALATE", reason: "The supplier says this is the wrong contact." };
  }
  if (state.triageDecision === "NEEDS_HUMAN") {
    return { kind: "ESCALATE", reason: "The reply asks something the stored request facts do not answer." };
  }
  if (state.hasDraft) {
    return policy.autoSend
      ? { kind: "SEND_DRAFT", reason: "A saved reply carrying the request files is ready to deliver." }
      : { kind: "AWAIT_APPROVAL", reason: "A saved reply is waiting for an operator to confirm delivery." };
  }
  if (state.lastDirection === "INBOUND") {
    return { kind: "DRAFT_REPLY", reason: "The supplier replied and the request files answer it." };
  }
  if (state.lastDirection === "OUTBOUND") {
    // A supplier that replied once and then went quiet is chased on the same
    // thread, carrying the same request files, up to the bounded limit.
    const chase = supplierChaseDecision({
      lastDirection: state.lastDirection,
      lastMessageAt: state.lastMessageAt ?? null,
      chasesSent: state.chasesSent ?? 0,
      hasQuote: state.hasQuote,
      now: policy.now,
    });
    return chase.chase
      ? { kind: "CHASE", reason: chase.reason }
      : { kind: "NONE", reason: chase.reason };
  }
  return { kind: "NONE", reason: "This supplier has no thread yet." };
}

export type AutopilotStage = "COLLECTING_REPLIES" | "QUOTES_READY_FOR_PO";

// A request is only called PO ready when enough real quotes exist to compare.
// Drafts, replies and interest never count as a quote.
export function autopilotRequestStage(args: { quotes: number; required?: number }): AutopilotStage {
  const required = Math.max(1, Math.trunc(args.required ?? AUTOPILOT_QUOTES_FOR_PO));
  return args.quotes >= required ? "QUOTES_READY_FOR_PO" : "COLLECTING_REPLIES";
}

export function autopilotEscalations(
  plan: readonly { vendorId: string; vendorName: string; action: AutopilotAction }[],
) {
  return plan
    .filter((entry) => entry.action.kind === "ESCALATE")
    .map((entry) => ({ vendorId: entry.vendorId, vendorName: entry.vendorName, reason: entry.action.reason }));
}
