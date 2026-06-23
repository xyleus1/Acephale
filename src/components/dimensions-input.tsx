"use client";

import { useState } from "react";
import { dimensionCompleteness, type DimRow, parseDimensions, rowCbm, totalCbm, totalChargeableCbm } from "@/lib/cargo";

// Structured package dimensions (Qty × L × W × H in cm) with live CBM total.
// Serializes to two hidden inputs: `dimensions` (JSON) and `volume` (total CBM).
export function DimensionsInput({
  initial,
  initialStackable,
  initialTopLoad,
}: {
  initial?: string | null;
  initialStackable?: string | null;
  initialTopLoad?: string | null;
}) {
  const parsed = parseDimensions(initial);
  const [rows, setRows] = useState<DimRow[]>(
    parsed.length > 0 ? parsed : [{ qty: "", length: "", width: "", height: "" }]
  );
  const [stackable, setStackable] = useState(initialStackable ?? "UNKNOWN");
  const [topLoad, setTopLoad] = useState(initialTopLoad ?? "UNKNOWN");

  function update(i: number, key: keyof DimRow, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  const cbm = totalCbm(rows);
  const chargeable = totalChargeableCbm(rows, stackable);
  const filled = rows.filter((r) => r.qty || r.length || r.width || r.height);
  const completeness = dimensionCompleteness(rows);

  return (
    <div className="dimensions-input">
      <div className="dimension-grid-wrap">
        <div className="dimension-grid dimension-grid-head">
          {["Qty", "Length (cm)", "Width (cm)", "Height (cm)", "CBM", ""].map((h, i) => (
            <span key={i} className="dimension-heading">{h}</span>
          ))}
        </div>
        {rows.map((r, i) => (
          <div key={i} className="dimension-grid dimension-grid-row">
            <input className="dimension-input" type="number" min="1" placeholder="1" value={r.qty} onChange={(e) => update(i, "qty", e.target.value)} />
            <input className="dimension-input" type="number" min="0" placeholder="120" value={r.length} onChange={(e) => update(i, "length", e.target.value)} />
            <input className="dimension-input" type="number" min="0" placeholder="80" value={r.width} onChange={(e) => update(i, "width", e.target.value)} />
            <input className="dimension-input" type="number" min="0" placeholder="100" value={r.height} onChange={(e) => update(i, "height", e.target.value)} />
            <span className="dimension-cbm">
              {rowCbm(r) > 0 ? rowCbm(r).toFixed(2) : "—"}
            </span>
            <button
              type="button"
              onClick={() => setRows((prev) => (prev.length === 1 ? [{ qty: "", length: "", width: "", height: "" }] : prev.filter((_, idx) => idx !== i)))}
              title="Remove row"
              className="dimension-remove-btn"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="form-grid-2 dimension-options">
        <label className="field">
          <span>Stackable?</span>
          <select value={stackable} onChange={(e) => setStackable(e.target.value)}>
            <option value="UNKNOWN">Unknown</option>
            <option value="YES">Yes</option>
            <option value="NO">No</option>
          </select>
        </label>
        {stackable === "NO" && (
          <label className="field">
            <span>Top load?</span>
            <select value={topLoad} onChange={(e) => setTopLoad(e.target.value)}>
              <option value="UNKNOWN">Unknown</option>
              <option value="YES">Requested</option>
              <option value="NO">Not requested</option>
            </select>
          </label>
        )}
      </div>
      {stackable === "NO" && (
        <div className="dimension-help">
          Non-stackable cargo is priced using the floor area it occupies with a 20&apos; container height. Top load can be requested, but it is not guaranteed and normally costs more than stackable cargo.
        </div>
      )}
      {completeness.hasPartialDimensions && (
        <div className="dimension-warning">
          Complete quantity, length, width, and height on every entered row before using CBM for pricing.
        </div>
      )}
      <div className="dimension-summary-row">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { qty: "", length: "", width: "", height: "" }])}
          className="btn btn-secondary btn-sm"
        >+ Add package</button>
        <span className="dimension-total">
          Physical: <strong>{cbm.toFixed(3)} cbm</strong>
          {stackable === "NO" && (
            <span> · Chargeable: <strong>{chargeable.toFixed(3)} cbm</strong></span>
          )}
        </span>
      </div>
      <input type="hidden" name="dimensions" value={filled.length > 0 ? JSON.stringify(filled.map((r) => ({ qty: Number(r.qty) || 1, length: Number(r.length) || 0, width: Number(r.width) || 0, height: Number(r.height) || 0 }))) : ""} />
      <input type="hidden" name="volume" value={chargeable > 0 ? String(chargeable) : ""} />
      <input type="hidden" name="stackable" value={stackable} />
      <input type="hidden" name="topLoad" value={stackable === "NO" ? topLoad : ""} />
    </div>
  );
}
