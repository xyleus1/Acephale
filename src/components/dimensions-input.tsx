"use client";

import { useState } from "react";
import { type DimRow, parseDimensions, rowCbm, totalCbm } from "@/lib/cargo";

// Structured package dimensions (Qty × L × W × H in cm) with live CBM total.
// Serializes to two hidden inputs: `dimensions` (JSON) and `volume` (total CBM).
export function DimensionsInput({ initial }: { initial?: string | null }) {
  const parsed = parseDimensions(initial);
  const [rows, setRows] = useState<DimRow[]>(
    parsed.length > 0 ? parsed : [{ qty: "", length: "", width: "", height: "" }]
  );

  function update(i: number, key: keyof DimRow, value: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  }

  const cbm = totalCbm(rows);
  const filled = rows.filter((r) => r.qty || r.length || r.width || r.height);

  const cellStyle: React.CSSProperties = { fontSize: 13, padding: "6px 8px", width: "100%" };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 1fr 60px 28px", gap: 6, alignItems: "center", marginBottom: 4 }}>
        {["Qty", "Length (cm)", "Width (cm)", "Height (cm)", "CBM", ""].map((h, i) => (
          <span key={i} style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 1fr 60px 28px", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <input type="number" min="1" placeholder="1" value={r.qty} onChange={(e) => update(i, "qty", e.target.value)} style={cellStyle} />
          <input type="number" min="0" placeholder="120" value={r.length} onChange={(e) => update(i, "length", e.target.value)} style={cellStyle} />
          <input type="number" min="0" placeholder="80" value={r.width} onChange={(e) => update(i, "width", e.target.value)} style={cellStyle} />
          <input type="number" min="0" placeholder="100" value={r.height} onChange={(e) => update(i, "height", e.target.value)} style={cellStyle} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>
            {rowCbm(r) > 0 ? rowCbm(r).toFixed(2) : "—"}
          </span>
          <button
            type="button"
            onClick={() => setRows((prev) => (prev.length === 1 ? [{ qty: "", length: "", width: "", height: "" }] : prev.filter((_, idx) => idx !== i)))}
            title="Remove row"
            style={{ border: "1px solid var(--border)", background: "var(--surface-2)", color: "var(--text-3)", borderRadius: 4, width: 24, height: 24, cursor: "pointer", fontSize: 13, lineHeight: 1 }}
          >×</button>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { qty: "", length: "", width: "", height: "" }])}
          className="btn btn-secondary btn-sm"
          style={{ fontSize: 12 }}
        >+ Add package</button>
        <span style={{ fontSize: 12, color: "var(--text-2)" }}>
          Total: <strong style={{ color: "var(--text)" }}>{cbm.toFixed(3)} cbm</strong>
        </span>
      </div>
      <input type="hidden" name="dimensions" value={filled.length > 0 ? JSON.stringify(filled.map((r) => ({ qty: Number(r.qty) || 1, length: Number(r.length) || 0, width: Number(r.width) || 0, height: Number(r.height) || 0 }))) : ""} />
      <input type="hidden" name="volume" value={cbm > 0 ? String(cbm) : ""} />
    </div>
  );
}
