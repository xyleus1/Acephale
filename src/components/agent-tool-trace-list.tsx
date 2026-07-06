"use client";

import type { AgentToolTrace } from "@/lib/agent-chat";

function prettyToolName(name: string) {
  return name
    .split("_")
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : part)
    .join(" ");
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

  return (
    <div className={`agent-evidence-trace ${variant}`} aria-label="Agent tool evidence">
      <div className="agent-evidence-head">
        <span className="agent-evidence-label">
          Checked {trace.length} source{trace.length === 1 ? "" : "s"}
          {failures > 0 ? ` · ${failures} failed` : ""}
        </span>
      </div>
      <div className="agent-evidence-chip-row">
        {visible.map((tool, index) => (
          <span
            key={`${tool.name}-${index}`}
            className={`agent-evidence-chip ${tool.ok ? "ok" : "error"}`}
            title={tool.error ?? prettyToolName(tool.name)}
          >
            <strong>{tool.ok ? "OK" : "!"}</strong>
            {prettyToolName(tool.name)}
          </span>
        ))}
        {trace.length > visible.length && (
          <span className="agent-evidence-chip more">+{trace.length - visible.length}</span>
        )}
      </div>
    </div>
  );
}
