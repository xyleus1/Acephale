import { EmailRoundTripTest } from "@/components/email-round-trip-test";
import { EmailSenderPool } from "@/components/email-sender-pool";
import { GmailAppPasswordBulkForm } from "@/components/gmail-app-password-bulk-form";
import { GmailAppPasswordForm } from "@/components/gmail-app-password-form";
import { ResumeAccountButton } from "@/components/resume-account-button";
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

export default async function ConnectedEmailsPage() {
  const session = await requireEmailAccountAdminSession();
  const accounts = await prisma.emailAccount.findMany({
    where: { officeId: session.officeId, provider: { in: EMAIL_PROVIDERS } },
    orderBy: [{ isActive: "desc" }, { isDefaultSender: "desc" }, { createdAt: "desc" }],
  });
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
  const sentTodayRows = await prisma.emailMessage.groupBy({
    by: ["accountId"],
    where: {
      accountId: { in: accounts.map((account) => account.id) },
      direction: "OUTBOUND",
      sentAt: { gte: todayStart, lt: tomorrowStart },
    },
    _count: true,
  });
  const sentToday = new Map(sentTodayRows.map((row) => [row.accountId, row._count]));

  const connected = accounts.filter((account) => account.isActive);
  const pooledAccounts = connected.filter((account) => isManagedGmail(account.provider));
  const paused = accounts.filter((account) => !account.isActive);
  const monitored = connected.filter((account) => (
    (account.provider === "GMAIL" && Boolean(account.refreshToken))
    || (account.provider === GMAIL_APP_PASSWORD_PROVIDER && Boolean(account.credentialSecret))
  ));
  const enabledSenders = monitored.filter((account) => account.sendEnabled);
  const sentTodayTotal = monitored.reduce((total, account) => total + (sentToday.get(account.id) ?? 0), 0);
  const dailyCapacity = enabledSenders.reduce((total, account) => total + account.dailySendLimit, 0);
  const oauthConfigured = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <main className={settingsStyles.page}>
      <SettingsHeader active="connected-emails" isAdmin={session.role === "ADMIN"} />
      <div className={styles.workspace}>
        <section className={styles.summary} aria-label="Email account summary">
          <div><span>Connected</span><strong>{connected.length}</strong></div>
          <div><span>Monitoring</span><strong>{monitored.length}</strong></div>
          <div><span>Sending pool</span><strong>{enabledSenders.length}</strong></div>
          <div><span>Sent today</span><strong>{sentTodayTotal} / {dailyCapacity}</strong></div>
          <a className="btn" href="#add-email">Add account</a>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <h2>Connected emails</h2>
              <p>New supplier inquiry drafts start with the least-used active mailbox. Approved sends and replies keep their selected mailbox.</p>
            </div>
          </header>
          {pooledAccounts.length > 0 ? (
            <EmailSenderPool accounts={pooledAccounts.map((account) => ({
              id: account.id,
              displayName: account.displayName || account.email,
              email: account.email,
              provider: providerLabel(account.provider),
              sendEnabled: account.sendEnabled,
              dailySendLimit: account.dailySendLimit,
              sentToday: sentToday.get(account.id) ?? 0,
            }))} />
          ) : (
            <div className={styles.empty}>No connected Gmail accounts are available for the sender pool.</div>
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
            <div><h2>Add accounts</h2></div>
          </header>
          <div className={styles.panelBody}>
            {oauthConfigured ? (
              <a className="btn btn-secondary" href="/api/auth/gmail/start">Connect Gmail OAuth</a>
            ) : null}
            <div className={styles.formDivider}><span>Bulk Gmail setup</span></div>
            <GmailAppPasswordBulkForm encryptionConfigured={isSecretEncryptionConfigured()} />
            <div className={styles.formDivider}><span>Single account</span></div>
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
