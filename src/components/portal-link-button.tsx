"use client";

import { useState, useTransition } from "react";
import { ensurePortalToken, rotatePortalToken, setNotifyCustomer } from "@/lib/portal";
import { Icon } from "@/components/icon";

export function PortalLinkButton({ jobId, hasToken, notifyCustomer }: { jobId: string; hasToken: boolean; notifyCustomer: boolean }) {
  const [busy, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notify, setNotify] = useState(notifyCustomer);

  function show() {
    setOpen(true);
    if (!link) {
      start(async () => {
        const r = await ensurePortalToken(jobId);
        if ("ok" in r) setLink(r.url);
      });
    }
  }
  function rotate() {
    if (!confirm("Rotate the portal link? The old URL will stop working immediately.")) return;
    start(async () => {
      const r = await rotatePortalToken(jobId);
      if ("ok" in r) setLink(r.url);
    });
  }
  function copy() {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  function toggleNotify() {
    const next = !notify;
    setNotify(next);
    start(async () => { await setNotifyCustomer(jobId, next); });
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        className="btn btn-secondary btn-sm portal-link-trigger"
        title="Get a public read-only link to share with the customer"
      >
        <Icon name="external" size={11} />
        Customer portal
      </button>
      {open && (
        <div onClick={() => setOpen(false)} className="product-modal-overlay">
          <div onClick={(e) => e.stopPropagation()} className="product-modal portal-link-modal">
            <div className="product-modal-header">
              <div>
                <div className="product-modal-kicker">External visibility</div>
                <div className="product-modal-title">Customer portal</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="product-modal-close" aria-label="Close customer portal modal">
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="product-modal-body">
              <p className="portal-link-copy">
                A read-only public page showing the customer-facing pipeline and high-level workflow steps. Anyone with the link can view; rotate it any time to revoke.
              </p>
              {link ? (
                <div className="portal-link-row">
                  <input
                    readOnly
                    value={link}
                    onFocus={(e) => e.currentTarget.select()}
                    className="portal-link-input"
                  />
                  <button onClick={copy} className="btn btn-sm modal-action-btn">
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <a href={link} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm modal-action-btn portal-open-link">
                    Open <Icon name="external" size={11} />
                  </a>
                </div>
              ) : (
                <div className="portal-link-loading">{busy ? "Generating link..." : "Loading..."}</div>
              )}

              <label className="portal-notify-row">
                <input type="checkbox" checked={notify} onChange={toggleNotify} disabled={busy} />
                Auto-email customer on key status changes (Booked / En route / Delivered) and confirmed delivery updates.
              </label>
              <div className="product-modal-footer">
                <button onClick={rotate} className="btn btn-secondary btn-sm modal-action-btn" disabled={busy || !hasToken}>
                  Rotate link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
