"use client";

import { useEffect, useState } from "react";
import { subscribe, toggle, isSelected } from "./bulk-select-store";

export function BulkCheckbox({ threadId }: { threadId: string }) {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  const checked = isSelected(threadId);
  return (
    <label
      onClick={(e) => e.stopPropagation()}
      style={{ display: "inline-flex", alignItems: "center", padding: "0 4px", cursor: "pointer" }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => toggle(threadId)}
        style={{ width: 14, height: 14, cursor: "pointer" }}
      />
    </label>
  );
}
