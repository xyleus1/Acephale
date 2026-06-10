"use client";

import { CargoFields } from "./cargo-fields";
import { SubmitButton } from "./submit-button";

const STATUS_OPTIONS = [
  ["PROPOSED", "Proposed"], ["INQUIRY", "Inquiry"], ["QUOTED", "Quoted"], ["BOOKED", "Booked"],
  ["IN_TRANSIT", "In Transit"], ["CUSTOMS", "Customs"], ["DELIVERED", "Delivered"],
] as const;

export function NewJobForm({
  companies,
  action,
}: {
  companies: { id: string; name: string }[];
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action}>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 16 }}>Deal</div>
          <label className="field" style={{ marginBottom: 12 }}>
            <span>Deal name</span>
            <input name="title" placeholder="e.g. China Spare Parts, Soybean Meal" />
          </label>
          <div className="form-grid-3">
            <label className="field">
              <span>Customer</span>
              <input
                name="companyName"
                list="company-suggestions"
                placeholder="Type a name (optional)"
                autoComplete="off"
              />
              <datalist id="company-suggestions">
                {companies.map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Stage</span>
              <select name="status" defaultValue="INQUIRY">
                {STATUS_OPTIONS.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Frequency</span>
              <select name="cadence" defaultValue="">
                <option value="">— Select —</option>
                <option value="ONE_OFF">One-off</option>
                <option value="MONTHLY">Monthly</option>
              </select>
            </label>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 8 }}>
            New customer names are saved automatically — no need to create them first.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 16 }}>Route & Cargo</div>
          <div className="form-grid-2" style={{ marginBottom: 12 }}>
            <label className="field"><span>Origin <span style={{ color: "var(--danger)" }}>*</span></span>
              <input name="origin" required placeholder="e.g. Shanghai, CN" />
            </label>
            <label className="field"><span>Destination <span style={{ color: "var(--danger)" }}>*</span></span>
              <input name="destination" required placeholder="e.g. Hamburg, DE" />
            </label>
          </div>
          <div className="form-grid-2" style={{ marginBottom: 12 }}>
            <label className="field"><span>Incoterms</span>
              <select name="incoterms">
                <option value="">— Select —</option>
                {["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field"><span>Commodity</span>
              <input name="commodity" placeholder="e.g. Electronics" />
            </label>
          </div>
          <div className="form-grid-2" style={{ marginBottom: 12 }}>
            <label className="field"><span>Quantity</span>
              <input name="quantity" type="number" step="any" placeholder="e.g. 350" />
            </label>
            <label className="field"><span>Unit</span>
              <input name="quantityUnit" list="quantity-units" placeholder="e.g. TONS" autoComplete="off" />
              <datalist id="quantity-units">
                {["TONS", "KG", "TRUCKS", "PALLETS", "UNITS", "CBM", "LITERS"].map((u) => (
                  <option key={u} value={u} />
                ))}
              </datalist>
            </label>
          </div>
          <CargoFields />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 16 }}>Dates</div>
          <div className="form-grid-2">
            <label className="field"><span>ETD (Est. Departure)</span>
              <input name="etd" type="date" />
            </label>
            <label className="field"><span>ETA (Est. Arrival)</span>
              <input name="eta" type="date" />
            </label>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 16 }}>Financials (optional)</div>
          <div className="form-grid-2">
            <label className="field"><span>Revenue (USD)</span>
              <input name="revenue" type="number" step="any" placeholder="0" />
            </label>
            <label className="field"><span>Cost (USD)</span>
              <input name="cost" type="number" step="any" placeholder="0" />
            </label>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 16 }}>Note</div>
          <label className="field">
            <span>Short note (only you see this)</span>
            <textarea name="notes" rows={2} placeholder="e.g. Urgent — customer needs quote by Friday" style={{ resize: "vertical", fontSize: 13, padding: "8px 10px" }} />
          </label>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <SubmitButton pendingLabel="Creating…">Create Job</SubmitButton>
        <a href="/dashboard/jobs" className="btn btn-secondary" style={{ textDecoration: "none" }}>Cancel</a>
      </div>
    </form>
  );
}
