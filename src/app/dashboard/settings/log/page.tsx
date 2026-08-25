import type { Route } from "next";
import Link from "next/link";
import { loadMailLog, type MailLogEntry, type MailLogFilter } from "@/lib/admin-mail-log";
import { requireMailLogSession } from "@/lib/email-account-access";
import { SettingsHeader } from "../settings-header";
import settingsStyles from "../integrations/integrations-settings.module.css";
import styles from "./log-settings.module.css";

export const metadata = { title: "Mail log" };

type LogSearchParams = {
  q?: string;
  direction?: string;
  outreach?: string;
};

function parseDirection(value: string | undefined): MailLogFilter["direction"] {
  if (value === "OUTBOUND" || value === "INBOUND") return value;
  return "ALL";
}

function parseOutreach(value: string | undefined): MailLogFilter["outreach"] {
  if (value === "Procurement" || value === "Sales") return value;
  return "ALL";
}

function whenLabel(value: Date) {
  return value.toISOString().slice(0, 16).replace("T", " ");
}

export default async function MailLogSettingsPage({ searchParams }: { searchParams: Promise<LogSearchParams> }) {
  const session = await requireMailLogSession();
  const params = await searchParams;
  const filter: MailLogFilter = {
    search: (params.q ?? "").trim(),
    direction: parseDirection(params.direction),
    outreach: parseOutreach(params.outreach),
  };
  const entries = await loadMailLog(session.officeId, filter);
  const filtered = filter.search !== "" || filter.direction !== "ALL" || filter.outreach !== "ALL";
  const sent = entries.filter((entry) => entry.direction === "OUTBOUND").length;
  const procurement = entries.filter((entry) => entry.outreachType === "Procurement").length;

  return (
    <main className={settingsStyles.page}>
      <SettingsHeader active="log" isAdmin={session.role === "ADMIN"} canReadMailLog />
      <div className={styles.workspace}>
        <section className={styles.summary} aria-label="Mail log summary">
          <div><span>Logged</span><strong>{entries.length}</strong></div>
          <div><span>Sent</span><strong>{sent}</strong></div>
          <div><span>Received</span><strong>{entries.length - sent}</strong></div>
          <div><span>Procurement</span><strong>{procurement}</strong></div>
          <form className={styles.filters} method="get">
            <input type="search" name="q" defaultValue={filter.search} placeholder="Company, item, address, subject" aria-label="Search mail log" />
            <select name="direction" defaultValue={filter.direction} aria-label="Direction">
              <option value="ALL">Sent and received</option>
              <option value="OUTBOUND">Sent</option>
              <option value="INBOUND">Received</option>
            </select>
            <select name="outreach" defaultValue={filter.outreach} aria-label="Outreach type">
              <option value="ALL">All outreach</option>
              <option value="Procurement">Procurement</option>
              <option value="Sales">Sales</option>
            </select>
            <button type="submit">Filter</button>
          </form>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>Mail log</h2>
              <p>Every sent and received message on this office, newest first. Expand a line to read the message and open its procurement thread.</p>
            </div>
          </header>
          <div className={styles.headerRow} aria-hidden="true">
            <span>When</span>
            <span>Direction</span>
            <span>Company</span>
            <span>Outreach</span>
            <span>Line item</span>
            <span>Email account</span>
            <span>Subject</span>
          </div>
          {entries.length === 0 ? (
            <div className={styles.empty}>
              {filtered
                ? "No mail matches this filter."
                : "No mail recorded yet. Lines appear as soon as an outreach is sent or a reply is synced."}
            </div>
          ) : entries.map((entry: MailLogEntry) => (
            <details className={styles.row} key={entry.messageId}>
              <summary>
                <span className={styles.when}>{whenLabel(entry.sentAt)}</span>
                <span><span className={styles.tag}>{entry.direction === "OUTBOUND" ? "Sent" : "Received"}</span></span>
                <span data-label="Company">{entry.companyName}</span>
                <span data-label="Outreach">{entry.outreachType}</span>
                <span data-label="Line item">{entry.lineItem}</span>
                <span className={styles.account}>{entry.accountEmail}</span>
                <span className={styles.subject}>{entry.subject}</span>
              </summary>
              <div className={styles.detail}>
                <dl>
                  <div>
                    <dt>{entry.direction === "OUTBOUND" ? "To" : "From"}</dt>
                    <dd>{entry.counterpartyEmail}</dd>
                  </div>
                  <div>
                    <dt>Account</dt>
                    <dd>{entry.accountEmail}</dd>
                  </div>
                  <div>
                    <dt>Subject</dt>
                    <dd>{entry.subject}</dd>
                  </div>
                </dl>
                <pre>{entry.body || "No body captured."}</pre>
                {entry.procurementLink ? (
                  <Link href={entry.procurementLink as Route}>Open in procurement messages</Link>
                ) : null}
              </div>
            </details>
          ))}
        </section>
      </div>
    </main>
  );
}
