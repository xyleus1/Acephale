"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createLoadFromRfqReview, getRfqLoadDraft } from "@/lib/rfq-load-review";
import type { RfqLoadDraft } from "@/lib/rfq-load-review";
import type { RfqLoadFieldSource } from "@/lib/rfq-load-draft-core";
import { COMMODITY_CATEGORIES, SECURITY_TIERS, TRACKING_TYPES } from "@/lib/security-sop";
import { CARRIER_EQUIPMENT_TYPES } from "@/lib/carrier-vetting";
import { Icon } from "@/components/icon";

export function RfqLoadReviewButton({
  inquiryId,
  label = "Create load",
  className = "inbox-action-btn primary",
}: {
  inquiryId: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RfqLoadDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState("");
  const [busy, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (draft) setMode(draft.values.mode ?? "");
  }, [draft]);

  function loadDraft() {
    setOpen(true);
    if (draft) return;
    setError(null);
    startTransition(async () => {
      const result = await getRfqLoadDraft(inquiryId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setDraft(result);
    });
  }

  function submit() {
    const form = formRef.current;
    if (!form) return;
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    setError(null);
    startTransition(async () => {
      const result = await createLoadFromRfqReview(inquiryId, payload);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.push(`/dashboard/jobs/${result.jobId}` as never);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={loadDraft}
        disabled={busy}
        className={className}
        title="Review RFQ details and create an active load"
      >
        <Icon name="check" size={11} strokeWidth={2.5} />
        {busy && !open ? "…" : label}
      </button>

      {open && (
        <div className="product-modal-overlay" onClick={() => setOpen(false)}>
          <div className="product-modal rfq-load-modal" role="dialog" aria-modal="true" aria-label="Create load from RFQ" onClick={(e) => e.stopPropagation()}>
            <header className="product-modal-header">
              <div>
                <div className="product-modal-kicker">RFQ to load</div>
                <div className="product-modal-title">{draft?.subject ?? "Review detected RFQ"}</div>
                <div className="product-modal-subtitle">
                  Confirm the fields before this becomes an active load. Carried-forward values are editable.
                </div>
              </div>
              <button type="button" className="product-modal-close" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="x" size={15} strokeWidth={2.5} />
              </button>
            </header>

            <div className="product-modal-body">
              {error && <div className="draft-modal-status is-error">{error}</div>}
              {!draft ? (
                <div className="portal-link-loading">Loading RFQ and customer history…</div>
              ) : (
                <form ref={formRef} className="rfq-load-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
                  {draft.warning && (
                    <div className="rfq-load-warning">
                      <Icon name="info" size={14} />
                      <span>{draft.warning}</span>
                    </div>
                  )}

                  {draft.priorLoads.length > 0 && (
                    <div className="rfq-load-prior-panel">
                      <div className="rfq-load-prior-title">Customer history used for autofill</div>
                      <div className="rfq-load-prior-list">
                        {draft.priorLoads.map((load) => (
                          <div key={load.id} className={`rfq-load-prior-row${load.id === draft.selectedPriorLoadId ? " selected" : ""}`}>
                            <strong>{load.reference}</strong>
                            <span>{load.companyName ?? "No customer"} · {load.route} · {load.mode ?? "mode unknown"}</span>
                            {load.commodity && <em>{load.commodity}</em>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {draft.missing.length > 0 && (
                    <div className="rfq-load-missing">
                      <strong>Still missing before forwarder handoff</strong>
                      <div>
                        {draft.missing.map((item) => <span key={item}>{item}</span>)}
                      </div>
                    </div>
                  )}

                  <section className="rfq-load-section">
                    <div className="rfq-load-section-title">Deal</div>
                    <div className="form-grid-2">
                      <Field label="Customer" source={draft.sources.companyName}>
                        <input
                          name="companyName"
                          list={`rfq-load-companies-${draft.inquiryId}`}
                          defaultValue={draft.values.companyName}
                          placeholder="Type customer name"
                          autoComplete="off"
                        />
                        <datalist id={`rfq-load-companies-${draft.inquiryId}`}>
                          {draft.companies.map((company) => (
                            <option key={company.id} value={company.name} />
                          ))}
                        </datalist>
                      </Field>
                      <Field label="Deal name" source={draft.sources.title}>
                        <input name="title" defaultValue={draft.values.title} placeholder="e.g. Port Klang Plastics" />
                      </Field>
                    </div>
                    <div className="form-grid-2 form-row-gap">
                      <Field label="Job type" source={draft.sources.type}>
                        <select name="type" defaultValue={draft.values.type || "FORWARDING"}>
                          <option value="FORWARDING">Forwarding</option>
                          <option value="SOURCING">Sourcing / procurement</option>
                        </select>
                      </Field>
                      <Field label="Frequency" source={draft.sources.cadence}>
                        <select name="cadence" defaultValue={draft.values.cadence}>
                          <option value="">One-off / unknown</option>
                          <option value="ONE_OFF">One-off</option>
                          <option value="MONTHLY">Monthly</option>
                        </select>
                      </Field>
                    </div>
                  </section>

                  <section className="rfq-load-section">
                    <div className="rfq-load-section-title">Route</div>
                    <div className="form-grid-3">
                      <Field label="Origin" source={draft.sources.origin}>
                        <input name="origin" defaultValue={draft.values.origin} placeholder="City, CC" />
                      </Field>
                      <Field label="Destination" source={draft.sources.destination}>
                        <input name="destination" defaultValue={draft.values.destination} placeholder="City, CC" />
                      </Field>
                      <Field label="Mode" source={draft.sources.mode}>
                        <select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
                          <option value="">Select</option>
                          <option value="SEA-FCL">Sea FCL</option>
                          <option value="SEA-LCL">Sea LCL</option>
                          <option value="AIR">Air</option>
                          <option value="ROAD">Road</option>
                          <option value="COURIER">Courier</option>
                        </select>
                      </Field>
                    </div>
                  </section>

                  <section className="rfq-load-section">
                    <div className="rfq-load-section-title">Cargo</div>
                    <div className="form-grid-2">
                      <Field label="Commodity" source={draft.sources.commodity}>
                        <input name="commodity" defaultValue={draft.values.commodity} placeholder="Cargo / product" />
                      </Field>
                      <Field label="Incoterms" source={draft.sources.incoterms}>
                        <select name="incoterms" defaultValue={draft.values.incoterms}>
                          <option value="">Select</option>
                          {["EXW","FCA","FAS","FOB","CFR","CIF","CPT","CIP","DAP","DPU","DDP"].map((term) => (
                            <option key={term} value={term}>{term}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="form-grid-3 form-row-gap">
                      <Field label="Quantity" source={draft.sources.quantity}>
                        <input name="quantity" type="number" step="any" defaultValue={draft.values.quantity ?? ""} placeholder="e.g. 350" />
                      </Field>
                      <Field label="Unit" source={draft.sources.quantityUnit}>
                        <input name="quantityUnit" list="rfq-load-quantity-units" defaultValue={draft.values.quantityUnit} placeholder="TONS" />
                      </Field>
                      <Field label="Weight (kg)" source={draft.sources.weight}>
                        <input name="weight" type="number" step="any" defaultValue={draft.values.weight ?? ""} />
                      </Field>
                    </div>
                    <datalist id="rfq-load-quantity-units">
                      {["TONS", "KG", "TRUCKS", "PALLETS", "UNITS", "CBM", "LITERS"].map((unit) => (
                        <option key={unit} value={unit} />
                      ))}
                    </datalist>

                    {mode === "SEA-FCL" ? (
                      <div className="form-grid-2 form-row-gap">
                        <Field label="Container count" source={draft.sources.containerCount}>
                          <input name="containerCount" type="number" min="1" defaultValue={draft.values.containerCount ?? ""} />
                        </Field>
                        <Field label="Container type" source={draft.sources.containerType}>
                          <select name="containerType" defaultValue={draft.values.containerType}>
                            <option value="">Select</option>
                            {["20GP","40GP","40HC","20DC","40DC","20RF","40RF","OT","FR","LCL"].map((type) => (
                              <option key={type} value={type}>{type}</option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    ) : (
                      <>
                        <div className="form-grid-3 form-row-gap">
                          <Field label="Volume (cbm)" source={draft.sources.volume}>
                            <input name="volume" type="number" step="any" defaultValue={draft.values.volume ?? ""} />
                          </Field>
                          <Field label="Packages" source={draft.sources.packages}>
                            <input name="packages" type="number" defaultValue={draft.values.packages ?? ""} />
                          </Field>
                          <Field label="Stackable" source={draft.sources.stackable}>
                            <select name="stackable" defaultValue={draft.values.stackable || "UNKNOWN"}>
                              <option value="UNKNOWN">Unknown</option>
                              <option value="YES">Yes</option>
                              <option value="NO">No</option>
                            </select>
                          </Field>
                        </div>
                        <div className="form-grid-2 form-row-gap">
                          <Field label="Top load" source={draft.sources.topLoad}>
                            <select name="topLoad" defaultValue={draft.values.topLoad || "UNKNOWN"}>
                              <option value="UNKNOWN">Unknown</option>
                              <option value="YES">Requested</option>
                              <option value="NO">Not requested</option>
                            </select>
                          </Field>
                          <Field label="Dimensions JSON" source={draft.sources.dimensions}>
                            <input name="dimensions" defaultValue={draft.values.dimensions} placeholder='[{"qty":1,"length":120,"width":80,"height":100}]' />
                          </Field>
                        </div>
                      </>
                    )}

                    <div className="form-grid-2 form-row-gap">
                      <Field label="Dangerous goods" source={draft.sources.dangerousGoods}>
                        <select name="dangerousGoods" defaultValue={draft.values.dangerousGoods || "UNKNOWN"}>
                          <option value="UNKNOWN">Unknown</option>
                          <option value="NO">No</option>
                          <option value="YES">Yes</option>
                        </select>
                      </Field>
                      <Field label="Customs by" source={draft.sources.customsBy}>
                        <select name="customsBy" defaultValue={draft.values.customsBy || "UNKNOWN"}>
                          <option value="UNKNOWN">Unknown</option>
                          <option value="US">Us</option>
                          <option value="CUSTOMER">Customer</option>
                          <option value="FORWARDER">Forwarder / agent</option>
                        </select>
                      </Field>
                    </div>
                  </section>

                  <section className="rfq-load-section">
                    <div className="rfq-load-section-title">Security & equipment</div>
                    <div className="form-grid-3">
                      <Field label="Equipment" source={draft.sources.equipmentType}>
                        <select name="equipmentType" defaultValue={draft.values.equipmentType}>
                          <option value="">Select</option>
                          {CARRIER_EQUIPMENT_TYPES.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Commodity category" source={draft.sources.commodityCategory}>
                        <select name="commodityCategory" defaultValue={draft.values.commodityCategory}>
                          <option value="">Select</option>
                          {COMMODITY_CATEGORIES.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Team drivers" source={draft.sources.teamDriversRequired}>
                        <select name="teamDriversRequired" defaultValue={draft.values.teamDriversRequired || "UNKNOWN"}>
                          <option value="UNKNOWN">Unknown</option>
                          <option value="YES">Required</option>
                          <option value="NO">Not required</option>
                        </select>
                      </Field>
                    </div>
                    <div className="form-grid-3 form-row-gap">
                      <Field label="Declared value" source={draft.sources.declaredValue}>
                        <input name="declaredValue" type="number" step="any" defaultValue={draft.values.declaredValue ?? ""} placeholder="Cargo value" />
                      </Field>
                      <Field label="Security tier" source={draft.sources.securityTier}>
                        <select name="securityTier" defaultValue={draft.values.securityTier}>
                          <option value="">Auto (from value + commodity)</option>
                          {SECURITY_TIERS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Tracking" source={draft.sources.trackingType}>
                        <select name="trackingType" defaultValue={draft.values.trackingType}>
                          <option value="">Select</option>
                          {TRACKING_TYPES.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <input type="hidden" name="declaredValueCurrency" value={draft.values.declaredValueCurrency || "USD"} />
                  </section>

                  <section className="rfq-load-section">
                    <div className="rfq-load-section-title">Pricing posture</div>
                    <div className="form-grid-3">
                      <Field label="Target status" source={draft.sources.targetPriceStatus}>
                        <select name="targetPriceStatus" defaultValue={draft.values.targetPriceStatus || "UNKNOWN"}>
                          <option value="UNKNOWN">Ask customer</option>
                          <option value="PROVIDED">Target provided</option>
                          <option value="NO_TARGET">No target given</option>
                        </select>
                      </Field>
                      <Field label="Target price" source={draft.sources.targetPrice}>
                        <input name="targetPrice" type="number" step="any" defaultValue={draft.values.targetPrice ?? ""} />
                      </Field>
                      <Field label="Currency" source={draft.sources.targetCurrency}>
                        <select name="targetCurrency" defaultValue={draft.values.targetCurrency || "USD"}>
                          <option>USD</option><option>EUR</option><option>TRY</option><option>GBP</option>
                        </select>
                      </Field>
                    </div>
                    <Field label="Target note" source={draft.sources.targetPriceSource}>
                      <input name="targetPriceSource" defaultValue={draft.values.targetPriceSource} placeholder="Who gave it / where it came from" />
                    </Field>
                    <input type="hidden" name="currency" value={draft.values.currency || draft.values.targetCurrency || "USD"} />
                  </section>

                  <section className="rfq-load-section">
                    <div className="rfq-load-section-title">Internal note</div>
                    <textarea name="notes" rows={3} defaultValue={draft.values.notes} placeholder="Operator note for this load" />
                  </section>

                  <footer className="product-modal-footer">
                    <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
                    <button type="submit" className="btn" disabled={busy}>
                      {busy ? "Creating…" : "Create load"}
                    </button>
                  </footer>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  source,
  children,
}: {
  label: string;
  source?: RfqLoadFieldSource;
  children: ReactNode;
}) {
  return (
    <label className="field rfq-load-field">
      <span className="rfq-load-field-label">
        {label}
        {source && <SourceBadge source={source} />}
      </span>
      {children}
    </label>
  );
}

function SourceBadge({ source }: { source: RfqLoadFieldSource }) {
  const title = [source.label, source.detail].filter(Boolean).join(" · ");
  return (
    <em className={`rfq-load-source ${source.kind}`} title={title}>
      {source.kind === "prior_load" ? source.reference ?? "prior load" : source.label}
    </em>
  );
}
