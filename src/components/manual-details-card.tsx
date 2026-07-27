"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { saveManualDetailsAction } from "@/app/dashboard/rfq/[inquiryId]/actions";

// "Real details (WhatsApp)" - the paste box for what the customer actually
// said, since form answers are often irrelevant. Own card + own action so it
// never collides with the Load-details form save.
export function ManualDetailsCard({ inquiryId, initial }: {
  inquiryId: string;
  initial: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(true);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (busy || saved) return;
    startTransition(async () => {
      setError(null);
      try {
        const res = await saveManualDetailsAction(inquiryId, text);
        if ("error" in res) {
          setError(res.error);
          return;
        }
        setSaved(true);
        router.refresh();
      } catch {
        setError("Could not save - check your connection and try again.");
      }
    });
  }

  return (
    <div className={`record-panel manual-details${text.trim() ? " manual-details--filled" : ""}`}>
      <div className="record-card-header">
        <div className="record-card-title">
          <Icon name="whatsapp" size={13} /> Real details (WhatsApp)
        </div>
        {!saved && <span className="manual-details-dirty">unsaved</span>}
        {saved && text.trim() && (
          <span className="rfq-mail-sent"><Icon name="check" size={11} strokeWidth={2.5} /> Saved</span>
        )}
      </div>
      <div className="card-body">
        <textarea
          className="manual-details-input"
          rows={text.trim() ? Math.min(10, Math.max(3, text.split("\n").length + 1)) : 3}
          placeholder="Paste what the customer actually said on WhatsApp - this is the truth source when the form answers are noise."
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          }}
        />
        <div className="manual-details-foot">
          <span className="record-helper-text">Saves on click-away, or Cmd+Enter.</span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || saved} onClick={save}>
            {busy ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
        </div>
        {error && <div className="rfq-mail-error">{error}</div>}
      </div>
    </div>
  );
}
