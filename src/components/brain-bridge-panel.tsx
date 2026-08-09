import type { BrainBridgeResult, BrainBridgeSection } from "@/lib/brain-bridge";

type Tone = "neutral" | "good" | "warn" | "danger" | "info";

const MODE_META: Record<BrainBridgeResult["mode"], { label: string; tone: Tone }> = {
  live: { label: "Live", tone: "good" },
  mock: { label: "Mock mode", tone: "warn" },
  disabled: { label: "Disabled", tone: "neutral" },
  error: { label: "Unavailable", tone: "danger" },
};

const STATUS_META: Record<BrainBridgeSection["status"], { label: string; tone: Tone }> = {
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

function ToneBadge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function BrainBridgePanel({ result }: { result: BrainBridgeResult }) {
  const mode = MODE_META[result.mode];
  return (
    <section className="card brain-bridge-panel">
      <div className="card-body">
        <div className="brain-bridge-header">
          <h2>Recorded context</h2>
          {result.sections.length > 0 && <span>{result.sections.length}</span>}
        </div>
        <div className="brain-bridge-state">
          <ToneBadge tone={mode.tone}>{mode.label}</ToneBadge>
          <p>{result.note}</p>
        </div>
        {result.sections.length === 0 ? (
          <div className="brain-bridge-empty">
            {result.mode === "error"
              ? "Context retrieval failed - this panel is read-only context; the RFQ data above is unaffected."
              : "No context sections available."}
          </div>
        ) : (
          result.sections.map((section) => {
            const status = STATUS_META[section.status];
            return (
              <div key={section.key} className="brain-bridge-block">
                <h3>{SECTION_TITLES[section.key]}</h3>
                <div className="brain-bridge-state">
                  <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
                  <span>
                    confidence: {section.confidence} · freshness: {section.freshness}
                  </span>
                </div>
                {section.summary && <p>{section.summary}</p>}
                {section.sourceSlugs.length > 0 && (
                  <div className="brain-bridge-sources">
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
        <div className="brain-bridge-block">
          <p>
            <strong>Limit:</strong> Read only. RFQ records override this context. Review web sources before use.
          </p>
        </div>
      </div>
    </section>
  );
}
