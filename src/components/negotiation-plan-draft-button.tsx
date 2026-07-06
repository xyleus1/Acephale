"use client";

import { useState, useTransition } from "react";
import { draftNegotiationPlanForJob } from "@/app/dashboard/jobs/[jobId]/actions";
import { Icon } from "@/components/icon";

type DraftResult = Awaited<ReturnType<typeof draftNegotiationPlanForJob>>;
type ReadyDraft = Extract<DraftResult, { ok: true }>;

function money(value: number | null | undefined, currency: string) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${currency} ${Math.round(value).toLocaleString()}`;
}

export function NegotiationPlanDraftButton({
  jobId,
  disabled = false,
}: {
  jobId: string;
  disabled?: boolean;
}) {
  const [result, setResult] = useState<ReadyDraft | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function openDraft() {
    startTransition(async () => {
      setError(null);
      setCopied(false);
      const next = await draftNegotiationPlanForJob(jobId);
      if (!next.ok) {
        setError(next.error);
        return;
      }
      setResult(next);
      setText(next.draft.body);
    });
  }

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  function close() {
    setResult(null);
    setText("");
    setCopied(false);
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary record-wide-action negotiation-plan-trigger"
        onClick={openDraft}
        disabled={disabled || pending}
      >
        <Icon name="sparkles" size={13} />
        {pending ? "Drafting..." : "Draft negotiation plan"}
      </button>
      {error && <div className="record-helper-text quote-draft-error">{error}</div>}

      {result && (
        <div onClick={close} className="product-modal-overlay">
          <div onClick={(e) => e.stopPropagation()} className="product-modal negotiation-plan-modal">
            <div className="product-modal-header">
              <div>
                <div className="product-modal-kicker">Negotiation plan</div>
                <div className="product-modal-title">{result.draft.title}</div>
                <div className="product-modal-subtitle">{result.safety}</div>
              </div>
              <button type="button" onClick={close} className="product-modal-close" aria-label="Close negotiation plan draft">
                <Icon name="x" size={15} />
              </button>
            </div>

            <div className="negotiation-plan-body">
              <div className="negotiation-plan-summary">
                <div>
                  <span>Customer</span>
                  <strong>{result.draft.customerTalkTrack}</strong>
                </div>
                <div>
                  <span>Forwarder</span>
                  <strong>{result.draft.forwarderCounter}</strong>
                </div>
                <div>
                  <span>Guardrail</span>
                  <strong>{result.draft.internalGuardrail}</strong>
                </div>
              </div>

              <div className="negotiation-plan-guardrails">
                <span>Buy {money(result.draft.guardrails.buyCost, result.draft.guardrails.currency)}</span>
                <span>Floor {money(result.draft.guardrails.floorPrice, result.draft.guardrails.currency)}</span>
                <span>Sell {money(result.draft.guardrails.recommendedPrice, result.draft.guardrails.currency)}</span>
                <span>Target buy {money(result.draft.guardrails.targetBuyLimit, result.draft.guardrails.currency)}</span>
                {result.draft.guardrails.approvalRequired && <span>Approval required</span>}
              </div>

              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="draft-modal-textarea negotiation-plan-textarea"
              />

              <div className="negotiation-plan-reasons">
                {result.draft.decisionReasons.slice(0, 4).map((reason) => (
                  <span key={`${reason.key}-${reason.summary}`}>{reason.label}: {reason.summary}</span>
                ))}
              </div>
            </div>

            <div className="draft-modal-footer">
              <div className="draft-modal-status">{result.safety}</div>
              <button type="button" onClick={close} className="btn btn-secondary btn-sm modal-action-btn">Close</button>
              <button type="button" onClick={copy} className="btn btn-sm modal-action-btn">
                {copied ? "Copied" : "Copy plan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
