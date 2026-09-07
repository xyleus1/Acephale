export type OfficeSelectionCandidate = {
  id: string;
  name: string;
};

export function resolveOfficeSelection(
  candidates: readonly OfficeSelectionCandidate[],
  input: string,
) {
  const exactId = candidates.find((candidate) => candidate.id === input);
  if (exactId) return exactId;
  const matches = candidates.filter((candidate) => candidate.name === input);
  if (matches.length === 0) {
    throw new Error(`Office "${input}" was not found`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Office name "${input}" is ambiguous; matching IDs: ${matches.map((candidate) => candidate.id).join(", ")}`,
    );
  }
  return matches[0];
}
