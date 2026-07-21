"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateJobStatus } from "@/app/dashboard/jobs/[jobId]/actions";
import { JobConfirmActions } from "@/components/job-confirm-button";

export type BoardJob = {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  type: string;
  companyName: string | null;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  eta: string | null;
  notes: string | null;
  assignedToName: string | null;
};

const STATUSES = [
  { key: "PROPOSED",   label: "Proposed"   },
  { key: "INQUIRY",    label: "RFQ"        },
  { key: "QUOTED",     label: "Pricing"    },
  { key: "BOOKED",     label: "Booked / Waiting Cargo" },
  { key: "IN_TRANSIT", label: "En Route"   },
  { key: "DELIVERED",  label: "Delivered"  },
] as const;

export function JobsBoard({
  jobs,
  labels,
  focusedId,
}: {
  jobs: BoardJob[];
  labels: Record<string, string>;
  focusedId: string | null;
}) {
  const router = useRouter();
  // Optimistic status overrides: applied instantly on drop, server confirms via refresh.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const statusOf = (j: BoardJob) => {
    const o = overrides[j.id];
    if (o && o === j.status) {
      // server caught up - override no longer needed (cleared lazily)
      return j.status;
    }
    const status = o ?? j.status;
    return status === "CUSTOMS" ? "IN_TRANSIT" : status;
  };

  function onDrop(statusKey: string) {
    setOverCol(null);
    if (!dragId) return;
    const job = jobs.find((j) => j.id === dragId);
    setDragId(null);
    if (!job || statusOf(job) === statusKey) return;
    setOverrides((prev) => ({ ...prev, [dragId]: statusKey }));
    updateJobStatus(dragId, statusKey)
      .then(() => router.refresh())
      .catch(() => {
        // revert on failure
        setOverrides((prev) => {
          const next = { ...prev };
          delete next[job.id];
          return next;
        });
      });
  }

  const byStatus: Record<string, BoardJob[]> = {};
  for (const s of STATUSES) byStatus[s.key] = [];
  for (const j of jobs) {
    const s = statusOf(j);
    if (s in byStatus) byStatus[s].push(j);
  }

  return (
    <div className="job-board">
      {STATUSES.map((status) => {
        const colJobs = byStatus[status.key];
        const isOver = overCol === status.key && dragId !== null;
        return (
          <div
            key={status.key}
            className={`job-col${isOver ? " is-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverCol(status.key); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setOverCol(null); }}
            onDrop={(e) => { e.preventDefault(); onDrop(status.key); }}
          >
            <div className="job-col-header">
              <div className="job-col-title">{labels[status.key] ?? status.label}</div>
              <span className="job-col-count">{colJobs.length}</span>
            </div>
            <div className="job-col-body">
              {colJobs.length === 0 ? (
                <div className="job-col-empty">-</div>
              ) : (
                colJobs.map((job) => (
                  <a
                    key={job.id}
                    href={`/dashboard/jobs/${job.id}`}
                    className={[
                      "job-card",
                      focusedId === job.id ? "focus-match" : "",
                      dragId === job.id ? "is-dragging" : "",
                      statusOf(job) === "PROPOSED" ? "is-draft" : "",
                    ].filter(Boolean).join(" ")}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(job.id); }}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                  >
                    <div className="job-card-ref-line">
                      <span className="job-card-ref">{job.reference}</span>
                      {statusOf(job) === "PROPOSED" && (
                        <span className="job-draft-badge">Draft</span>
                      )}
                    </div>
                    {job.title && (
                      <div className="job-card-title">{job.title}</div>
                    )}
                    <div className="job-card-company">{job.companyName ?? "-"}</div>
                    <div className="job-card-route">
                      {job.origin && job.destination ? (
                        <>{job.origin} → {job.destination}</>
                      ) : "Route TBD"}
                    </div>
                    {job.notes && (
                      <div className="job-card-note" title={job.notes}>
                        {job.notes}
                      </div>
                    )}
                    <div className="job-card-footer">
                      {job.mode && <span className="job-mode-chip">{job.mode}</span>}
                      {job.assignedToName && (
                        <span className="job-mode-chip" title={`Assigned to ${job.assignedToName}`}>
                          {job.assignedToName}
                        </span>
                      )}
                    </div>
                    {statusOf(job) === "PROPOSED" && <JobConfirmActions jobId={job.id} />}
                  </a>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
