"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dimensionsSummary } from "./dimensions-input";
import { CONTAINER_TYPE_LABEL } from "./cargo-fields";

export type TableJob = {
  id: string;
  reference: string;
  status: string;
  type: string;
  companyName: string | null;
  origin: string | null;
  destination: string | null;
  mode: string | null;
  commodity: string | null;
  incoterms: string | null;
  weight: number | null;
  volume: number | null;
  packages: number | null;
  dimensions: string | null;
  containerCount: number | null;
  containerType: string | null;
  etd: string | null;
  eta: string | null;
  revenue: number | null;
  cost: number | null;
  currency: string | null;
  notes: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Proposed", INQUIRY: "Inquiry", QUOTED: "Quoted", BOOKED: "Booked",
  IN_TRANSIT: "In Transit", CUSTOMS: "Customs", DELIVERED: "Delivered", CANCELLED: "Cancelled",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}
function fmtMoney(n: number | null): string {
  return n != null ? `$${n.toLocaleString()}` : "—";
}

type Col = {
  key: string;
  label: string;
  default: boolean;
  value: (j: TableJob) => string | number | null;
  render?: (j: TableJob) => React.ReactNode;
  numeric?: boolean;
};

const COLUMNS: Col[] = [
  { key: "reference",   label: "Reference",   default: true,  value: (j) => j.reference },
  { key: "status",      label: "Stage",       default: true,  value: (j) => j.status,
    render: (j) => <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 3, background: j.status === "CANCELLED" ? "var(--surface-3)" : "var(--brand-light)", color: j.status === "CANCELLED" ? "var(--text-3)" : "var(--brand)", border: "1px solid var(--brand-border)", letterSpacing: "0.04em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{STATUS_LABEL[j.status] ?? j.status}</span> },
  { key: "customer",    label: "Customer",    default: true,  value: (j) => j.companyName },
  { key: "route",       label: "Route",       default: true,  value: (j) => `${j.origin ?? ""} ${j.destination ?? ""}`.trim() || null,
    render: (j) => j.origin || j.destination ? <>{j.origin ?? "?"} → {j.destination ?? "?"}</> : "—" },
  { key: "mode",        label: "Mode",        default: true,  value: (j) => j.mode },
  { key: "equipment",   label: "Equipment",   default: true,  value: (j) =>
      j.mode === "SEA-FCL" && j.containerCount
        ? `${j.containerCount} × ${j.containerType ? (CONTAINER_TYPE_LABEL[j.containerType] ?? j.containerType) : "cntr"}`
        : dimensionsSummary(j.dimensions) || null },
  { key: "commodity",   label: "Commodity",   default: false, value: (j) => j.commodity },
  { key: "incoterms",   label: "Incoterms",   default: false, value: (j) => j.incoterms },
  { key: "weight",      label: "Weight (kg)", default: false, value: (j) => j.weight, numeric: true,
    render: (j) => j.weight != null ? j.weight.toLocaleString() : "—" },
  { key: "volume",      label: "CBM",         default: false, value: (j) => j.volume, numeric: true,
    render: (j) => j.volume != null ? j.volume.toLocaleString() : "—" },
  { key: "packages",    label: "Packages",    default: false, value: (j) => j.packages, numeric: true },
  { key: "etd",         label: "ETD",         default: true,  value: (j) => j.etd, render: (j) => fmtDate(j.etd) },
  { key: "eta",         label: "ETA",         default: true,  value: (j) => j.eta, render: (j) => fmtDate(j.eta) },
  { key: "revenue",     label: "Revenue",     default: false, value: (j) => j.revenue, numeric: true, render: (j) => fmtMoney(j.revenue) },
  { key: "cost",        label: "Cost",        default: false, value: (j) => j.cost, numeric: true, render: (j) => fmtMoney(j.cost) },
  { key: "margin",      label: "Margin",      default: false, numeric: true,
    value: (j) => (j.revenue && j.cost ? (j.revenue - j.cost) / j.revenue : null),
    render: (j) => (j.revenue && j.cost ? `${(((j.revenue - j.cost) / j.revenue) * 100).toFixed(1)}%` : "—") },
  { key: "note",        label: "Note",        default: true,  value: (j) => j.notes,
    render: (j) => j.notes ? <span title={j.notes} style={{ display: "inline-block", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom", color: "var(--text-2)" }}>{j.notes}</span> : "—" },
  { key: "created",     label: "Created",     default: false, value: (j) => j.createdAt, render: (j) => fmtDate(j.createdAt) },
];

const STORAGE_KEY = "derya.jobsTable.columns";

export function JobsTable({ jobs }: { jobs: TableJob[] }) {
  const [visible, setVisible] = useState<string[]>(COLUMNS.filter((c) => c.default).map((c) => c.key));
  const [loaded, setLoaded] = useState(false);
  const [sortKey, setSortKey] = useState<string>("created");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) setVisible(arr.filter((k) => COLUMNS.some((c) => c.key === k)));
      }
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(visible)); } catch {}
    }
  }, [visible, loaded]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    if (pickerOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [pickerOpen]);

  const cols = COLUMNS.filter((c) => visible.includes(c.key));

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return jobs;
    return [...jobs].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb)) * sortDir;
    });
  }, [jobs, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <div ref={pickerRef} style={{ position: "relative" }}>
          <button type="button" className="btn btn-secondary btn-sm" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setPickerOpen((o) => !o)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
            Columns ({cols.length})
          </button>
          {pickerOpen && (
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 30,
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "8px 0", minWidth: 200,
              maxHeight: 360, overflowY: "auto",
            }}>
              {COLUMNS.map((c) => (
                <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 14px", fontSize: 12.5, cursor: "pointer", color: "var(--text)" }}>
                  <input
                    type="checkbox"
                    checked={visible.includes(c.key)}
                    onChange={(e) => setVisible((prev) => e.target.checked ? COLUMNS.map((x) => x.key).filter((k) => prev.includes(k) || k === c.key) : prev.filter((k) => k !== c.key))}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  style={{
                    padding: "9px 12px", textAlign: c.numeric ? "right" : "left", whiteSpace: "nowrap",
                    fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                    color: sortKey === c.key ? "var(--text)" : "var(--text-3)",
                    borderBottom: "1px solid var(--border)", background: "var(--surface-2)",
                    cursor: "pointer", userSelect: "none", position: "sticky", top: 0,
                  }}
                >
                  {c.label}{sortKey === c.key ? (sortDir === 1 ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={cols.length} style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>No jobs match.</td></tr>
            ) : sorted.map((j) => (
              <tr
                key={j.id}
                onClick={() => { window.location.href = `/dashboard/jobs/${j.id}`; }}
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ""; }}
              >
                {cols.map((c) => (
                  <td key={c.key} style={{
                    padding: "9px 12px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap",
                    textAlign: c.numeric ? "right" : "left",
                    fontVariantNumeric: c.numeric ? "tabular-nums" : undefined,
                    fontFamily: c.key === "reference" ? "ui-monospace, Menlo, monospace" : undefined,
                    fontWeight: c.key === "reference" ? 600 : 400,
                    color: "var(--text)",
                  }}>
                    {c.render ? c.render(j) : (c.value(j) ?? "—") || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
