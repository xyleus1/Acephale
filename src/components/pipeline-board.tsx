"use client";
import { useState, useRef } from "react";
import Link from "next/link";

type Company = {
  id: string;
  name: string;
  status: string;
  owners: { user: { fullName: string } }[];
  activities: { occurredAt: string }[];
};

type Colors = { bg: string; border: string; text: string };

type Props = {
  initialGrouped: Record<string, Company[]>;
  statusOrder: string[];
  statusColors: Record<string, Colors>;
  statusLabels: Record<string, string>;
  t: { lastActivity: string; noActivity: string; noCompanies: string };
  updateStatusAction: (fd: FormData) => Promise<void>;
};

function daysSince(date: string | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

export function PipelineBoard({
  initialGrouped,
  statusOrder,
  statusColors,
  statusLabels,
  t,
  updateStatusAction,
}: Props) {
  const [grouped, setGrouped] = useState(initialGrouped);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const dragFrom = useRef<string | null>(null);

  function handleDragStart(id: string, fromStatus: string) {
    dragId.current = id;
    dragFrom.current = fromStatus;
  }

  function handleDrop(toStatus: string) {
    const id = dragId.current;
    const from = dragFrom.current;
    setDropTarget(null);
    if (!id || !from || from === toStatus) return;

    // Optimistic UI update
    setGrouped((prev) => {
      const company = prev[from].find((c) => c.id === id);
      if (!company) return prev;
      return {
        ...prev,
        [from]: prev[from].filter((c) => c.id !== id),
        [toStatus]: [{ ...company, status: toStatus }, ...prev[toStatus]],
      };
    });

    const fd = new FormData();
    fd.set("companyId", id);
    fd.set("status", toStatus);
    updateStatusAction(fd);

    dragId.current = null;
    dragFrom.current = null;
  }

  return (
    <div className="pipeline-board">
      {statusOrder.map((status) => {
        const col = grouped[status];
        const colors = statusColors[status];
        const isOver = dropTarget === status;

        return (
          <div
            key={status}
            className="pipeline-col"
            style={isOver ? { background: "var(--brand-light)", outline: "2px dashed var(--brand)", outlineOffset: -2 } : undefined}
            onDragOver={(e) => { e.preventDefault(); setDropTarget(status); }}
            onDragLeave={(e) => {
              // Only clear if leaving the column entirely (not entering a child)
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropTarget(null);
              }
            }}
            onDrop={() => handleDrop(status)}
          >
            <div className="pipeline-col-header" style={{ borderTop: `3px solid ${colors.border}` }}>
              <span className="pipeline-col-title" style={{ color: colors.text }}>
                {statusLabels[status]}
              </span>
              <span className="pipeline-col-count">{col.length}</span>
            </div>

            <div className="pipeline-col-body">
              {col.length === 0 && (
                <div className="pipeline-empty" style={isOver ? { color: "var(--brand)" } : undefined}>
                  {isOver ? "Drop here" : t.noCompanies}
                </div>
              )}
              {col.map((company) => {
                const d = daysSince(company.activities[0]?.occurredAt ?? null);
                return (
                  <div
                    key={company.id}
                    className="pipeline-card"
                    draggable
                    onDragStart={() => handleDragStart(company.id, status)}
                    onDragEnd={() => setDropTarget(null)}
                    style={{ cursor: "grab" }}
                  >
                    <Link href={`/dashboard/customers/${company.id}`} className="pipeline-card-name">
                      {company.name}
                    </Link>
                    {company.owners.length > 0 && (
                      <div className="pipeline-card-owners">
                        {company.owners.map((o) => o.user.fullName).join(", ")}
                      </div>
                    )}
                    <div className="pipeline-card-meta">
                      {d === null ? (
                        <span style={{ color: "var(--danger)" }}>{t.noActivity}</span>
                      ) : (
                        <span style={{ color: d >= 14 ? "var(--danger)" : d >= 7 ? "var(--warning)" : "var(--success)" }}>
                          {t.lastActivity}: {d}d
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
