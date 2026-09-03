"use client";

import { useCallback, useEffect, useState } from "react";
import type { OutreachProposalReview } from "@/lib/outreach-proposal-review";
import {
  applyOutreachProposalAction,
  discardOutreachProposalAction,
  listPendingOutreachProposalsAction,
} from "./outreach-approval-actions";
import styles from "./supply-os-outreach.module.css";

type ProposalCardProps = {
  proposal: OutreachProposalReview;
  busy: boolean;
  canApprove: boolean;
  onApply: (proposalId: string, reviewedItemIds: string[]) => Promise<void>;
  onDiscard: (proposalId: string) => Promise<void>;
};

function ProposalCard({ proposal, busy, canApprove, onApply, onDiscard }: ProposalCardProps) {
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const total = proposal.reviewItems.length;
  const blocked = proposal.blocker !== null;
  const allRead = !blocked && total > 0 && proposal.reviewItems.every((item) => readIds.has(item.id));
  const footerNote = blocked
    ? proposal.blocker
    : !canApprove
      ? "Starting or discarding this campaign needs an admin or manager account."
      : allRead
        ? "Starting the campaign activates sending on the next batch. Human decision required."
        : `Mark all ${total} spot-check emails as read to start the campaign.`;

  function toggle(itemId: string) {
    setReadIds((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  return (
    <article className={styles.approval} data-outreach-proposal={proposal.id}>
      <header className={styles.approvalHeader}>
        <strong>{proposal.actionLabel}</strong>
        <span>{total} spot-check email{total === 1 ? "" : "s"}</span>
      </header>
      {proposal.actionDetails.length > 0 ? (
        <ul className={styles.approvalDetails}>
          {proposal.actionDetails.map((detail) => <li key={detail}>{detail}</li>)}
        </ul>
      ) : null}
      <ol className={styles.approvalItems}>
        {proposal.reviewItems.map((item) => (
          <li key={item.id} className={styles.approvalItem}>
            <div className={styles.approvalItemHead}>
              <div>
                <strong>{item.title}</strong>
                {item.meta ? <span>{item.meta}</span> : null}
              </div>
              {blocked ? null : (
                <label>
                  <input
                    type="checkbox"
                    checked={readIds.has(item.id)}
                    onChange={() => toggle(item.id)}
                    disabled={busy || !canApprove}
                  />
                  Read
                </label>
              )}
            </div>
            {item.subject ? <div className={styles.approvalSubject}>Subject: {item.subject}</div> : null}
            <pre className={styles.approvalBody}>{item.body}</pre>
          </li>
        ))}
      </ol>
      <footer className={styles.approvalActions}>
        <span>{footerNote}</span>
        <div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy || !canApprove}
            onClick={() => void onDiscard(proposal.id)}
          >
            Discard
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !canApprove || !allRead}
            onClick={() => void onApply(proposal.id, proposal.reviewItems.map((item) => item.id))}
          >
            Start campaign
          </button>
        </div>
      </footer>
    </article>
  );
}

export function SupplyOsOutreachApprovals({ refreshKey }: { refreshKey: number }) {
  const [proposals, setProposals] = useState<OutreachProposalReview[]>([]);
  const [canView, setCanView] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await listPendingOutreachProposalsAction();
      setCanView(result.canView);
      setCanApprove(result.canApprove);
      setProposals(result.proposals);
      setLoadError(null);
    } catch {
      setLoadError("Pending approvals could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    try {
      const result = await action();
      setNotice(result.message);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The approval request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!loadError && (!canView || (proposals.length === 0 && !notice))) return null;
  const message = loadError ?? notice;

  return (
    <section className={styles.approvals} aria-label="Pending approvals" data-outreach-approvals>
      <div className={styles.approvalsHeader}>
        <h3>Pending approvals</h3>
        <span>{proposals.length}</span>
      </div>
      {message ? <p className={styles.approvalsNotice} role="status">{message}</p> : null}
      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          busy={busy}
          canApprove={canApprove}
          onApply={(proposalId, reviewedItemIds) => run(() => applyOutreachProposalAction(proposalId, reviewedItemIds))}
          onDiscard={(proposalId) => run(() => discardOutreachProposalAction(proposalId))}
        />
      ))}
    </section>
  );
}
