"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addGmailAppPasswordAccount } from "@/app/dashboard/settings/email/actions";

export function GmailAppPasswordForm({ encryptionConfigured }: { encryptionConfigured: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function submit(formData: FormData) {
    setStatus(null);
    startTransition(async () => {
      try {
        const result = await addGmailAppPasswordAccount(formData);
        if (!result.ok) {
          setStatus({ ok: false, message: result.error });
          return;
        }
        formRef.current?.reset();
        setStatus({ ok: true, message: "Account verified and added. Sending remains off until enabled." });
        router.refresh();
      } catch (caught) {
        setStatus({
          ok: false,
          message: caught instanceof Error ? caught.message : "Account setup failed.",
        });
      }
    });
  }

  return (
    <form ref={formRef} action={submit} style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 6, color: "var(--text-2)", fontSize: 12, fontWeight: 600 }}>
          Display name
          <input name="displayName" required maxLength={120} autoComplete="name" placeholder="Marlowe Cole" />
        </label>
        <label style={{ display: "grid", gap: 6, color: "var(--text-2)", fontSize: 12, fontWeight: 600 }}>
          Email
          <input name="email" type="email" required autoComplete="username" placeholder="name@company.com" />
        </label>
        <label style={{ display: "grid", gap: 6, color: "var(--text-2)", fontSize: 12, fontWeight: 600 }}>
          Gmail app password
          <input
            name="appPassword"
            type="password"
            required
            minLength={16}
            maxLength={32}
            autoComplete="new-password"
            placeholder="16 characters"
          />
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <p style={{ margin: 0, color: "var(--text-3)", fontSize: 11.5 }}>
          {encryptionConfigured
            ? "Use a newly generated app password. Gmail SMTP uses STARTTLS, IMAP is encrypted, and the password is never displayed again."
            : "Server credential encryption must be configured before an account can be added."}
        </p>
        <button className="btn" type="submit" disabled={busy || !encryptionConfigured}>
          {busy ? "Verifying..." : "Verify and add"}
        </button>
      </div>
      {status ? (
        <p
          role={status.ok ? "status" : "alert"}
          style={{ margin: 0, color: status.ok ? "var(--success)" : "var(--danger)", fontSize: 11.5 }}
        >
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
