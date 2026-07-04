import { CrmBadge } from "@/components/crm/crm-components";
import type { CrmTone } from "@/lib/crm/types";
import type { BrainBridgeResult, BrainBridgeSection } from "@/lib/brain-bridge";

const MODE_META: Record<BrainBridgeResult["mode"], { label: string; tone: CrmTone }> = {
  live: { label: "Live GBrain", tone: "good" },
  mock: { label: "Mock mode", tone: "warn" },
  disabled: { label: "Disabled", tone: "neutral" },
  error: { label: "Unavailable", tone: "danger" },
};

const STATUS_META: Record<BrainBridgeSection["status"], { label: string; tone: CrmTone }> = {
  ready: { label: "Ready", tone: "good" },
  proposed_only: { label: "Proposed only", tone: "info" },
  no_context_found: { label: "No context found", tone: "neutral" },
  timeout: { label: "Timed out", tone: "danger" },
  unavailable: { label: "Unavailable", tone: "danger" },
};

const SECTION_TITLES: Record<BrainBridgeSection["key"], string> = {
  customer: "Customer",
  lane: "Lane",
  provider: "Rate providers",
  sop: "SOP",
  web_intel: "Web intelligence",
};

export function BrainBridgePanel({ result }: { result: BrainBridgeResult }) {
  const mode = MODE_META[result.mode];
  return (
    <section className="crm-panel crm-brain-panel">
      <div className="crm-panel-header">
        <div>
          <h2>Live Brain Context</h2>
          {result.sections.length > 0 && <span>{result.sections.length}</span>}
        </div>
      </div>
      <div className="crm-brain-state">
        <CrmBadge tone={mode.tone}>{mode.label}</CrmBadge>
        <p>{result.note}</p>
      </div>
      {result.sections.length === 0 ? (
        <div className="crm-empty">
          {result.mode === "error"
            ? "Context retrieval failed — this panel is read-only context; the RFQ data above is unaffected."
            : "No brain context sections to show."}
        </div>
      ) : (
        result.sections.map((section) => {
          const status = STATUS_META[section.status];
          return (
            <div key={section.key} className="crm-brain-block">
              <h3>{SECTION_TITLES[section.key]}</h3>
              <div className="crm-brain-state">
                <CrmBadge tone={status.tone}>{status.label}</CrmBadge>
                <span>
                  confidence: {section.confidence} · freshness: {section.freshness}
                </span>
              </div>
              {section.summary && <p>{section.summary}</p>}
              {section.sourceSlugs.length > 0 && (
                <div className="crm-source-row">
                  <span>Sources</span>
                  <strong>{section.sourceSlugs.map((slug) => <code key={slug}> {slug} </code>)}</strong>
                </div>
              )}
              {section.missingEvidence.length > 0 && (
                <ul>
                  {section.missingEvidence.map((item) => (
                    <li key={item}>Missing: {item}</li>
                  ))}
                </ul>
              )}
              {section.suggestedNextAction && (
                <p>
                  <strong>Next:</strong> {section.suggestedNextAction}
                </p>
              )}
            </div>
          );
        })
      )}
      <div className="crm-brain-block">
        <p>
          <strong>Gate:</strong> Read-only memory context. Product truth wins on any conflict. Web-intel sections are
          proposed context, not operational fact. No customer-facing action from this panel.
        </p>
      </div>
    </section>
  );
}
