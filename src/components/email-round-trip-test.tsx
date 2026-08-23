"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  advanceEmailRoundTripTest,
  EmailRoundTripState,
  startEmailRoundTripTest,
} from "@/app/dashboard/settings/connected-emails/actions";
import styles from "@/app/dashboard/settings/connected-emails/connected-emails.module.css";

type TestAccount = { id: string; email: string; displayName: string | null; isDefaultSender: boolean };

export function EmailRoundTripTest({ accounts }: { accounts: TestAccount[] }) {
  const router = useRouter();
  const orderedAccounts = useMemo(() => [...accounts].sort((a, b) => (
    Number(b.isDefaultSender) - Number(a.isDefaultSender) || a.email.localeCompare(b.email)
  )), [accounts]);
  const [senderId, setSenderId] = useState(orderedAccounts[0]?.id ?? "");
  const [recipientId, setRecipientId] = useState(orderedAccounts[1]?.id ?? "");
  const [testState, setTestState] = useState<EmailRoundTripState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setTestState(null);
    startTransition(async () => {
      const result = await startEmailRoundTripTest(senderId, recipientId);
      if (!result.ok) {
        setError(result.error ?? "Mailbox test failed.");
        return;
      }
      setTestState(result.state);
      router.refresh();
    });
  }

  function advance() {
    if (!testState) return;
    setError(null);
    startTransition(async () => {
      const result = await advanceEmailRoundTripTest(testState);
      if (!result.ok) {
        setError(result.error ?? "Mailbox test failed.");
        return;
      }
      setTestState(result.state);
      router.refresh();
    });
  }

  const nextLabel = testState?.stage === "reply_sent" || testState?.stage === "reply_waiting"
    ? "Check reply"
    : "Check delivery";

  return (
    <form className={styles.testForm} onSubmit={start}>
      <label>
        Sender
        <select value={senderId} onChange={(event) => setSenderId(event.target.value)} disabled={busy || accounts.length < 2}>
          {orderedAccounts.map((account) => (
            <option key={account.id} value={account.id}>{account.displayName || account.email} ({account.email})</option>
          ))}
        </select>
      </label>
      <label>
        Recipient and reply sender
        <select value={recipientId} onChange={(event) => setRecipientId(event.target.value)} disabled={busy || accounts.length < 2}>
          {orderedAccounts.map((account) => (
            <option key={account.id} value={account.id}>{account.displayName || account.email} ({account.email})</option>
          ))}
        </select>
      </label>
      <div className={styles.testActions}>
        <button className="btn" type="submit" disabled={busy || accounts.length < 2 || senderId === recipientId}>
          {busy && !testState ? "Sending..." : "Start test"}
        </button>
        {testState && testState.stage !== "complete" ? (
          <button className="btn btn-secondary" type="button" onClick={advance} disabled={busy}>
            {busy ? "Checking..." : nextLabel}
          </button>
        ) : null}
      </div>
      {accounts.length < 2 ? <p className={styles.muted}>Enable sending on at least two connected accounts.</p> : null}
      {testState ? <p className={testState.stage === "complete" ? styles.success : styles.status} role="status">{testState.message}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </form>
  );
}
