import "server-only";

import { listSuppressedEmails } from "@/lib/email-delivery-events";
import {
  autopilotDraftBindingMatches,
  autopilotEscalations,
  autopilotFailures,
  autopilotGoalReached,
  autopilotNudgeBudget,
  autopilotRequestStage,
  planAutopilotVendorAction,
  prioritizeAutopilotQueue,
  rotateAutopilotOrderIds,
  rotateAutopilotQueue,
  type AutopilotAction,
  type AutopilotStage,
  type AutopilotVendorState,
} from "@/lib/procurement-autopilot-plan";
import { loadBulkRfqOrder } from "@/lib/procurement-bulk-rfq";
import {
  conversationFunnel,
  unreadConversationInput,
  type ConversationFunnel,
} from "@/lib/procurement-conversation-stage";
import { procurementVendorConversation } from "@/lib/procurement-conversation";
import {
  conversationFailureIsCapacity,
  conversationTaskEntries,
} from "@/lib/procurement-conversation-task";
import {
  conversationTaskBacklog,
  EMPTY_CONVERSATION_TASK_BACKLOG,
  listBackingOffConversationVendorIds,
  recordConversationTasks,
  settleAbsentConversationTasks,
  type ConversationTaskBacklog,
} from "@/lib/procurement-conversation-task-store";
import {
  cancelStaleProcurementFileDeliveryDraft,
  getProcurementFileDeliveryDraft,
  saveProcurementFileDeliveryDraft,
} from "@/lib/procurement-file-delivery-draft";
import { procurementOperatorAccess } from "@/lib/procurement-operator-access";
import { createProcurementVendorDraftStateRead } from "@/lib/procurement-state-runtime";
import { prisma } from "@/lib/prisma";
import { procurementRepliedVendors } from "@/lib/procurement-reply-scope";
import { chasesSentAfterLastReply } from "@/lib/procurement-supplier-chase";
import {
  listSupplierNudgeTargets,
  procurementVendorOutreachClosed,
  runProcurementSupplierNudges,
} from "@/lib/procurement-supplier-nudge";
import { sweepSupplierQuoteCapture } from "@/lib/procurement-supplier-quote";
import {
  recoverProcurementWrongContact,
  type WrongContactRecoveryOutcome,
} from "@/lib/procurement-wrong-contact";
import type { SupplierQuoteMissingFact } from "@/lib/procurement-supplier-quote-reading";
import { runProcurementFileDraftBatch } from "@/lib/procurement-file-draft-batch";
import { runProcurementFileDraftSendBatch } from "@/lib/procurement-file-draft-send";
import {
  procurementReplyFacts,
  supplierWrittenMessages,
  triageSupplierInbound,
} from "@/lib/procurement-inbound-triage";
import { storedQuoteGoal } from "@/lib/supply-os/project-status";
import {
  getProcurementRequest,
  getProcurementWorkflowAccount,
  procurementWorkflowDatabase,
  VENDOR_SENT_MESSAGE_ID_SQL,
  type ProcurementOrderDetail,
} from "@/lib/procurement-workflow";

import { SupplyPersistenceError } from "@/lib/supply-os/persistence";
import { procurementVendorPacketWithSavedDraft } from "@/lib/supply-os/state-runtime/autopilot";
import { compileProcurementRequestVendorPageState } from "@/lib/supply-os/state-runtime/compile";
import { supplyStateRuntimeConfig } from "@/lib/supply-os/state-runtime/config";
import {
  summarizeSupplyStateConflict,
  validateSupplyStateReadForAction,
} from "@/lib/supply-os/state-runtime/enforcement";
import { persistSupplyStateRead } from "@/lib/supply-os/state-runtime/persist-read";
import type { SupplyWorldStatePacket } from "@/lib/supply-os/state-runtime/types";

// One pass of the sourcing loop for a single request: read every supplier
// thread, draft the replies the stored request files answer, deliver them when
// the operator turned sending on, and report everything a human has to decide.
// Every reply is built from the request's own linked documents, so a follow up
// carries the same screened files and the same derived facts the first reply
// did, without an operator restating the context.

export const AUTOPILOT_MAX_PER_RUN = 25;
// How many requests one pass can hope to work. The queue it chooses from is
// larger, because a pass that only ever saw the first requests of an oldest
// first list would leave every later request unworked forever.
export const AUTOPILOT_MAX_ORDERS_PER_RUN = 10;
export const AUTOPILOT_MAX_QUEUE = 200;

// Only requests that already reached suppliers can have a supplier thread to
// work, and a closed request is never touched again. A supplier is contacted by
// the same current or legacy stamp the rest of the loop reads, so a request
// whose suppliers were mailed before `last_email_message_id` existed is still
// worked by the scheduled pass instead of being invisible to it.
export async function listAutopilotOrderIds(limit = AUTOPILOT_MAX_QUEUE): Promise<string[]> {
  const bounded = Math.min(AUTOPILOT_MAX_QUEUE, Math.max(1, Math.trunc(limit)));
  const rows = await procurementWorkflowDatabase().$queryRawUnsafe<Array<{ orderId: string }>>(`
    SELECT DISTINCT orders.id AS "orderId", orders.created_at
    FROM orders
    JOIN order_vendors
      ON order_vendors.order_id = orders.id
      AND (
        ${VENDOR_SENT_MESSAGE_ID_SQL} IS NOT NULL
        -- A supplier a wrong contact reply moved to another address has had its
        -- send receipt cleared on purpose, so the request would otherwise drop
        -- out of the queue and stop being reported while it still owes that
        -- supplier its first contact at the replacement address.
        OR to_jsonb(order_vendors)->'research'->'wrongContact'->>'state' = 'RESOURCED'
      )
    WHERE orders.status NOT IN ('ordered', 'cancelled')
    ORDER BY orders.created_at ASC, orders.id ASC
    LIMIT ${bounded}
  `);
  return rows.map((row) => row.orderId);
}

export { prioritizeAutopilotQueue, rotateAutopilotOrderIds };

// What the send batch needs at the end of a pass, so reading never consumes the
// time answering requires.
export const AUTOPILOT_SEND_RESERVE_MS = 60_000;

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
  // Follow ups that ask a supplier for the one commercial fact their reply is
  // short of, counted apart from a chase that only repeats the package.
  quoteFactAsks: number;
  // A supplier that never answered the first RFQ cannot be chased through the
  // reply path, so those follow ups are counted separately.
  nudgeCandidates: number;
  nudged: number;
  // Quotes read out of supplier replies during this pass, so a request can
  // reach a purchase order without an operator retyping a price.
  quotesRecorded: number;
  sent: number;
  alreadySent: number;
  // Deliveries the send time state recheck refused because the sourcing request
  // moved after the draft was saved. They need a redraft, not a retry.
  refused: number;
  // Saved drafts the thread moved past, retired by this pass. They are not
  // failures: the supplier already has the answer they carried, or a newer
  // message replaces the one they answered.
  superseded: number;
  failed: number;
  failures: Array<{ vendorId: string; vendorName: string; error: string }>;
  // Work no mailbox was free for. The loop keeps it queued and due, so it is
  // not a failure an operator has to act on, and it is counted apart from one
  // rather than being reported as both.
  queued: number;
  queuedByCapacity: Array<{ vendorId: string; vendorName: string; error: string }>;
  autoSend: boolean;
  quoteGoal: number | null;
  quoteGoalReadFailed: boolean;
  goalReached: boolean;
  // Reports whether unsolicited chases, nudges, and quote fact asks were
  // enabled for this pass after the campaign goal gate was applied.
  sendFollowUps: boolean;
  // True when the pass stopped starting work to stay inside the invocation it
  // was given. What it did is reported and the rest is left for the next pass,
  // which is the only outcome that reports anything at all: a pass killed at
  // the function limit reports nothing and answers nothing.
  stoppedAtDeadline: boolean;
  escalations: Array<{ vendorId: string; vendorName: string; reason: string }>;
  // Wrong contact replies this pass worked: moved to another address at the
  // same supplier, or faded out of the funnel. Reported so a shop leaving the
  // request is a recorded decision rather than a silent disappearance.
  wrongContacts: WrongContactRecoveryOutcome[];
  // Where every supplier thread this pass read stands, and how many still owe
  // an action. A pass reports one slice of a request, so this is what makes a
  // thread that stalled visible without somebody sweeping the request by hand.
  funnel: ConversationFunnel;
  // The work the loop still owns for this request after the pass, which is what
  // survives it: a failed send or an unanswered reply is a stored task the next
  // scheduled pass retries, with a backoff, instead of being recomputed and
  // possibly missed. `due` is what a pass can pick up now, `stuck` names the
  // threads that keep failing and need a person.
  backlog: ConversationTaskBacklog;
  // Whether the backlog above is the stored truth. A store that refused the
  // write or the read reports an empty backlog, and this says so.
  backlogStored: boolean;
  plan: AutopilotVendorPlan[];
};

// What a chase has to be built from: the supplier's newest reply anchors the
// follow up, exactly as the first answer was anchored.
type ChaseAnchor = {
  sourceMessageId: string;
  recipient: string;
  conversationSubject: string | null;
};

type StateReadReference = {
  id: string;
  packetHash: string;
  sourceFingerprint: string;
};

type DraftBoundStateReadReference = StateReadReference & {
  expectedTaskId: string;
  expectedInputHash: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function workspaceIdFromOrder(order: ProcurementOrderDetail) {
  const source = record(record(order.requestContext).source);
  return typeof source.workspace_id === "string" && source.workspace_id.trim()
    ? source.workspace_id.trim()
    : null;
}

async function procurementStateScope(args: {
  officeId: string;
  customerId: string;
  order: ProcurementOrderDetail;
}) {
  const account = await getProcurementWorkflowAccount({
    customerId: args.customerId,
    officeId: args.officeId,
  });
  if (!account) return null;
  const workspaceId = workspaceIdFromOrder(args.order);
  if (workspaceId) {
    const workspace = await prisma.supplyWorkspace.findFirst({
      where: { id: workspaceId, officeId: args.officeId, status: "ACTIVE" },
      select: { id: true, companyId: true },
    });
    if (!workspace || workspace.companyId !== account.companyId) {
      throw new SupplyPersistenceError(
        "The procurement request workspace is not owned by the workflow company.",
        "forbidden",
      );
    }
    return {
      type: "procurement_request" as const,
      officeId: args.officeId,
      companyId: account.companyId,
      customerId: args.customerId,
      orderId: args.order.id,
      workspaceId: workspace.id,
    };
  }
  return {
    type: "procurement_request" as const,
    officeId: args.officeId,
    companyId: account.companyId,
    customerId: args.customerId,
    orderId: args.order.id,
    workspaceId,
  };
}

async function persistAutopilotStateRead(packet: SupplyWorldStatePacket): Promise<StateReadReference> {
  const stateRead = await persistSupplyStateRead({ officeId: packet.scope.officeId, packet });
  return {
    id: stateRead.id,
    packetHash: packet.packetHash,
    sourceFingerprint: packet.sourceFingerprint,
  };
}

async function vendorStates(args: {
  officeId: string;
  customerId: string;
  order: ProcurementOrderDetail;
  // Best effort answers every question the request can speak to, so only price,
  // terms, and legal questions are left for the operator.
  bestEffort?: boolean;
  // Reading a supplier thread is one bounded unit of work, so the scan stops
  // between threads rather than running the invocation out. The suppliers it
  // did not read are simply absent from the plan and are read by the next pass.
  outOfTime?: () => boolean;
  // When set, respondents are rotated by the window the pass belongs to, so a
  // request whose respondents cannot all be read in one pass still has every
  // one of them read by a later pass rather than the same prefix every time.
  rotateFrom?: number | null;
  // What each supplier's own replies still leave unsaid, read by the quote
  // sweep earlier in this pass, so a thread short of a price or a lead time is
  // asked for that fact instead of being chased with the brief again.
  missingQuoteFacts?: Map<string, SupplierQuoteMissingFact[]>;
  // Conversations waiting out their own backoff after a failure. They are left
  // out of the scan so the pass spends itself on the threads that are due,
  // instead of retrying a thread whose sender pool or mailbox has not had time
  // to recover.
  skipVendorIds?: ReadonlySet<string>;
}): Promise<{
  states: AutopilotVendorState[];
  anchors: Map<string, ChaseAnchor>;
  recoveries: WrongContactRecoveryOutcome[];
  stopped: boolean;
}> {
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
  const recoveries: WrongContactRecoveryOutcome[] = [];
  const storedContactEmails = args.order.vendors
    .map((vendor) => vendor.contact?.email?.trim().toLowerCase() ?? "")
    .filter(Boolean);
  const checkedSuppressionEmails = new Set(storedContactEmails);
  const suppressed = await listSuppressedEmails(args.officeId, storedContactEmails);
  // Every action this plan can take needs a supplier reply to work from, so the
  // scan follows the replies rather than the supplier count. Suppliers that
  // never answered are followed up through the nudge path, which selects them
  // without reading a thread each.
  const scanned = await procurementRepliedVendors({
    officeId: args.officeId,
    orderId: args.order.id,
    vendors: args.skipVendorIds?.size
      ? args.order.vendors.filter((vendor) => !args.skipVendorIds?.has(vendor.id))
      : args.order.vendors,
    outOfTime: args.outOfTime,
  });
  const replied = typeof args.rotateFrom === "number"
    ? rotateAutopilotQueue(scanned.vendors, args.rotateFrom)
    : scanned.vendors;
  // A history read cut short leaves repliers unseen, so the pass is unfinished
  // even if every thread it did find is handled.
  let stopped = !scanned.complete;
  const processedIds = new Set<string>();
  for (const vendor of replied) {
    if (args.outOfTime?.()) {
      stopped = true;
      break;
    }
    processedIds.add(vendor.id);
    const conversation = await procurementVendorConversation({
      officeId: args.officeId,
      customerId: args.customerId,
      orderId: args.order.id,
      vendorId: vendor.id,
    });
    // An out of office note or a bounce report answers nothing and is never
    // answered itself, so the whole scan reads the thread as the people on it
    // wrote it: a supplier question sitting behind such a notice is still owed an
    // answer, a notice landing after our answer still leaves the thread waiting
    // on the supplier, and a follow up anchors on a reply a supplier can read.
    const written = supplierWrittenMessages(conversation.messages);
    const latest = written.at(-1) ?? null;
    const inbound = latest?.direction === "INBOUND" ? latest : null;
    const newestReply = [...written].reverse().find((message) => message.direction === "INBOUND") ?? null;
    const recipient = (newestReply?.fromEmail ?? vendor.contact?.email ?? "").trim().toLowerCase();
    if (recipient && !checkedSuppressionEmails.has(recipient)) {
      const recipientSuppression = await listSuppressedEmails(args.officeId, [recipient]);
      checkedSuppressionEmails.add(recipient);
      for (const [email, reason] of recipientSuppression) suppressed.set(email, reason);
    }
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
    // A shop that says it is the wrong contact is worked here rather than
    // reported: the request moves to another address the supplier named, or on
    // its own domain, and fades the row when there is none. Nothing is mailed by
    // this, so it runs in a draft only pass too, and the RFQ to the replacement
    // address stays behind the same send rules as any other first contact.
    const wrongContact = triage?.kind === "WRONG_RECIPIENT" && inbound
      ? await recoverProcurementWrongContact({
        orderId: args.order.id,
        vendorId: vendor.id,
        vendorName: vendor.name,
        replyBody: inbound.body,
        sourceMessageId: inbound.id,
        mailedEmails: written
          .filter((message) => message.direction === "OUTBOUND")
          .flatMap((message) => message.toEmails),
      })
      : null;
    if (wrongContact) recoveries.push(wrongContact);
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
      draftBinding: draft?.taskId && draft.inputHash
        ? { taskId: draft.taskId, inputHash: draft.inputHash }
        : null,
      hasQuote: Boolean(vendor.quote),
      suppressed: suppressed.get(recipient) ?? null,
      lastMessageAt: latest?.sentAt ?? null,
      chasesSent: chasesSentAfterLastReply(written, {
        // Notices are already out of this thread view, so the newest inbound
        // message is a reply the supplier wrote and the first outbound message
        // after it is the answer to it rather than a follow up.
        answeredReply: newestReply !== null,
      }),
      missingQuoteFacts: args.missingQuoteFacts?.get(vendor.id) ?? null,
      unansweredQuestions: triage?.unanswered.map((entry) => entry.question) ?? null,
      wrongContactRecovery: wrongContact?.resolved ?? null,
    });
  }
  const allVendors = args.order.vendors;
  for (const vendor of allVendors) {
    if (args.skipVendorIds?.has(vendor.id) || processedIds.has(vendor.id)) continue;
    const email = vendor.contact?.email?.trim().toLowerCase() ?? "";
    const suppression = email ? suppressed.get(email) ?? null : null;
    if (!suppression) continue;
    states.push({
      vendorId: vendor.id,
      vendorName: vendor.name,
      lastDirection: vendor.contacted ? "OUTBOUND" : null,
      inboundKind: null,
      triageDecision: null,
      hasDraft: false,
      hasQuote: Boolean(vendor.quote),
      suppressed: suppression,
    });
  }
  return { states, anchors, recoveries, stopped };
}

// A supplier that answered once and then went quiet gets the same files again
// on the same thread. The draft is saved first either way, so an operator sees
// exactly what a chase would say before sending is ever turned on.
async function draftChases(args: {
  officeId: string;
  customerId: string;
  order: ProcurementOrderDetail;
  // A thread short of a price or a lead time carries what is missing, so the
  // follow up asks the one question that closes the quote.
  targets: ReadonlyArray<{ vendorId: string; missing: SupplierQuoteMissingFact[] }>;
  anchors: Map<string, ChaseAnchor>;
  outOfTime?: () => boolean;
}) {
  const drafted: string[] = [];
  const bindings = new Map<string, { taskId: string; inputHash: string }>();
  const failures: AutopilotRunResult["failures"] = [];
  if (!args.targets.length) return { drafted, bindings, failures, stopped: false };
  const access = await procurementOperatorAccess(args.officeId);
  for (const target of args.targets) {
    if (args.outOfTime?.()) return { drafted, bindings, failures, stopped: true };
    const vendorId = target.vendorId;
    const vendor = args.order.vendors.find((candidate) => candidate.id === vendorId);
    const anchor = args.anchors.get(vendorId);
    if (!vendor || !anchor) continue;
    try {
      const stateRead = await createProcurementVendorDraftStateRead({
        officeId: args.officeId,
        customerId: args.customerId,
        order: args.order,
        vendorId,
        objective: `Prepare the confirmed supplier follow up for vendor ${vendorId}.`,
      });
      const saved = await saveProcurementFileDeliveryDraft({
        context: access,
        customerId: args.customerId,
        order: args.order,
        vendor,
        sourceMessageId: anchor.sourceMessageId,
        recipient: anchor.recipient,
        conversationSubject: anchor.conversationSubject,
        variant: "CHASE",
        missingFacts: target.missing,
        stateRead,
      });
      drafted.push(vendorId);
      if (saved.taskId && saved.inputHash) {
        bindings.set(vendorId, { taskId: saved.taskId, inputHash: saved.inputHash });
      }
    } catch (error) {
      failures.push({
        vendorId,
        vendorName: vendor.name,
        error: error instanceof Error ? error.message : "The supplier follow up draft failed.",
      });
    }
  }
  return { drafted, bindings, failures, stopped: false };
}

export async function runProcurementAutopilot(args: {
  orderId: string;
  autoSend?: boolean;
  // Sending is split so an unattended pass can answer the replies that
  // currently await an answer without also mailing unsolicited follow ups.
  // Chases and nudges are the ones an operator confirms, so they default to
  // the same instruction that turned sending on and are turned off separately.
  sendFollowUps?: boolean;
  // A supplier who already answered with part of a quote is asked for the fact
  // that is missing, on their own thread, even when unsolicited follow ups stay
  // behind an operator confirmation. Without this a thread that priced but
  // never dated (or dated but never priced) sits at a partial reading forever,
  // which is the leak that kept requests short of a purchase order. It stays
  // bounded by the same quiet period and follow up cap as any chase.
  askQuoteFacts?: boolean;
  bestEffort?: boolean;
  limit?: number;
  // Absolute time after which no further work is started. A pass runs several
  // sequential phases over a request, so a caller bounded by a function limit
  // cannot rely on starting in time: it has to be able to stop the pass in the
  // middle and still get a report.
  deadlineAt?: number;
}): Promise<AutopilotRunResult | null> {
  const deadlineAt = Number.isFinite(args.deadlineAt) ? Number(args.deadlineAt) : null;
  const outOfTime = () => deadlineAt !== null && Date.now() >= deadlineAt;
  // Reading and drafting stop earlier than the deadline itself, because a scan
  // that spent the whole budget and then found no time to send would answer
  // nobody: a request too large to scan in one pass would send nothing forever.
  // The reserve is what the send batch needs, so a partial scan still delivers
  // the answers it collected.
  const scanDeadlineAt = deadlineAt === null ? null : deadlineAt - AUTOPILOT_SEND_RESERVE_MS;
  const outOfScanTime = () => scanDeadlineAt !== null && Date.now() >= scanDeadlineAt;
  const summary = await loadBulkRfqOrder(args.orderId);
  if (!summary) return null;
  const limit = Math.min(AUTOPILOT_MAX_PER_RUN, Math.max(1, Math.trunc(args.limit ?? AUTOPILOT_MAX_PER_RUN)));
  const autoSend = args.autoSend === true;
  const sendFollowUps = autoSend && args.sendFollowUps !== false;
  const askQuoteFacts = autoSend && args.askQuoteFacts !== false;
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
  // A request enters the scheduled queue when any one of its conversations is
  // due, so the pass has to honour each conversation's own backoff itself:
  // without this, one due thread pulled every failing thread of the request
  // into the same pass. It is read before the first phase that can retry a
  // thread, since the quote write and the draft are retries too, and reading it
  // after them let those two failures repeat on every pass. A store that cannot
  // be read blocks nothing, since holding the whole request back would be worse
  // than retrying too early.
  const backingOff = new Set(await listBackingOffConversationVendorIds({
    officeId: summary.officeId,
    orderId: args.orderId,
  }).catch((error: unknown) => {
    console.error("procurement conversation backoff not read", args.orderId, error);
    return [] as string[];
  }));
  const quoteRun = outOfScanTime()
    ? null
    : await sweepSupplierQuoteCapture({
      orderId: args.orderId,
      outOfTime: outOfScanTime,
      skipVendorIds: backingOff,
    });
  // Each phase is entered only while there is time to finish it, and stops
  // between its own units of work, so a pass that runs out reports what it did
  // instead of being killed with nothing said.
  const draftRun = outOfScanTime() ? null : await runProcurementFileDraftBatch({
    orderId: args.orderId,
    limit,
    bestEffort: args.bestEffort,
    outOfTime: outOfScanTime,
    rotateFrom: deadlineAt === null ? undefined : Date.now(),
    skipVendorIds: backingOff,
  });
  if (!draftRun && !outOfScanTime()) return null;
  const order = await getProcurementRequest(summary.customerId, args.orderId);
  if (!order) return null;
  const { states, anchors, recoveries, stopped: scanStopped } = await vendorStates({
    officeId: summary.officeId,
    customerId: summary.customerId,
    order,
    bestEffort: args.bestEffort,
    outOfTime: outOfScanTime,
    // A scan that always starts at the same respondent could never reach the
    // rest of a request it cannot finish in one pass, so respondents rotate by
    // window exactly as the request queue does. Delivery stays idempotent, so
    // revisiting a thread cannot mail it twice.
    rotateFrom: deadlineAt === null ? null : Date.now(),
    missingQuoteFacts: new Map(
      (quoteRun?.partials ?? []).map((partial) => [partial.vendorId, partial.missing]),
    ),
    skipVendorIds: backingOff,
  });
  const plan = states.map((state) => ({
    vendorId: state.vendorId,
    vendorName: state.vendorName,
    state,
    action: planAutopilotVendorAction(state, { autoSend }),
  }));
  // The quote count spans every vendor on the request. The thread scan can
  // omit backing-off vendors or stop at its deadline, but the order snapshot
  // still carries the complete quote state after the capture sweep.
  const quotes = order.vendors.filter((vendor) => Boolean(vendor.quote)).length;
  const goalLookup = await storedQuoteGoal(summary.officeId, summary.sourceWorkspaceId)
    .then((quoteGoal) => ({ quoteGoal, failed: false as const }))
    .catch((error: unknown) => {
      console.error("procurement campaign quote goal not read", args.orderId, error);
      return { quoteGoal: null, failed: true as const };
    });
  const quoteGoal = goalLookup.quoteGoal;
  const goalReached = autopilotGoalReached({ quotes, quoteGoal });
  // A goal that could not be read blocks unsolicited mail until a later pass
  // can read it. Answers to replies do not wait on the lookup.
  const followUps = sendFollowUps && !goalReached && !goalLookup.failed;
  const quoteFactAsks = askQuoteFacts && !goalReached && !goalLookup.failed;
  // Drafts exist for threads the plan escalates, so delivery is restricted to
  // the suppliers the plan chose. The plan is therefore computed before the
  // send, never after it.
  // A chase draft is a saved reply like any other, so a pass that must not
  // deliver chases does not write them either: a later pass would otherwise
  // read them as a ready draft and send what was never confirmed. The plan
  // still names every quiet thread, so nothing is hidden from the operator.
  const chaseTargets = plan.flatMap((entry) => {
    if (backingOff.has(entry.vendorId)) return [];
    if (entry.action.kind === "ASK_QUOTE_FACTS" && (followUps || quoteFactAsks)) {
      return [{ vendorId: entry.vendorId, missing: entry.action.missing }];
    }
    return entry.action.kind === "CHASE" && followUps
      ? [{ vendorId: entry.vendorId, missing: [] as SupplierQuoteMissingFact[] }]
      : [];
  });
  const chaseRun = chaseTargets.length
    ? await draftChases({
      officeId: summary.officeId,
      customerId: summary.customerId,
      order,
      // A precise ask for the missing commercial fact is a chase on the same
      // thread with the same files, so it is drafted by the same path and only
      // differs in what it asks for.
      targets: chaseTargets,
      anchors,
      outOfTime: outOfScanTime,
    })
    : { drafted: [] as string[], bindings: new Map<string, { taskId: string; inputHash: string }>(), failures: [] as AutopilotRunResult["failures"], stopped: false };
  for (const entry of plan) {
    const binding = chaseRun.bindings.get(entry.vendorId);
    if (binding) entry.state = { ...entry.state, hasDraft: true, draftBinding: binding };
  }
  const requestedDeliverable = [
    ...plan
      .filter((entry) => !backingOff.has(entry.vendorId)
        && entry.action.kind === "SEND_DRAFT"
        // Without follow up sending, delivery is restricted to threads whose
        // newest message is the supplier's, which is exactly a reply awaiting
        // an answer. A chase draft saved by an earlier operator pass sits on a
        // thread we spoke last on, so it stays behind its confirmation.
        && (followUps
          || entry.state.lastDirection === "INBOUND"
          // A saved ask for a missing commercial fact belongs to a thread that
          // already engaged, so a pass that withholds unsolicited follow ups
          // still delivers it. Leaving it undelivered would strand the one
          // question standing between the reply and a purchase order.
          || (quoteFactAsks && Boolean(entry.state.missingQuoteFacts?.length))))
      .map((entry) => entry.vendorId),
    ...chaseRun.drafted,
  ];
  const sendStateReads: Record<string, DraftBoundStateReadReference> = {};
  const stateEscalations: Array<{ vendorId: string; vendorName: string; reason: string }> = [];
  const runtime = supplyStateRuntimeConfig();
  let packet: SupplyWorldStatePacket | null = null;
  const selectedVendorIds = [...new Set(requestedDeliverable)].slice(0, limit);
  const selectedVendors = new Set(selectedVendorIds);
  const selectedEntries = plan.filter((entry) => selectedVendors.has(entry.vendorId));
  if (runtime.enabled && selectedVendorIds.length && !outOfTime()) {
    try {
      const scope = await procurementStateScope({
        officeId: summary.officeId,
        customerId: summary.customerId,
        order,
      });
      if (!scope) throw new Error("The procurement request is not linked to a tenant company.");
      packet = await compileProcurementRequestVendorPageState({
        scope,
        vendorIds: selectedVendorIds,
        objective: `Validate the bounded sourcing autopilot send pass for procurement request ${order.id}.`,
      });
    } catch {
      if (runtime.validationMode === "enforce") {
        for (const entry of selectedEntries) {
          const reason = "Commercial state could not be compiled, so the supplier draft remains unsent until the request is refreshed.";
          entry.action = { kind: "ESCALATE", reason };
          stateEscalations.push({ vendorId: entry.vendorId, vendorName: entry.vendorName, reason });
        }
      }
    }
  }
  if (packet && autoSend) {
    const access = await procurementOperatorAccess(summary.officeId);
    for (const entry of selectedEntries) {
      if (outOfTime()) break;
      const draft = await getProcurementFileDeliveryDraft({
        officeId: summary.officeId,
        order,
        vendorId: entry.vendorId,
      });
      if (!draft?.taskId || !draft.inputHash) {
        const reason = "The saved supplier draft could not be bound to its immutable task input.";
        entry.action = { kind: "ESCALATE", reason };
        stateEscalations.push({ vendorId: entry.vendorId, vendorName: entry.vendorName, reason });
        continue;
      }
      if (!autopilotDraftBindingMatches(entry.state, draft)) {
        const reason = "The saved supplier draft changed after this plan was compiled. The replacement draft was left unsent and requires a new plan and confirmation.";
        entry.action = { kind: "ESCALATE", reason };
        stateEscalations.push({ vendorId: entry.vendorId, vendorName: entry.vendorName, reason });
        continue;
      }
      try {
        const draftValidation = await validateSupplyStateReadForAction({
          officeId: summary.officeId,
          stateReadId: draft.stateReadId,
          action: "procurement_supplier_draft.validate_original_scope",
        });
        if (draftValidation.blocked) {
          const changed = summarizeSupplyStateConflict(draftValidation);
          const reason = `The saved supplier draft is stale: ${changed}. A new plan and confirmation are required.`;
          await cancelStaleProcurementFileDeliveryDraft({
            context: access,
            customerId: summary.customerId,
            order,
            vendorId: entry.vendorId,
            expectedTaskId: draft.taskId,
            expectedInputHash: draft.inputHash,
            reason,
          });
          entry.action = { kind: "ESCALATE", reason };
          stateEscalations.push({ vendorId: entry.vendorId, vendorName: entry.vendorName, reason });
          continue;
        }
        const sendPacket = procurementVendorPacketWithSavedDraft({
          packet,
          customerId: summary.customerId,
          orderId: order.id,
          vendorId: entry.vendorId,
          draft: { id: draft.taskId, inputHash: draft.inputHash, status: "PLANNED" },
          objective: `Validate and deliver the confirmed supplier draft for vendor ${entry.vendorId}.`,
        });
        const stateRead = await persistAutopilotStateRead(sendPacket);
        const validation = await validateSupplyStateReadForAction({
          officeId: summary.officeId,
          stateReadId: stateRead.id,
          action: "procurement_supplier_draft.select_for_send",
        });
        if (validation.blocked) {
          const changed = summarizeSupplyStateConflict(validation);
          const reason = `The confirmed supplier draft is stale: ${changed}. A new plan and confirmation are required.`;
          await cancelStaleProcurementFileDeliveryDraft({
            context: access,
            customerId: summary.customerId,
            order,
            vendorId: entry.vendorId,
            expectedTaskId: draft.taskId,
            expectedInputHash: draft.inputHash,
            reason,
          });
          entry.action = { kind: "ESCALATE", reason };
          stateEscalations.push({ vendorId: entry.vendorId, vendorName: entry.vendorName, reason });
          continue;
        }
        sendStateReads[entry.vendorId] = {
          ...stateRead,
          expectedTaskId: draft.taskId,
          expectedInputHash: draft.inputHash,
        };
      } catch (error) {
        if (runtime.validationMode !== "enforce") continue;
        const reason = error instanceof Error
          ? `Commercial state validation blocked this supplier draft: ${error.message}`
          : "Commercial state validation blocked this supplier draft.";
        entry.action = { kind: "ESCALATE", reason };
        stateEscalations.push({ vendorId: entry.vendorId, vendorName: entry.vendorName, reason });
      }
    }
  }
  const blockedStateVendors = new Set(stateEscalations.map((entry) => entry.vendorId));
  const deliverable = selectedVendorIds
    .filter((vendorId) => !blockedStateVendors.has(vendorId))
    .filter((vendorId) => !runtime.enabled || runtime.validationMode !== "enforce" || Boolean(sendStateReads[vendorId]));
  // Suppliers that never replied have no inbound message to answer, so their
  // follow up rides on our own RFQ thread instead of being silently skipped.
  const nudgeLimit = autopilotNudgeBudget(limit, deliverable.length);
  // Answering is the last phase to be given up, since a supplier is waiting on
  // it, and an unsent draft is delivered by the next pass either way.
  // Even an empty delivery list reconciles unresolved provider attempts.
  const sendRun = autoSend && !outOfTime()
    // A thread whose mailbox was disconnected or paused by sender protection
    // can only be answered from another pooled mailbox, and leaving it unsent
    // means a real supplier reply is never answered at all, so the loop allows
    // the pooled sender rather than failing the delivery forever.
    ? await runProcurementFileDraftSendBatch({
      orderId: args.orderId,
      limit,
      vendorIds: deliverable,
      allowPooledSender: true,
      outOfTime,
      ...(packet ? { vendorStateReads: sendStateReads } : {}),
    })
    : null;
  const sendStateFailures = (sendRun?.outcomes ?? [])
    .filter((outcome) => (outcome.state === "FAILED" || outcome.state === "STALE")
      && /commercial state|strict commercial/i.test(outcome.error ?? ""))
    .map((outcome) => ({
      vendorId: outcome.vendorId,
      vendorName: outcome.vendorName,
      reason: `${outcome.error ?? "Commercial state changed before supplier delivery."} A new plan and confirmation are required.`,
    }));
  for (const failure of sendStateFailures) {
    const entry = plan.find((candidate) => candidate.vendorId === failure.vendorId);
    if (entry) entry.action = { kind: "ESCALATE", reason: failure.reason };
  }
  const nudgeRun = followUps && nudgeLimit > 0 && !outOfScanTime()
    ? await runProcurementSupplierNudges({ orderId: args.orderId, limit: nudgeLimit })
    : null;
  const nudgePlan = nudgeRun || outOfScanTime()
    ? null
    : await listSupplierNudgeTargets({ order: summary, limit });
  // The funnel covers the whole request, not only the threads this pass read: a
  // reply scan walks the suppliers that answered, so counting only those would
  // report nothing owed while hundreds of silent suppliers wait. Suppliers whose
  // outreach is closed, rejected or ordered elsewhere are left out, since the
  // request is not pursuing them.
  const funnelEntries = [
    ...plan
      // A supplier that replied and was then rejected or ordered elsewhere is
      // excluded on the same rule as one this pass never read, so the two halves
      // of the funnel agree about who the request is still pursuing.
      .filter((entry) => !procurementVendorOutreachClosed(
        order.vendors.find((vendor) => vendor.id === entry.vendorId)?.status,
      ))
      .map((entry) => ({
        input: entry.state,
        action: entry.action,
        attempted: !backingOff.has(entry.vendorId),
      })),
    ...order.vendors
      .filter((vendor) => !plan.some((entry) => entry.vendorId === vendor.id)
        && !procurementVendorOutreachClosed(vendor.status))
      // A supplier the pass only projected keeps whatever the store already
      // knows about it, so a deadline or a batch limit cannot erase the retry
      // history of a thread this pass never reached.
      .map((vendor) => ({ input: unreadConversationInput(vendor), attempted: false })),
  ];
  const attempted = autopilotFailures({
    // A wrong contact the loop could not re-source or fade is owed work, not a
    // finished thread, so it keeps its task and is tried again.
    chase: [
      ...chaseRun.failures,
      ...stateEscalations.map((entry) => ({ vendorId: entry.vendorId, vendorName: entry.vendorName, error: entry.reason })),
      ...recoveries
        .filter((outcome) => outcome.state === "FAILED")
        .map((outcome) => ({
          vendorId: outcome.vendorId,
          vendorName: outcome.vendorName,
          error: outcome.error ?? outcome.reason,
        })),
    ],
    draft: draftRun?.outcomes,
    nudge: nudgeRun?.outcomes,
    send: sendRun?.outcomes,
    quote: quoteRun?.outcomes,
  });
  // A thread stopped by sender capacity is queued rather than failed: the work
  // is ready and only a mailbox is missing, so it stays due and resumes by
  // itself. Counting it as a failure told an operator to act on a thread the
  // loop was already carrying, so the two are reported apart. The stored task
  // still records why it waited, so nothing is lost.
  const queuedByCapacity = attempted.filter((failure) => conversationFailureIsCapacity(failure.error));
  const failures = attempted.filter((failure) => !conversationFailureIsCapacity(failure.error));
  // Every thread the pass covered is written back as a task, whether it moved,
  // failed or simply waits, so the loop owns the whole request between passes
  // and nothing depends on an operator sweeping it.
  // A store that will not accept the write must not throw away a pass that
  // already answered suppliers, so the failure is reported and the next pass
  // writes the same threads again from the same projection.
  const recorded = await recordConversationTasks({
    officeId: summary.officeId,
    orderId: args.orderId,
    entries: conversationTaskEntries({
      entries: funnelEntries,
      failures: new Map(attempted.map((failure) => [failure.vendorId, failure.error])),
      progressed: new Set([
        ...chaseRun.drafted,
        // Moving a wrong contact to another address at the same supplier, or
        // fading a shop that named none, is this thread moving forward.
        ...recoveries
          .filter((outcome) => outcome.state === "RESOURCED" || outcome.state === "FADED")
          .map((outcome) => outcome.vendorId),
        ...(draftRun?.outcomes ?? [])
          .filter((outcome) => outcome.state === "DRAFTED")
          .map((outcome) => outcome.vendorId),
        ...(sendRun?.outcomes ?? [])
          // Retiring a draft the thread moved past is progress on that
          // conversation: the answer it carried is already with the supplier, or
          // a newer message replaces it, so the thread is not waiting on a retry
          // of this draft and its attempt count starts clean.
          .filter((outcome) => outcome.state === "SENT" || outcome.state === "SUPERSEDED")
          .map((outcome) => outcome.vendorId),
        ...(nudgeRun?.outcomes ?? [])
          .filter((outcome) => outcome.state === "SENT")
          .map((outcome) => outcome.vendorId),
        ...(quoteRun?.outcomes ?? [])
          .filter((outcome) => outcome.state === "RECORDED")
          .map((outcome) => outcome.vendorId),
      ]),
    }),
  }).catch((error: unknown) => {
    console.error("procurement conversation tasks not stored", args.orderId, error);
    return null;
  });
  // A supplier the request stopped pursuing is no longer in the funnel, so its
  // task is settled here. Left owed, it would keep its request in the due queue
  // for work nobody wants done.
  const reconciled = await settleAbsentConversationTasks({
    officeId: summary.officeId,
    orderId: args.orderId,
    activeVendorIds: funnelEntries.map((entry) => entry.input.vendorId),
  }).catch((error: unknown) => {
    console.error("procurement conversation tasks not reconciled", args.orderId, error);
    return null;
  });
  const backlog = await conversationTaskBacklog({
    officeId: summary.officeId,
    orderId: args.orderId,
  }).catch((error: unknown) => {
    console.error("procurement conversation backlog not read", args.orderId, error);
    return null;
  });
  return {
    orderId: summary.orderId,
    material: summary.material,
    stage: autopilotRequestStage({ quotes, required: quoteGoal ?? undefined }),
    quotes,
    replied: states.filter((state) => state.lastDirection === "INBOUND").length,
    drafted: draftRun?.drafted ?? 0,
    chased: chaseRun.drafted.length,
    quoteFactAsks: chaseTargets.filter((target) => target.missing.length).length,
    nudgeCandidates: nudgeRun?.candidates ?? nudgePlan?.targets.length ?? 0,
    nudged: nudgeRun?.sent ?? 0,
    quotesRecorded: quoteRun?.recorded ?? 0,
    sent: sendRun?.sent ?? 0,
    alreadySent: sendRun?.alreadySent ?? 0,
    refused: sendRun?.stale ?? 0,
    superseded: sendRun?.superseded ?? 0,
    // Every path that can fail counts toward one total, including the drafts
    // and chase drafts a reply needs before it can be delivered at all, so a
    // pass cannot report zero failures while naming failures.
    failed: failures.length,
    // A delivery that fails needs an operator, so it is reported next to the
    // escalations instead of being reduced to a count. A quote that cannot be
    // written counts too, since it leaves a priced reply invisible.
    failures,
    queued: queuedByCapacity.length,
    queuedByCapacity,
    autoSend,
    quoteGoal,
    quoteGoalReadFailed: goalLookup.failed,
    goalReached,
    sendFollowUps: followUps,
    stoppedAtDeadline: scanStopped || chaseRun.stopped || outOfTime(),
    escalations: autopilotEscalations(plan),
    wrongContacts: recoveries,
    funnel: conversationFunnel(funnelEntries),
    backlog: backlog ?? EMPTY_CONVERSATION_TASK_BACKLOG,
    // False when the durable record of this pass could not be written or read,
    // which is itself owed work rather than an empty backlog.
    backlogStored: recorded !== null && reconciled !== null && backlog !== null,
    plan,
  };
}
