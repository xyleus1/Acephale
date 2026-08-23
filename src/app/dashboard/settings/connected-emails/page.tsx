import { DisconnectAccountButton } from "@/components/disconnect-account-button";
import { EmailAccountControls } from "@/components/email-account-controls";
import { EmailRoundTripTest } from "@/components/email-round-trip-test";
import { GmailAppPasswordForm } from "@/components/gmail-app-password-form";
import { ResumeAccountButton } from "@/components/resume-account-button";
import { SyncAccountButton } from "@/components/sync-account-button";
import { requireEmailAccountAdminSession } from "@/lib/email-account-access";
import { GMAIL_APP_PASSWORD_PROVIDER } from "@/lib/gmail-app-password";
import { prisma } from "@/lib/prisma";
import { isSecretEncryptionConfigured } from "@/lib/security/crypto";
import { SettingsHeader } from "../settings-header";
import settingsStyles from "../integrations/integrations-settings.module.css";
import styles from "./connected-emails.module.css";

export const metadata = { title: "Connected emails" };

const EMAIL_PROVIDERS = ["GMAIL", GMAIL_APP_PASSWORD_PROVIDER, "OUTLOOK", "IMAP"];

function providerLabel(provider: string) {
  if (provider === "GMAIL") return "Gmail OAuth";
  if (provider === GMAIL_APP_PASSWORD_PROVIDER) return "Gmail app password";
  if (provider === "OUTLOOK") return "Outlook";
  if (provider === "IMAP") return "IMAP";
  return provider;
}

function isManagedGmail(provider: string) {
  return provider === "GMAIL" || provider === GMAIL_APP_PASSWORD_PROVIDER;
}

function timeAgo(value: Date | null | undefined) {
  if (!value) return "Never";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function ConnectedEmailsPage() {
  const session = await requireEmailAccountAdminSession();
  const accounts = await prisma.emailAccount.findMany({
    where: { officeId: session.officeId, provider: { in: EMAIL_PROVIDERS } },
    orderBy: [{ isActive: "desc" }, { isDefaultSender: "desc" }, { createdAt: "desc" }],
  });
  const activityRows = await prisma.emailMessage.groupBy({
    by: ["accountId", "direction"],
    where: { accountId: { in: accounts.map((account) => account.id) } },
    _count: true,
    _max: { sentAt: true },
  });
  const activity = new Map<string, { inbound: number; outbound: number; lastInbound: Date | null; lastOutbound: Date | null }>();
  for (const row of activityRows) {
    if (!row.accountId) continue;
    const current = activity.get(row.accountId) ?? { inbound: 0, outbound: 0, lastInbound: null, lastOutbound: null };
    if (row.direction === "INBOUND") {
      current.inbound = row._count;
      current.lastInbound = row._max.sentAt;
    } else {
      current.outbound = row._count;
      current.lastOutbound = row._max.sentAt;
    }
    activity.set(row.accountId, current);
  }

  const connected = accounts.filter((account) => account.isActive);
  const paused = accounts.filter((account) => !account.isActive);
  const monitored = connected.filter((account) => (
    (account.provider === "GMAIL" && Boolean(account.refreshToken))
    || (account.provider === GMAIL_APP_PASSWORD_PROVIDER && Boolean(account.credentialSecret))
  ));
  const enabledSenders = monitored.filter((account) => account.sendEnabled);
  const defaultSender = enabledSenders.find((account) => account.isDefaultSender) ?? null;
  const oauthConfigured = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <main className={settingsStyles.page}>
      <SettingsHeader active="connected-emails" isAdmin={session.role === "ADMIN"} />
      <div className={styles.workspace}>
        <section className={styles.summary} aria-label="Email account summary">
          <div><span>Connected</span><strong>{connected.length}</strong></div>
          <div><span>Monitoring</span><strong>{monitored.length}</strong></div>
          <div><span>Sending</span><strong>{enabledSenders.length}</strong></div>
          <div><span>Default sender</span><strong>{defaultSender?.email ?? "Not set"}</strong></div>
          <a className="btn" href="#add-email">Add account</a>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>Connected emails</h2>
              <p>{connected.length} active, {paused.length} paused</p>
            </div>
          </header>
          {connected.length > 0 ? (
            <div className={styles.accountList}>
              {connected.map((account) => {
                const accountActivity = activity.get(account.id);
                return (
                  <article className={styles.accountRow} key={account.id}>
                    <span className={styles.statusDot} aria-label="Monitoring active" />
                    <div className={styles.identity}>
                      <strong>{account.displayName || account.email}</strong>
                      <span>{account.email}</span>
                    </div>
                    <dl className={styles.accountFacts}>
                      <div><dt>Provider</dt><dd>{providerLabel(account.provider)}</dd></div>
                      <div><dt>Incoming</dt><dd>{accountActivity?.inbound ?? 0} · {timeAgo(accountActivity?.lastInbound)}</dd></div>
                      <div><dt>Outgoing</dt><dd>{accountActivity?.outbound ?? 0} · {timeAgo(accountActivity?.lastOutbound)}</dd></div>
                    </dl>
                    <div className={styles.accountState}>
                      {isManagedGmail(account.provider) ? (
                        <>
                          <span data-on={account.sendEnabled}>{account.sendEnabled ? "Sending on" : "Sending off"}</span>
                          {account.isDefaultSender ? <span>Default</span> : null}
                        </>
                      ) : null}
                    </div>
                    <div className={styles.accountActions}>
                      {isManagedGmail(account.provider) ? (
                        <EmailAccountControls
                          accountId={account.id}
                          active={account.isActive}
                          sendEnabled={account.sendEnabled}
                          isDefaultSender={account.isDefaultSender}
                        />
                      ) : null}
                      {isManagedGmail(account.provider) ? <SyncAccountButton accountId={account.id} /> : null}
                      <DisconnectAccountButton accountId={account.id} />
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>No connected email accounts.</div>
          )}
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>Round-trip test</h2>
              <p>Send from one connected account, receive on another, reply, then verify the reply.</p>
            </div>
          </header>
          <div className={styles.panelBody}>
            <EmailRoundTripTest
              accounts={enabledSenders.map((account) => ({
                id: account.id,
                email: account.email,
                displayName: account.displayName,
                isDefaultSender: account.isDefaultSender,
              }))}
            />
          </div>
        </section>

        <section className={styles.panel} id="add-email">
          <header className={styles.panelHeader}>
            <div><h2>Add account</h2></div>
          </header>
          <div className={styles.panelBody}>
            {oauthConfigured ? (
              <a className="btn btn-secondary" href="/api/auth/gmail/start">Connect Gmail OAuth</a>
            ) : null}
            <div className={styles.formDivider}><span>Gmail app password</span></div>
            <GmailAppPasswordForm encryptionConfigured={isSecretEncryptionConfigured()} />
          </div>
        </section>

        {paused.length > 0 ? (
          <section className={styles.panel}>
            <header className={styles.panelHeader}><div><h2>Paused</h2><p>{paused.length} account{paused.length === 1 ? "" : "s"}</p></div></header>
            <div className={styles.pausedList}>
              {paused.map((account) => (
                <div className={styles.pausedRow} key={account.id}>
                  <div><strong>{account.displayName || account.email}</strong><span>{account.email}</span></div>
                  <ResumeAccountButton accountId={account.id} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
