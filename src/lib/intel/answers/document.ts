import type { IntelSourceUse } from "../sources";

export type AnswerIntent =
  | "ocean_hardware_research"
  | "shipment_preflight"
  | "customs_commodity"
  | "carrier"
  | "lane_market"
  | "unknown";

export type AnswerStatus = "complete" | "partial" | "blocked";
export type AnswerConfidence = "high" | "medium" | "low" | "not_assessed";
export type AnswerFactValue = string | number | boolean | null;

export type AnswerFact = {
  id: string;
  label: string;
  value: AnswerFactValue;
  displayValue: string;
  unit: string | null;
  period: string | null;
  detail: string | null;
  confidence: AnswerConfidence;
  sources: IntelSourceUse[];
};

export type AnswerFindingKind = "insight" | "opportunity" | "risk" | "next_step";
export type AnswerFindingSeverity = "info" | "watch" | "important";

export type AnswerFinding = {
  id: string;
  kind: AnswerFindingKind;
  severity: AnswerFindingSeverity;
  title: string;
  detail: string;
  action: string | null;
  sources: IntelSourceUse[];
};

export type AnswerLimitation = {
  id: string;
  title: string;
  detail: string;
  impact: string;
  sources: IntelSourceUse[];
};

export type AnswerSectionKind =
  | "summary"
  | "metrics"
  | "trend"
  | "table"
  | "analysis"
  | "limitations"
  | "sources";

export type AnswerSection = {
  id: string;
  title: string;
  description: string | null;
  kind: AnswerSectionKind;
  factIds: string[];
  findingIds: string[];
  limitationIds: string[];
};

export type AnswerScope = {
  geographicBasis: string;
  geographyLabel: string;
  fromMonth: string | null;
  throughMonth: string | null;
  transportModes: string[];
  commodityBasket: string | null;
  notes: string[];
};

export type AnswerDocument = {
  version: 1;
  question: string;
  intent: AnswerIntent;
  status: AnswerStatus;
  title: string;
  scope: AnswerScope;
  summary: string;
  facts: AnswerFact[];
  findings: AnswerFinding[];
  sections: AnswerSection[];
  limitations: AnswerLimitation[];
  sources: IntelSourceUse[];
  generatedAt: string;
};

export type ComposeAnswerDocumentInput = Omit<AnswerDocument, "version" | "sources"> & {
  sources?: readonly IntelSourceUse[];
};

export function answerSourceKey(source: IntelSourceUse): string {
  return `${source.sourceId}|${source.sourceUrl}`;
}

export function dedupeAnswerSources(sources: readonly IntelSourceUse[]): IntelSourceUse[] {
  const seen = new Set<string>();
  const result: IntelSourceUse[] = [];
  for (const source of sources) {
    const key = answerSourceKey(source);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...source });
  }
  return result;
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} cannot be empty`);
}

function assertUniqueIds(items: readonly { id: string }[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    assertNonEmpty(item.id, `${label} id`);
    if (ids.has(item.id)) throw new Error(`Duplicate ${label} id: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

export function composeAnswerDocument(input: ComposeAnswerDocumentInput): AnswerDocument {
  assertNonEmpty(input.question, "Answer question");
  assertNonEmpty(input.title, "Answer title");
  assertNonEmpty(input.summary, "Answer summary");

  const generatedAt = new Date(input.generatedAt);
  if (Number.isNaN(generatedAt.getTime())) throw new Error("Answer generatedAt must be an ISO date-time string");

  const factIds = assertUniqueIds(input.facts, "fact");
  const findingIds = assertUniqueIds(input.findings, "finding");
  const limitationIds = assertUniqueIds(input.limitations, "limitation");
  assertUniqueIds(input.sections, "section");

  for (const section of input.sections) {
    for (const id of section.factIds) {
      if (!factIds.has(id)) throw new Error(`Section ${section.id} references unknown fact: ${id}`);
    }
    for (const id of section.findingIds) {
      if (!findingIds.has(id)) throw new Error(`Section ${section.id} references unknown finding: ${id}`);
    }
    for (const id of section.limitationIds) {
      if (!limitationIds.has(id)) throw new Error(`Section ${section.id} references unknown limitation: ${id}`);
    }
  }

  const facts = input.facts.map((fact) => ({ ...fact, sources: dedupeAnswerSources(fact.sources) }));
  const findings = input.findings.map((finding) => ({
    ...finding,
    sources: dedupeAnswerSources(finding.sources),
  }));
  const limitations = input.limitations.map((limitation) => ({
    ...limitation,
    sources: dedupeAnswerSources(limitation.sources),
  }));
  const sources = dedupeAnswerSources([
    ...(input.sources ?? []),
    ...facts.flatMap((fact) => fact.sources),
    ...findings.flatMap((finding) => finding.sources),
    ...limitations.flatMap((limitation) => limitation.sources),
  ]);

  return {
    version: 1,
    question: input.question.trim(),
    intent: input.intent,
    status: input.status,
    title: input.title.trim(),
    scope: {
      ...input.scope,
      transportModes: [...input.scope.transportModes],
      notes: [...input.scope.notes],
    },
    summary: input.summary.trim(),
    facts,
    findings,
    sections: input.sections.map((section) => ({
      ...section,
      factIds: [...section.factIds],
      findingIds: [...section.findingIds],
      limitationIds: [...section.limitationIds],
    })),
    limitations,
    sources,
    generatedAt: input.generatedAt,
  };
}
