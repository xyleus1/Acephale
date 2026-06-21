"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";

export type LoadOption =
  | { kind: "job"; id: string; reference: string; type: string; customer: string | null }
  | { kind: "inquiry"; id: string; subject: string; type: string };

export function LoadFilterPicker({
  activeJobId, activeInquiryId,
  openJobs, unlinkedInquiries,
}: {
  activeJobId: string | null;
  activeInquiryId: string | null;
  openJobs: { id: string; reference: string; type: string; customer: string | null }[];
  unlinkedInquiries: { id: string; subject: string; type: string }[];
}) {
  const router = useRouter();
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

  const activeLabel = useMemo(() => {
    if (activeJobId) {
      const j = openJobs.find((x) => x.id === activeJobId);
      return j ? `${j.reference}${j.customer ? ` · ${j.customer}` : ""}` : "Job (not in office)";
    }
    if (activeInquiryId) {
      const i = unlinkedInquiries.find((x) => x.id === activeInquiryId);
      return i ? i.subject : "Inquiry";
    }
    return null;
  }, [activeJobId, activeInquiryId, openJobs, unlinkedInquiries]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return { jobs: openJobs.slice(0, 30), inquiries: unlinkedInquiries.slice(0, 20) };
    return {
      jobs: openJobs.filter((j) =>
        j.reference.toLowerCase().includes(ql) ||
        (j.customer ?? "").toLowerCase().includes(ql)
      ).slice(0, 30),
      inquiries: unlinkedInquiries.filter((i) => i.subject.toLowerCase().includes(ql)).slice(0, 20),
    };
  }, [q, openJobs, unlinkedInquiries]);

  function pickJob(id: string) {
    setOpen(false);
    router.push(`/dashboard/inbox?job=${encodeURIComponent(id)}` as never);
  }
  function pickInquiry(id: string) {
    setOpen(false);
    router.push(`/dashboard/inbox?inquiry=${encodeURIComponent(id)}` as never);
  }
  function clear() {
    setOpen(false);
    router.push("/dashboard/inbox" as never);
  }

  return (
    <div ref={wrapRef} className="load-filter-wrap">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`btn btn-secondary load-filter-button${activeLabel ? " active" : ""}`}
      >
        <Icon name="layers" size={12} />
        {activeLabel ? <span className="load-filter-label">{activeLabel}</span> : "Filter by load"}
        {activeLabel ? (
          <span
            onClick={(e) => { e.stopPropagation(); clear(); }}
            className="load-filter-clear"
            title="Clear filter"
          >
            <Icon name="x" size={11} />
          </span>
        ) : (
          <Icon name="chevron-down" size={11} />
        )}
      </button>
      {open && (
        <div className="inbox-popover load-filter">
          <div className="inbox-popover-search">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by ref, customer, or subject…"
              className="inbox-popover-input"
            />
          </div>
          <div className="inbox-popover-list">
            {filtered.jobs.length === 0 && filtered.inquiries.length === 0 && (
              <div className="inbox-popover-empty">
                No matches.
              </div>
            )}
            {filtered.jobs.length > 0 && (
              <>
                <SectionLabel>Active jobs</SectionLabel>
                {filtered.jobs.map((j) => (
                  <Row
                    key={j.id}
                    onClick={() => pickJob(j.id)}
                    primary={`${j.reference}${j.customer ? ` · ${j.customer}` : ""}`}
                    secondary={j.type === "SOURCING" ? "Procurement" : "Forwarding"}
                    active={activeJobId === j.id}
                  />
                ))}
              </>
            )}
            {filtered.inquiries.length > 0 && (
              <>
                <SectionLabel>Open inquiries (no job)</SectionLabel>
                {filtered.inquiries.map((i) => (
                  <Row
                    key={i.id}
                    onClick={() => pickInquiry(i.id)}
                    primary={i.subject}
                    secondary={i.type === "SOURCING" ? "Procurement" : "Forwarding"}
                    active={activeInquiryId === i.id}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="inbox-popover-section-label">{children}</div>
  );
}

function Row({ onClick, primary, secondary, active }: { onClick: () => void; primary: string; secondary: string; active: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inbox-popover-option${active ? " active" : ""}`}
    >
      <div className="inbox-popover-option-title">
        {primary}
      </div>
      <div className="inbox-popover-option-meta">
        {secondary}
      </div>
    </button>
  );
}
