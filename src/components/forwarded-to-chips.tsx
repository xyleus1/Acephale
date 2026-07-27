"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { FORWARDER_PARTNERS } from "@/lib/forwarder-partners";
import { toggleForwardedToAction } from "@/app/dashboard/rfq/actions";

// Which partner forwarders this RFQ was handed to - toggle chips for the
// fixed partner list (KINAY / ORIGIN / ANDELOG / CTT).
export function ForwardedToChips({ inquiryId, initial }: {
  inquiryId: string;
  initial: string[];
}) {
  const router = useRouter();
  const [active, setActive] = useState<string[]>(initial);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(partner: string) {
    if (busy) return;
    const prev = active;
    // Optimistic flip; revert on failure.
    setActive(prev.includes(partner) ? prev.filter((p) => p !== partner) : [...prev, partner]);
    startTransition(async () => {
      setError(null);
      try {
        const res = await toggleForwardedToAction(inquiryId, partner);
        if ("error" in res) {
          setError(res.error);
          setActive(prev);
          return;
        }
        setActive(res.forwardedTo);
        router.refresh();
      } catch {
        setError("Could not save - try again.");
        setActive(prev);
      }
    });
  }

  // Partners no longer on the fixed list but stored on this RFQ stay visible.
  const extras = active.filter((p) => !(FORWARDER_PARTNERS as readonly string[]).includes(p));

  return (
    <div className="record-panel">
      <div className="record-card-header">
        <div className="record-card-title">
          <Icon name="mail-out" size={13} /> Forwarded to partners
        </div>
        {active.length > 0 && <span className="fwd-count">{active.length}</span>}
      </div>
      <div className="card-body">
        <div className="fwd-chip-row">
          {[...FORWARDER_PARTNERS, ...extras].map((partner) => {
            const on = active.includes(partner);
            return (
              <button
                key={partner}
                type="button"
                className={`fwd-chip${on ? " fwd-chip--on" : ""}`}
                disabled={busy}
                title={on ? `Sent to ${partner} - click to unmark` : `Mark as forwarded to ${partner}`}
                onClick={() => toggle(partner)}
              >
                {on && <Icon name="check" size={11} strokeWidth={2.5} />}
                {partner}
              </button>
            );
          })}
        </div>
        <div className="record-helper-text" style={{ marginTop: 8 }}>
          Tracking only - actual sending still happens from your mail client / the desk forward.
        </div>
        {error && <div className="rfq-mail-error">{error}</div>}
      </div>
    </div>
  );
}
