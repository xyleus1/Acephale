"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markMilestoneActual, updateMilestonePlanned } from "@/app/dashboard/jobs/[jobId]/actions";

export function MilestoneEdit({
  milestoneId,
  plannedAt,
}: {
  milestoneId: string;
  plannedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(plannedAt ?? "");
  const [busy, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function setPlanned() {
    if (!date) return;
    startTransition(async () => {
      await updateMilestonePlanned(milestoneId, date);
      setOpen(false);
      router.refresh();
    });
  }

  function markDone() {
    startTransition(async () => {
      await markMilestoneActual(milestoneId);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="ms-edit">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-secondary btn-sm ms-edit-trigger"
      >
        {open ? "Close" : "Edit"}
      </button>
      {open && (
        <div className="ms-edit-pop">
          <div className="ms-edit-row">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="ms-edit-input"
            />
            <button
              onClick={setPlanned}
              disabled={busy || !date}
              className="btn btn-secondary btn-sm"
            >Set</button>
          </div>
          <button
            onClick={markDone}
            disabled={busy}
            className="btn btn-sm ms-edit-done"
          >Mark done now</button>
        </div>
      )}
    </div>
  );
}
