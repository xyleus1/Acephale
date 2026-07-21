import { prisma } from "@/lib/prisma";

// Admin-facing activity log: one row per user action on a load. Deliberately
// separate from MemoryEvent (agent memory) and Event (system/agent audit) -
// this table answers "who changed what, where" for humans.

export type AuditChange = { field: string; from: string | null; to: string | null };

export type AuditAction =
  | "load.created"
  | "load.status_changed"
  | "load.claimed"
  | "load.assigned"
  | "load.updated";

const VALUE_MAX_LEN = 160;

// Normalize any field value to a short, log-friendly string (null = empty).
export function auditValueOf(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  const s = String(value).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > VALUE_MAX_LEN ? `${s.slice(0, VALUE_MAX_LEN)}…` : s;
}

// Compare a before-snapshot with an update payload and keep only real changes.
export function diffAuditChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fieldLabels?: Record<string, string>,
): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const key of Object.keys(after)) {
    const from = auditValueOf(before[key]);
    const to = auditValueOf(after[key]);
    if (from === to) continue;
    changes.push({ field: fieldLabels?.[key] ?? key, from, to });
  }
  return changes;
}

export async function recordAuditLog(args: {
  officeId: string;
  actorUserId?: string | null;
  actorEmail: string;
  action: AuditAction;
  entityType?: string;
  entityId?: string | null;
  entityRef?: string | null;
  summary: string;
  changes?: AuditChange[];
}): Promise<void> {
  // The log must never break the action it describes.
  await prisma.auditLog
    .create({
      data: {
        officeId: args.officeId,
        actorUserId: args.actorUserId ?? null,
        actorEmail: args.actorEmail,
        action: args.action,
        entityType: args.entityType ?? "job",
        entityId: args.entityId ?? null,
        entityRef: args.entityRef ?? null,
        summary: args.summary,
        changes: args.changes && args.changes.length > 0 ? args.changes : undefined,
      },
    })
    .catch((error) => {
      console.warn("audit log write failed", error);
      return null;
    });
}
