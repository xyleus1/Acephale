"use client";

import { useState } from "react";
import { DimensionsInput } from "./dimensions-input";
import { CONTAINER_TYPES, CONTAINER_TYPE_LABEL } from "@/lib/cargo";

// Mode selector + the fields that depend on it:
//   FCL  → container count + container type
//   else → structured package dimensions (auto-CBM) + weight
export function CargoFields({
  initialMode,
  initialContainerCount,
  initialContainerType,
  initialDimensions,
  initialWeight,
  initialStackable,
  initialTopLoad,
}: {
  initialMode?: string | null;
  initialContainerCount?: number | null;
  initialContainerType?: string | null;
  initialDimensions?: string | null;
  initialWeight?: number | null;
  initialStackable?: string | null;
  initialTopLoad?: string | null;
}) {
  const [mode, setMode] = useState(initialMode ?? "");
  const isFcl = mode === "SEA-FCL";

  return (
    <div className="cargo-fields">
      <div className="form-grid-2">
        <label className="field"><span>Mode</span>
          <select name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">- Select -</option>
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
        <div className="form-grid-2">
          <label className="field"><span>Containers</span>
            <input name="containerCount" type="number" min="1" placeholder="e.g. 2" defaultValue={initialContainerCount ?? ""} />
          </label>
          <label className="field"><span>Container type</span>
            <select name="containerType" defaultValue={initialContainerType ?? ""}>
              <option value="">- Select -</option>
              {CONTAINER_TYPES.map((t) => (
                <option key={t} value={t}>{CONTAINER_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="field">
          <span className="cargo-dimensions-label">Dimensions</span>
          <DimensionsInput
            initial={initialDimensions}
            initialStackable={initialStackable}
            initialTopLoad={initialTopLoad}
          />
        </div>
      )}
    </div>
  );
}
