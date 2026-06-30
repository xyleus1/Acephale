"use client";

import { useState, useTransition } from "react";
import { askAboutDocument } from "@/lib/doc-analyze";
import { analyzeJobDocument } from "@/lib/doc-analyze";
import { Icon } from "@/components/icon";

type QA = { q: string; a: string; at: string };

export function DocumentViewer({
  documentId, name, status,
}: { documentId: string; name: string; status: string }) {
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<QA[]>([]);
  const [reanalyzeMsg, setReanalyzeMsg] = useState<string | null>(null);

  function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    start(async () => {
      const r = await askAboutDocument({ documentId, question: q });
      const a = "error" in r ? `Error: ${r.error}` : r.answer;
      setHistory((h) => [...h, { q, a, at: new Date().toISOString() }]);
    });
  }

  function reanalyze() {
    start(async () => {
      setReanalyzeMsg(null);
      const r = await analyzeJobDocument({ documentId, force: true });
      setReanalyzeMsg("error" in r ? `Error: ${r.error}` : "Re-analyzed.");
      setTimeout(() => setReanalyzeMsg(null), 3000);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-secondary btn-sm"
        style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
      >
        <Icon name="external" size={11} /> Open
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100,
          display: "flex", alignItems: "stretch", justifyContent: "center", padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--surface)", borderRadius: 8,
            width: "min(1200px, 96vw)", height: "100%",
            display: "grid", gridTemplateColumns: "1fr 360px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.3)", overflow: "hidden",
          }}>
            {/* PDF iframe */}
            <div style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
              <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>
                    {status.toLowerCase()}
                  </div>
                </div>
                <a
                  href={`/api/jobs/document/${documentId}`}
                  download={name}
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: 11, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <Icon name="download" size={11} /> Download
                </a>
              </div>
              <iframe
                src={`/api/jobs/document/${documentId}#toolbar=1&navpanes=0`}
                title={name}
                style={{ flex: 1, border: "none", background: "var(--surface-2)" }}
              />
            </div>

            {/* Right rail: Q&A + actions */}
            <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-2)" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-2)" }}>
                    Ask the doc
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                    AI answers from the PDF text.
                  </div>
                </div>
                <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-3)" }}>
                  <Icon name="x" size={14} strokeWidth={2.5} />
                </button>
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                {history.length === 0 && !busy && (
                  <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>
                    Ask anything about this document — &quot;What&apos;s the BL number?&quot;, &quot;When does the LC expire?&quot;, &quot;Is the consignee right?&quot;.
                  </div>
                )}
                {history.map((h, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{h.q}</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55, padding: "8px 10px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4 }}>
                      {h.a}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>Reading…</div>
                )}
              </div>

              <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(); } }}
                  placeholder="Ask about this document…"
                  rows={2}
                  style={{
                    fontSize: 12.5, padding: "8px 10px",
                    border: "1px solid var(--border)", borderRadius: 4,
                    fontFamily: "inherit", resize: "vertical", outline: "none",
                    background: "var(--surface-2)",
                  }}
                />
                <div style={{ display: "flex", gap: 6, justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={reanalyze}
                    disabled={busy}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Icon name="sparkles" size={11} /> Re-analyze
                  </button>
                  <button
                    type="button"
                    onClick={ask}
                    disabled={busy || !question.trim()}
                    className="btn btn-sm"
                    style={{ fontSize: 11.5 }}
                  >
                    {busy ? "…" : "Ask"}
                  </button>
                </div>
                {reanalyzeMsg && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{reanalyzeMsg}</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
