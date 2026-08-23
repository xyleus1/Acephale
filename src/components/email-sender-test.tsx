"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { sendEmailAccountTest } from "@/app/dashboard/settings/email/actions";

export function EmailSenderTest({
  accounts,
  recipient,
}: {
  accounts: Array<{ id: string; email: string; isDefaultSender: boolean }>;
  recipient: string;
}) {
  const defaultAccount = accounts.find((account) => account.isDefaultSender) ?? accounts[0] ?? null;
  const [accountId, setAccountId] = useState(defaultAccount?.id ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    setAccountId((current) => (
      accounts.some((account) => account.id === current)
        ? current
        : defaultAccount?.id ?? ""
    ));
  }, [accounts, defaultAccount?.id]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    startTransition(async () => {
      try {
        const result = await sendEmailAccountTest(accountId);
        setStatus(result.ok ? `Test sent to ${recipient}.` : result.error);
      } catch (caught) {
        setStatus(caught instanceof Error ? caught.message : "Test send failed.");
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "end" }}>
      <label style={{ display: "grid", gap: 6, color: "var(--text-2)", fontSize: 12, fontWeight: 600 }}>
        Sender
        <select value={accountId} onChange={(event) => setAccountId(event.target.value)} disabled={busy || accounts.length === 0}>
          {accounts.length === 0 ? <option value="">No enabled sender</option> : null}
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.email}{account.isDefaultSender ? " (default)" : ""}</option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn" disabled={busy || !accountId}>
        {busy ? "Sending..." : "Send test"}
      </button>
      <p style={{ gridColumn: "1 / -1", margin: 0, color: status?.startsWith("Test sent") ? "var(--success)" : "var(--text-3)", fontSize: 11.5 }} role="status">
        {status ?? `Recipient: ${recipient}`}
      </p>
    </form>
  );
}
