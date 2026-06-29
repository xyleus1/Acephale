export function intelligenceIconKindForCategory(type: string) {
  if (type === "rate" || type === "rate_index") return "rate";
  if (type === "customs" || type === "compliance" || type === "regulatory") return "customs";
  if (type === "port_disruption" || type === "port") return "port";
  if (type === "carrier_advisory" || type === "capacity" || type === "carrier") return "carrier";
  return "market";
}

export function IntelligenceIcon({ type, size = 18 }: { type: string; size?: number }) {
  const kind = intelligenceIconKindForCategory(type);
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "rate") {
    return <svg {...common}><path d="M4 19h16" /><path d="M6 16l4-5 4 3 4-7" /><path d="M18 7h-4" /><path d="M18 7v4" /></svg>;
  }
  if (kind === "customs") {
    return <svg {...common}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h4" /><path d="M9 13h6" /><path d="M9 17h5" /></svg>;
  }
  if (kind === "port") {
    return <svg {...common}><path d="M4 20h16" /><path d="M7 17V8l5-4 5 4v9" /><path d="M9 17v-5h6v5" /><path d="M12 4v16" /></svg>;
  }
  if (kind === "carrier") {
    return <svg {...common}><path d="M3 16l2-6h11l3 6" /><path d="M5 16c2 2 4 2 6 0 2 2 4 2 6 0 1 1 2 1 4 0" /><path d="M7 10V6h7v4" /></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></svg>;
}

export function EntityBadge({ label }: { label: string }) {
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "MI";
  return (
    <span style={{
      display: "inline-grid",
      placeItems: "center",
      width: 24,
      height: 24,
      borderRadius: 6,
      background: "linear-gradient(135deg, #0a1f3a, #5a3a25)",
      color: "white",
      fontSize: 10,
      fontWeight: 700,
      flex: "0 0 auto",
    }}>
      {initials}
    </span>
  );
}
