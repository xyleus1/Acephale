"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInquiryFromThread } from "@/lib/thread-actions";
import { Icon } from "@/components/icon";

export function CreateInquiryButton({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function go() {
    startTransition(async () => {
      setErr(null);
      const res = await createInquiryFromThread(threadId);
      if ("error" in res) {
        setErr(res.error);
      } else {
        router.push(`/dashboard/rfq/${res.inquiryId}`);
      }
    });
  }

  return (
    <div className="inbox-action-group has-error">
      {err && <span className="inbox-action-error">{err}</span>}
      <button
        onClick={go}
        disabled={busy}
        className="inbox-action-btn primary"
      >
        <Icon name="sparkles" size={11} />
        {busy ? "Creating…" : "Create Inquiry from this thread"}
      </button>
    </div>
  );
}
