"use client";
import { useEffect, useRef, useState } from "react";

const STATUS_LABELS: Record<string, string> = {
  UNTOUCHED: "Untouched",
  IN_PROGRESS: "In Progress",
  WORKED: "Worked",
  LOST: "Lost",
};

const statuses = ["UNTOUCHED", "IN_PROGRESS", "WORKED", "LOST"];

export function BulkBar({ action }: { action: (fd: FormData) => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    function onCheck() {
      const checks = document.querySelectorAll<HTMLInputElement>("input[name='companyIds']:checked");
      setSelected(Array.from(checks).map((c) => c.value));
    }
    document.addEventListener("change", onCheck);
    return () => document.removeEventListener("change", onCheck);
  }, []);

  if (selected.length === 0) return null;

  return (
    <div className="bulk-bar-float">
      <span style={{ fontWeight: 600 }}>{selected.length} selected</span>
      <form ref={formRef} action={action} style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {selected.map((id) => (
          <input key={id} type="hidden" name="companyIds" value={id} />
        ))}
        <select name="bulkStatus" style={{ width: "auto", height: 30, fontSize: 12 }}>
          {statuses.map((s) => (
            <option key={s} value={s}>→ {STATUS_LABELS[s] ?? s}</option>
          ))}
        </select>
        <button type="submit" className="btn-sm">Apply</button>
      </form>
      <button
        type="button"
        className="secondary btn-sm"
        onClick={() => {
          document.querySelectorAll<HTMLInputElement>("input[name='companyIds']").forEach((c) => { c.checked = false; });
          setSelected([]);
        }}
      >
        Clear
      </button>
    </div>
  );
}
