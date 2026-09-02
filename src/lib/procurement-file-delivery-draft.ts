import "server-only";

import { Prisma } from "@prisma/client";
import { stripEmDashes } from "@/lib/no-em-dash";
import { prisma } from "@/lib/prisma";
import {
  PROCUREMENT_FILE_DRAFT_STALE_REASON,
  PROCUREMENT_FILE_DRAFT_UNVERIFIED_REASON,
  procurementFileDraftStateKey,
} from "@/lib/procurement-file-draft-freshness";
import type { ProcurementOrderDetail, ProcurementOrderVendor } from "@/lib/procurement-workflow";
import { requireSupplyWorkspace, SupplyPersistenceError, type SupplyAccessContext } from "@/lib/supply-os/persistence";
import {
  loadRequestDocumentAttachments,
  type RequestDocumentAttachmentSkip,
} from "@/lib/supply-os/request-document-attachments";
import {
  appendSupplierCommunicationEvent,
  currentAccessContext,
  digest,
  inputJson,
  messageBody,
  record,
  requiredText,
  singleEmail,
} from "@/lib/supply-os/supplier-communication-shared";

// Suppliers replied to the RFQ campaign asking for the technical package, so a
// reply carrying the stored request files is prepared here and saved as a draft.
// Nothing in this module contacts an email provider: sending stays behind the
// existing operator confirmation on the reply send path.

export const PROCUREMENT_REPLY_DRAFT_TASK_TYPE = "PROCUREMENT_SUPPLIER_REPLY_DRAFT";

const DRAFT_LIVE_STATUSES = ["PLANNED", "BLOCKED", "READY"];

function draftTaskScopeKey(args: { orderId: string; vendorId: string }) {
  return `procurement-reply-draft:${args.orderId}:${args.vendorId}`;
}

const MAX_DOCUMENT_CONTEXT_CHARS = 1_400;
const MAX_DOCUMENT_CONTEXT_LINES = 24;
const MAX_TOTAL_DOCUMENT_CONTEXT_CHARS = 6_000;

export type ProcurementRequestDocument = {
  documentId: string;
  name: string;
  summary: string | null;
  markdown: string;
};

export type ProcurementDraftAttachment = {
  documentId: string;
  name: string;
  mimeType: string;
  size: number;
};

export type ProcurementDraftVariant = "REPLY" | "CHASE";

export type ProcurementFileDeliveryDraft = {
  state: "DRAFT";
  variant: ProcurementDraftVariant;
  orderId: string;
  vendorId: string;
  sourceMessageId: string;
  recipient: string;
  subject: string;
  body: string;
  attachments: ProcurementDraftAttachment[];
  withheld: Array<{ name: string; reason: string }>;
  // Fingerprint of the request state the draft repeats. Drafts saved before the
  // send time recheck existed carry none, and those cannot be delivered.
  stateKey: string | null;
  savedAt: string;
};

// The workflow request records every file it was built from as a
// "document:<context id>" citation, which is the only trusted link from a
// sourcing request to a stored company document.
export function procurementRequestDocuments(order: ProcurementOrderDetail): ProcurementRequestDocument[] {
  const context = record(record(order.requestContext).procurement_context);
  const documents = Array.isArray(context.documents) ? context.documents : [];
  return documents.flatMap((entry) => {
    const row = record(entry);
    const citation = typeof row.citation_id === "string" ? row.citation_id : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!citation.startsWith("document:") || !name) return [];
    const documentId = citation.slice("document:".length).trim();
    if (!documentId) return [];
    return [{
      documentId,
      name,
      summary: typeof row.summary === "string" && row.summary.trim() ? row.summary.trim() : null,
      markdown: typeof row.markdown === "string" ? row.markdown : "",
    }];
  });
}

function factLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const tableCells = trimmed.startsWith("|") && trimmed.endsWith("|")
    ? trimmed.slice(1, -1).split("|").map((cell) => cell.trim())
    : null;
  if (tableCells) {
    if (tableCells.every((cell) => /^-{2,}$/.test(cell) || !cell)) return null;
    const [label, ...rest] = tableCells;
    const value = rest.filter(Boolean).join(", ");
    return label && value ? `${label}: ${value}` : null;
  }
  const plain = trimmed.replace(/^[-*]\s+/, "").replace(/^#+\s*/, "");
  if (/^[A-Za-z][A-Za-z0-9 ()/._-]{1,60}:\s*\S/.test(plain)) return plain;
  if (/^Derived [a-z ]+facts/i.test(plain)) return plain;
  return null;
}

// Only the extracted field lines are carried into supplier mail. Prose and
// layout noise from the source file stay out so the reply says nothing the
// stored evidence does not support.
export function documentContextLines(document: ProcurementRequestDocument, budget: number) {
  const lines: string[] = [];
  let used = 0;
  const limit = Math.min(MAX_DOCUMENT_CONTEXT_CHARS, budget);
  if (document.summary) {
    const summary = document.summary.slice(0, Math.min(400, limit));
    lines.push(summary);
    used += summary.length;
  }
  for (const raw of document.markdown.split(/\r?\n/)) {
    if (lines.length >= MAX_DOCUMENT_CONTEXT_LINES || used >= limit) break;
    const line = factLine(raw);
    if (!line || lines.includes(line)) continue;
    lines.push(line.slice(0, limit - used));
    used += line.length;
  }
  return lines;
}

// The document lines a reply actually renders: attached documents only, walked
// in order under one shared character budget. The body and the state
// fingerprint both read from here, so a line the supplier never sees cannot
// count as supplier visible state.
export function renderedDocumentContext(args: {
  documents: readonly ProcurementRequestDocument[];
  attachments: readonly ProcurementDraftAttachment[];
}) {
  const attached = new Set(args.attachments.map((attachment) => attachment.documentId));
  const rendered: { documentId: string; name: string; lines: string[] }[] = [];
  let budget = MAX_TOTAL_DOCUMENT_CONTEXT_CHARS;
  for (const document of args.documents) {
    if (budget <= 0) break;
    if (!attached.has(document.documentId)) continue;
    const lines = documentContextLines(document, budget);
    if (!lines.length) continue;
    budget -= lines.join("\n").length;
    rendered.push({ documentId: document.documentId, name: document.name, lines });
  }
  return rendered;
}

function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function supplierGreetingName(vendor: ProcurementOrderVendor) {
  const contactName = vendor.contact?.name?.trim();
  const name = (contactName || vendor.name || "").replace(/[.,]$/, "").trim();
  return name || "there";
}

function quantityText(order: ProcurementOrderDetail) {
  const numeric = Number(order.quantity);
  const quantity = Number.isFinite(numeric) ? String(numeric) : String(order.quantity);
  return `${quantity} ${order.unit}`.trim();
}

export function buildFileDeliveryReplyBody(args: {
  order: ProcurementOrderDetail;
  vendor: ProcurementOrderVendor;
  companyName: string;
  documents: ProcurementRequestDocument[];
  attachments: ProcurementDraftAttachment[];
  variant?: ProcurementDraftVariant;
  // Answers to the questions this supplier actually asked, so the reply speaks
  // to their message instead of only restating the package.
  answers?: readonly string[];
}) {
  const { order, attachments } = args;
  const chase = args.variant === "CHASE";
  const included = new Set<string>();
  const documentSections = renderedDocumentContext({ documents: args.documents, attachments })
    .map((document) => {
      document.lines.forEach((line) => included.add(line));
      return [`From ${document.name}:`, ...document.lines].join("\n");
    });
  // Anything the request recorded but the file sections did not repeat, such as
  // a field the operator flagged as ambiguous, still has to reach the supplier.
  const specificationLines = (order.specification ?? "")
    .split(/\r?\n/)
    .flatMap((raw) => {
      const line = factLine(raw);
      return line && !included.has(line) ? [line] : [];
    })
    .slice(0, 14);
  const sections = [
    `Hello ${supplierGreetingName(args.vendor)},`,
    chase
      ? `Following up on ${order.material}. We sent the technical package you asked for and have not heard back, so it is attached again here in case it did not reach you.`
      : `Thank you for coming back to us on ${order.material}. The technical package you asked for is attached to this reply.`,
    [
      "Attached files:",
      ...attachments.map((attachment) => `- ${attachment.name} (${attachment.mimeType}, ${sizeLabel(attachment.size)})`),
    ].join("\n"),
    [
      "Build summary:",
      `Item: ${order.material}`,
      `Quantity: ${quantityText(order)}`,
      ...(order.neededBy ? [`Needed by: ${String(order.neededBy).slice(0, 10)}`] : []),
    ].join("\n"),
    ...(args.answers?.length
      ? [["Answers to your questions:", ...[...new Set(args.answers)].slice(0, 10).map((answer) => `- ${answer}`)].join("\n")]
      : []),
    ...documentSections,
    ...(specificationLines.length
      ? [["Also recorded on the request:", ...specificationLines].join("\n")]
      : []),
    [
      "The figures above are read from the files themselves, so please treat the files as the controlling source and tell us where they disagree with your process.",
      "",
      "Please reply with:",
      "1. Whether this build is inside your capability as drawn.",
      `2. Unit price at ${quantityText(order)}, and at 250 and 500 units.`,
      "3. Tooling, setup, or NRE cost if any.",
      "4. Lead time for tooling and for production.",
      "5. Anything still missing from this package.",
    ].join("\n"),
    ["Thank you,", "Sourcing desk", `Derya Supply OS, for ${args.companyName}`].join("\n"),
  ];
  return stripEmDashes(sections.join("\n\n")).slice(0, 8_000);
}

export function fileDeliveryReplySubject(args: { conversationSubject: string | null; order: ProcurementOrderDetail }) {
  const base = args.conversationSubject?.trim()
    || `[RFQ ${args.order.id.slice(0, 8)}] ${args.order.material}`;
  const subject = /^re:/i.test(base) ? base : `Re: ${base}`;
  return stripEmDashes(subject).replace(/[\r\n]+/g, " ").trim().slice(0, 180);
}

function requestWorkspaceId(order: ProcurementOrderDetail) {
  const source = record(record(order.requestContext).source);
  const workspaceId = typeof source.workspace_id === "string" ? source.workspace_id.trim() : "";
  if (!workspaceId) {
    throw new SupplyPersistenceError("This sourcing request is not linked to a Derya workspace, so supplier replies cannot be drafted.", "conflict");
  }
  return workspaceId;
}

function companyName(order: ProcurementOrderDetail) {
  const source = record(record(order.requestContext).source);
  const name = typeof source.company_name === "string" ? source.company_name.trim() : "";
  return name || "our customer";
}

function draftFromTask(task: { input: Prisma.JsonValue | null; result: Prisma.JsonValue | null }): ProcurementFileDeliveryDraft {
  const input = record(task.input);
  const message = record(input.message);
  const result = record(task.result);
  return {
    state: "DRAFT",
    variant: input.variant === "CHASE" ? "CHASE" : "REPLY",
    orderId: String(input.orderId ?? ""),
    vendorId: String(input.vendorId ?? ""),
    sourceMessageId: String(input.sourceMessageId ?? ""),
    recipient: String(message.recipient ?? ""),
    subject: String(message.subject ?? ""),
    body: String(message.body ?? ""),
    attachments: Array.isArray(input.attachments)
      ? input.attachments.map((entry) => {
          const attachment = record(entry);
          return {
            documentId: String(attachment.documentId ?? ""),
            name: String(attachment.name ?? ""),
            mimeType: String(attachment.mimeType ?? ""),
            size: Number(attachment.size ?? 0),
          };
        })
      : [],
    withheld: Array.isArray(input.withheld)
      ? input.withheld.map((entry) => {
          const withheld = record(entry);
          return { name: String(withheld.name ?? ""), reason: String(withheld.reason ?? "") };
        })
      : [],
    stateKey: typeof input.stateKey === "string" ? input.stateKey : null,
    savedAt: String(result.savedAt ?? ""),
  };
}

async function requestAttachmentState(args: { context: SupplyAccessContext; order: ProcurementOrderDetail }) {
  const access = await currentAccessContext(args.context);
  const workspaceId = requestWorkspaceId(args.order);
  const workspace = await requireSupplyWorkspace(access, workspaceId, "edit");
  if (!workspace.companyId) {
    throw new SupplyPersistenceError("This sourcing request is not linked to a company profile, so its files cannot be attached.", "conflict");
  }
  const documents = procurementRequestDocuments(args.order);
  const selection = await loadRequestDocumentAttachments({
    officeId: access.officeId,
    companyId: workspace.companyId,
    documentIds: documents.map((document) => document.documentId),
  });
  const attachments: ProcurementDraftAttachment[] = selection.attachments.map((attachment) => ({
    documentId: attachment.documentId,
    name: attachment.storedName,
    mimeType: attachment.contentType,
    size: attachment.bytes.length,
  }));
  return { access, workspaceId, documents, attachments, selection };
}

function stateKeyFor(args: {
  order: ProcurementOrderDetail;
  documents: ProcurementRequestDocument[];
  attachments: ProcurementDraftAttachment[];
}) {
  // A document the attachment screen withheld is never named or quoted to the
  // supplier, and neither is prose the body drops or a line past the body's
  // shared character budget, so the fingerprint reads the same rendered lines
  // the reply body renders.
  return procurementFileDraftStateKey({
    material: args.order.material,
    quantity: args.order.quantity,
    unit: args.order.unit,
    neededBy: args.order.neededBy == null ? null : String(args.order.neededBy),
    specification: args.order.specification,
    documents: renderedDocumentContext({
      documents: args.documents,
      attachments: args.attachments,
    }),
    attachments: args.attachments,
  });
}

// The request state a saved draft would repeat, read from live records rather
// than from the draft. The send path compares it with the fingerprint the draft
// stored, so an order whose quantity, date, specification, or file set moved
// after drafting cannot reach a supplier as if nothing had changed.
export async function procurementFileDraftCurrentStateKey(args: {
  context: SupplyAccessContext;
  order: ProcurementOrderDetail;
}): Promise<string> {
  const state = await requestAttachmentState(args);
  return stateKeyFor({ order: args.order, documents: state.documents, attachments: state.attachments });
}

export type ProcurementFileDraftFreshness = {
  fresh: boolean;
  reason: string | null;
  storedStateKey: string | null;
  currentStateKey: string | null;
};

export async function procurementFileDraftFreshness(args: {
  context: SupplyAccessContext;
  order: ProcurementOrderDetail;
  draft: Pick<ProcurementFileDeliveryDraft, "stateKey">;
}): Promise<ProcurementFileDraftFreshness> {
  const currentStateKey = await procurementFileDraftCurrentStateKey({ context: args.context, order: args.order });
  const storedStateKey = args.draft.stateKey;
  if (!storedStateKey) {
    return { fresh: false, reason: PROCUREMENT_FILE_DRAFT_UNVERIFIED_REASON, storedStateKey: null, currentStateKey };
  }
  if (storedStateKey !== currentStateKey) {
    return { fresh: false, reason: PROCUREMENT_FILE_DRAFT_STALE_REASON, storedStateKey, currentStateKey };
  }
  return { fresh: true, reason: null, storedStateKey, currentStateKey };
}

export type ProcurementFileSendDecision =
  | { deliver: true }
  // `audited` is false when the refusal could not be written to the event
  // trail, so a run can tell an audited refusal from an unaudited one.
  | { deliver: false; reason: string; audited: boolean };

export const PROCUREMENT_FILE_DRAFT_UNAUDITED_REFUSAL_SUFFIX =
  " The refusal could not be recorded on the supplier communication trail, so this run needs an operator.";

// The recheck every file bearing delivery passes through. It reads the request
// state from live records, compares it with the state the draft was built on,
// and records the refusal on the draft's own event trail. Nothing here contacts
// a provider, so scripts/state-recheck.test.ts exercises the real gate.
export async function procurementFileDraftSendDecision(args: {
  context: SupplyAccessContext;
  order: ProcurementOrderDetail;
  vendorId: string;
  draft: Pick<ProcurementFileDeliveryDraft, "stateKey">;
}): Promise<ProcurementFileSendDecision> {
  // A recheck that cannot run is not a pass, so an unreadable request state
  // refuses the delivery the same way a changed one does.
  const freshness = await procurementFileDraftFreshness(args)
    .catch((error): ProcurementFileDraftFreshness => ({
      fresh: false,
      reason: error instanceof Error ? error.message : "The saved draft state could not be rechecked before sending.",
      storedStateKey: args.draft.stateKey,
      currentStateKey: null,
    }));
  if (freshness.fresh) return { deliver: true };
  // Delivery stays refused either way, but a refusal with no trail entry is
  // reported as such instead of reading like a routine stale outcome.
  const audited = await recordProcurementFileDraftStaleRefusal({
    context: args.context,
    order: args.order,
    vendorId: args.vendorId,
    freshness,
  }).catch(() => false);
  const reason = freshness.reason ?? PROCUREMENT_FILE_DRAFT_STALE_REASON;
  return {
    deliver: false,
    reason: audited ? reason : `${reason}${PROCUREMENT_FILE_DRAFT_UNAUDITED_REFUSAL_SUFFIX}`,
    audited,
  };
}

// A refused delivery is a decision, so it is appended to the draft's own event
// trail instead of being dropped in a run summary the operator may never read.
export async function recordProcurementFileDraftStaleRefusal(args: {
  context: SupplyAccessContext;
  order: ProcurementOrderDetail;
  vendorId: string;
  freshness: ProcurementFileDraftFreshness;
}): Promise<boolean> {
  const access = await currentAccessContext(args.context);
  const workspaceId = requestWorkspaceId(args.order);
  const task = await prisma.supplyExecutionTask.findFirst({
    where: {
      officeId: access.officeId,
      workspaceId,
      taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE,
      taskKey: { startsWith: `${draftTaskScopeKey({ orderId: args.order.id, vendorId: args.vendorId })}:` },
      status: "PLANNED",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (!task) return false;
  await prisma.$transaction(async (tx) => {
    await appendSupplierCommunicationEvent({
      tx,
      taskId: task.id,
      officeId: access.officeId,
      workspaceId,
      actorUserId: access.userId,
      eventType: "PROCUREMENT_SUPPLIER_FILE_REPLY_REFUSED_STALE",
      status: "PLANNED",
      message: args.freshness.reason ?? PROCUREMENT_FILE_DRAFT_STALE_REASON,
      payload: inputJson({
        orderId: args.order.id,
        vendorId: args.vendorId,
        storedStateKey: args.freshness.storedStateKey,
        currentStateKey: args.freshness.currentStateKey,
      }),
    });
  });
  return true;
}

export async function saveProcurementFileDeliveryDraft(args: {
  context: SupplyAccessContext;
  customerId: string;
  order: ProcurementOrderDetail;
  vendor: ProcurementOrderVendor;
  sourceMessageId: string;
  recipient: string;
  conversationSubject: string | null;
  // A chase repeats the same files on a thread the supplier left quiet, so it
  // opens differently and is delivered by the chase send path.
  variant?: ProcurementDraftVariant;
  answers?: readonly string[];
}): Promise<ProcurementFileDeliveryDraft> {
  const documents = procurementRequestDocuments(args.order);
  if (!documents.length) {
    throw new SupplyPersistenceError("This sourcing request has no stored source files to send.", "conflict");
  }
  const state = await requestAttachmentState({ context: args.context, order: args.order });
  const { access, workspaceId, attachments, selection } = state;
  if (!attachments.length) {
    throw new SupplyPersistenceError("None of the stored request files passed the attachment safety check.", "conflict");
  }
  const withheld = selection.skipped.map((skip: RequestDocumentAttachmentSkip) => ({
    name: skip.name,
    reason: skip.reason,
  }));
  const message = {
    recipient: singleEmail(args.recipient, "Supplier recipient"),
    subject: fileDeliveryReplySubject({ conversationSubject: args.conversationSubject, order: args.order }),
    body: messageBody(buildFileDeliveryReplyBody({
      order: args.order,
      vendor: args.vendor,
      companyName: companyName(args.order),
      documents,
      attachments,
      variant: args.variant,
      answers: args.answers,
    })),
  };
  const sourceMessageId = requiredText(args.sourceMessageId, "Displayed supplier message", 512);
  const taskScopeKey = draftTaskScopeKey({ orderId: args.order.id, vendorId: args.vendor.id });
  const savedAt = new Date().toISOString();
  const taskInput = {
    customerId: args.customerId,
    orderId: args.order.id,
    vendorId: args.vendor.id,
    variant: args.variant === "CHASE" ? "CHASE" : "REPLY",
    sourceMessageId,
    message,
    messageHash: digest(message),
    attachments,
    withheld,
    stateKey: stateKeyFor({ order: args.order, documents, attachments }),
  };
  const result = { state: "DRAFT", savedAt, attachmentCount: attachments.length };
  const existing = await prisma.supplyExecutionTask.findMany({
    where: { workspaceId, taskKey: { startsWith: `${taskScopeKey}:` } },
    select: { id: true, officeId: true, taskType: true, status: true },
  });
  if (existing.some((row) => row.officeId !== access.officeId || row.taskType !== PROCUREMENT_REPLY_DRAFT_TASK_TYPE)) {
    throw new SupplyPersistenceError("The supplier reply draft scope conflicts with an existing record.", "conflict");
  }
  // Execution task input is immutable once written, so redrafting supersedes
  // the previous draft instead of editing it. Drafts stay PLANNED because an
  // unsent draft carries no human approval yet.
  const task = await prisma.$transaction(async (tx) => {
    for (const row of existing) {
      if (!DRAFT_LIVE_STATUSES.includes(row.status)) continue;
      await tx.supplyExecutionTask.update({
        where: { id: row.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    }
    const taskKey = `${taskScopeKey}:${existing.length + 1}`;
    const saved = await tx.supplyExecutionTask.create({
      data: {
        officeId: access.officeId,
        workspaceId,
        createdByUserId: access.userId,
        taskKey,
        taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE,
        capabilityKey: "draft.procurement_supplier_files",
        status: "PLANNED",
        requiresApproval: true,
        input: inputJson(taskInput),
        inputHash: digest(taskInput),
        result: inputJson(result),
        resultHash: digest(result),
        idempotencyKey: taskKey,
      },
      select: { id: true, input: true, result: true },
    });
    await appendSupplierCommunicationEvent({
      tx,
      taskId: saved.id,
      officeId: access.officeId,
      workspaceId,
      actorUserId: access.userId,
      eventType: "PROCUREMENT_SUPPLIER_FILE_REPLY_DRAFTED",
      status: "PLANNED",
      message: args.variant === "CHASE"
        ? "A follow up carrying the stored request files was saved as a draft for a supplier that went quiet. Nothing was sent."
        : "A supplier reply carrying the stored request files was saved as a draft. Nothing was sent.",
      payload: inputJson({
        orderId: args.order.id,
        vendorId: args.vendor.id,
        sourceMessageId,
        attachments: attachments.map((attachment) => attachment.name),
        withheld,
      }),
    });
    return saved;
  });
  return draftFromTask(task);
}

// A draft that was delivered stops being a draft, so the saved task records the
// approval that sent it instead of staying PLANNED and being offered again.
export async function markProcurementFileDeliveryDraftSent(args: {
  context: SupplyAccessContext;
  order: ProcurementOrderDetail;
  vendorId: string;
  sourceMessageId: string;
  providerMessageId: string;
}): Promise<boolean> {
  const access = await currentAccessContext(args.context);
  const workspaceId = requestWorkspaceId(args.order);
  const task = await prisma.supplyExecutionTask.findFirst({
    where: {
      officeId: access.officeId,
      workspaceId,
      taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE,
      taskKey: { startsWith: `${draftTaskScopeKey({ orderId: args.order.id, vendorId: args.vendorId })}:` },
      status: "PLANNED",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, inputHash: true },
  });
  if (!task) return false;
  await prisma.$transaction(async (tx) => {
    // The draft was written with requiresApproval, so the database guard only
    // lets it complete once a matching approval exists. The operator send is
    // that approval, recorded against the exact draft input it delivered.
    const now = new Date();
    const approval = await tx.supplyApproval.create({
      data: {
        officeId: access.officeId,
        workspaceId,
        executionTaskId: task.id,
        requestedByUserId: access.userId,
        requiredRole: access.role,
        scopeHash: task.inputHash,
        requestReason: "An operator confirmed delivery of the saved supplier file reply.",
        idempotencyKey: `procurement-file-reply-send:${task.id}`,
      },
      select: { id: true },
    });
    await tx.supplyApproval.update({
      where: { id: approval.id },
      data: {
        status: "APPROVED",
        decidedByUserId: access.userId,
        decidedAt: now,
        decisionNote: "Approved by the operator send command.",
      },
    });
    // The guard only allows PLANNED to READY to RUNNING to SUCCEEDED, so the
    // delivered draft walks the same lifecycle every other executed task does.
    await tx.supplyExecutionTask.update({ where: { id: task.id }, data: { status: "READY" } });
    await tx.supplyExecutionTask.update({ where: { id: task.id }, data: { status: "RUNNING", startedAt: now } });
    await tx.supplyExecutionTask.update({
      where: { id: task.id },
      data: { status: "SUCCEEDED", completedAt: now },
    });
    await appendSupplierCommunicationEvent({
      tx,
      taskId: task.id,
      officeId: access.officeId,
      workspaceId,
      actorUserId: access.userId,
      eventType: "PROCUREMENT_SUPPLIER_FILE_REPLY_SENT",
      status: "SUCCEEDED",
      message: "The saved supplier reply carrying the request files was approved and delivered.",
      payload: inputJson({
        orderId: args.order.id,
        vendorId: args.vendorId,
        sourceMessageId: args.sourceMessageId,
        providerMessageId: args.providerMessageId,
      }),
    });
  });
  return true;
}

export async function getProcurementFileDeliveryDraft(args: {
  officeId: string;
  order: ProcurementOrderDetail;
  vendorId: string;
}): Promise<ProcurementFileDeliveryDraft | null> {
  const source = record(record(args.order.requestContext).source);
  const workspaceId = typeof source.workspace_id === "string" ? source.workspace_id.trim() : "";
  if (!workspaceId) return null;
  const task = await prisma.supplyExecutionTask.findFirst({
    where: {
      officeId: args.officeId,
      workspaceId,
      taskType: PROCUREMENT_REPLY_DRAFT_TASK_TYPE,
      taskKey: { startsWith: `${draftTaskScopeKey({ orderId: args.order.id, vendorId: args.vendorId })}:` },
      status: "PLANNED",
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { input: true, result: true },
  });
  return task ? draftFromTask(task) : null;
}
