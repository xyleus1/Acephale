"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createForwarderDraftsForJobAction,
  draftCustomerQuoteForJob,
  draftMissingInfoForJobAction,
} from "@/app/dashboard/jobs/[jobId]/actions";
import { DraftModal } from "@/components/draft-modal";
import { Icon } from "@/components/icon";

type ToolKind = "missing_info" | "forwarder" | "customer_quote";

type RerunResult =
  | { kind: "missing_info"; auditEventId?: string | null; to: string | null; subject: string | null; body: string | null }
  | { kind: "forwarder"; auditEventId?: string | null; status: string; detail: string; reviewUrl?: string | null }
  | { kind: "customer_quote"; auditEventId?: string | null; status: string; to: string | null; subject: string | null; body: string | null; detail: string };

function kindForEvent(eventType: string): ToolKind | null {
  if (eventType.startsWith("missing_info_draft.")) return "missing_info";
  if (eventType.startsWith("forwarder_drafts.")) return "forwarder";
  if (eventType.startsWith("customer_quote_draft.")) return "customer_quote";
  return null;
}

function labelForKind(kind: ToolKind | null) {
  if (kind === "missing_info") return "Rerun missing-info";
  if (kind === "forwarder") return "Rerun forwarder drafts";
  if (kind === "customer_quote") return "Rerun customer quote";
  return "Rerun draft";
}

function auditEventLabel(auditEventId: string | null | undefined) {
  return auditEventId
    ? `New current audit row #${auditEventId.slice(0, 8)}`
    : "Rerun completed; audit row could not be confirmed";
}

export function AgentAuditRerunButton({
  jobId,
  eventType,
}: {
  jobId: string;
  eventType: string;
}) {
  const router = useRouter();
  const kind = kindForEvent(eventType);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RerunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!kind) return null;

  function run() {
    if (!kind) return;
    setError(null);
    setResult(null);
    startTransition(async () => {
      if (kind === "missing_info") {
        const next = await draftMissingInfoForJobAction(jobId);
        if (!next.ok) {
          setError(next.error ?? "Could not rerun missing-info draft.");
          router.refresh();
          return;
        }
        setResult({
          kind,
          auditEventId: next.auditEventId,
          to: next.to ?? null,
          subject: next.subject ?? null,
          body: next.body ?? null,
        });
        router.refresh();
        return;
      }

      if (kind === "forwarder") {
        const next = await createForwarderDraftsForJobAction(jobId);
        if (!next.ok) {
          setError(next.error);
          router.refresh();
          return;
        }
        setResult({
          kind,
          auditEventId: next.auditEventId,
          status: next.status,
          detail: next.status === "READY"
            ? `${next.createdDrafts.length} new and ${next.existingDrafts.length} existing drafts.`
            : `Blocked by missing fields: ${next.missing.join(", ") || "review required"}.`,
          reviewUrl: next.reviewUrl,
        });
        router.refresh();
        return;
      }

      const next = await draftCustomerQuoteForJob(jobId);
      if (!next.ok) {
        setError(next.error);
        router.refresh();
        return;
      }
      setResult({
        kind,
        auditEventId: next.auditEventId,
        status: next.status,
        to: next.to ?? null,
        subject: next.subject ?? null,
        body: next.status === "READY"
          ? next.body
          : (next.blockers.length ? next.blockers.join("\n") : "Customer quote gate is not ready."),
        detail: next.status === "READY"
          ? "Customer quote draft rerun from current pricing facts."
          : "Customer quote remains blocked by the current assessment.",
      });
      router.refresh();
    });
  }

  const modal = result?.kind === "missing_info"
    ? {
      title: "Missing-info rerun",
      subtitle: `${result.to || "No recipient"} · ${result.subject ?? "No subject"}`,
      draft: `To: ${result.to || "(no sender email on RFQ)"}\nSubject: ${result.subject ?? "Missing RFQ information"}\n\n${result.body ?? ""}`,
    }
    : result?.kind === "customer_quote"
      ? {
        title: "Customer quote rerun",
        subtitle: result.detail,
        draft: `To: ${result.to || "(no customer email)"}\nSubject: ${result.subject ?? "Customer quote"}\n\n${result.body ?? ""}`,
      }
      : null;

  return (
    <div className="agent-audit-rerun">
      <button type="button" className="btn btn-secondary btn-sm agent-audit-rerun-button" onClick={run} disabled={pending}>
        <Icon name="activity" size={12} />
        {pending ? "Rerunning..." : labelForKind(kind)}
      </button>
      {error && <span className="agent-audit-rerun-error">{error}</span>}
      {result && (
        <span className={`agent-audit-rerun-result ${result.kind === "missing_info" ? "ready" : "status" in result ? result.status.toLowerCase() : "ready"}`}>
          {auditEventLabel(result.auditEventId)}
        </span>
      )}
      {result?.kind === "forwarder" && (
        <span className={`agent-audit-rerun-result secondary ${result.status.toLowerCase()}`}>
          {result.detail}
          {result.reviewUrl && <a href={result.reviewUrl}>Review</a>}
        </span>
      )}
      {modal && (
        <DraftModal
          title={modal.title}
          subtitle={modal.subtitle}
          draft={modal.draft}
          onClose={() => setResult(null)}
        />
      )}
    </div>
  );
}
