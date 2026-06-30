export type AgentPageCueDetail = {
  target: string;
  label: string;
  detail: string;
  durationMs?: number;
};

export const AGENT_PAGE_CUE_EVENT = "derya:agent-page-cues";

export function dispatchAgentPageCues(cues: AgentPageCueDetail[]) {
  if (typeof window === "undefined" || cues.length === 0) return;
  if (typeof window.CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent(AGENT_PAGE_CUE_EVENT, { detail: { cues } }));
    return;
  }

  const event = document.createEvent("CustomEvent");
  event.initCustomEvent(AGENT_PAGE_CUE_EVENT, false, false, { cues });
  window.dispatchEvent(event);
}
