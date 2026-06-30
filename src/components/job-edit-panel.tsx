"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobAllFields, updateJobStatus } from "@/app/dashboard/jobs/[jobId]/actions";
import { CargoFields } from "./cargo-fields";
import { cleanNotes } from "@/lib/quote-lines";
import { Icon } from "@/components/icon";

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
  stackable: string | null;
  topLoad: string | null;
  dangerousGoods: string | null;
  customsBy: string | null;
  containerCount: number | null;
  containerType: string | null;
  etd: Date | null;
  eta: Date | null;
  revenue: number | null;
  cost: number | null;
  currency: string | null;
  targetPrice: number | null;
  targetCurrency: string | null;
  targetPriceStatus: string | null;
  targetPriceSource: string | null;
  notes: string | null;
};

type CompanyOption = { id: string; name: string };

const STATUS_OPTIONS = [
  ["PROPOSED", "Proposed"], ["INQUIRY", "RFQ"], ["QUOTED", "Pricing"], ["BOOKED", "Booked / Waiting Cargo"],
  ["IN_TRANSIT", "En Route"], ["DELIVERED", "Delivered"], ["CANCELLED", "Cancelled"],
];

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
        className="btn btn-secondary btn-sm btn-inline-icon"
        title="Edit shipment details"
      >
        <Icon name="settings" size={11} />
        Edit
      </button>

      {open && (
        <div className="edit-panel-backdrop" onClick={() => setOpen(false)}>
          <aside className="edit-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Edit shipment">
            <header className="edit-panel-header">
              <div>
                <div className="edit-panel-kicker">Edit shipment</div>
                <div className="edit-panel-reference">{job.reference}</div>
              </div>
              <button onClick={() => setOpen(false)} className="edit-panel-close" aria-label="Close">
                <Icon name="x" size={14} strokeWidth={2.5} />
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
                <div className="edit-panel-section-title">RFQ Qualification</div>
                <div className="form-grid-3">
                  <label className="field">
                    <span>Target status</span>
                    <select name="targetPriceStatus" defaultValue={job.targetPriceStatus ?? "UNKNOWN"}>
                      <option value="UNKNOWN">Ask customer</option>
                      <option value="PROVIDED">Target provided</option>
                      <option value="NO_TARGET">No target given</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Target price</span>
                    <input name="targetPrice" type="number" step="any" defaultValue={job.targetPrice ?? ""} />
                  </label>
                  <label className="field">
                    <span>Target currency</span>
                    <select name="targetCurrency" defaultValue={job.targetCurrency ?? job.currency ?? "USD"}>
                      <option>USD</option><option>EUR</option><option>TRY</option><option>GBP</option>
                    </select>
                  </label>
                </div>
                <label className="field form-row-gap">
                  <span>Target note</span>
                  <input name="targetPriceSource" defaultValue={job.targetPriceSource ?? ""} placeholder="Who gave it / context" />
                </label>
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
                <p className="edit-panel-help">
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
                <div className="form-grid-2 form-row-gap">
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
                <label className="field form-row-gap">
                  <span>Commodity</span>
                  <input name="commodity" defaultValue={job.commodity ?? ""} placeholder="e.g. Machine parts" />
                </label>
                <div className="form-grid-2 form-row-gap">
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
                  initialStackable={job.stackable}
                  initialTopLoad={job.topLoad}
                />
                <div className="form-grid-2 form-row-gap">
                  <label className="field">
                    <span>Dangerous goods?</span>
                    <select name="dangerousGoods" defaultValue={job.dangerousGoods ?? "UNKNOWN"}>
                      <option value="UNKNOWN">Unknown</option>
                      <option value="NO">No</option>
                      <option value="YES">Yes</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Customs work by</span>
                    <select name="customsBy" defaultValue={job.customsBy ?? "UNKNOWN"}>
                      <option value="UNKNOWN">Unknown</option>
                      <option value="US">Us</option>
                      <option value="CUSTOMER">Customer</option>
                      <option value="FORWARDER">Forwarder / agent</option>
                    </select>
                  </label>
                </div>
                <label className="field form-row-gap">
                  <span>Packages</span>
                  <input name="packages" type="number" defaultValue={job.packages ?? ""} />
                </label>
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
                  className="edit-panel-note-textarea"
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
