"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { populateJobFromEmails } from "@/lib/job-populate";
import { Icon } from "@/components/icon";

export function PopulateJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    start(async () => {
      setMsg(null);
      const r = await populateJobFromEmails(jobId);
      if ("error" in r) {
        setMsg(r.error);
        setTimeout(() => setMsg(null), 6000);
      } else if (r.proposed.length === 0) {
        setMsg("No useful proposal");
        setTimeout(() => setMsg(null), 4000);
      } else {
        setMsg(`Proposed ${r.proposed.length} field${r.proposed.length === 1 ? "" : "s"}`);
        router.refresh();
        setTimeout(() => setMsg(null), 5000);
      }
    });
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {msg && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{msg}</span>}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}
        title="Extract a reviewed field proposal from linked emails"
      >
        <Icon name="sparkles" size={11} />
        {busy ? "Extracting…" : "Propose from emails"}
      </button>
    </div>
  );
}
