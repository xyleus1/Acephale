"use client";
import { useState } from "react";

export function MoreFiltersToggle({ children, hasActive }: { children: React.ReactNode; hasActive: boolean }) {
  const [open, setOpen] = useState(hasActive);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="secondary btn-sm"
        style={{ whiteSpace: "nowrap", gap: 4 }}
      >
        {hasActive ? "▾ Filters •" : "▾ Filters"}
      </button>
      {open && children}
    </>
  );
}
