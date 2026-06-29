"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncDeryaLoadRfqInboxes } from "@/lib/gmail-sync";

export function SyncDeryaInboxesButton({ disabled = false }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function sync() {
    startTransition(async () => {
      setMsg(null);
      const res = await syncDeryaLoadRfqInboxes();
      if ("error" in res) {
        setMsg(res.error);
      } else {
        const detail = [
          `${res.accounts} inbox${res.accounts === 1 ? "" : "es"}`,
          `+${res.created} msgs`,
          `${res.threadsTouched} threads`,
          res.autoInquiries > 0 ? `+${res.autoInquiries} RFQs` : null,
          res.autoLinked > 0 ? `+${res.autoLinked} linked` : null,
          res.missing.length > 0 ? `${res.missing.length} missing` : null,
        ].filter(Boolean).join(" · ");
        setMsg(detail);
        router.refresh();
        setTimeout(() => setMsg(null), 5000);
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {msg && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{msg}</span>}
      <button
        type="button"
        onClick={sync}
        disabled={disabled || busy}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 12 }}
      >
        {busy ? "Syncing both..." : "Sync Derya inboxes"}
      </button>
    </div>
  );
}
