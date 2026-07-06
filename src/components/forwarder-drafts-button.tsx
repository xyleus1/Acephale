"use client";

import { useState, useTransition } from "react";
import { createForwarderDraftsForJobAction } from "@/app/dashboard/jobs/[jobId]/actions";
import { Icon } from "@/components/icon";

type DraftSummary = {
  id: string;
  forwarderName: string;
  toEmail: string;
  subject: string;
};

type SkippedForwarder = {
  id: string;
  name: string;
  email: string;
  reason: string;
};

type BlockedReason = {
  key: string;
  label: string;
  priority: "critical" | "high" | "medium";
  ask: string;
  why: string;
};

type DraftResult = {
  ok: true;
  status: "READY" | "BLOCKED";
  missing: string[];
  blockedReasons?: BlockedReason[];
  eligibleForwarders: number;
  createdDrafts: DraftSummary[];
  existingDrafts: DraftSummary[];
  skippedForwarders: SkippedForwarder[];
  reviewUrl: string;
  safety: string;
} | {
  ok: false;
  error: string;
};

export function ForwarderDraftsButton({
  jobId,
  disabled = false,
}: {
  jobId: string;
  disabled?: boolean;
}) {
  const [result, setResult] = useState<DraftResult | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const next = await createForwarderDraftsForJobAction(jobId);
      setResult(next);
    });
  }

  const ready = result?.ok && result.status === "READY";
  const blocked = result?.ok && result.status === "BLOCKED";

  return (
    <div className="forwarder-drafts-control">
      <button
        type="button"
        className="btn btn-secondary record-wide-action"
        onClick={run}
        disabled={disabled || pending}
      >
        <Icon name="mail-out" size={13} />
        {pending ? "Creating drafts..." : "Create forwarder drafts"}
      </button>

      {result && (
        <div className={`forwarder-drafts-result ${result.ok ? result.status.toLowerCase() : "error"}`}>
          {!result.ok ? (
            <span>{result.error}</span>
          ) : blocked ? (
            <>
              <strong>Blocked by RFQ maturity</strong>
              <span>{result.blockedReasons?.length ? "Clear these before forwarder handoff:" : result.missing.join(", ")}</span>
              {result.blockedReasons && result.blockedReasons.length > 0 && (
                <div className="forwarder-drafts-blockers">
                  {result.blockedReasons.slice(0, 3).map((item, index) => (
                    <div key={item.key} className={item.priority}>
                      <span>{index + 1}</span>
                      <div>
                        <strong>{item.label}</strong>
                        <em>{item.ask}</em>
                        <small>{item.why}</small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : ready ? (
            <>
              <strong>
                {result.createdDrafts.length} created, {result.existingDrafts.length} already existed
              </strong>
              <span>{result.safety}</span>
              <a href={result.reviewUrl} className="forwarder-drafts-link">Review in pricing</a>
              {(result.createdDrafts.length > 0 || result.existingDrafts.length > 0) && (
                <div className="forwarder-drafts-list">
                  {[...result.createdDrafts, ...result.existingDrafts].slice(0, 4).map((draft) => (
                    <div key={draft.id}>
                      <strong>{draft.forwarderName}</strong>
                      <em>{draft.toEmail}</em>
                    </div>
                  ))}
                </div>
              )}
              {result.skippedForwarders.length > 0 && (
                <details className="forwarder-drafts-skipped">
                  <summary>{result.skippedForwarders.length} skipped</summary>
                  {result.skippedForwarders.slice(0, 5).map((item) => (
                    <span key={item.id}>{item.name}: {item.reason}</span>
                  ))}
                </details>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
