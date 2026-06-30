"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { draftCounterOffer, logOutboundEmail } from "@/lib/job-email";
import { Icon } from "@/components/icon";

export function CounterOfferButton({
  jobId,
  carrierQuoteId,
  carrierName,
}: {
  jobId: string;
  carrierQuoteId: string;
  carrierName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sending, startSending] = useTransition();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reduction, setReduction] = useState(5);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function draft() {
    setDrafting(true);
    setError(null);
    try {
      const res = await draftCounterOffer(jobId, carrierQuoteId, reduction);
      if ("error" in res) {
        setError(res.error);
      } else {
        setSubject(res.subject);
        setBody(res.body);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setDrafting(false);
    }
  }

  function send() {
    if (!subject.trim() || !body.trim()) return;
    const fd = new FormData();
    fd.set("subject", subject);
    fd.set("body", body);
    fd.set("toEmail", toEmail);
    fd.set("toLabel", carrierName);
    startSending(async () => {
      const res = await logOutboundEmail(jobId, fd);
      if ("error" in res) {
        setError(res.error);
      } else {
        setOpen(false);
        setSubject("");
        setBody("");
        router.refresh();
      }
    });
  }

  return (
    <div ref={ref} className="counter-offer-wrap">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open && !subject) draft(); }}
        className="btn btn-secondary btn-sm counter-offer-trigger"
        title={`Draft a counter-offer email to ${carrierName}`}
      >
        Counter
      </button>

      {open && (
        <div className="counter-pop">
          <div className="counter-pop-header">
            <div>
              <div className="counter-pop-kicker">
                Counter-offer to
              </div>
              <div className="counter-pop-title">{carrierName}</div>
            </div>
            <div className="counter-pop-controls">
              <span>Target reduction</span>
              <select
                value={reduction}
                onChange={(e) => setReduction(Number(e.target.value))}
                className="counter-pop-select"
              >
                <option value={3}>3%</option>
                <option value={5}>5%</option>
                <option value={8}>8%</option>
                <option value={10}>10%</option>
              </select>
              <button
                type="button"
                onClick={draft}
                disabled={drafting}
                className="btn btn-secondary btn-sm counter-redraft"
              >
                <Icon name="sparkles" size={11} /> {drafting ? "..." : "Re-draft"}
              </button>
            </div>
          </div>

          {error && (
            <div className="counter-pop-error">{error}</div>
          )}

          <div className="counter-address-row">
            <span>To</span>
            <input
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
              placeholder={`${carrierName.toLowerCase().replace(/\s/g, "")}@example.com`}
              className="counter-address-input"
            />
          </div>

          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={drafting ? "Drafting..." : "Subject..."}
            className="counter-subject-input"
          />

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={drafting ? "Drafting..." : "Body..."}
            rows={9}
            className="counter-body-textarea"
          />

          <div className="counter-pop-footer">
            <button onClick={() => setOpen(false)} className="btn btn-secondary btn-sm counter-footer-btn">Cancel</button>
            <button
              onClick={() => send()}
              disabled={sending || !subject.trim() || !body.trim()}
              className="btn btn-sm counter-footer-btn"
            >{sending ? "Logging..." : "Send & log"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
