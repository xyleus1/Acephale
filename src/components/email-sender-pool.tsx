"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  resumeSenderPoolAccount,
  updateEmailSenderPoolAccounts,
} from "@/app/dashboard/settings/email/actions";
import { MAX_EMAIL_DAILY_SEND_LIMIT } from "@/lib/email-sender-pool-policy";
import styles from "@/app/dashboard/settings/connected-emails/connected-emails.module.css";

export type EmailSenderPoolRow = {
  id: string;
  displayName: string;
  email: string;
  provider: string;
  sendEnabled: boolean;
  sendPausedAt: string | null;
  sendPausedReason: string | null;
  dailySendLimit: number;
  sentToday: number;
};

export function EmailSenderPool({ accounts }: { accounts: EmailSenderPoolRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(accounts);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dailyLimit, setDailyLimit] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const selected = useMemo(() => [...selectedIds], [selectedIds]);

  useEffect(() => {
    setRows(accounts);
    setSelectedIds((current) => new Set([...current].filter((id) => accounts.some((account) => account.id === id))));
  }, [accounts]);

  function toggleSelection(accountId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function updateSelected(change: { sendEnabled?: boolean; dailySendLimit?: number }) {
    if (selected.length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateEmailSenderPoolAccounts({ accountIds: selected, ...change });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setRows((current) => current.map((row) => selectedIds.has(row.id) ? { ...row, ...change } : row));
        router.refresh();
      } catch {
        setError("The sender-pool update failed. Try again.");
      }
    });
  }

  function toggleAccount(accountId: string, sendEnabled: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateEmailSenderPoolAccounts({ accountIds: [accountId], sendEnabled });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setRows((current) => current.map((row) => row.id === accountId ? { ...row, sendEnabled } : row));
        router.refresh();
      } catch {
        setError("The sender-pool update failed. Try again.");
      }
    });
  }

  function resumeAccount(accountId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await resumeSenderPoolAccount({ accountId });
        if (!result.resumed) {
          setError("The sender account was already resumed.");
          return;
        }
        setRows((current) => current.map((row) => row.id === accountId
          ? { ...row, sendPausedAt: null, sendPausedReason: null }
          : row));
        router.refresh();
      } catch {
        setError("The sender account could not be resumed. Try again.");
      }
    });
  }

  return (
    <div>
      <div className={styles.poolToolbar}>
        <label className={styles.selectAll}>
          <input type="checkbox" checked={allSelected} onChange={selectAll} aria-label="Select all connected email accounts" />
          <span>{selected.length > 0 ? `${selected.length} selected` : "Select all"}</span>
        </label>
        <div className={styles.bulkPoolActions} aria-label="Bulk sender-pool controls">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || selected.length === 0} onClick={() => updateSelected({ sendEnabled: true })}>Turn on</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || selected.length === 0} onClick={() => updateSelected({ sendEnabled: false })}>Turn off</button>
          <label className={styles.limitControl}>
            <span>Daily limit</span>
            <input
              type="number"
              min={1}
              max={MAX_EMAIL_DAILY_SEND_LIMIT}
              value={dailyLimit}
              onChange={(event) => setDailyLimit(Number(event.target.value))}
              aria-label="Daily pooled-send limit"
            />
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy || selected.length === 0 || !Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > MAX_EMAIL_DAILY_SEND_LIMIT}
            onClick={() => updateSelected({ dailySendLimit: dailyLimit })}
          >
            Set limit
          </button>
        </div>
      </div>
      {error ? <p className={styles.poolError} role="alert">{error}</p> : null}
      <div className={styles.accountList}>
        {rows.map((account) => {
          const utilization = Math.min(100, Math.round((account.sentToday / account.dailySendLimit) * 100));
          const paused = account.sendEnabled && Boolean(account.sendPausedAt);
          return (
            <article className={styles.poolRow} key={account.id}>
              <input
                className={styles.rowCheckbox}
                type="checkbox"
                checked={selectedIds.has(account.id)}
                onChange={() => toggleSelection(account.id)}
                aria-label={`Select ${account.email}`}
              />
              <div className={styles.identity}>
                <strong>{account.displayName}</strong>
                <span>{account.email}</span>
              </div>
              <div className={styles.providerFact}>
                <span>Provider</span>
                <strong>{account.provider}</strong>
              </div>
              <div className={styles.usageFact}>
                <div><span>Today</span><strong>{account.sentToday} / {account.dailySendLimit}</strong></div>
                <div className={styles.usageTrack} aria-hidden="true"><span style={{ width: `${utilization}%` }} /></div>
              </div>
              <div className={styles.toggleCell}>
                <span>{paused ? "Paused" : account.sendEnabled ? "On" : "Off"}</span>
                {paused ? (
                  <div className={styles.pauseDetail}>
                    <span>{account.sendPausedReason ?? "Sender protection pause."}</span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => resumeAccount(account.id)}
                    >
                      Resume sending
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={account.sendEnabled}
                    aria-label={`${account.sendEnabled ? "Turn off" : "Turn on"} pooled sending for ${account.email}`}
                    className={styles.poolSwitch}
                    data-on={account.sendEnabled}
                    disabled={busy}
                    onClick={() => toggleAccount(account.id, !account.sendEnabled)}
                  >
                    <span />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
