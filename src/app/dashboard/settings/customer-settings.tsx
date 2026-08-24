"use client";

import { useState, type FormEvent } from "react";
import styles from "./customer-settings.module.css";

type CustomerWorkspaceSettings = {
  workspaceId: string;
  companyName: string;
  website: string | null;
  snapshotVersion: number | null;
  base: {
    name: string;
    addressLine: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    countryCode: string | null;
  } | null;
  logisticsReady: boolean;
};

export function CustomerSettings({
  initialSettings,
  account,
  canEdit,
  previewMode,
  backHref,
}: {
  initialSettings: CustomerWorkspaceSettings;
  account: { name: string; username: string; role: string };
  canEdit: boolean;
  previewMode: boolean;
  backHref: string;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [website, setWebsite] = useState(initialSettings.website ?? "");
  const [base, setBase] = useState({
    name: initialSettings.base?.name ?? `${initialSettings.companyName} base`,
    addressLine: initialSettings.base?.addressLine ?? "",
    city: initialSettings.base?.city ?? "",
    region: initialSettings.base?.region ?? "",
    postalCode: initialSettings.base?.postalCode ?? "",
    countryCode: initialSettings.base?.countryCode ?? "",
  });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function save(action: "website" | "base", payload: Record<string, unknown>, successMessage: string) {
    if (!canEdit || state === "saving") return;
    setState("saving");
    setMessage("");
    const response = await fetch(`/api/supply-os/workspaces/${encodeURIComponent(settings.workspaceId)}/management`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({})) as { settings?: CustomerWorkspaceSettings; error?: string };
    if (!response.ok || !body.settings) {
      setState("error");
      setMessage(body.error || "Settings could not be saved.");
      return;
    }
    setSettings(body.settings);
    setState("saved");
    setMessage(successMessage);
  }

  function saveWebsite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save("website", { website }, "Company website saved.");
  }

  function saveBase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save("base", { base }, "Operating base saved. Logistics is ready to use.");
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <a href={backHref}>{previewMode ? "Back to customer preview" : "Back to workspace"}</a>
        <div>
          <span><small>Customer settings</small><h1>{settings.companyName}</h1></span>
          <i data-ready={settings.logisticsReady}>{settings.logisticsReady ? "Logistics ready" : "Setup needed"}</i>
        </div>
      </header>

      {previewMode ? <div className={styles.previewNotice}>Customer preview is read-only.</div> : null}
      {message ? <div className={styles.notice} data-error={state === "error"}>{message}</div> : null}

      <div className={styles.layout}>
        <section className={styles.card}>
          <header><h2>{previewMode ? "Preview scope" : "Your account"}</h2><p>{previewMode ? "This is a read-only company preview. It does not impersonate a customer account." : "This is your customer profile. Admin tools are kept on a separate internal settings page."}</p></header>
          <dl className={styles.accountFacts}>
            <div><dt>{previewMode ? "Company" : "Name"}</dt><dd>{account.name}</dd></div>
            <div><dt>{previewMode ? "Identity" : "Username"}</dt><dd>{account.username}</dd></div>
            <div><dt>{previewMode ? "Mode" : "Access"}</dt><dd>{account.role.toLowerCase()}</dd></div>
          </dl>
        </section>

        <form className={styles.card} onSubmit={saveWebsite}>
          <header><h2>Company profile</h2><p>Keep your public website accurate.</p></header>
          <div className={styles.formGrid}>
            <label className={styles.wide}>Company website<input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://company.com" disabled={!canEdit} /></label>
          </div>
          <footer>
            <span>Visible to your Derya operators</span>
            <button type="submit" disabled={!canEdit || state === "saving"}>{state === "saving" ? "Saving" : "Save website"}</button>
          </footer>
        </form>

        <form className={styles.card} onSubmit={saveBase}>
          <header><h2>Logistics base</h2><p>Save the real facility you ship or receive from. This is required before logistics can run.</p></header>
          <div className={styles.formGrid}>
            <label className={styles.wide}>Facility name<input value={base.name} onChange={(event) => setBase((current) => ({ ...current, name: event.target.value }))} maxLength={160} required disabled={!canEdit} /></label>
            <label className={styles.wide}>Street address<input value={base.addressLine} onChange={(event) => setBase((current) => ({ ...current, addressLine: event.target.value }))} maxLength={240} required disabled={!canEdit} /></label>
            <label>City<input value={base.city} onChange={(event) => setBase((current) => ({ ...current, city: event.target.value }))} maxLength={120} required disabled={!canEdit} /></label>
            <label>State or region<input value={base.region} onChange={(event) => setBase((current) => ({ ...current, region: event.target.value }))} maxLength={120} disabled={!canEdit} /></label>
            <label>Postal code<input value={base.postalCode} onChange={(event) => setBase((current) => ({ ...current, postalCode: event.target.value }))} maxLength={32} disabled={!canEdit} /></label>
            <label>Country code<input value={base.countryCode} onChange={(event) => setBase((current) => ({ ...current, countryCode: event.target.value.toUpperCase() }))} maxLength={2} placeholder="US" required disabled={!canEdit} /></label>
          </div>
          <footer>
            <span>{settings.snapshotVersion ? `Saved in data snapshot v${settings.snapshotVersion}` : "No operating base saved yet"}</span>
            <button type="submit" disabled={!canEdit || state === "saving"}>{state === "saving" ? "Saving" : "Save base"}</button>
          </footer>
        </form>
      </div>
    </main>
  );
}
