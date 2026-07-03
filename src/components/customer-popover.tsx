"use client";

import { useEffect, useRef, useState } from "react";

type Summary = {
  id: string;
  name: string;
  status: string;
  contacts: { id: string; name: string | null; email: string | null; phone: string | null }[];
  jobsCount: number;
  recentJobs: { id: string; reference: string; route: string | null; status: string }[];
};

export function CustomerPopover({ companyId, name }: { companyId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || data) return;
    setLoading(true);
    fetch(`/api/customers/${companyId}/summary`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [open, data, companyId]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", onClick);
      document.addEventListener("keydown", onKey);
    }
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="customer-popover-anchor">
      <button
        onClick={() => setOpen((o) => !o)}
        className="customer-popover-trigger"
      >
        {name}
      </button>

      {open && (
        <div className="customer-popover">
          {loading && <div className="customer-popover-loading">Loading...</div>}
          {data && (
            <>
              <div className="customer-popover-header">
                <div>
                  <div className="customer-popover-title">{data.name}</div>
                  <div className="customer-popover-meta">
                    {data.jobsCount} {data.jobsCount === 1 ? "job" : "jobs"} - status {data.status.toLowerCase()}
                  </div>
                </div>
                <a href={`/dashboard/crm/companies/${data.id}`} className="btn btn-secondary btn-sm customer-popover-profile">
                  Profile
                </a>
              </div>

              {data.contacts.length > 0 && (
                <div className="customer-popover-section">
                  <div className="customer-popover-section-title">Contacts</div>
                  {data.contacts.slice(0, 3).map((c) => (
                    <div key={c.id} className="customer-popover-contact">
                      <div className="customer-popover-contact-name">{c.name ?? "(no name)"}</div>
                      <div className="customer-popover-contact-meta">
                        {[c.email, c.phone].filter(Boolean).join(" - ") || "-"}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {data.recentJobs.length > 0 && (
                <div className="customer-popover-section">
                  <div className="customer-popover-section-title">Recent jobs</div>
                  {data.recentJobs.map((j) => (
                    <a key={j.id} href={`/dashboard/jobs/${j.id}`} className="customer-popover-job">
                      <span className="customer-popover-job-ref">{j.reference}</span>
                      <span className="customer-popover-job-route">{j.route ?? "-"}</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </span>
  );
}
