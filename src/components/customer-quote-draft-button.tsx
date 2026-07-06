"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import {
  applyCustomerQuoteDraftAction,
  draftCustomerQuoteForJob,
} from "@/app/dashboard/jobs/[jobId]/actions";

type DraftResult = Awaited<ReturnType<typeof draftCustomerQuoteForJob>>;
type ReadyDraft = Extract<DraftResult, { ok: true }>;

export function CustomerQuoteDraftButton({
  jobId,
  quoteReady,
}: {
  jobId: string;
  quoteReady?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ReadyDraft | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [applyMsg, setApplyMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [applying, startApplyTransition] = useTransition();

  function openDraft() {
    startTransition(async () => {
      setError(null);
      setApplyMsg(null);
      const result = await draftCustomerQuoteForJob(jobId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDraft(result);
      setText([
        `To: ${result.to ?? "(no customer email)"}`,
        `Subject: ${result.subject ?? "Customer quote"}`,
        "",
        result.body ?? "",
      ].join("\n"));
    });
  }

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  function applyLineItem() {
    startApplyTransition(async () => {
      setError(null);
      setApplyMsg(null);
      const result = await applyCustomerQuoteDraftAction(jobId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setApplyMsg(result.message);
      router.refresh();
    });
  }

  function close() {
    setDraft(null);
    setText("");
    setApplyMsg(null);
    setCopied(false);
  }

  return (
    <>
      <button
        type="button"
        className={`btn btn-secondary record-wide-action customer-quote-draft-trigger${quoteReady ? " is-ready" : ""}`}
        onClick={openDraft}
        disabled={pending}
      >
        <Icon name={quoteReady ? "sparkles" : "alert"} size={13} />
        {pending ? "Drafting..." : quoteReady ? "Draft customer quote" : "Review quote blockers"}
      </button>
      {error && <div className="record-helper-text quote-draft-error">{error}</div>}

      {draft && (
        <div onClick={close} className="product-modal-overlay">
          <div onClick={(e) => e.stopPropagation()} className="product-modal quote-draft-modal">
            <div className="product-modal-header">
              <div>
                <div className="product-modal-kicker">Customer quote</div>
                <div className="product-modal-title">
                  {draft.status === "READY" ? "Reviewed quote draft" : "Quote gate blocked"}
                </div>
                <div className="product-modal-subtitle">
                  {draft.status === "READY" ? `${draft.to ?? "No recipient"} · ${draft.subject ?? "No subject"}` : "The brain is refusing to quote this load yet."}
                </div>
              </div>
              <button type="button" onClick={close} className="product-modal-close" aria-label="Close customer quote draft">
                <Icon name="x" size={15} />
              </button>
            </div>

            {draft.status === "READY" ? (
              <>
                <div className="quote-draft-body">
                  <div className="quote-draft-line-strip">
                    {draft.lineItems.map((line) => (
                      <div key={`${line.description}-${line.amount}-${line.currency}`} className="quote-draft-line">
                        <span>{line.description}</span>
                        <strong>{Math.round(line.amount).toLocaleString()} {line.currency}</strong>
                      </div>
                    ))}
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="draft-modal-textarea quote-draft-textarea"
                  />
                  <div className="quote-draft-guardrails">
                    <span>Buy {draft.internalGuardrails.buyCost == null ? "-" : Math.round(draft.internalGuardrails.buyCost).toLocaleString()}</span>
                    <span>Floor {draft.internalGuardrails.floorPrice == null ? "-" : Math.round(draft.internalGuardrails.floorPrice).toLocaleString()}</span>
                    <span>Sell {draft.internalGuardrails.recommendedPrice == null ? "-" : Math.round(draft.internalGuardrails.recommendedPrice).toLocaleString()}</span>
                    <span>{draft.internalGuardrails.expectedMarginPct == null ? "-" : `${draft.internalGuardrails.expectedMarginPct.toFixed(1)}%`} margin</span>
                  </div>
                </div>
                <div className="draft-modal-footer">
                  <div className="draft-modal-status">
                    {applyMsg ?? draft.safety}
                  </div>
                  <button type="button" onClick={close} className="btn btn-secondary btn-sm modal-action-btn" disabled={applying}>Close</button>
                  <button type="button" onClick={copy} className="btn btn-secondary btn-sm modal-action-btn" disabled={applying}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <button type="button" onClick={applyLineItem} className="btn btn-sm modal-action-btn" disabled={applying}>
                    {applying ? "Applying..." : "Use line item"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="quote-draft-body">
                  <div className="quote-draft-blockers">
                    {(draft.blockers.length ? draft.blockers : ["Customer quote gate is not ready."]).map((blocker) => (
                      <span key={blocker}>{blocker}</span>
                    ))}
                  </div>
                  <div className="quote-draft-guardrail-copy">
                    {draft.internalGuardrails.internalGuardrail}
                  </div>
                </div>
                <div className="draft-modal-footer">
                  <div className="draft-modal-status">{draft.safety}</div>
                  <button type="button" onClick={close} className="btn btn-secondary btn-sm modal-action-btn">Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
