"use client";
import { useState } from "react";

export function NewAccountBtn({ onToggle, open }: { onToggle: () => void; open?: boolean }) {
  return (
    <button type="button" className="btn-sm" onClick={onToggle}>
      {open ? "✕ Cancel" : "+ New Account"}
    </button>
  );
}

export function NewAccountToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" className="btn-sm" onClick={() => setOpen(!open)}>
          {open ? "✕ Cancel" : "+ New Account"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          {children}
        </div>
      )}
    </div>
  );
}
