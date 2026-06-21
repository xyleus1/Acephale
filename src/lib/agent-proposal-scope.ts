export type AgentProposalFieldScope = "job" | "rfq";

export function filterScopedProposalFields(args: {
  update: Record<string, unknown>;
  inquiryUpdate: Record<string, unknown>;
  acceptedFields?: string[] | null;
}) {
  const accepted = args.acceptedFields ? new Set(args.acceptedFields) : null;
  const acceptsField = (scope: AgentProposalFieldScope, key: string) => {
    if (!accepted) return true;
    return accepted.has(`${scope}:${key}`) || accepted.has(key);
  };

  return {
    update: accepted
      ? Object.fromEntries(Object.entries(args.update).filter(([key]) => acceptsField("job", key)))
      : { ...args.update },
    inquiryUpdate: accepted
      ? Object.fromEntries(Object.entries(args.inquiryUpdate).filter(([key]) => acceptsField("rfq", key)))
      : { ...args.inquiryUpdate },
  };
}
