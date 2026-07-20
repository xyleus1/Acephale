"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { dimensionsSummary, CONTAINER_TYPE_LABEL } from "@/lib/cargo";
import { calculateOpportunity, type OpportunityCarrierQuote } from "@/lib/opportunity-score";
import { OpportunityScorePill } from "./opportunity-score-card";
import { Icon } from "./icon";

export type TableJob = {
  id: string;
  reference: string;
  title: string | null;
  cadence: string | null;
  quantity: number | null;
  quantityUnit: string | null;
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
  stackable: string | null;
  topLoad: string | null;
  dangerousGoods: string | null;
  customsBy: string | null;
  targetPrice: number | null;
  targetCurrency: string | null;
  targetPriceStatus: string | null;
  targetPriceSource: string | null;
  fromEmail: string | null;
  fromCompany: string | null;
  assignedToName: string | null;
  carrierQuotes: OpportunityCarrierQuote[];
  etd: string | null;
  eta: string | null;
  revenue: number | null;
  cost: number | null;
  currency: string | null;
  notes: string | null;
  createdAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Proposed", INQUIRY: "RFQ", QUOTED: "Pricing", BOOKED: "Booked",
  IN_TRANSIT: "En Route", CUSTOMS: "En Route", DELIVERED: "Delivered", CANCELLED: "Cancelled",
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
  { key: "title",       label: "Deal",        default: true,  value: (j) => j.title,
    render: (j) => j.title ? <span className="data-cell-strong">{j.title}</span> : "—" },
  { key: "status",      label: "Stage",       default: true,  value: (j) => j.status,
    render: (j) => <span className={`data-status-badge${j.status === "CANCELLED" ? " cancelled" : ""}`}>{STATUS_LABEL[j.status] ?? j.status}</span> },
  { key: "opportunity", label: "Opportunity", default: true,  value: (j) => calculateOpportunity(j).score, numeric: true,
    render: (j) => <OpportunityScorePill score={calculateOpportunity(j)} /> },
  { key: "customer",    label: "Customer",    default: true,  value: (j) => j.companyName },
  { key: "assignee",    label: "Assigned",    default: true,  value: (j) => j.assignedToName,
    render: (j) => j.assignedToName ?? <span className="data-muted">—</span> },
  { key: "route",       label: "Route",       default: true,  value: (j) => `${j.origin ?? ""} ${j.destination ?? ""}`.trim() || null,
    render: (j) => j.origin || j.destination ? <>{j.origin ?? "?"} → {j.destination ?? "?"}</> : "—" },
  { key: "mode",        label: "Mode",        default: true,  value: (j) => j.mode },
  { key: "equipment",   label: "Equipment",   default: true,  value: (j) =>
      j.mode === "SEA-FCL" && j.containerCount
        ? `${j.containerCount} × ${j.containerType ? (CONTAINER_TYPE_LABEL[j.containerType] ?? j.containerType) : "cntr"}`
        : dimensionsSummary(j.dimensions)
          || (j.quantity != null ? `${j.quantity.toLocaleString()} ${j.quantityUnit ?? ""}`.trim() : null) },
  { key: "quantity",    label: "Quantity",    default: false, value: (j) => j.quantity, numeric: true,
    render: (j) => j.quantity != null ? `${j.quantity.toLocaleString()} ${j.quantityUnit ?? ""}`.trim() : "—" },
  { key: "cadence",     label: "Frequency",   default: false, value: (j) => j.cadence,
    render: (j) => j.cadence === "MONTHLY" ? "Monthly" : j.cadence === "ONE_OFF" ? "One-off" : "—" },
  { key: "commodity",   label: "Commodity",   default: false, value: (j) => j.commodity },
  { key: "incoterms",   label: "Incoterms",   default: false, value: (j) => j.incoterms },
  { key: "weight",      label: "Weight (kg)", default: false, value: (j) => j.weight, numeric: true,
    render: (j) => j.weight != null ? j.weight.toLocaleString() : "—" },
  { key: "volume",      label: "CBM",         default: false, value: (j) => j.volume, numeric: true,
    render: (j) => j.volume != null ? j.volume.toLocaleString() : "—" },
  { key: "stackable",   label: "Stackable",   default: false, value: (j) => j.stackable,
    render: (j) => j.stackable === "YES" ? "Yes" : j.stackable === "NO" ? `No${j.topLoad === "YES" ? " · top load" : ""}` : "Unknown" },
  { key: "dg",          label: "DG",          default: false, value: (j) => j.dangerousGoods,
    render: (j) => j.dangerousGoods === "YES" ? "Yes" : j.dangerousGoods === "NO" ? "No" : "Unknown" },
  { key: "customs",     label: "Customs By",  default: false, value: (j) => j.customsBy,
    render: (j) => j.customsBy === "US" ? "Us" : j.customsBy === "CUSTOMER" ? "Customer" : j.customsBy === "FORWARDER" ? "Forwarder" : "Unknown" },
  { key: "packages",    label: "Packages",    default: false, value: (j) => j.packages, numeric: true },
  { key: "target",      label: "Target Price",default: true,  value: (j) => j.targetPrice, numeric: true,
    render: (j) => j.targetPrice != null
      ? `${j.targetCurrency ?? "USD"} ${j.targetPrice.toLocaleString()}`
      : j.targetPriceStatus === "NO_TARGET" ? "No target" : "Ask" },
  { key: "revenue",     label: "Revenue",     default: false, value: (j) => j.revenue, numeric: true, render: (j) => fmtMoney(j.revenue) },
  { key: "cost",        label: "Cost",        default: false, value: (j) => j.cost, numeric: true, render: (j) => fmtMoney(j.cost) },
  { key: "profit",      label: "Profit",      default: true,  numeric: true,
    value: (j) => (j.revenue != null && j.cost != null ? j.revenue - j.cost : null),
    render: (j) => (j.revenue != null && j.cost != null ? fmtMoney(j.revenue - j.cost) : "—") },
  { key: "margin",      label: "Margin",      default: false, numeric: true,
    value: (j) => (j.revenue && j.cost ? (j.revenue - j.cost) / j.revenue : null),
    render: (j) => (j.revenue && j.cost ? `${(((j.revenue - j.cost) / j.revenue) * 100).toFixed(1)}%` : "—") },
  { key: "note",        label: "Note",        default: true,  value: (j) => j.notes,
    render: (j) => j.notes ? <span title={j.notes} className="data-note">{j.notes}</span> : "—" },
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
      <div className="table-toolbar">
        <div ref={pickerRef} className="table-picker">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickerOpen((o) => !o)}>
            <Icon name="grid" size={12} />
            Columns ({cols.length})
          </button>
          {pickerOpen && (
            <div className="table-picker-menu">
              {COLUMNS.map((c) => (
                <label key={c.key} className="table-picker-option">
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

      <div className="card table-shell">
        <table className="data-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => toggleSort(c.key)}
                  className={`${c.numeric ? "numeric" : ""}${sortKey === c.key ? " active" : ""}`}
                >
                  {c.label}{sortKey === c.key ? (sortDir === 1 ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={cols.length} className="table-empty-cell">No jobs match.</td></tr>
            ) : sorted.map((j) => (
              <tr
                key={j.id}
                onClick={() => { window.location.href = `/dashboard/jobs/${j.id}`; }}
                className="data-row"
              >
                {cols.map((c) => (
                  <td key={c.key} className={`${c.numeric ? "numeric" : ""}${c.key === "reference" ? " data-cell-mono" : ""}`}>
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
