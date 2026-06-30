"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmProposedJob, discardProposedJob } from "@/lib/job-actions";
import { Icon } from "@/components/icon";

export function JobConfirmActions({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();

  function confirm(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    start(async () => {
      await confirmProposedJob(jobId);
      router.refresh();
    });
  }
  function discard(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Discard this proposed job and unlink its emails?")) return;
    start(async () => {
      await discardProposedJob(jobId);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={confirm}
        disabled={busy}
        style={{
          flex: 1, fontSize: 11, fontWeight: 600, padding: "5px 8px",
          background: "var(--brand)", color: "#fff",
          border: "none", borderRadius: 4, cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
        }}
      >
        <Icon name="check" size={11} strokeWidth={2.5} />
        {busy ? "…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={discard}
        disabled={busy}
        title="Discard"
        style={{
          fontSize: 11, padding: "5px 8px",
          background: "var(--surface-2)", color: "var(--text-3)",
          border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer",
        }}
      >
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}
