"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { confirmRfqAsJob, mergeRfqIntoExistingJob } from "@/lib/rfq-promote";
import { Icon } from "@/components/icon";

type ActiveJobOption = { id: string; reference: string; type: string; customer: string | null };

export function RfqRowActions({ inquiryId, jobLinked, activeJobs }: {
  inquiryId: string;
  jobLinked: boolean;
  activeJobs: ActiveJobOption[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function doConfirm() {
    start(async () => {
      const r = await confirmRfqAsJob(inquiryId);
      if ("error" in r) { alert(r.error); return; }
      router.push(`/dashboard/jobs/${r.jobId}` as never);
    });
  }
  function pickMerge(targetJobId: string) {
    setOpen(false);
    if (!window.confirm("Merge this RFQ into the selected job? Source RFQ's email threads move onto the target; the source RFQ is deleted.")) return;
    start(async () => {
      const r = await mergeRfqIntoExistingJob({ sourceInquiryId: inquiryId, targetJobId });
      if ("error" in r) { alert(r.error); return; }
      router.refresh();
    });
  }

  const ql = q.trim().toLowerCase();
  const filtered = ql
    ? activeJobs.filter((j) => j.reference.toLowerCase().includes(ql) || (j.customer ?? "").toLowerCase().includes(ql))
    : activeJobs.slice(0, 30);

  return (
    <div ref={wrapRef} className="inbox-action-popover-wrap" onClick={(e) => e.stopPropagation()}>
      {!jobLinked && (
        <button
          type="button"
          onClick={doConfirm}
          disabled={busy}
          title="Confirm this RFQ as a real Inquiry-stage job"
          className="inbox-action-btn primary"
        >
          <Icon name="check" size={11} strokeWidth={2.5} />
          {busy ? "…" : "Confirm"}
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        title="Merge this RFQ into an existing active job"
        className="inbox-action-btn"
      >
        <Icon name="layers" size={11} /> Merge into…
      </button>
      {open && (
        <div className="inbox-popover merge">
          <div className="inbox-popover-search">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search jobs by ref, customer…"
              className="inbox-popover-input"
            />
          </div>
          <div className="inbox-popover-list">
            {filtered.length === 0 ? (
              <div className="inbox-popover-empty">
                No active jobs match.
              </div>
            ) : filtered.map((j) => (
              <button
                key={j.id}
                onClick={() => pickMerge(j.id)}
                className="inbox-popover-option"
              >
                <div className="inbox-popover-option-title">{j.reference}{j.customer ? ` · ${j.customer}` : ""}</div>
                <div className="inbox-popover-option-meta">
                  {j.type === "SOURCING" ? "Procurement" : "Forwarding"}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
