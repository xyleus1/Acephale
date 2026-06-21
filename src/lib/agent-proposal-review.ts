export type ReviewedFieldScope = "job" | "rfq";

export type ReviewedFieldChange = {
  scope: ReviewedFieldScope;
  field: string;
  label: string;
  before: unknown;
  after: unknown;
};

function humanizeField(field: string) {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

export function proposalFieldLabel(field: string, fieldLabels?: Record<string, string>) {
  const label = fieldLabels?.[field]?.trim();
  return label || humanizeField(field);
}

export function reviewedFieldTokenLabel(token: string, fieldLabels?: Record<string, string>) {
  const [maybeScope, maybeField] = token.split(":");
  const scope = maybeField ? maybeScope : "";
  const field = maybeField || maybeScope;
  const label = proposalFieldLabel(field, fieldLabels);
  if (scope === "rfq") return `RFQ ${label}`;
  if (scope === "job") return `Job ${label}`;
  return label;
}

export function buildReviewedFieldChanges(args: {
  jobBefore: Record<string, unknown>;
  inquiryBefore?: Record<string, unknown> | null;
  update: Record<string, unknown>;
  inquiryUpdate: Record<string, unknown>;
  fieldLabels?: Record<string, string>;
}): ReviewedFieldChange[] {
  const jobRows = Object.entries(args.update).map(([field, after]) => ({
    scope: "job" as const,
    field,
    label: proposalFieldLabel(field, args.fieldLabels),
    before: args.jobBefore[field],
    after,
  }));
  const inquiryRows = Object.entries(args.inquiryUpdate).map(([field, after]) => ({
    scope: "rfq" as const,
    field,
    label: proposalFieldLabel(field, args.fieldLabels),
    before: args.inquiryBefore?.[field],
    after,
  }));
  return [...jobRows, ...inquiryRows];
}
