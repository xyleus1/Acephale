export type WorkstreamDraftState = {
  caseId: string;
  sections: string[];
} | null;

export function markWorkstreamDraft(
  state: WorkstreamDraftState,
  caseId: string,
  section: string,
): WorkstreamDraftState {
  if (!state || state.caseId !== caseId) return { caseId, sections: [section] };
  return state.sections.includes(section)
    ? state
    : { caseId, sections: [...state.sections, section] };
}

export function resolveWorkstreamDraft(
  state: WorkstreamDraftState,
  caseId: string,
  section: string | undefined,
): WorkstreamDraftState {
  if (!state || state.caseId !== caseId || !section) return state;
  const sections = state.sections.filter((candidate) => candidate !== section);
  return sections.length ? { caseId, sections } : null;
}

export function hasDirtyWorkstream(state: WorkstreamDraftState, caseId: string | undefined) {
  return Boolean(caseId && state?.caseId === caseId && state.sections.length);
}
