"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobAllFields, updateJobStatus } from "@/app/dashboard/jobs/[jobId]/actions";
import { CargoFields } from "./cargo-fields";
import { cleanNotes } from "@/lib/quote-lines";

type JobShape = {
  id: string;
  reference: string;
  title: string | null;
  cadence: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  status: string;
  companyId: string | null;
  mode: string | null;
  origin: string | null;
  destination: string | null;
  commodity: string | null;
  incoterms: string | null;
  weight: number | null;
  volume: number | null;
  packages: number | null;
  dimensions: string | null;
  containerCount: number | null;
  containerType: string | null;
  etd: Date | null;
  eta: Date | null;
  revenue: number | null;
  cost: number | null;
  currency: string | null;
  notes: string | null;
};

type CompanyOption = { id: string; name: string };

const STATUS_OPTIONS = [
  ["PROPOSED", "Proposed"], ["INQUIRY", "Inquiry"], ["QUOTED", "Quoted"], ["BOOKED", "Booked"],
  ["IN_TRANSIT", "In Transit"], ["CUSTOMS", "Customs"], ["DELIVERED", "Delivered"], ["CANCELLED", "Cancelled"],
];

function fmtDateInput(d: Date | null) {
  return d ? new Date(d).toISOString().split("T")[0] : "";
}

export function JobEditPanel({ job, companies }: { job: JobShape; companies: CompanyOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement | null>(null);
  const currentCompanyName = companies.find((c) => c.id === job.companyId)?.name ?? "";

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) setOpen(false);
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function submit(formData: FormData) {
    startTransition(async () => {
      await updateJobAllFields(job.id, formData);
      setOpen(false);
      router.refresh();
    });
  }

  function quickStatus(s: string) {
    startTransition(async () => {
      await updateJobStatus(job.id, s);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 5 }}
        title="Edit shipment details"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        Edit
      </button>

      {open && (
        <div className="edit-panel-backdrop" onClick={() => setOpen(false)}>
          <aside className="edit-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit shipment">
            <header className="edit-panel-header">
              <div>
                <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
                  Edit shipment
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2, fontFamily: "ui-monospace, Menlo, monospace" }}>{job.reference}</div>
              </div>
              <button onClick={() => setOpen(false)} className="edit-panel-close" aria-label="Close">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </header>

            {/* Quick status changer at the top */}
            <div className="edit-panel-section">
              <div className="edit-panel-section-title">Move to stage</div>
              <div className="status-quickpick">
                {STATUS_OPTIONS.map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    disabled={busy || job.status === key}
                    onClick={() => quickStatus(key)}
                    className={`status-quick ${job.status === key ? "active" : ""}`}
                  >{label}</button>
                ))}
              </div>
            </div>

            <form ref={formRef} action={submit} className="edit-panel-form">
              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Deal</div>
                <div className="form-grid-2">
                  <label className="field">
                    <span>Deal name</span>
                    <input name="title" defaultValue={job.title ?? ""} placeholder="e.g. China Spare Parts" />
                  </label>
                  <label className="field">
                    <span>Frequency</span>
                    <select name="cadence" defaultValue={job.cadence ?? ""}>
                      <option value="">—</option>
                      <option value="ONE_OFF">One-off</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Customer</div>
                <input
                  name="companyName"
                  list="edit-company-suggestions"
                  defaultValue={currentCompanyName}
                  placeholder="Type a customer name"
                  autoComplete="off"
                />
                <datalist id="edit-company-suggestions">
                  {companies.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
                <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 6 }}>
                  New names are saved as customers automatically. Leave empty for no customer.
                </p>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Route</div>
                <div className="form-grid-2">
                  <label className="field">
                    <span>Origin</span>
                    <input name="origin" defaultValue={job.origin ?? ""} placeholder="e.g. Istanbul, TR" />
                  </label>
                  <label className="field">
                    <span>Destination</span>
                    <input name="destination" defaultValue={job.destination ?? ""} placeholder="e.g. Munich, DE" />
                  </label>
                </div>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Cargo</div>
                <div className="form-grid-2" style={{ marginBottom: 10 }}>
                  <label className="field">
                    <span>Incoterms</span>
                    <select name="incoterms" defaultValue={job.incoterms ?? ""}>
                      <option value="">—</option>
                      {["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Currency</span>
                    <select name="currency" defaultValue={job.currency ?? "USD"}>
                      <option>USD</option><option>EUR</option><option>TRY</option><option>GBP</option>
                    </select>
                  </label>
                </div>
                <label className="field" style={{ marginBottom: 10 }}>
                  <span>Commodity</span>
                  <input name="commodity" defaultValue={job.commodity ?? ""} placeholder="e.g. Machine parts" />
                </label>
                <div className="form-grid-2" style={{ marginBottom: 10 }}>
                  <label className="field"><span>Quantity</span>
                    <input name="quantity" type="number" step="any" defaultValue={job.quantity ?? ""} placeholder="e.g. 350" />
                  </label>
                  <label className="field"><span>Unit</span>
                    <input name="quantityUnit" list="edit-quantity-units" defaultValue={job.quantityUnit ?? ""} placeholder="e.g. TONS" autoComplete="off" />
                    <datalist id="edit-quantity-units">
                      {["TONS", "KG", "TRUCKS", "PALLETS", "UNITS", "CBM", "LITERS"].map((u) => (
                        <option key={u} value={u} />
                      ))}
                    </datalist>
                  </label>
                </div>
                <CargoFields
                  initialMode={job.mode}
                  initialContainerCount={job.containerCount}
                  initialContainerType={job.containerType}
                  initialDimensions={job.dimensions}
                  initialWeight={job.weight}
                />
                <label className="field" style={{ marginTop: 10 }}>
                  <span>Packages</span>
                  <input name="packages" type="number" defaultValue={job.packages ?? ""} />
                </label>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Dates</div>
                <div className="form-grid-2">
                  <label className="field">
                    <span>ETD (departure)</span>
                    <input name="etd" type="date" defaultValue={fmtDateInput(job.etd)} />
                  </label>
                  <label className="field">
                    <span>ETA (arrival)</span>
                    <input name="eta" type="date" defaultValue={fmtDateInput(job.eta)} />
                  </label>
                </div>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Financials</div>
                <div className="form-grid-2">
                  <label className="field"><span>Revenue</span>
                    <input name="revenue" type="number" step="any" defaultValue={job.revenue ?? ""} />
                  </label>
                  <label className="field"><span>Cost</span>
                    <input name="cost" type="number" step="any" defaultValue={job.cost ?? ""} />
                  </label>
                </div>
              </div>

              <div className="edit-panel-section">
                <div className="edit-panel-section-title">Note</div>
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={cleanNotes(job.notes)}
                  placeholder="Short note — only you see this"
                  style={{ width: "100%", resize: "vertical", fontSize: 13, padding: "8px 10px" }}
                />
              </div>

              {/* Hidden status field so updateJobAllFields gets it */}
              <input type="hidden" name="status" value={job.status} />

              <div className="edit-panel-footer">
                <button type="button" onClick={() => setOpen(false)} className="btn btn-secondary">Cancel</button>
                <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
