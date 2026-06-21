export type DocumentReadinessDoc = {
  id: string;
  name: string;
  status: string;
  docType?: string | null;
  aiSummary?: string | null;
  aiFlags?: string | null;
  aiKeyFields?: string | null;
};

export type DocumentReadinessTone = "ready" | "review" | "blocked" | "info";

export type DocumentReadiness = {
  total: number;
  approved: number;
  uploaded: number;
  pending: number;
  analyzed: number;
  extractedFields: number;
  flags: number;
  readinessPct: number;
  tone: DocumentReadinessTone;
  label: string;
  metric: string;
  detail: string;
  pendingDocs: DocumentReadinessDoc[];
};

function countJsonFields(value?: string | null) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    return Object.keys(parsed).length;
  } catch {
    return 0;
  }
}

function countJsonFlags(value?: string | null) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function pct(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export function buildDocumentReadiness(docs: DocumentReadinessDoc[]): DocumentReadiness {
  const total = docs.length;
  const approved = docs.filter((doc) => doc.status === "APPROVED").length;
  const uploaded = docs.filter((doc) => doc.status === "UPLOADED").length;
  const pending = docs.filter((doc) => doc.status === "PENDING").length;
  const analyzed = docs.filter((doc) => doc.aiSummary || doc.aiKeyFields || doc.aiFlags).length;
  const extractedFields = docs.reduce((sum, doc) => sum + countJsonFields(doc.aiKeyFields), 0);
  const flags = docs.reduce((sum, doc) => sum + countJsonFlags(doc.aiFlags), 0);
  const readinessPct = pct(approved, total);
  const pendingDocs = docs.filter((doc) => doc.status !== "APPROVED").slice(0, 4);

  if (total === 0) {
    return {
      total,
      approved,
      uploaded,
      pending,
      analyzed,
      extractedFields,
      flags,
      readinessPct,
      tone: "info",
      label: "No document pack",
      metric: "No docs",
      detail: "The brain is relying on RFQ text, pricing data, and inbox evidence only.",
      pendingDocs,
    };
  }

  if (flags > 0) {
    return {
      total,
      approved,
      uploaded,
      pending,
      analyzed,
      extractedFields,
      flags,
      readinessPct,
      tone: "review",
      label: "Document flags",
      metric: `${flags} AI flag${flags === 1 ? "" : "s"}`,
      detail: "AI saw document discrepancies. Review them before trusting the proof pack.",
      pendingDocs,
    };
  }

  if (uploaded > 0) {
    return {
      total,
      approved,
      uploaded,
      pending,
      analyzed,
      extractedFields,
      flags,
      readinessPct,
      tone: "review",
      label: "Documents need approval",
      metric: `${uploaded} uploaded`,
      detail: "Uploaded files are present, but an operator still needs to approve them.",
      pendingDocs,
    };
  }

  if (pending > 0) {
    return {
      total,
      approved,
      uploaded,
      pending,
      analyzed,
      extractedFields,
      flags,
      readinessPct,
      tone: "info",
      label: "Document pack incomplete",
      metric: `${approved}/${total} approved`,
      detail: "Some documents are still pending. This is visible evidence, not a pricing blocker by itself.",
      pendingDocs,
    };
  }

  return {
    total,
    approved,
    uploaded,
    pending,
    analyzed,
    extractedFields,
    flags,
    readinessPct,
    tone: "ready",
    label: "Documents approved",
    metric: `${approved}/${total} approved`,
    detail: `${analyzed}/${total} documents have extracted summaries, fields, or flags.`,
    pendingDocs,
  };
}
