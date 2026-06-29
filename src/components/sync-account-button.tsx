"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncEmailAccount } from "@/lib/gmail-sync";

export function SyncAccountButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function sync() {
    startTransition(async () => {
      setMsg(null);
      const res = await syncEmailAccount(accountId);
      if ("error" in res) {
        setMsg(res.error);
      } else {
        const ai = [
          res.autoInquiries > 0 ? `+${res.autoInquiries} inquiries` : null,
          res.autoLinked > 0 ? `+${res.autoLinked} linked` : null,
          (res.backfillQueued ?? 0) > 0 ? `${res.backfillQueued} backfill windows queued` : null,
        ].filter(Boolean).join(" · ");
        setMsg(`+${res.created} msgs · ${res.threadsTouched} threads${ai ? ` · ${ai}` : ""}`);
        router.refresh();
        setTimeout(() => setMsg(null), 4000);
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {msg && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{msg}</span>}
      <button
        onClick={sync}
        disabled={busy}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 12 }}
      >
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
