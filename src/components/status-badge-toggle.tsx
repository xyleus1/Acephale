"use client";
import { useState, useRef, useEffect, useTransition } from "react";
import { updateCompanyStatusAction } from "@/app/dashboard/activity/actions";

const STATUS_OPTIONS = [
  { value: "UNTOUCHED", label: "Untouched", tone: "neutral" },
  { value: "IN_PROGRESS", label: "In Progress", tone: "info" },
  { value: "WORKED", label: "Worked", tone: "good" },
  { value: "LOST", label: "Lost", tone: "danger" },
] as const;

const TONE_STYLES: Record<string, React.CSSProperties> = {
  neutral: { background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--border)" },
  info: { background: "var(--info-bg, #eff6ff)", color: "var(--info, #1d4ed8)", border: "1px solid var(--info-border, #bfdbfe)" },
  good: { background: "var(--success-bg, #ffffff)", color: "var(--success, #1f5d43)", border: "1px solid var(--success-border, #bdd5c7)" },
  danger: { background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid var(--danger-border)" },
};

export function StatusBadgeToggle({
  companyId,
  initialStatus,
}: {
  companyId: string;
  initialStatus: string;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const current = STATUS_OPTIONS.find((s) => s.value === status) ?? STATUS_OPTIONS[0];
  const toneStyle = TONE_STYLES[current.tone];

  function handleSelect(value: string) {
    setOpen(false);
    if (value === status) return;
    setStatus(value);
    startTransition(async () => {
      await updateCompanyStatusAction(companyId, value);
    });
  }

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...toneStyle,
          fontSize: 11,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 4,
          cursor: "pointer",
          opacity: isPending ? 0.6 : 1,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          whiteSpace: "nowrap",
        }}
      >
        {current.label}
        <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ opacity: 0.6 }}>
          <path d="M4 6L0.5 2h7L4 6z" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 50,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
            minWidth: 130,
            overflow: "hidden",
          }}
        >
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleSelect(opt.value)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: opt.value === status ? 600 : 400,
                background: opt.value === status ? "var(--surface-2)" : "transparent",
                color: opt.value === status ? TONE_STYLES[opt.tone].color : "var(--text)",
                cursor: "pointer",
                border: "none",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
