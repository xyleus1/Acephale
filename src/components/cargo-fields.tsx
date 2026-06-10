"use client";

import { useState } from "react";
import { DimensionsInput } from "./dimensions-input";

export const CONTAINER_TYPES = ["20DC", "40DC", "40HC", "45HC", "20RF", "40RF", "40OT", "40FR"] as const;
export const CONTAINER_TYPE_LABEL: Record<string, string> = {
  "20DC": "20' Dry", "40DC": "40' Dry", "40HC": "40' High Cube", "45HC": "45' High Cube",
  "20RF": "20' Reefer", "40RF": "40' Reefer", "40OT": "40' Open Top", "40FR": "40' Flat Rack",
};

export function equipmentSummary(job: { mode: string | null; containerCount: number | null; containerType: string | null }): string {
  if (job.mode === "SEA-FCL" && job.containerCount) {
    return `${job.containerCount} × ${job.containerType ?? "cntr"}`;
  }
  return "";
}

// Mode selector + the fields that depend on it:
//   FCL  → container count + container type
//   else → structured package dimensions (auto-CBM) + weight
export function CargoFields({
  initialMode,
  initialContainerCount,
  initialContainerType,
  initialDimensions,
  initialWeight,
}: {
  initialMode?: string | null;
  initialContainerCount?: number | null;
  initialContainerType?: string | null;
  initialDimensions?: string | null;
  initialWeight?: number | null;
}) {
  const [mode, setMode] = useState(initialMode ?? "");
  const isFcl = mode === "SEA-FCL";

  return (
    <>
      <div className="form-grid-2" style={{ marginBottom: 12 }}>
        <label className="field"><span>Mode</span>
          <select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">— Select —</option>
            <option value="SEA-FCL">Sea FCL</option>
            <option value="SEA-LCL">Sea LCL</option>
            <option value="AIR">Air</option>
            <option value="ROAD">Road</option>
            <option value="COURIER">Courier</option>
          </select>
        </label>
        <label className="field"><span>Weight (kg)</span>
          <input name="weight" type="number" step="any" placeholder="0" defaultValue={initialWeight ?? ""} />
        </label>
      </div>

      {isFcl ? (
        <div className="form-grid-2" style={{ marginBottom: 0 }}>
          <label className="field"><span>Containers</span>
            <input name="containerCount" type="number" min="1" placeholder="e.g. 2" defaultValue={initialContainerCount ?? ""} />
          </label>
          <label className="field"><span>Container type</span>
            <select name="containerType" defaultValue={initialContainerType ?? ""}>
              <option value="">— Select —</option>
              {CONTAINER_TYPES.map((t) => (
                <option key={t} value={t}>{CONTAINER_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="field" style={{ marginBottom: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-2)", marginBottom: 6, display: "block" }}>Dimensions</span>
          <DimensionsInput initial={initialDimensions} />
        </div>
      )}
    </>
  );
}
