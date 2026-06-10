"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateJobStatus } from "@/app/dashboard/jobs/[jobId]/actions";
import { JobConfirmActions } from "@/components/job-confirm-button";

export type BoardJob = {
  id: string;
  reference: string;
  status: string;
  type: string;
  companyName: string | null;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  eta: string | null;
  notes: string | null;
};

const STATUSES = [
  { key: "PROPOSED",   label: "Proposed"   },
  { key: "INQUIRY",    label: "Inquiry"    },
  { key: "QUOTED",     label: "Quoted"     },
  { key: "BOOKED",     label: "Booked"     },
  { key: "IN_TRANSIT", label: "In Transit" },
  { key: "CUSTOMS",    label: "Customs"    },
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
      // server caught up — override no longer needed (cleared lazily)
      return j.status;
    }
    return o ?? j.status;
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
            className="job-col"
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverCol(status.key); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setOverCol(null); }}
            onDrop={(e) => { e.preventDefault(); onDrop(status.key); }}
            style={isOver ? { outline: "2px dashed var(--brand)", outlineOffset: -2, background: "var(--brand-light)" } : undefined}
          >
            <div className="job-col-header">
              <div className="job-col-title">{labels[status.key] ?? status.label}</div>
              <span className="job-col-count">{colJobs.length}</span>
            </div>
            <div className="job-col-body">
              {colJobs.length === 0 ? (
                <div className="job-col-empty">—</div>
              ) : (
                colJobs.map((job) => (
                  <a
                    key={job.id}
                    href={`/dashboard/jobs/${job.id}`}
                    className={`job-card${focusedId === job.id ? " focus-match" : ""}`}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(job.id); }}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    style={{
                      cursor: "grab",
                      ...(dragId === job.id ? { opacity: 0.4 } : {}),
                      ...(statusOf(job) === "PROPOSED" ? { borderStyle: "dashed", borderColor: "var(--brand)", background: "var(--surface)" } : {}),
                    }}
                  >
                    <div className="job-card-ref" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {job.reference}
                      {statusOf(job) === "PROPOSED" && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                          background: "var(--brand-light)", color: "var(--brand)",
                          border: "1px solid var(--brand-border)",
                          textTransform: "uppercase", letterSpacing: "0.06em",
                        }}>DRAFT</span>
                      )}
                    </div>
                    <div className="job-card-company">{job.companyName ?? "—"}</div>
                    <div className="job-card-route">
                      {job.origin && job.destination ? (
                        <>{job.origin} → {job.destination}</>
                      ) : "Route TBD"}
                    </div>
                    {job.notes && (
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={job.notes}>
                        {job.notes}
                      </div>
                    )}
                    <div className="job-card-footer">
                      {job.mode && <span className="job-mode-chip">{job.mode}</span>}
                      {job.eta && (
                        <span className="job-eta">
                          ETA {new Date(job.eta).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
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
