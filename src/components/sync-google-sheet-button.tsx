"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncDeryaGoogleSheet } from "@/lib/google-sheets-sync";

export function SyncGoogleSheetButton() {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function sync() {
    startTransition(async () => {
      setMsg(null);
      const res = await syncDeryaGoogleSheet();
      if ("error" in res) {
        setMsg(res.error);
      } else {
        setMsg(
          `${res.requests.created + res.requests.updated} RFQs · ` +
          `${res.leads.created + res.leads.updated} TR leads · ` +
          `${res.leadsUs.created + res.leadsUs.updated} US leads · ` +
          `${res.autoReplies.sent} auto-replies · ` +
          `${res.operations.created + res.operations.updated} jobs · ` +
          `${res.operations.companiesCreated} companies` +
          (res.warnings.length > 0 ? ` · ${res.warnings[0]}` : "")
        );
        router.refresh();
        setTimeout(() => setMsg(null), 7000);
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {msg && <span style={{ fontSize: 11, color: "var(--text-3)", maxWidth: 420 }}>{msg}</span>}
      <button
        onClick={sync}
        disabled={busy}
        className="btn btn-secondary btn-sm"
      >
        {busy ? "Syncing sheet..." : "Sync Google Sheet"}
      </button>
    </div>
  );
}
