"use client";

import type { AgentToolTrace } from "@/lib/agent-chat";
import { prettyToolName } from "@/lib/agent-page-cues";
import { dispatchAgentPageCues } from "@/lib/agent-page-presence";

function cueTargets(tool: AgentToolTrace) {
  const seen = new Set<string>();
  return (tool.pageCues ?? [])
    .map((cue) => cue.target)
    .filter((target) => {
      if (!target || seen.has(target)) return false;
      seen.add(target);
      return true;
    });
}

function cueTrail(trace: AgentToolTrace[]) {
  const seen = new Set<string>();
  return trace.flatMap((tool) => (tool.pageCues ?? []).map((cue) => ({ tool, cue })))
    .filter(({ cue }) => cue.target && cue.label && cue.detail)
    .filter(({ cue }) => {
      const key = `${cue.target}:${cue.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5);
}

export function AgentToolTraceList({
  trace,
  variant = "panel",
}: {
  trace?: AgentToolTrace[];
  variant?: "panel" | "conversation";
}) {
  if (!trace?.length) return null;
  const visible = trace.slice(0, 4);
  const failures = trace.filter((tool) => !tool.ok).length;
  const trail = cueTrail(trace);

  function showToolTargets(tool: AgentToolTrace) {
    const cues = tool.pageCues?.filter((cue) => cue.target && cue.label && cue.detail) ?? [];
    dispatchAgentPageCues(cues);
  }

  function replayTrail() {
    dispatchAgentPageCues(trail.map(({ cue }) => cue));
  }

  return (
    <div className={`agent-evidence-trace ${variant}`} aria-label="Agent tool evidence">
      <div className="agent-evidence-head">
        <span className="agent-evidence-label">
          Used {trace.length} tool{trace.length === 1 ? "" : "s"}
          {failures > 0 ? ` · ${failures} failed` : ""}
        </span>
        {trail.length > 0 && (
          <button
            type="button"
            className="agent-evidence-replay"
            onClick={replayTrail}
            aria-label="Replay where the agent looked on this page"
            title="Replay where the agent looked"
          >
            Replay trail
          </button>
        )}
      </div>
      {trail.length > 0 && (
        <ol className="agent-evidence-trail" aria-label="Agent page evidence trail">
          {trail.map(({ cue, tool }, index) => (
            <li key={`${tool.name}-${cue.target}-${cue.label}`}>
              <button
                type="button"
                onClick={() => dispatchAgentPageCues([cue])}
                title={cue.detail}
              >
                <span>{index + 1}</span>
                <strong>{cue.label}</strong>
                <em>{cue.target.replace(/-/g, " ")}</em>
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="agent-evidence-chip-row">
        {visible.map((tool, index) => {
          const targets = cueTargets(tool);
          const title = tool.error ?? (targets.length ? targets.join(", ") : prettyToolName(tool.name));
          const isActionable = targets.length > 0;
          return (
            <button
              type="button"
              key={`${tool.name}-${index}`}
              className={`agent-evidence-chip ${tool.ok ? "ok" : "error"}${isActionable ? " is-actionable" : ""}`}
              title={title}
              aria-label={isActionable
                ? `Show where ${prettyToolName(tool.name)} looked`
                : `${prettyToolName(tool.name)} evidence`}
              disabled={!isActionable}
              onClick={() => showToolTargets(tool)}
            >
              <strong>{tool.ok ? "OK" : "!"}</strong>
              {prettyToolName(tool.name)}
              {targets.length > 0 && (
                <em>
                  {targets.slice(0, 2).join(" / ")}
                  {targets.length > 2 ? ` +${targets.length - 2}` : ""}
                </em>
              )}
            </button>
          );
        })}
        {trace.length > visible.length && (
          <span className="agent-evidence-chip more">+{trace.length - visible.length}</span>
        )}
      </div>
    </div>
  );
}
