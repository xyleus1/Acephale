"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  LoaderCircle,
  Mail,
  MessageSquare,
  PackageCheck,
  Paperclip,
  PenLine,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProcurementConversation } from "@/lib/procurement-conversation-model";
import {
  procurementContextReplyBody,
  type ProcurementInboundTriage,
} from "@/lib/procurement-inbound-triage";
import { PROCUREMENT_APPROVAL_STATUSES } from "@/lib/procurement-status";
import { PROCUREMENT_REPLY_SENDER_UNAVAILABLE } from "@/lib/procurement-reply-errors";
import {
  type CustomerProcurementListItem,
} from "@/lib/supply-os/customer-procurement";
import {
  customerProcurementContactSummary,
  customerProcurementEvidenceSummary,
  customerProcurementQuoteSummary,
  customerProcurementStatusLabel,
  type CustomerProcurementRequestDetail,
} from "@/lib/supply-os/customer-procurement-status";
import {
  EMPTY_SUPPLIER_THREAD_RECEIPT,
  externalPoReady,
  externalPoState,
  externalSourcingActive,
  externalVendorActivityLabel,
  externalVendorOutreachRead,
  externalVendorPoReady,
  externalVendorPoState,
  externalVendorResponseCount,
  externalVendorResponseRead,
  groupActiveHistoricalSourcing,
  historicalPoReady,
  historicalPoState,
  historicalResponseCount,
  historicalSituation,
  historicalSupplierContacted,
  historicalSupplierResponded,
  supplierThreadReceipt,
  type SupplierThreadReceipt,
} from "./supply-os-active-sourcing-model";
import type {
  SavedProcurementCase,
  SavedSourcingResearchRun,
} from "./supply-os-sourcing-research-types";
import styles from "./supply-os-logistics.module.css";

type Selection = { kind: "workflow" | "historical"; id: string };
type ConversationState = "idle" | "loading" | "ready" | "error";
type ReplyDraftState = "idle" | "loading" | "ready" | "error";
type ReplySendState = "idle" | "confirming" | "sending" | "sent" | "error";
type ReplyDraftAttachment = {
  documentId: string;
  name: string;
  mimeType: string;
  size: number;
};
type ReplyDraft = {
  recipient: string;
  subject: string;
  body: string;
  sourceMessageId: string;
  attachments?: ReplyDraftAttachment[];
  withheld?: Array<{ name: string; reason: string }>;
  saved?: boolean;
};
type ReplyDelivery = {
  state: "SENT";
  accountEmail: string;
  recipient: string;
  sourceUrl: string;
  sentAt: string;
  alreadySent: boolean;
};

class SupplierActivityRequestError extends Error {
  constructor(message: string, readonly status: number, readonly reason: string | null) {
    super(message);
    this.name = "SupplierActivityRequestError";
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function contextAnswerSubject(subject: string | null) {
  const threadSubject = (subject ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s*\u2014\s*/g, " - ")
    .replace(/^\[[^\]\r\n]{1,80}\]\s*(?=(?:(?:re|fw|fwd)\s*:))/i, "")
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
    .trim() || "Supplier sourcing request";
  return `Re: ${threadSubject}`.slice(0, 240);
}

function responseCountLabel(responses: number) {
  return `${responses} response${responses === 1 ? "" : "s"}`;
}

function outreachLabel(contacted: number, suppliers: number) {
  return `${contacted} of ${suppliers} contacted`;
}

function workflowSituation(
  request: CustomerProcurementListItem,
  detail: CustomerProcurementRequestDetail,
  vendor: CustomerProcurementRequestDetail["vendors"][number],
  receipt: SupplierThreadReceipt,
) {
  const poState = externalVendorPoState(request, detail, vendor.id);
  if (poState === "Purchase order placed") return "The purchase order for this manufacturer was approved and placed.";
  if (poState === "Ready for PO approval") return "This manufacturer is selected and ready for final purchase order approval.";
  if (poState === "Not selected for PO") return "This manufacturer was not selected for the purchase order.";
  if (poState.includes("supplier selection not recorded")) return "The order advanced, but the workflow did not record which manufacturer was selected.";
  if (vendor.quote) return "The manufacturer responded and commercial terms are recorded for review.";
  if (externalVendorResponseCount(vendor) > 0) return "The manufacturer replied. Commercial terms are not recorded yet.";
  if (vendor.contacted) return "The manufacturer was contacted. The workflow is waiting for a response.";
  if (receipt.inbound > 0) return "The connected thread below has supplier replies that the workflow did not record. Read the thread before trusting the counts.";
  if (receipt.outbound > 0) return "The connected thread below has sent messages that the workflow did not record as a contact receipt.";
  return "The manufacturer was identified, but no supplier contact receipt is recorded yet.";
}

function historicalDraft(procurementCase: SavedProcurementCase | null) {
  if (!procurementCase) return null;
  const sent = procurementCase.supplierEmailAction?.input.message;
  if (sent) return { ...sent, label: procurementCase.supplierEmailAction?.result?.state === "SENT" ? "Sent message record" : "Approved message" };
  const draft = procurementCase.supplierEmailDraft?.result?.message;
  return draft ? { ...draft, label: "Draft, not sent" } : null;
}

async function fetchJson<T>(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", signal, headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error ?? "The supplier activity could not be loaded.");
  return payload as T;
}

async function postJson<T>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string; reason?: string }) | null;
  if (!response.ok) throw new SupplierActivityRequestError(payload?.error ?? "The reply draft could not be generated.", response.status, payload?.reason ?? null);
  return payload as T;
}

function ConversationMessages({
  conversation,
  state,
  error,
  fallbackCase,
}: {
  conversation: ProcurementConversation | null;
  state: ConversationState;
  error: string | null;
  fallbackCase: SavedProcurementCase | null;
}) {
  const draft = historicalDraft(fallbackCase);
  if (state === "loading") return <div className={styles.activeConversationEmpty}><LoaderCircle size={17} /> Loading exact thread</div>;
  if (state === "error") return <div className={styles.activeConversationEmpty}><MessageSquare size={17} /><span>{error ?? "Conversation unavailable."}</span></div>;
  if (conversation?.available && conversation.messages.length) {
    return (
      <div className={styles.activeConversationMessages}>
        {conversation.messages.map((message) => (
          <article key={message.id} data-direction={message.direction.toLowerCase()}>
            <header>
              <span><strong>{message.direction === "OUTBOUND" ? "Derya" : message.fromName ?? message.fromEmail}</strong><small>{message.direction === "OUTBOUND" ? `To ${message.toEmails.join(", ") || "supplier"}` : message.fromEmail}</small></span>
              <time>{formatDate(message.sentAt)}</time>
            </header>
            {message.subject ? <h4>{message.subject}</h4> : null}
            <p>{message.body || "Message body unavailable."}</p>
            {message.truncated ? <small>Message body truncated at the dashboard safety limit.</small> : null}
          </article>
        ))}
      </div>
    );
  }
  if (draft) {
    return (
      <div className={styles.activeConversationMessages}>
        <article data-direction="outbound">
          <header><span><strong>{draft.label}</strong><small>To {draft.recipient}</small></span></header>
          <h4>{draft.subject}</h4>
          <p>{draft.body}</p>
        </article>
        <div className={styles.activeConversationEmpty}><MessageSquare size={17} /><span>{conversation?.unavailableReason ?? "No connected thread is recorded."}</span></div>
      </div>
    );
  }
  return <div className={styles.activeConversationEmpty}><MessageSquare size={17} /><span>{conversation?.unavailableReason ?? "No message or connected conversation is recorded for this supplier."}</span></div>;
}

export function ActiveSourcingWorkspace({
  workflowRequests,
  historicalRuns,
  historicalCases,
  onOpenWorkflowRequest,
  onOpenHistoricalRun,
  hasMoreHistorical,
  historicalPageState,
  onLoadOlderHistorical,
}: {
  workflowRequests: CustomerProcurementListItem[];
  historicalRuns: SavedSourcingResearchRun[];
  historicalCases: SavedProcurementCase[];
  onOpenWorkflowRequest: (request: CustomerProcurementListItem) => void;
  onOpenHistoricalRun: (run: SavedSourcingResearchRun) => void;
  hasMoreHistorical: boolean;
  historicalPageState: "idle" | "loading" | "error";
  onLoadOlderHistorical: () => void;
}) {
  const activeWorkflowRequests = useMemo(
    () => workflowRequests.filter(externalSourcingActive),
    [workflowRequests],
  );
  const historicalGroups = useMemo(
    () => groupActiveHistoricalSourcing(historicalRuns, historicalCases),
    [historicalCases, historicalRuns],
  );
  const [selection, setSelection] = useState<Selection | null>(null);
  const [workflowDetail, setWorkflowDetail] = useState<CustomerProcurementRequestDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const [manufacturerId, setManufacturerId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ProcurementConversation | null>(null);
  const [conversationState, setConversationState] = useState<ConversationState>("idle");
  const [conversationError, setConversationError] = useState<string | null>(null);
  const [conversationRevision, setConversationRevision] = useState(0);
  const [triage, setTriage] = useState<ProcurementInboundTriage | null>(null);
  const [replyDraft, setReplyDraft] = useState<ReplyDraft | null>(null);
  const [replyDraftState, setReplyDraftState] = useState<ReplyDraftState>("idle");
  const [replyDraftError, setReplyDraftError] = useState<string | null>(null);
  const [replyDraftErrorReason, setReplyDraftErrorReason] = useState<string | null>(null);
  const [replyCopied, setReplyCopied] = useState(false);
  const [replySendState, setReplySendState] = useState<ReplySendState>("idle");
  const [replyDelivery, setReplyDelivery] = useState<ReplyDelivery | null>(null);

  const workflowRequest = selection?.kind === "workflow"
    ? activeWorkflowRequests.find((request) => request.id === selection.id) ?? null
    : null;
  const historicalGroup = selection?.kind === "historical"
    ? historicalGroups.find((group) => group.id === selection.id) ?? null
    : null;
  const historicalCase = historicalGroup?.cases.find((procurementCase) => procurementCase.id === manufacturerId)
    ?? historicalGroup?.cases[0]
    ?? null;
  const workflowVendor = workflowDetail?.vendors.find((vendor) => vendor.id === manufacturerId)
    ?? workflowDetail?.vendors[0]
    ?? null;
  const workflowRequestId = workflowRequest?.id ?? null;
  const workflowRequestUpdatedAt = workflowRequest?.updatedAt ?? null;
  const workflowVendorId = workflowVendor?.id ?? null;
  const historicalCaseId = historicalCase?.id ?? null;
  const replySelectionRef = useRef("");
  replySelectionRef.current = `${workflowRequestId ?? ""}:${workflowVendorId ?? ""}`;

  useEffect(() => {
    const selectionValid = selection?.kind === "workflow"
      ? activeWorkflowRequests.some((request) => request.id === selection.id)
      : selection?.kind === "historical"
        ? historicalGroups.some((group) => group.id === selection.id)
        : false;
    if (selectionValid) return;
    if (activeWorkflowRequests[0]) setSelection({ kind: "workflow", id: activeWorkflowRequests[0].id });
    else if (historicalGroups[0]) setSelection({ kind: "historical", id: historicalGroups[0].id });
    else if (selection) setSelection(null);
  }, [activeWorkflowRequests, historicalGroups, selection]);

  useEffect(() => {
    setConversation(null);
    setConversationState("idle");
    setConversationError(null);
    if (!workflowRequestId) {
      setWorkflowDetail(null);
      setDetailState("idle");
      return;
    }
    const controller = new AbortController();
    setWorkflowDetail(null);
    setDetailState("loading");
    setDetailError(null);
    void fetchJson<CustomerProcurementRequestDetail>(
      `/api/procurement/requests/${encodeURIComponent(workflowRequestId)}`,
      controller.signal,
    ).then((detail) => {
      setWorkflowDetail(detail);
      setManufacturerId((current) => detail.vendors.some((vendor) => vendor.id === current)
        ? current
        : detail.vendors[0]?.id ?? null);
      setDetailState("ready");
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setWorkflowDetail(null);
      setDetailState("error");
      setDetailError(error instanceof Error ? error.message : "Supplier detail unavailable.");
    });
    return () => controller.abort();
  }, [detailRevision, workflowRequestId, workflowRequestUpdatedAt]);

  useEffect(() => {
    const controller = new AbortController();
    const url = workflowRequestId && workflowVendorId
      ? `/api/procurement/requests/${encodeURIComponent(workflowRequestId)}/vendors/${encodeURIComponent(workflowVendorId)}/conversation`
      : historicalCaseId
        ? `/api/supply-os/procurement-cases/${encodeURIComponent(historicalCaseId)}/conversation`
        : null;
    if (!url) {
      setConversation(null);
      setConversationState("idle");
      return () => controller.abort();
    }
    setConversation(null);
    setConversationState("loading");
    setConversationError(null);
    setTriage(null);
    void fetchJson<{
      conversation: ProcurementConversation;
      triage?: ProcurementInboundTriage | null;
      fileDraft?: (ReplyDraft & { state: "DRAFT" }) | null;
    }>(url, controller.signal)
      .then((payload) => {
        setConversation(payload.conversation);
        setTriage(payload.triage ?? null);
        const saved = payload.fileDraft;
        if (saved && saved.sourceMessageId === payload.conversation.messages.at(-1)?.id) {
          setReplyDraft({ ...saved, saved: true });
          setReplyDraftState("ready");
        }
        setConversationState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setConversationState("error");
        setConversationError(error instanceof Error ? error.message : "Conversation unavailable.");
      });
    return () => controller.abort();
  }, [conversationRevision, historicalCaseId, workflowRequestId, workflowRequestUpdatedAt, workflowVendorId]);

  useEffect(() => {
    setReplyDraft(null);
    setReplyDraftState("idle");
    setReplyDraftError(null);
    setReplyDraftErrorReason(null);
    setReplyCopied(false);
    setReplySendState("idle");
    setReplyDelivery(null);
  }, [workflowRequestId, workflowVendorId]);

  useEffect(() => {
    if (conversationState !== "ready" || !replyDraft || replySendState === "sent") return;
    if (conversation?.messages.at(-1)?.id === replyDraft.sourceMessageId) return;
    setReplyDraft(null);
    setReplyDraftState("idle");
    setReplySendState("idle");
  }, [conversation, conversationState, replyDraft, replySendState]);

  const threadReceipt = supplierThreadReceipt(conversation);
  const workflowContacted = activeWorkflowRequests.reduce((sum, request) => sum + request.contactedCount, 0);
  const workflowResponses = activeWorkflowRequests.reduce((sum, request) => sum + request.responseCount, 0);
  const historicalContacted = historicalGroups.reduce((sum, group) => sum + group.contactedCount, 0);
  const historicalResponses = historicalGroups.reduce((sum, group) => sum + group.responseCount, 0);
  const totalSuppliers = activeWorkflowRequests.reduce((sum, request) => sum + request.supplierCount, 0)
    + historicalGroups.reduce((sum, group) => sum + group.supplierCount, 0);
  const totalContacted = workflowContacted + historicalContacted;
  const totalResponses = workflowResponses + historicalResponses;
  const poReady = activeWorkflowRequests.filter(externalPoReady).length
    + historicalGroups.reduce((sum, group) => sum + group.poReadyCount, 0);

  const retryWorkflowDetail = () => {
    if (!workflowRequest) return;
    setDetailRevision((revision) => revision + 1);
  };

  const createReplyDraft = async () => {
    if (!workflowRequestId || !workflowVendorId) return;
    const displayedInbound = conversation?.messages.at(-1);
    if (displayedInbound?.direction !== "INBOUND") return;
    const selectionKey = replySelectionRef.current;
    setReplyDraft(null);
    setReplyDraftState("loading");
    setReplyDraftError(null);
    setReplyDraftErrorReason(null);
    setReplyCopied(false);
    try {
      const payload = await postJson<{ draft: ReplyDraft }>(
        `/api/procurement/requests/${encodeURIComponent(workflowRequestId)}/vendors/${encodeURIComponent(workflowVendorId)}/conversation`,
        { sourceMessageId: displayedInbound.id },
      );
      if (replySelectionRef.current !== selectionKey) return;
      setReplyDraft(payload.draft);
      setReplyDraftState("ready");
      setReplySendState("idle");
      setReplyDelivery(null);
    } catch (error) {
      if (replySelectionRef.current !== selectionKey) return;
      if (error instanceof SupplierActivityRequestError && error.status === 409) {
        setConversationRevision((revision) => revision + 1);
      }
      setReplyDraftState("error");
      setReplyDraftError(error instanceof Error ? error.message : "The reply draft could not be generated.");
      setReplyDraftErrorReason(error instanceof SupplierActivityRequestError ? error.reason : null);
    }
  };

  // Saving the request files as a draft never sends. Delivery stays behind the
  // send confirmation below.
  const draftReplyWithRequestFiles = async () => {
    if (!workflowRequestId || !workflowVendorId) return;
    const displayedInbound = conversation?.messages.at(-1);
    if (displayedInbound?.direction !== "INBOUND") return;
    const selectionKey = replySelectionRef.current;
    setReplyDraft(null);
    setReplyDraftState("loading");
    setReplyDraftError(null);
    setReplyDraftErrorReason(null);
    setReplyCopied(false);
    try {
      const payload = await postJson<{ draft: ReplyDraft }>(
        `/api/procurement/requests/${encodeURIComponent(workflowRequestId)}/vendors/${encodeURIComponent(workflowVendorId)}/conversation`,
        { sourceMessageId: displayedInbound.id, withRequestFiles: true },
      );
      if (replySelectionRef.current !== selectionKey) return;
      setReplyDraft({ ...payload.draft, saved: true });
      setReplyDraftState("ready");
      setReplySendState("idle");
      setReplyDelivery(null);
    } catch (error) {
      if (replySelectionRef.current !== selectionKey) return;
      setReplyDraftState("error");
      setReplyDraftError(error instanceof Error ? error.message : "The request files could not be prepared.");
      setReplyDraftErrorReason(error instanceof SupplierActivityRequestError ? error.reason : null);
    }
  };

  const useContextAnswer = () => {
    const displayedInbound = conversation?.messages.at(-1);
    if (!triage || triage.decision !== "AUTO_ANSWER" || displayedInbound?.direction !== "INBOUND") return;
    setReplyDraft({
      recipient: displayedInbound.fromEmail,
      subject: contextAnswerSubject(displayedInbound.subject),
      body: procurementContextReplyBody({
        supplierName: displayedInbound.fromName,
        answered: triage.answered,
      }),
      sourceMessageId: displayedInbound.id,
    });
    setReplyDraftState("ready");
    setReplyDraftError(null);
    setReplyDraftErrorReason(null);
    setReplyCopied(false);
    setReplySendState("idle");
    setReplyDelivery(null);
  };

  const copyReplyDraft = async () => {
    if (!replyDraft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${replyDraft.subject}\n\n${replyDraft.body}`);
      setReplyCopied(true);
    } catch {
      setReplyDraftError("Copy failed. Select the draft text and copy it manually.");
      setReplyDraftErrorReason(null);
    }
  };

  const updateReplyDraft = (field: "subject" | "body", value: string) => {
    if (replySendState === "sent") return;
    setReplyDraft((current) => current ? { ...current, [field]: value } : current);
    setReplyCopied(false);
    setReplyDraftError(null);
    setReplyDraftErrorReason(null);
    setReplySendState("idle");
  };

  const sendReplyDraft = async () => {
    if (!replyDraft || !workflowRequestId || !workflowVendorId || replySendState === "sending") return;
    const selectionKey = replySelectionRef.current;
    setReplySendState("sending");
    setReplyDraftError(null);
    setReplyDraftErrorReason(null);
    try {
      const payload = await postJson<{ delivery: ReplyDelivery }>(
        `/api/procurement/requests/${encodeURIComponent(workflowRequestId)}/vendors/${encodeURIComponent(workflowVendorId)}/conversation/send`,
        {
          confirmed: true,
          sourceMessageId: replyDraft.sourceMessageId,
          recipient: replyDraft.recipient,
          subject: replyDraft.subject,
          body: replyDraft.body,
          ...(replyDraft.attachments?.length
            ? { attachmentDocumentIds: replyDraft.attachments.map((attachment) => attachment.documentId) }
            : {}),
        },
      );
      if (replySelectionRef.current !== selectionKey) return;
      setReplyDelivery(payload.delivery);
      setReplySendState("sent");
      setConversationRevision((revision) => revision + 1);
      setDetailRevision((revision) => revision + 1);
    } catch (error) {
      if (replySelectionRef.current !== selectionKey) return;
      if (error instanceof SupplierActivityRequestError && error.status === 409) {
        setConversationRevision((revision) => revision + 1);
      }
      setReplySendState("error");
      setReplyDraftError(error instanceof Error ? error.message : "The supplier reply could not be sent.");
      setReplyDraftErrorReason(error instanceof SupplierActivityRequestError ? error.reason : null);
    }
  };

  return (
    <section className={styles.activeSourcingWorkspace} aria-label="Active supplier messages">
      <header className={styles.activeSourcingHeader}>
        <span><small>Supplier activity</small><h2>Active sourcing</h2><p>Contact receipts, replies, exact threads, and purchase order readiness.</p></span>
        <dl>
          <div><dt>Reached out</dt><dd>{totalContacted}<small>of {totalSuppliers} manufacturers</small></dd></div>
          <div><dt>Responded</dt><dd>{totalResponses}<small>supplier responses</small></dd></div>
          <div><dt>PO ready</dt><dd>{poReady}<small>workstreams or orders</small></dd></div>
        </dl>
      </header>

      <div className={styles.activeSourcingTableRegion}>
        <table className={styles.activeSourcingTable}>
          <thead><tr><th>Request</th><th>Outreach</th><th>Responses</th><th>Purchase order</th><th>Action</th></tr></thead>
          <tbody>
            {activeWorkflowRequests.map((request) => (
              <tr key={`workflow:${request.id}`} data-active={selection?.kind === "workflow" && selection.id === request.id}>
                <td><button type="button" onClick={() => setSelection({ kind: "workflow", id: request.id })}><span className={styles.inventoryStatusDot} /><span><small>Automated workflow</small><strong title={request.material}>{request.material}</strong><em>{request.quantity.toLocaleString("en-US")} {request.unit}</em></span></button></td>
                <td>{outreachLabel(request.contactedCount, request.supplierCount)}</td>
                <td>{responseCountLabel(request.responseCount)}</td>
                <td>{externalPoState(request.status)}</td>
                <td><button type="button" className={styles.sourcingQueueAction} onClick={() => setSelection({ kind: "workflow", id: request.id })}>Inspect <ArrowRight size={13} /></button></td>
              </tr>
            ))}
            {historicalGroups.map((group) => (
              <tr key={`historical:${group.id}`} data-active={selection?.kind === "historical" && selection.id === group.id}>
                <td><button type="button" onClick={() => setSelection({ kind: "historical", id: group.id })}><span className={styles.inventoryStatusDot} /><span><small>Historical Derya workstream</small><strong title={group.title}>{group.title}</strong><em title={group.itemKey}>{group.itemKey}</em></span></button></td>
                <td>{outreachLabel(group.contactedCount, group.supplierCount)}</td>
                <td>{responseCountLabel(group.responseCount)}</td>
                <td>{group.poReadyCount ? `${group.poReadyCount} PO-ready` : "Not ready for PO"}</td>
                <td><button type="button" className={styles.sourcingQueueAction} onClick={() => setSelection({ kind: "historical", id: group.id })}>Inspect <ArrowRight size={13} /></button></td>
              </tr>
            ))}
            {!activeWorkflowRequests.length && !historicalGroups.length ? (
              <tr data-empty="true"><td colSpan={5}><Mail size={18} /><strong>No active supplier outreach yet</strong><span>Start a sourcing request from Inventory. Contact and response receipts will appear here.</span></td></tr>
            ) : null}
          </tbody>
        </table>
        {hasMoreHistorical ? (
          <div className={styles.activeSourcingLoadMore}>
            <span>Historical totals cover loaded records. Load older activity to complete the historical view.</span>
            <button type="button" onClick={onLoadOlderHistorical} disabled={historicalPageState === "loading"}>
              {historicalPageState === "loading" ? <LoaderCircle size={13} /> : <RefreshCw size={13} />}
              {historicalPageState === "loading" ? "Loading" : historicalPageState === "error" ? "Retry older activity" : "Load older activity"}
            </button>
          </div>
        ) : null}
      </div>

      {selection ? (
        <section className={styles.activeSourcingDetail}>
          <aside className={styles.activeManufacturerList}>
            <header><small>Manufacturers</small><strong>{workflowRequest?.material ?? historicalGroup?.title}</strong></header>
            {detailState === "loading" && workflowRequest ? <div className={styles.activeConversationEmpty}><LoaderCircle size={17} /> Loading manufacturers</div> : null}
            {detailState === "error" && workflowRequest ? <div className={styles.activeConversationEmpty}><span>{detailError}</span><button type="button" onClick={retryWorkflowDetail}><RefreshCw size={13} /> Retry</button></div> : null}
            {workflowDetail?.vendors.map((vendor) => (
              <button key={vendor.id} type="button" data-active={workflowVendor?.id === vendor.id} onClick={() => setManufacturerId(vendor.id)}>
                <span><strong title={vendor.name}>{vendor.name}</strong><small>{vendor.contact?.email ?? "Supplier email not saved"}</small></span>
                <span><b>{externalVendorActivityLabel(vendor, vendor.id === workflowVendor?.id ? threadReceipt : EMPTY_SUPPLIER_THREAD_RECEIPT)}</b><small>{externalVendorResponseCount(vendor) ? responseCountLabel(externalVendorResponseCount(vendor)) : customerProcurementQuoteSummary(vendor.quote)}</small></span>
              </button>
            ))}
            {historicalGroup?.cases.map((procurementCase) => (
              <button key={procurementCase.id} type="button" data-active={historicalCase?.id === procurementCase.id} onClick={() => setManufacturerId(procurementCase.id)}>
                <span><strong>{procurementCase.result?.selectedOption.name ?? "Unknown supplier"}</strong><small>{procurementCase.supplierEmailAction?.input.message.recipient ?? "Supplier email not saved"}</small></span>
                <span><b>{historicalSupplierResponded(procurementCase) ? "Responded" : historicalSupplierContacted(procurementCase) ? "Contacted" : "Not contacted"}</b><small>{historicalPoState(procurementCase)}</small></span>
              </button>
            ))}
          </aside>

          {workflowRequest && workflowDetail && workflowVendor ? (
            <article className={styles.activeSupplierDossier}>
              <header>
                <span><small>Situation read</small><h3>{workflowVendor.name}</h3><p>{workflowSituation(workflowRequest, workflowDetail, workflowVendor, threadReceipt)}</p></span>
                <i data-ready={externalVendorPoReady(workflowRequest, workflowDetail, workflowVendor.id)}>{externalVendorPoState(workflowRequest, workflowDetail, workflowVendor.id)}</i>
              </header>
              <dl className={styles.activeSupplierFacts}>
                <div><dt>Outreach</dt><dd>{externalVendorOutreachRead(workflowVendor, threadReceipt)}</dd></div>
                <div><dt>Response</dt><dd>{workflowVendor.quote ? customerProcurementQuoteSummary(workflowVendor.quote) : externalVendorResponseRead(workflowVendor, threadReceipt)}</dd></div>
                <div><dt>Contact</dt><dd>{customerProcurementContactSummary(workflowVendor.contact).secondary}</dd></div>
                <div><dt>Workflow</dt><dd>{customerProcurementStatusLabel(workflowRequest.status)}</dd></div>
              </dl>
              {PROCUREMENT_APPROVAL_STATUSES.has(workflowRequest.status) ? (
                <p className={styles.activeApprovalNotice}>
                  <ShieldCheck size={14} />
                  {workflowRequest.status === "awaiting_shortlist_approval"
                    ? "Shortlist approval is pending. Approve or reject in the Bourne Inbox. No further supplier contact happens until then."
                    : "Final order approval is pending. Approve or reject in the Bourne Inbox before the purchase order is released."}
                </p>
              ) : null}
              <section className={styles.activeEvidenceRead}>
                <small>Evidence read</small>
                {customerProcurementEvidenceSummary(workflowVendor.research).map((entry) => <p key={entry}>{entry}</p>)}
                {!customerProcurementEvidenceSummary(workflowVendor.research).length ? <p>No supplier evidence summary is available.</p> : null}
              </section>
              <section className={styles.activeConversationPanel}>
                <header>
                  <span><MessageSquare size={16} /><strong>Conversation</strong></span>
                  <div>
                    {conversationState === "ready" && conversation?.messages.at(-1)?.direction === "INBOUND" ? (
                      <button type="button" onClick={createReplyDraft} disabled={replyDraftState === "loading"}>
                        {replyDraftState === "loading" ? <LoaderCircle size={12} /> : <PenLine size={12} />}
                        {replyDraftState === "loading" ? "Drafting" : replyDraft ? "Redraft reply" : "Draft reply"}
                      </button>
                    ) : null}
                    {conversationState === "ready" && conversation?.messages.at(-1)?.direction === "INBOUND" ? (
                      <button type="button" onClick={draftReplyWithRequestFiles} disabled={replyDraftState === "loading"}>
                        <Paperclip size={12} /> Draft with request files
                      </button>
                    ) : null}
                    {conversation?.sourceUrl ? <a href={conversation.sourceUrl} target="_blank" rel="noreferrer">Open Gmail <ExternalLink size={12} /></a> : null}
                  </div>
                </header>
                <ConversationMessages conversation={conversation} state={conversationState} error={conversationError} fallbackCase={null} />
                {conversationState === "ready" && triage && triage.decision !== "NO_REPLY_NEEDED" ? (
                  <section
                    className={styles.activeReplyTriage}
                    data-needs-human={triage.decision === "NEEDS_HUMAN"}
                    aria-label="Supplier reply triage"
                  >
                    <header>
                      <span>
                        {triage.decision === "NEEDS_HUMAN" ? <AlertTriangle size={14} /> : <Check size={14} />}
                        <strong>{triage.decision === "NEEDS_HUMAN" ? "Needs your reply" : "Answerable from context"}</strong>
                      </span>
                      {triage.decision === "AUTO_ANSWER" && !replyDraft ? (
                        <button type="button" onClick={useContextAnswer}><PenLine size={13} /> Use context answer</button>
                      ) : null}
                    </header>
                    <p>{triage.headline}</p>
                    {triage.unanswered.length ? (
                      <ul>
                        {triage.unanswered.map((entry) => (
                          <li key={`${entry.topic}:${entry.question}`}><strong>{entry.question}</strong><span>{entry.reason}</span></li>
                        ))}
                      </ul>
                    ) : null}
                    {triage.answered.length ? (
                      <ul data-answered="true">
                        {triage.answered.map((entry) => (
                          <li key={`${entry.topic}:${entry.question}`}><strong>{entry.question}</strong><span>{entry.answer}</span></li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ) : null}
                {replyDraftError ? (
                  <div className={styles.activeReplyDraftError} role="alert">
                    <span>{replyDraftError}</span>
                    {replyDraftErrorReason === PROCUREMENT_REPLY_SENDER_UNAVAILABLE ? (
                      <a href="/dashboard/settings/connected-emails">Manage connected emails <ArrowRight size={13} /></a>
                    ) : null}
                  </div>
                ) : null}
                {replyDraft ? (
                  <section className={styles.activeReplyDraft} aria-label="Supplier reply draft">
                    <header>
                      <span><small>{replyDraft.saved ? "Saved draft, not sent" : "Draft reply"}</small><strong>To {replyDraft.recipient}</strong></span>
                      <div className={styles.activeReplyDraftHeaderActions}>
                        <button type="button" onClick={copyReplyDraft}>{replyCopied ? <Check size={13} /> : <Copy size={13} />}{replyCopied ? "Copied" : "Copy reply"}</button>
                        {replySendState !== "sent" ? (
                          <button type="button" data-primary="true" onClick={() => { setReplyDraftError(null); setReplyDraftErrorReason(null); setReplySendState("confirming"); }} disabled={replySendState === "sending" || !replyDraft.subject.trim() || !replyDraft.body.trim()}>
                            <Send size={13} /> Send reply
                          </button>
                        ) : null}
                      </div>
                    </header>
                    <label>Subject<input value={replyDraft.subject} disabled={replySendState === "sent"} onChange={(event) => updateReplyDraft("subject", event.target.value)} /></label>
                    {replyDraft.attachments?.length ? (
                      <ul className={styles.activeReplyAttachments} aria-label="Attached request files">
                        {replyDraft.attachments.map((attachment) => (
                          <li key={attachment.documentId}><Paperclip size={12} /> {attachment.name} <small>{Math.max(1, Math.round(attachment.size / 1024))} KB</small></li>
                        ))}
                      </ul>
                    ) : null}
                    {replyDraft.withheld?.length ? (
                      <ul className={styles.activeReplyAttachments} data-withheld="true" aria-label="Files held back">
                        {replyDraft.withheld.map((entry) => (
                          <li key={entry.name}>{entry.name} held back because {entry.reason}</li>
                        ))}
                      </ul>
                    ) : null}
                    <label>Reply<textarea rows={7} value={replyDraft.body} disabled={replySendState === "sent"} onChange={(event) => updateReplyDraft("body", event.target.value)} /></label>
                    {replySendState === "confirming" ? (
                      <div className={styles.activeReplyConfirmation} role="group" aria-label="Confirm supplier reply">
                        <p>Send this exact reply from {conversation?.accountEmail ?? "the connected Gmail account"} to {replyDraft.recipient}?</p>
                        <div>
                          <button type="button" onClick={() => setReplySendState("idle")}>Cancel</button>
                          <button type="button" data-primary="true" onClick={sendReplyDraft}><Send size={13} /> Confirm send</button>
                        </div>
                      </div>
                    ) : replySendState === "sending" ? (
                      <p className={styles.activeReplyStatus}><LoaderCircle size={13} /> Sending through connected Gmail. Do not retry.</p>
                    ) : replySendState === "sent" && replyDelivery ? (
                      <p className={styles.activeReplyStatus} data-sent="true"><CheckCircle2 size={13} /> Sent from {replyDelivery.accountEmail} at {formatDate(replyDelivery.sentAt)}. <a href={replyDelivery.sourceUrl} target="_blank" rel="noreferrer">Open sent message</a></p>
                    ) : (
                      <p>Review before sending. Derya sends only after you confirm the exact recipient and message.</p>
                    )}
                  </section>
                ) : null}
              </section>
              <footer><button type="button" onClick={() => onOpenWorkflowRequest(workflowRequest)}>Open full sourcing request <ArrowRight size={13} /></button></footer>
            </article>
          ) : historicalGroup && historicalCase ? (
            <article className={styles.activeSupplierDossier}>
              <header>
                <span><small>Situation read</small><h3>{historicalCase.result?.selectedOption.name ?? "Unknown supplier"}</h3><p>{historicalSituation(historicalCase)}</p></span>
                <i data-ready={historicalPoReady(historicalCase)}>{historicalPoState(historicalCase)}</i>
              </header>
              <dl className={styles.activeSupplierFacts}>
                <div><dt>Outreach</dt><dd>{historicalSupplierContacted(historicalCase) ? "Supplier contacted" : "Not contacted"}</dd></div>
                <div><dt>Responses</dt><dd>{historicalResponseCount(historicalCase)}</dd></div>
                <div><dt>Recipient</dt><dd>{historicalCase.supplierEmailAction?.input.message.recipient ?? historicalCase.supplierEmailDraft?.result?.message.recipient ?? "Not saved"}</dd></div>
                <div><dt>PO state</dt><dd>{historicalPoState(historicalCase)}</dd></div>
              </dl>
              <section className={styles.activeConversationPanel}>
                <header><span><MessageSquare size={16} /><strong>Conversation</strong></span>{conversation?.sourceUrl ? <a href={conversation.sourceUrl} target="_blank" rel="noreferrer">Open Gmail <ExternalLink size={12} /></a> : null}</header>
                <ConversationMessages conversation={conversation} state={conversationState} error={conversationError} fallbackCase={historicalCase} />
              </section>
              {historicalGroup.run ? <footer><button type="button" onClick={() => onOpenHistoricalRun(historicalGroup.run!)}>Open full workstream <ArrowRight size={13} /></button></footer> : null}
            </article>
          ) : selection && detailState !== "loading" && detailState !== "error" ? (
            <div className={styles.activeSourcingNoManufacturer}><PackageCheck size={22} /><strong>No manufacturer workstream yet</strong><p>Supplier research is still running. Contact receipts will appear after approved outreach.</p></div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
