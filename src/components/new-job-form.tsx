"use client";

import type { ReactNode } from "react";
import { CargoFields } from "./cargo-fields";
import { SubmitButton } from "./submit-button";

const STATUS_OPTIONS = [
  ["PROPOSED", "Proposed"], ["INQUIRY", "RFQ"], ["QUOTED", "Pricing"], ["BOOKED", "Booked / Waiting Cargo"],
  ["IN_TRANSIT", "En Route"], ["DELIVERED", "Delivered"],
] as const;

function FormSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="card form-section">
      <header className="form-section-header">
        <h2 className="form-section-title">{title}</h2>
        {note && <p className="form-section-note">{note}</p>}
      </header>
      <div className="form-section-body">{children}</div>
    </section>
  );
}

export function NewJobForm({
  companies,
  action,
}: {
  companies: { id: string; name: string }[];
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <form action={action} className="form-shell">
      <FormSection title="Deal" note="Create the commercial record first. New customer names are saved automatically.">
        <label className="field">
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
              <option value="">- Select -</option>
              <option value="ONE_OFF">One-off</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>
        </div>
      </FormSection>

      <FormSection title="RFQ Qualification" note="Do not guess customer budget. Mark the target price state clearly so follow-up automation does not invent context.">
        <div className="form-grid-3">
          <label className="field">
            <span>Target price status</span>
            <select name="targetPriceStatus" defaultValue="UNKNOWN">
              <option value="UNKNOWN">Ask customer</option>
              <option value="PROVIDED">Target provided</option>
              <option value="NO_TARGET">No target given</option>
            </select>
          </label>
          <label className="field">
            <span>Target price</span>
            <input name="targetPrice" type="number" step="any" placeholder="e.g. 1550" />
          </label>
          <label className="field">
            <span>Currency</span>
            <select name="targetCurrency" defaultValue="USD">
              <option>USD</option>
              <option>EUR</option>
              <option>TRY</option>
              <option>GBP</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Target price source / note</span>
          <input name="targetPriceSource" placeholder="e.g. customer said budget is 55,000 TL" />
        </label>
      </FormSection>

      <FormSection title="Route & Cargo" note="Capture the shipment facts that pricing and operations need later. Required route fields are marked.">
        <div className="form-grid-2">
          <label className="field">
            <span>Origin <span className="required-mark">*</span></span>
            <input name="origin" required placeholder="e.g. Shanghai, CN" />
          </label>
          <label className="field">
            <span>Destination <span className="required-mark">*</span></span>
            <input name="destination" required placeholder="e.g. Hamburg, DE" />
          </label>
        </div>
        <div className="form-grid-2">
          <label className="field">
            <span>Incoterms</span>
            <select name="incoterms">
              <option value="">- Select -</option>
              {["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Commodity</span>
            <input name="commodity" placeholder="e.g. Electronics" />
          </label>
        </div>
        <div className="form-grid-2">
          <label className="field">
            <span>Quantity</span>
            <input name="quantity" type="number" step="any" placeholder="e.g. 350" />
          </label>
          <label className="field">
            <span>Unit</span>
            <input name="quantityUnit" list="quantity-units" placeholder="e.g. TONS" autoComplete="off" />
            <datalist id="quantity-units">
              {["TONS", "KG", "TRUCKS", "PALLETS", "UNITS", "CBM", "LITERS"].map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </label>
        </div>
        <CargoFields />
        <div className="form-grid-2">
          <label className="field">
            <span>Dangerous goods?</span>
            <select name="dangerousGoods" defaultValue="UNKNOWN">
              <option value="UNKNOWN">Unknown</option>
              <option value="NO">No</option>
              <option value="YES">Yes</option>
            </select>
          </label>
          <label className="field">
            <span>Customs work by</span>
            <select name="customsBy" defaultValue="UNKNOWN">
              <option value="UNKNOWN">Unknown</option>
              <option value="US">Us</option>
              <option value="CUSTOMER">Customer</option>
              <option value="FORWARDER">Forwarder / agent</option>
            </select>
          </label>
        </div>
      </FormSection>

      <FormSection title="Financials" note="Optional at creation. Leaving this blank keeps the job in a pricing-ready state.">
        <div className="form-grid-2">
          <label className="field">
            <span>Revenue (USD)</span>
            <input name="revenue" type="number" step="any" placeholder="0" />
          </label>
          <label className="field">
            <span>Cost (USD)</span>
            <input name="cost" type="number" step="any" placeholder="0" />
          </label>
        </div>
      </FormSection>

      <FormSection title="Note">
        <label className="field">
          <span>Short note (only you see this)</span>
          <textarea name="notes" rows={2} placeholder="e.g. Urgent - customer needs quote by Friday" className="activity-textarea" />
        </label>
      </FormSection>

      <div className="form-actions">
        <SubmitButton pendingLabel="Creating...">Create Job</SubmitButton>
        <a href="/dashboard/jobs" className="btn btn-secondary">Cancel</a>
      </div>
    </form>
  );
}
