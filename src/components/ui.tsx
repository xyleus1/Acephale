type BadgeTone = "neutral" | "good" | "warn" | "danger" | "info";

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({ message, icon = "◌" }: { message: string; icon?: string }) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">{icon}</span>
      <span>{message}</span>
    </div>
  );
}

export function statusTone(
  value: string,
  map: Partial<Record<string, BadgeTone>>,
  fallback: BadgeTone = "neutral"
): BadgeTone {
  return map[value] ?? fallback;
}

// Kept for backwards compatibility where still used
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="section-title" style={{ marginBottom: 12 }}>{children}</div>;
}

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
