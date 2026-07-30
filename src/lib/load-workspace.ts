import { dimensionsSummary } from "@/lib/cargo";

export type LoadFactState =
  | "recorded"
  | "source_stated"
  | "confirmed"
  | "conflict"
  | "missing";

export type LoadFact = {
  key: string;
  label: string;
  value: string;
  state: LoadFactState;
  evidence?: string;
  group: "movement" | "cargo" | "timing" | "trade";
};

export type LoadWorkspaceTaskInput = {
  id: string;
  title: string;
  details?: string | null;
  priority?: string | null;
  status?: string | null;
  dueAt?: Date | string | null;
};

export type LoadWorkspaceDocumentInput = {
  id: string;
  name: string;
  status: string;
  docType?: string | null;
};

export type LoadWorkspaceMarketReviewInput = {
  id: string;
  impactLevel: string;
  impactReason: string;
  recommendedAction?: string | null;
  status: string;
  summary: string;
  sourceTitle?: string | null;
};

export type LoadWorkspaceInput = {
  reference: string;
  status: string;
  origin?: string | null;
  destination?: string | null;
  mode?: string | null;
  commodity?: string | null;
  containerCount?: number | null;
  containerType?: string | null;
  dimensions?: string | null;
  quantity?: number | null;
  quantityUnit?: string | null;
  weight?: number | null;
  dangerousGoods?: string | null;
  cargoReadyDate?: Date | string | null;
  etd?: Date | string | null;
  eta?: Date | string | null;
  incoterms?: string | null;
  customsBy?: string | null;
  declaredValue?: number | null;
  declaredValueCurrency?: string | null;
  parsedData?: string | null;
  tasks: LoadWorkspaceTaskInput[];
  documents: LoadWorkspaceDocumentInput[];
  marketReviews: LoadWorkspaceMarketReviewInput[];
  threadCount: number;
  messageCount: number;
};

export type LoadWorkspaceIssue = {
  id: string;
  level: "critical" | "high" | "medium" | "low";
  title: string;
  detail: string;
  evidence?: string;
  kind: "conflict" | "compliance" | "market" | "missing";
};

export type LoadWorkspaceAction = {
  id: string;
  title: string;
  detail?: string;
  priority: "critical" | "high" | "medium" | "low";
  dueAt?: string;
  source: "task" | "derived" | "market";
};

export type LoadWorkspaceModel = {
  facts: LoadFact[];
  issues: LoadWorkspaceIssue[];
  actions: LoadWorkspaceAction[];
  evidence: {
    threadCount: number;
    messageCount: number;
    documentCount: number;
    approvedDocumentCount: number;
    pendingDocumentCount: number;
    marketReviewCount: number;
  };
  primaryAction: LoadWorkspaceAction | null;
  readiness: {
    known: number;
    total: number;
    missing: number;
    label: "ready_for_review" | "needs_inputs";
  };
};

type DossierFactInput = {
  key?: unknown;
  label?: unknown;
  value?: unknown;
  state?: unknown;
  evidence?: unknown;
  group?: unknown;
};

type DossierConflictInput = {
  title?: unknown;
  detail?: unknown;
  evidence?: unknown;
};

type ParsedDossier = {
  facts: LoadFact[];
  conflicts: Array<{ title: string; detail: string; evidence?: string }>;
  missing: Array<{ title: string; detail: string; evidence?: string }>;
};

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  urgent: 0,
  high: 1,
  medium: 2,
  normal: 2,
  low: 3,
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function displayText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "";
}

function evidenceText(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(displayText).filter(Boolean).join("; ");
  }
  return displayText(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function normalizeFactState(value: unknown): LoadFactState {
  const normalized = text(value).toLowerCase();
  // parsedData may be AI-extracted or imported source evidence. It cannot
  // promote itself to operator-confirmed truth without a separate review
  // record, so treat that claim as source-stated here.
  if (normalized === "confirmed" || normalized === "recorded") {
    return "source_stated";
  }
  if (
    normalized === "source_stated" ||
    normalized === "conflict" ||
    normalized === "missing"
  ) {
    return normalized;
  }
  return "source_stated";
}

function normalizeFactGroup(value: unknown, key = ""): LoadFact["group"] {
  const normalized = text(value).toLowerCase();
  if (
    normalized === "movement" ||
    normalized === "cargo" ||
    normalized === "timing" ||
    normalized === "trade"
  ) {
    return normalized;
  }
  if (/origin|destination|port|delivery|mode|equipment/i.test(key)) return "movement";
  if (/ready|etd|eta|window|date|timing/i.test(key)) return "timing";
  if (/incoterm|customs|hts|value|use|return|importer|consignee|rate|quote|price/i.test(key)) return "trade";
  return "cargo";
}

function parseDossier(parsedData: string | null | undefined): ParsedDossier {
  if (!parsedData) return { facts: [], conflicts: [], missing: [] };
  try {
    const parsed = record(JSON.parse(parsedData));
    const dossier = record(parsed.loadDossier ?? parsed.dossier);
    const facts = Array.isArray(dossier.facts)
      ? dossier.facts.flatMap((candidate, index) => {
          const item = candidate as DossierFactInput;
          const label = text(item.label);
          const value = displayText(item.value);
          const state = normalizeFactState(item.state);
          if (!label || (!value && state !== "missing")) return [];
          const key = text(item.key) || `source-fact-${index}`;
          return [{
            key,
            label,
            value,
            state,
            evidence: evidenceText(item.evidence) || undefined,
            group: normalizeFactGroup(item.group, key),
          }];
        })
      : [];
    const conflicts = Array.isArray(dossier.conflicts)
      ? dossier.conflicts.flatMap((candidate) => {
          const item = candidate as DossierConflictInput;
          const title = text(item.title);
          const detail = text(item.detail);
          return title && detail
            ? [{ title, detail, evidence: evidenceText(item.evidence) || undefined }]
            : [];
        })
      : [];
    const missingSource = Array.isArray(dossier.missing)
      ? dossier.missing
      : Array.isArray(dossier.missingItems)
        ? dossier.missingItems
        : [];
    const missing = missingSource.flatMap((candidate) => {
      if (typeof candidate === "string") {
        return candidate.trim()
          ? [{ title: candidate.trim(), detail: "Not present in the source packet." }]
          : [];
      }
      const item = candidate as DossierConflictInput;
      const title = text(item.title);
      if (!title) return [];
      return [{
        title,
        detail: text(item.detail) || "Not present in the source packet.",
        evidence: evidenceText(item.evidence) || undefined,
      }];
    });
    return { facts, conflicts, missing };
  } catch {
    return { facts: [], conflicts: [], missing: [] };
  }
}

function baseFacts(input: LoadWorkspaceInput): LoadFact[] {
  const isFcl = input.mode === "SEA-FCL";
  const equipment = isFcl
    ? input.containerCount
      ? `${input.containerCount} x ${input.containerType || "container type missing"}`
      : input.containerType || ""
    : dimensionsSummary(input.dimensions) ||
      (input.weight != null ? `${input.weight.toLocaleString()} kg cargo` : "");
  const quantity = input.quantity != null
    ? `${input.quantity.toLocaleString()} ${input.quantityUnit || "units"}`
    : "";
  const value = input.declaredValue != null
    ? `${input.declaredValueCurrency || "currency missing"} ${input.declaredValue.toLocaleString()}`
    : "";

  const isKnownText = (rawValue: unknown) => {
    const normalized = text(rawValue).toLowerCase();
    return Boolean(normalized) &&
      !["unknown", "tbd", "not provided", "n/a", "-"].includes(normalized);
  };
  const rows: Array<{
    key: string;
    label: string;
    value: unknown;
    group: LoadFact["group"];
    complete?: boolean;
  }> = [
    { key: "origin", label: "Origin", value: input.origin, group: "movement" },
    { key: "destination", label: "Final destination", value: input.destination, group: "movement" },
    { key: "mode", label: "Mode", value: input.mode, group: "movement" },
    {
      key: "equipment",
      label: "Equipment",
      value: equipment,
      group: "movement",
      complete: isFcl
        ? input.containerCount != null && Boolean(input.containerType)
        : Boolean(dimensionsSummary(input.dimensions)) || input.weight != null,
    },
    { key: "commodity", label: "Commodity", value: input.commodity, group: "cargo" },
    { key: "quantity", label: "Quantity", value: quantity, group: "cargo", complete: input.quantity != null },
    {
      key: "weight",
      label: "Gross weight",
      value: input.weight != null ? `${input.weight.toLocaleString()} kg` : "",
      group: "cargo",
      complete: input.weight != null,
    },
    {
      key: "dangerousGoods",
      label: "Dangerous goods",
      value: input.dangerousGoods,
      group: "cargo",
      complete: input.dangerousGoods === "YES" || input.dangerousGoods === "NO",
    },
    { key: "cargoReadyDate", label: "Cargo ready", value: formatDate(input.cargoReadyDate), group: "timing" },
    { key: "etd", label: "ETD", value: formatDate(input.etd), group: "timing" },
    { key: "eta", label: "ETA", value: formatDate(input.eta), group: "timing" },
    { key: "incoterms", label: "Incoterm", value: input.incoterms, group: "trade" },
    {
      key: "customsBy",
      label: "Customs owner",
      value: input.customsBy,
      group: "trade",
      complete: isKnownText(input.customsBy),
    },
    {
      key: "declaredValue",
      label: "Commercial value",
      value,
      group: "trade",
      complete: input.declaredValue != null && Boolean(input.declaredValueCurrency),
    },
  ];

  return rows.map((row) => {
    const complete = row.complete ?? isKnownText(row.value);
    return {
      key: row.key,
      label: row.label,
      value: complete ? text(row.value) : "",
      state: complete ? "recorded" : "missing",
      group: row.group,
    };
  });
}

function mergeFacts(base: LoadFact[], sourced: LoadFact[]) {
  const canonicalKey: Record<string, string> = {
    vehicle_count: "quantity",
    container: "equipment",
    factory_pickup: "cargoReadyDate",
    dangerous_goods: "dangerousGoods",
    incoterm: "incoterms",
    commercial_value: "declaredValue",
  };
  const byKey = new Map(base.map((fact) => [fact.key, fact]));
  for (const fact of sourced) {
    const key = canonicalKey[fact.key] ?? fact.key;
    const current = byKey.get(key);
    // Job fields are operator-editable system-of-record values. Source
    // evidence may fill a gap, but must never overwrite a later correction.
    if (current?.state === "recorded") continue;
    byKey.set(key, {
      ...fact,
      key,
      group: current?.group ?? fact.group,
    });
  }
  return [...byKey.values()];
}

function normalizePriority(value: string | null | undefined): LoadWorkspaceAction["priority"] {
  const normalized = text(value).toLowerCase();
  if (normalized === "critical" || normalized === "urgent") return "critical";
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

function taskActions(tasks: LoadWorkspaceTaskInput[]) {
  return tasks
    .filter((task) => !["DONE", "CANCELLED", "COMPLETED"].includes(text(task.status).toUpperCase()))
    .sort((a, b) => {
      const priority = (PRIORITY_ORDER[text(a.priority).toLowerCase()] ?? 2) -
        (PRIORITY_ORDER[text(b.priority).toLowerCase()] ?? 2);
      if (priority !== 0) return priority;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return aDue - bDue;
    })
    .map((task) => ({
      id: task.id,
      title: task.title,
      detail: task.details || undefined,
      priority: normalizePriority(task.priority),
      dueAt: formatDate(task.dueAt) || undefined,
      source: "task" as const,
    }));
}

function derivedMissingActions(facts: LoadFact[]): LoadWorkspaceAction[] {
  return facts
    .filter((fact) => fact.state === "missing")
    .slice(0, 5)
    .map((fact) => ({
      id: `missing-${fact.key}`,
      title: `Confirm ${fact.label.toLowerCase()}`,
      detail: "Needed before a reliable operational or customs commitment.",
      priority: ["declaredValue", "weight", "dangerousGoods"].includes(fact.key)
        ? "high" as const
        : "medium" as const,
      source: "derived" as const,
    }));
}

export function buildLoadWorkspaceModel(input: LoadWorkspaceInput): LoadWorkspaceModel {
  const dossier = parseDossier(input.parsedData);
  const facts = mergeFacts(baseFacts(input), dossier.facts);
  const missingFacts = facts.filter((fact) => fact.state === "missing");
  const conflicts: LoadWorkspaceIssue[] = dossier.conflicts.map((conflict, index) => ({
    id: `conflict-${index}`,
    level: "high",
    title: conflict.title,
    detail: conflict.detail,
    evidence: conflict.evidence,
    kind: "conflict",
  }));
  const sourceMissing: LoadWorkspaceIssue[] = dossier.missing.map((missing, index) => ({
    id: `source-missing-${index}`,
    level: "medium",
    title: missing.title,
    detail: missing.detail,
    evidence: missing.evidence,
    kind: "missing",
  }));
  const marketIssues: LoadWorkspaceIssue[] = input.marketReviews
    .filter((review) => review.status === "pending" || review.status === "acknowledged")
    .map((review) => ({
      id: `market-${review.id}`,
      level: normalizePriority(review.impactLevel),
      title: review.summary,
      detail: review.impactReason,
      evidence: review.sourceTitle || "Market intelligence review",
      kind: "market",
    }));
  const dgDocumentsPending = input.dangerousGoods === "YES" &&
    input.documents.some((document) =>
      document.status === "PENDING" &&
      /MSDS|UN38|dangerous|battery|appraisal|DG/i.test(document.name)
    );
  const complianceIssues: LoadWorkspaceIssue[] = dgDocumentsPending
    ? [{
        id: "dg-document-gate",
        level: "critical",
        title: "Dangerous goods acceptance is not proven",
        detail: "Battery or vehicle transport evidence is still pending. Do not treat the ocean move as carrier-accepted.",
        evidence: "Document control",
        kind: "compliance",
      }]
    : [];
  const missingIssue: LoadWorkspaceIssue[] = missingFacts.length > 0
    ? [{
        id: "missing-operational-facts",
        level: "medium",
        title: `${missingFacts.length} operational fact${missingFacts.length === 1 ? "" : "s"} unresolved`,
        detail: missingFacts.slice(0, 6).map((fact) => fact.label).join(", "),
        kind: "missing",
      }]
    : [];
  const issues = [
    ...complianceIssues,
    ...conflicts,
    ...marketIssues,
    ...sourceMissing,
    ...missingIssue,
  ];

  const explicitActions = taskActions(input.tasks);
  const existingActionTitles = new Set(explicitActions.map((action) => action.title.toLowerCase()));
  const marketActions: LoadWorkspaceAction[] = input.marketReviews
    .filter((review) =>
      (review.status === "pending" || review.status === "acknowledged") &&
      review.recommendedAction &&
      !existingActionTitles.has(review.recommendedAction.toLowerCase())
    )
    .map((review) => ({
      id: `market-action-${review.id}`,
      title: review.recommendedAction as string,
      detail: review.summary,
      priority: normalizePriority(review.impactLevel),
      source: "market" as const,
    }));
  const actions = [...explicitActions, ...marketActions];
  if (actions.length === 0) actions.push(...derivedMissingActions(facts));
  actions.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const approvedDocumentCount = input.documents.filter((document) => document.status === "APPROVED").length;
  const pendingDocumentCount = input.documents.filter((document) => document.status === "PENDING").length;
  const known = facts.filter((fact) => fact.state !== "missing").length;

  return {
    facts,
    issues,
    actions,
    evidence: {
      threadCount: input.threadCount,
      messageCount: input.messageCount,
      documentCount: input.documents.length,
      approvedDocumentCount,
      pendingDocumentCount,
      marketReviewCount: input.marketReviews.length,
    },
    primaryAction: actions[0] ?? null,
    readiness: {
      known,
      total: facts.length,
      missing: facts.length - known,
      label: missingFacts.length === 0 && conflicts.length === 0
        ? "ready_for_review"
        : "needs_inputs",
    },
  };
}
