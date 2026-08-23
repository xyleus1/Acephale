"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addGmailAppPasswordAccountsBulk,
  enableBulkEmailAccounts,
} from "@/app/dashboard/settings/email/actions";
import styles from "@/app/dashboard/settings/connected-emails/connected-emails.module.css";

type BulkResult = { email: string; ok: boolean; error?: string };

export function GmailAppPasswordBulkForm({ encryptionConfigured }: { encryptionConfigured: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [results, setResults] = useState<BulkResult[]>([]);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function submit(formData: FormData) {
    setErrors([]);
    setResults([]);
    setAccountIds([]);
    setStatus(null);
    startTransition(async () => {
      const result = await addGmailAppPasswordAccountsBulk(formData);
      setErrors(result.errors);
      setResults(result.results);
      setAccountIds(result.accountIds);
      if (result.results.length > 0) {
        const passed = result.results.filter((row) => row.ok).length;
        setStatus(`${passed} of ${result.results.length} accounts verified and connected. Sending remains off.`);
        if (passed === result.results.length) formRef.current?.reset();
        router.refresh();
      }
    });
  }

  function enableVerified() {
    setErrors([]);
    startTransition(async () => {
      const result = await enableBulkEmailAccounts(accountIds);
      if (!result.ok) {
        setErrors([result.error]);
        return;
      }
      setStatus(`${result.count} verified accounts enabled for sending.`);
      setAccountIds([]);
      router.refresh();
    });
  }

  return (
    <form className={styles.bulkForm} ref={formRef} action={submit}>
      <label>
        Accounts
        <textarea
          name="accounts"
          required
          rows={9}
          autoComplete="off"
          spellCheck={false}
          placeholder={"Display name, email, app password\nMarlowe Cole, marlowe@company.com, xxxx xxxx xxxx xxxx"}
        />
      </label>
      <p className={styles.muted}>Paste CSV or the full multi-line account block. Derya configures the Gmail connection automatically. Up to 10 accounts per batch.</p>
      <div className={styles.bulkActions}>
        <button className="btn" type="submit" disabled={busy || !encryptionConfigured}>
          {busy ? "Connecting..." : "Connect batch"}
        </button>
        {accountIds.length > 0 ? (
          <button className="btn btn-secondary" type="button" onClick={enableVerified} disabled={busy}>
            Enable verified
          </button>
        ) : null}
      </div>
      {!encryptionConfigured ? <p className={styles.error}>Server credential encryption is not configured.</p> : null}
      {status ? <p className={styles.status} role="status">{status}</p> : null}
      {errors.map((error) => <p className={styles.error} role="alert" key={error}>{error}</p>)}
      {results.length > 0 ? (
        <ul className={styles.bulkResults}>
          {results.map((result) => (
            <li data-ok={result.ok} key={result.email}>
              <strong>{result.email}</strong>
              <span>{result.ok ? "Connected" : result.error}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
