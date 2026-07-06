"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icon";
import { DraftModal } from "@/components/draft-modal";
import { draftMissingInfoEmail } from "@/app/dashboard/rfq/[inquiryId]/actions";
import { draftMissingInfoForJobAction } from "@/app/dashboard/jobs/[jobId]/actions";

type DraftState = {
  to: string;
  subject: string;
  body: string;
};

export function MissingInfoDraftButton({
  inquiryId,
  jobId,
  disabled = false,
}: {
  inquiryId?: string | null;
  jobId?: string | null;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      setError(null);
      const result = inquiryId
        ? await draftMissingInfoEmail(inquiryId)
        : jobId
          ? await draftMissingInfoForJobAction(jobId)
          : { ok: false as const, error: "No RFQ or job scope selected." };
      if (!result.ok) {
        setError(result.error ?? "Could not draft missing-info email.");
        return;
      }
      const to = result.to ?? "";
      const subject = result.subject ?? "Missing RFQ information";
      const body = result.body ?? "";
      setDraft({
        to,
        subject,
        body: `To: ${to || "(no sender email on RFQ)"}\nSubject: ${subject}\n\n${body}`,
      });
    });
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary record-wide-action"
        onClick={run}
        disabled={disabled || pending}
      >
        <Icon name="mail" size={13} />
        {pending ? "Drafting..." : "Draft missing-info email"}
      </button>
      {error && <div className="record-helper-text">{error}</div>}
      {draft && (
        <DraftModal
          title="Missing-info draft"
          subtitle={`${draft.to || "No recipient"} · ${draft.subject}`}
          draft={draft.body}
          onClose={() => setDraft(null)}
        />
      )}
    </>
  );
}
