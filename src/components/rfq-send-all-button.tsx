"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { sendAllDeskForwardsAction } from "@/app/dashboard/rfq/actions";

export function RfqSendAllButton({ pending, disabled }: { pending: number; disabled: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (pending === 0 && !msg) return null;

  function sendAll() {
    if (!window.confirm(`Forward ${pending} unsent lead RFQ${pending === 1 ? "" : "s"} to the desk (oguzhan@ + Andelog CC)?`)) {
      return;
    }
    startTransition(async () => {
      setMsg(null);
      try {
        const res = await sendAllDeskForwardsAction();
        if ("error" in res) {
          setMsg(res.error);
        } else {
          setMsg(
            `${res.sent} sent` +
            (res.failed ? ` · ${res.failed} failed` : "") +
            (res.skipped ? ` · ${res.skipped} already sent elsewhere` : "") +
            (res.remaining ? ` · ${res.remaining} left (run again)` : "")
          );
          router.refresh();
          setTimeout(() => setMsg(null), 8000);
        }
      } catch {
        setMsg("Send-all failed or was interrupted - refresh to see what was actually sent before retrying.");
        router.refresh();
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {msg && <span style={{ fontSize: 11, color: "var(--text-3)", maxWidth: 320 }}>{msg}</span>}
      {pending > 0 && (
        <button
          onClick={sendAll}
          disabled={busy || disabled}
          className="btn btn-secondary"
          title={disabled ? "RFQ mail is not configured (RFQ_MAIL_APP_PASSWORD)" : "Forward all unsent lead RFQs to the desk"}
        >
          <Icon name="mail-out" size={13} />
          {busy ? "Sending…" : `Send all to desk (${pending})`}
        </button>
      )}
    </div>
  );
}
