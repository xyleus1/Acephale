"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeDuplicateInquiryConsolidation } from "@/lib/merge-actions";
import { Icon } from "@/components/icon";

export function MergeDuplicatesButton() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    start(async () => {
      setMsg(null);
      const r = await proposeDuplicateInquiryConsolidation();
      if ("error" in r) {
        setMsg(r.error);
      } else {
        setMsg(`Review proposal created: ${r.duplicates} duplicate${r.duplicates === 1 ? "" : "s"} across ${r.clusters} cluster${r.clusters === 1 ? "" : "s"}`);
        router.refresh();
        setTimeout(() => setMsg(null), 6000);
      }
    });
  }

  return (
    <div className="inbox-action-group has-error">
      {msg && <span className="inbox-action-status">{msg}</span>}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="btn btn-secondary btn-sm"
      >
        <Icon name="layers" size={11} />
        {busy ? "Scanning…" : "Propose duplicate merge"}
      </button>
    </div>
  );
}
