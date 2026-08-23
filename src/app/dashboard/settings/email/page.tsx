import { prisma } from "@/lib/prisma";
import { requireEmailAccountAdminSession } from "@/lib/email-account-access";
import { Icon } from "@/components/icon";
import { SyncAccountButton } from "@/components/sync-account-button";
import { DisconnectAccountButton } from "@/components/disconnect-account-button";
import { ResumeAccountButton } from "@/components/resume-account-button";
import { EmailAccountControls } from "@/components/email-account-controls";
import { EmailSenderTest } from "@/components/email-sender-test";
import { SyncGoogleSheetButton } from "@/components/sync-google-sheet-button";
import { AppearanceToggle } from "@/components/appearance-toggle";
import { SyncDeryaInboxesButton } from "@/components/sync-derya-inboxes-button";
import { CheckWhatsAppStatusButton } from "@/components/check-whatsapp-status-button";
import { DERYA_LOAD_RFQ_INBOX_EMAILS, DERYA_LOAD_RFQ_INBOXES, DERYA_RFQ_SOURCE_EMAILS, gmailConnectHrefForInbox } from "@/lib/derya-inboxes";
import { whatsAppProvider, whatsAppSendConfigured } from "@/lib/whatsapp";
import { whatsAppAccountLabel } from "@/lib/whatsapp-display";
import { SettingsHeader } from "../settings-header";
import settingsStyles from "../integrations/integrations-settings.module.css";

export const metadata = { title: "Email accounts" };

function timeAgo(d: Date | null | undefined) {
  if (!d) return "Never";
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function EmailSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth_success?: string; oauth_error?: string }>;
}) {
  const session = await requireEmailAccountAdminSession();
  const sp = await searchParams;

  const accounts = await prisma.emailAccount.findMany({
    where: { officeId: session.officeId },
    orderBy: { createdAt: "desc" },
  });

  const messageCounts = await prisma.emailMessage.groupBy({
    by: ["accountId"],
    where: { account: { officeId: session.officeId } },
    _count: true,
  });
  const messageActivity = await prisma.emailMessage.groupBy({
    by: ["accountId", "direction"],
    where: { account: { officeId: session.officeId } },
    _count: true,
    _max: { sentAt: true },
  });
  const activeForwarderCount = await prisma.forwarder.count({
    where: { officeId: session.officeId, active: true },
  });
  const countByAccount = Object.fromEntries(messageCounts.map((c) => [c.accountId, c._count]));
  const activityByAccount = new Map<string, {
    inbound: number;
    outbound: number;
    lastInboundAt: Date | null;
    lastOutboundAt: Date | null;
  }>();
  for (const row of messageActivity) {
    if (!row.accountId) continue;
    const activity = activityByAccount.get(row.accountId) ?? {
      inbound: 0,
      outbound: 0,
      lastInboundAt: null,
      lastOutboundAt: null,
    };
    if (row.direction === "INBOUND") {
      activity.inbound = row._count;
      activity.lastInboundAt = row._max.sentAt;
    } else {
      activity.outbound = row._count;
      activity.lastOutboundAt = row._max.sentAt;
    }
    activityByAccount.set(row.accountId, activity);
  }

  const active = accounts.filter((a) => a.isActive);
  const paused = accounts.filter((a) => !a.isActive);
  const monitoredGmail = active.filter((a) => a.provider === "GMAIL" && Boolean(a.refreshToken));
  const sendingGmail = monitoredGmail.filter((a) => a.sendEnabled);
  const defaultSender = sendingGmail.find((a) => a.isDefaultSender) ?? null;
  const connectedAllowedSenderEmails = active
    .filter((a) => a.provider === "GMAIL" && DERYA_LOAD_RFQ_INBOX_EMAILS.includes(a.email.toLowerCase()))
    .map((a) => a.email.toLowerCase());
  const missingAllowedSenderEmails = DERYA_LOAD_RFQ_INBOX_EMAILS.filter((email) => !connectedAllowedSenderEmails.includes(email));
  const accountByEmail = new Map(accounts.map((account) => [account.email.toLowerCase(), account]));
  const deryaInboxRows = DERYA_LOAD_RFQ_INBOXES.map((inbox) => {
    const account = accountByEmail.get(inbox.email) ?? null;
    return {
      ...inbox,
      account,
      status: !account ? "missing" : account.isActive ? "connected" : "paused",
      messageCount: account ? countByAccount[account.id] ?? 0 : 0,
    };
  });
  // The rfq@ desk mailbox sends the US lead outreach and, since 2026-07-22,
  // receives the replies (Reply-To). It must be OAuth-connected or reply
  // detection cannot see them. Its EmailAccount row exists even when only
  // SMTP is configured, so "connected" means a refresh token, not just a row.
  const rfqDeskRows = DERYA_RFQ_SOURCE_EMAILS.map((email) => {
    const account = accountByEmail.get(email) ?? null;
    const connected = Boolean(account?.refreshToken && account.isActive);
    return {
      email,
      account,
      connected,
      messageCount: account ? countByAccount[account.id] ?? 0 : 0,
    };
  });
  const rfqDeskDisconnected = rfqDeskRows.filter((row) => !row.connected).map((row) => row.email);
  const oauthConfigured = !!process.env.GOOGLE_CLIENT_ID;
  // WhatsApp health is provider-aware: Green API mode has its own credentials
  // and webhook path; the Meta env vars only matter in meta mode.
  const waProvider = whatsAppProvider();
  const waSendReady = whatsAppSendConfigured();
  const waInboundReady = waProvider === "greenapi"
    ? !!(process.env.GREEN_API_ID_INSTANCE && process.env.GREEN_API_TOKEN && process.env.GREEN_API_WEBHOOK_TOKEN)
    : !!(process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET);
  const whatsAppConfigured = waSendReady && waInboundReady;
  const whatsAppWebhookConfigured = waInboundReady;
  const waProviderLabel = waProvider === "greenapi" ? "Green API" : "Meta Cloud API";
  const waCallbackPath = waProvider === "greenapi" ? "/api/webhooks/whatsapp/greenapi" : "/api/webhooks/whatsapp";
  const waAccount = accounts.find((a) => a.provider === "WHATSAPP") ?? null;
  const waEnvRows: Array<[string, boolean]> = waProvider === "greenapi"
    ? [
        ["GREEN_API_ID_INSTANCE", !!process.env.GREEN_API_ID_INSTANCE],
        ["GREEN_API_TOKEN", !!process.env.GREEN_API_TOKEN],
        // GREEN_API_BASE_URL is optional (defaults to api.green-api.com) -
        // only worth surfacing when it's actually set.
        ...(process.env.GREEN_API_BASE_URL ? [["GREEN_API_BASE_URL", true] as [string, boolean]] : []),
        ["GREEN_API_WEBHOOK_TOKEN", !!process.env.GREEN_API_WEBHOOK_TOKEN],
        ["WHATSAPP_PHONE_NUMBER_ID", !!process.env.WHATSAPP_PHONE_NUMBER_ID],
        ["WHATSAPP_SEND_ENABLED", process.env.WHATSAPP_SEND_ENABLED === "true"],
        ["WHATSAPP_AUTO_READ_ENABLED", process.env.WHATSAPP_AUTO_READ_ENABLED === "true"],
      ]
    : [
        ["WHATSAPP_VERIFY_TOKEN", !!process.env.WHATSAPP_VERIFY_TOKEN],
        ["WHATSAPP_APP_SECRET", !!process.env.WHATSAPP_APP_SECRET],
        ["WHATSAPP_ACCESS_TOKEN", !!process.env.WHATSAPP_ACCESS_TOKEN],
        ["WHATSAPP_PHONE_NUMBER_ID", !!process.env.WHATSAPP_PHONE_NUMBER_ID],
        ["WHATSAPP_SEND_ENABLED", process.env.WHATSAPP_SEND_ENABLED === "true"],
        ["WHATSAPP_AUTO_READ_ENABLED", process.env.WHATSAPP_AUTO_READ_ENABLED === "true"],
      ];
  const sheetId = process.env.DERYA_GOOGLE_SHEET_ID ?? "1CFmfSdFJKOCThss5xzglHb5GihPRlK3pRxLCmpuFUHg";
  const sheetsAuthConfigured = !!process.env.GOOGLE_SHEETS_API_KEY || !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const documentStorageDriver = (process.env.DOCUMENT_STORAGE_DRIVER ?? "local").toLowerCase();
  const productionDocumentStorageConfigured = documentStorageDriver === "s3"
    && !!process.env.DOCUMENT_STORAGE_S3_BUCKET
    && !!process.env.DOCUMENT_STORAGE_S3_ACCESS_KEY_ID
    && !!process.env.DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY;
  const setupGates = [
    {
      label: "Default sender",
      status: defaultSender ? "ready" : sendingGmail.length > 0 ? "setup required" : "blocked",
      detail: defaultSender
        ? `${defaultSender.email} is the default for approved outbound email.`
        : sendingGmail.length > 0
          ? "Choose one enabled Gmail account as the default sender."
          : "Connect Gmail and explicitly enable sending before outbound email can use an account.",
    },
    {
      label: "Derya load/RFQ inboxes",
      status: missingAllowedSenderEmails.length === 0 ? "ready" : oauthConfigured ? "setup required" : "blocked",
      detail: missingAllowedSenderEmails.length === 0
        ? `Native load/RFQ inboxes connected: ${connectedAllowedSenderEmails.join(", ")}.`
        : `Connect or resume ${missingAllowedSenderEmails.join(", ")} so inbound load/RFQ mail from both accounts is visible.`,
    },
    {
      label: "RFQ desk mailbox (US lead replies)",
      status: rfqDeskDisconnected.length === 0 ? "ready" : oauthConfigured ? "setup required" : "blocked",
      detail: rfqDeskDisconnected.length === 0
        ? `US lead replies and bounces are being captured: ${rfqDeskRows.map((row) => row.email).join(", ")}.`
        : `Connect ${rfqDeskDisconnected.join(", ")} - US lead emails ask for replies there, and without OAuth the outreach sequence cannot see them (or the bounces).`,
    },
    {
      label: "Forwarder directory",
      status: activeForwarderCount > 0 ? "ready" : "setup required",
      detail: activeForwarderCount > 0
        ? `${activeForwarderCount} active forwarder recipient${activeForwarderCount === 1 ? "" : "s"} configured.`
        : "Seed DSV and the first 5-10 forwarder quote emails with mode coverage before relying on RFQ handoff.",
    },
    {
      label: "Google Sheets",
      status: sheetsAuthConfigured ? "ready" : "setup required",
      detail: sheetsAuthConfigured
        ? "Google API credentials are configured for production sync."
        : "Manual/public fallback can work for testing; production sync needs API key or service account and sheet sharing.",
    },
    {
      label: "WhatsApp",
      status: whatsAppConfigured ? "ready" : whatsAppWebhookConfigured ? "setup required" : "blocked",
      detail: whatsAppConfigured
        ? `Inbound webhook and outbound sending are configured through ${waProviderLabel}.`
        : waProvider === "greenapi"
          ? "Green API instance credentials, webhook token, and WHATSAPP_SEND_ENABLED are required."
          : "Meta verify token, app secret, access token, phone number ID, and public callback URL are still required.",
    },
    {
      label: "Document storage",
      status: productionDocumentStorageConfigured ? "ready" : "setup required",
      detail: productionDocumentStorageConfigured
        ? "S3-compatible storage is configured for production documents."
        : `Current driver is ${documentStorageDriver}. Production needs S3/R2-compatible storage or an explicit local-production exception.`,
    },
  ];
  // Accounts connected before the gmail.send scope was added need to be
  // reconnected before AI replies can actually deliver. We can't tell from
  // the DB alone, so show a soft prompt for any account whose lastSyncAt
  // predates the scope rollout.
  const SCOPE_ROLLOUT = new Date("2026-05-02T22:00:00Z");
  // Gmail-scope prompt only - a quiet WhatsApp line is not a reauth problem.
  const needsReauth = active.filter((a) => a.provider !== "WHATSAPP" && (!a.lastSyncAt || new Date(a.lastSyncAt) < SCOPE_ROLLOUT));

  return (
    <main className={settingsStyles.page}>
      <SettingsHeader active="channels" isAdmin={session.role === "ADMIN"} />
      <div style={{ maxWidth: 1180, margin: "34px auto 0" }}>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 18 }}>
          <div>
            <div style={{ color: "var(--text-3)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Monitoring</div>
            <div style={{ marginTop: 5, color: "var(--text)", fontSize: 16, fontWeight: 650 }}>{monitoredGmail.length} active</div>
          </div>
          <div>
            <div style={{ color: "var(--text-3)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Sending</div>
            <div style={{ marginTop: 5, color: "var(--text)", fontSize: 16, fontWeight: 650 }}>{sendingGmail.length} enabled</div>
          </div>
          <div>
            <div style={{ color: "var(--text-3)", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Default sender</div>
            <div style={{ marginTop: 5, overflow: "hidden", color: "var(--text)", fontSize: 13, fontWeight: 650, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{defaultSender?.email ?? "Not set"}</div>
          </div>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body appearance-card-body">
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>Appearance</div>
            <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
              Keep the deal desk, agent, and pricing brain on the same operator interface.
            </p>
          </div>
          <AppearanceToggle />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 6 }}>Production setup gates</div>
          <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5, marginBottom: 12 }}>
            These are explicit blockers, not hidden failures. The local batch works without them; production messaging and sync do not.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {setupGates.map((gate) => (
              <div key={gate.label} style={{
                display: "grid",
                gap: 4,
                padding: "10px 12px",
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${gate.status === "ready" ? "var(--success)" : gate.status === "blocked" ? "var(--danger)" : "var(--warning)"}`,
                borderRadius: "var(--radius)",
                background: "var(--surface)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <strong style={{ fontSize: 13, color: "var(--text)" }}>{gate.label}</strong>
                  <span style={{
                    color: gate.status === "ready" ? "var(--success)" : gate.status === "blocked" ? "var(--danger)" : "var(--warning)",
                    fontSize: 10.5,
                    fontWeight: 900,
                    textTransform: "uppercase",
                  }}>
                    {gate.status}
                  </span>
                </div>
                <span style={{ color: "var(--text-2)", fontSize: 12, lineHeight: 1.45 }}>{gate.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status banners */}
      {sp.oauth_success && (
        <div style={{
          padding: "12px 16px", marginBottom: 16, borderRadius: "var(--radius)",
          background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "3px solid var(--brand)",
          fontSize: 13, color: "var(--text)",
        }}>
          Connected <strong>{sp.oauth_success}</strong>. Click <em>Sync now</em> below to fetch the last year.
        </div>
      )}
      {needsReauth.length > 0 && (
        <div style={{
          padding: "12px 16px", marginBottom: 16, borderRadius: "var(--radius)",
          background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "3px solid var(--brand)",
          fontSize: 13, color: "var(--text)",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Reconnect to enable Send</div>
          <p style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 8 }}>
            We added a Gmail Send permission for AI-drafted replies. Reconnect each inbox below to grant it. Read-only sync still works without this - but the Send button in draft modals will fail until you reconnect.
          </p>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            {needsReauth.map((a) => a.email).join(", ")}
          </div>
        </div>
      )}
      {sp.oauth_error && (
        <div style={{
          padding: "12px 16px", marginBottom: 16, borderRadius: "var(--radius)",
          background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "3px solid var(--danger)",
          fontSize: 13, color: "var(--text)",
        }}>
          OAuth error: <strong>{sp.oauth_error}</strong>. Check that the redirect URI in Google Cloud matches and that GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set.
        </div>
      )}

      {/* How it works */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 12 }}>
            How it works
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {[
              { step: "01", title: "Connect channel", desc: "Authorize Gmail or configure the WhatsApp Cloud API webhook." },
              { step: "02", title: "AI classifies", desc: "Each inbound message is classified as RFQ, forwarder reply, customer reply, or other." },
              { step: "03", title: "Auto-attached", desc: "RFQs become inquiries, forwarder prices update the pricing record, replies append to threads." },
            ].map(({ step, title, desc }) => (
              <div key={step} style={{ display: "flex", gap: 12 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 4, background: "var(--text)", color: "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800,
                  flexShrink: 0, fontFamily: "ui-monospace, Menlo, monospace",
                }}>{step}</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>{title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div className="section-title" style={{ marginBottom: 0 }}>WhatsApp</div>
              <span className="badge badge-info">Provider: {waProviderLabel}</span>
            </div>
            <CheckWhatsAppStatusButton />
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{
              padding: "12px 14px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "var(--surface-2)",
              fontSize: 12.5,
              color: "var(--text-2)",
              lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
                Status: {whatsAppConfigured
                  ? `ready for inbound and outbound messages${waAccount?.lastSyncAt ? ` · last inbound ${timeAgo(waAccount.lastSyncAt)}` : " · no inbound yet"}`
                  : whatsAppWebhookConfigured ? "inbound webhook ready; outbound sending not enabled" : "not configured"}
              </div>
              <div>
                Callback path: <code>{waCallbackPath}</code>. {waProvider === "greenapi"
                  ? "Green API POSTs inbound messages into the same inbox/RFQ workflow as email - no Meta app review required."
                  : <>Meta will verify this path with <code>hub.challenge</code>, then POST inbound messages into the same inbox/RFQ workflow as email.</>}
              </div>
            </div>
            <div className="settings-env-grid">
              {waEnvRows.map(([key, present]) => (
                <div key={String(key)} className="settings-env-row" style={{
                  padding: "9px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  background: "var(--surface)",
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  fontSize: 11.5,
                }}>
                  <code>{key}</code>
                  <span style={{ color: present ? "var(--brand)" : "var(--text-3)", fontWeight: 700 }}>
                    {present ? "set" : "missing"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 12 }}>Google Sheet source</div>
          <div style={{
            padding: "12px 14px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            background: "var(--surface-2)",
            fontSize: 12.5,
            color: "var(--text-2)",
            lineHeight: 1.5,
            marginBottom: 10,
          }}>
            <div style={{ fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
              Sheet: <code>{sheetId}</code>
            </div>
            <div>
              Sync pulls <code>06/2026 Talepler</code> into RFQs and <code>Operasyonlar</code> into Jobs with cost, revenue, margin, customer, mode, and status. Auth is {sheetsAuthConfigured ? "configured through Google API credentials" : "using public CSV fallback until Google API credentials are set"}.
            </div>
          </div>
          <SyncGoogleSheetButton />
        </div>
      </div>

      {/* Connect button(s) */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
            <div>
              <div className="section-title" style={{ marginBottom: 6 }}>Derya load/RFQ inboxes</div>
              <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
                These configured mailboxes are treated as first-class load/RFQ sources. Sync pulls recent Gmail immediately, queues older monthly backfill windows, keeps each mailbox separated, and labels freight-related mail as <code>load/rfq</code>, <code>load/customer</code>, <code>load/forwarder</code>, or <code>load/note</code>.
              </p>
            </div>
            <SyncDeryaInboxesButton disabled={connectedAllowedSenderEmails.length === 0} />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {rfqDeskRows.map((row) => (
              <div key={row.email} style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) auto",
                gap: 12,
                alignItems: "center",
                padding: "12px 14px",
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${row.connected ? "var(--brand)" : "var(--danger)"}`,
                borderRadius: "var(--radius)",
                background: "var(--surface)",
              }}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13 }}>{row.email}</strong>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 900,
                      textTransform: "uppercase",
                      color: row.connected ? "var(--brand)" : "var(--danger)",
                    }}>
                      {row.connected ? "connected" : "reply capture off"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3 }}>
                    RFQ desk · sends the US lead outreach and receives the replies
                    {row.connected
                      ? ` · ${row.messageCount} message${row.messageCount === 1 ? "" : "s"} synced · last sync ${timeAgo(row.account?.lastSyncAt)}`
                      : " · SMTP send works, but replies and bounces are invisible until this mailbox is OAuth-connected"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                  {row.connected && row.account && <SyncAccountButton accountId={row.account.id} />}
                  {oauthConfigured && (
                    <a href={gmailConnectHrefForInbox(row.email)} className="btn btn-sm" style={{ fontSize: 12 }}>
                      {row.connected ? "Reconnect" : "Connect"}
                    </a>
                  )}
                </div>
              </div>
            ))}
            {deryaInboxRows.map((row) => (
              <div key={row.email} style={{
                display: "grid",
                gridTemplateColumns: "minmax(0,1fr) auto",
                gap: 12,
                alignItems: "center",
                padding: "12px 14px",
                border: "1px solid var(--border)",
                borderLeft: `3px solid ${row.status === "connected" ? "var(--brand)" : row.status === "paused" ? "var(--warning)" : "var(--danger)"}`,
                borderRadius: "var(--radius)",
                background: "var(--surface)",
              }}>
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13 }}>{row.email}</strong>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 900,
                      textTransform: "uppercase",
                      color: row.status === "connected" ? "var(--brand)" : row.status === "paused" ? "var(--warning)" : "var(--danger)",
                    }}>
                      {row.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 3 }}>
                    {row.owner} · {row.role}
                    {row.account ? ` · ${row.messageCount} message${row.messageCount === 1 ? "" : "s"} synced · last sync ${timeAgo(row.account.lastSyncAt)}` : " · not authorized yet"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
                  {row.account?.isActive && row.account.provider === "GMAIL" && <SyncAccountButton accountId={row.account.id} />}
                  {row.account && !row.account.isActive && <ResumeAccountButton accountId={row.account.id} />}
                  {oauthConfigured && (
                    <a href={gmailConnectHrefForInbox(row.email)} className="btn btn-secondary btn-sm" style={{ fontSize: 12 }}>
                      {row.account ? "Reconnect" : "Connect"}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 12 }}>Add email account</div>
          <div style={{ display: "flex", gap: 10 }}>
            {oauthConfigured ? (
              <a
                href="/api/auth/gmail/start"
                className="btn"
                style={{ flex: 1, justifyContent: "center", gap: 10, padding: "12px 16px", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              >
                <span style={{ width: 20, height: 20, borderRadius: 4, background: "var(--derya-navy, var(--derya-ink))", border: "1px solid var(--derya-walnut, var(--border-strong))", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>G</span>
                Connect Gmail
              </a>
            ) : (
              <div style={{ flex: 1, padding: "12px 16px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 12.5, color: "var(--text-2)" }}>
                Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_REDIRECT_URI</code> in your environment to enable Gmail connect. See <a href="/docs/EMAIL_SETUP.md" target="_blank" style={{ color: "var(--brand)" }}>docs/EMAIL_SETUP.md</a>.
              </div>
            )}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 10, marginBottom: 0 }}>
            New accounts start with monitoring on and sending off. An administrator must enable sending and choose the default account separately.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body">
          <div className="section-title" style={{ marginBottom: 12 }}>Test sending</div>
          <EmailSenderTest
            recipient={session.email}
            accounts={sendingGmail.map((account) => ({
              id: account.id,
              email: account.email,
              isDefaultSender: account.isDefaultSender,
            }))}
          />
        </div>
      </div>

      {/* Connected accounts */}
      {active.length > 0 ? (
        <div className="card-flush" style={{ marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <div className="section-title">Connected ({active.length})</div>
          </div>
          {active.map((account) => (
            <div key={account.id} style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {account.provider === "WHATSAPP" ? (
                    <div className="wa-account-avatar">
                      <Icon name="whatsapp" size={16} strokeWidth={1.9} />
                    </div>
                  ) : (
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: "var(--surface-3)", border: "1px solid var(--border)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 700, color: "var(--text-2)",
                    }}>
                      {account.provider === "GMAIL" ? "G" : account.provider === "OUTLOOK" ? "O" : "M"}
                    </div>
                  )}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{whatsAppAccountLabel(account.email)}</span>
                      {account.provider === "GMAIL" ? (
                        <>
                          <span className={`badge ${account.sendEnabled ? "badge-good" : "badge-neutral"}`}>
                            {account.sendEnabled ? "sending on" : "sending off"}
                          </span>
                          {account.isDefaultSender ? <span className="badge badge-info">default</span> : null}
                        </>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {account.provider === "WHATSAPP"
                        ? `${waProviderLabel} · ${countByAccount[account.id] ?? 0} message${(countByAccount[account.id] ?? 0) === 1 ? "" : "s"} · last inbound ${timeAgo(account.lastSyncAt)}`
                        : `${account.provider} · ${countByAccount[account.id] ?? 0} message${(countByAccount[account.id] ?? 0) === 1 ? "" : "s"} synced · last sync ${timeAgo(account.lastSyncAt)}`}
                    </div>
                    {account.provider === "GMAIL" ? (
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
                        {activityByAccount.get(account.id)?.inbound ?? 0} inbound, last {timeAgo(activityByAccount.get(account.id)?.lastInboundAt)} · {activityByAccount.get(account.id)?.outbound ?? 0} outbound, last {timeAgo(activityByAccount.get(account.id)?.lastOutboundAt)}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {account.provider === "GMAIL" ? (
                    <EmailAccountControls
                      accountId={account.id}
                      active={account.isActive}
                      sendEnabled={account.sendEnabled}
                      isDefaultSender={account.isDefaultSender}
                    />
                  ) : null}
                  {account.provider === "GMAIL" && <SyncAccountButton accountId={account.id} />}
                  <DisconnectAccountButton accountId={account.id} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: "40px 24px", marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No connected inboxes</div>
          <p style={{ fontSize: 13, color: "var(--text-3)" }}>
            Connect Gmail above, then enable sending only on accounts approved for outbound use.
          </p>
        </div>
      )}

      {/* Paused accounts */}
      {paused.length > 0 && (
        <div className="card-flush" style={{ marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <div className="section-title">Paused ({paused.length})</div>
            <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "4px 0 0" }}>
              Sync is stopped and these inboxes&apos; emails are hidden from the Inbox. Nothing was deleted - resume any time.
            </p>
          </div>
          {paused.map((account) => (
            <div key={account.id} style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", opacity: 0.75 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {account.provider === "WHATSAPP" ? (
                    <div className="wa-account-avatar">
                      <Icon name="whatsapp" size={16} strokeWidth={1.9} />
                    </div>
                  ) : (
                    <div style={{
                      width: 36, height: 36, borderRadius: 8,
                      background: "var(--surface-3)", border: "1px solid var(--border)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 700, color: "var(--text-2)",
                    }}>
                      {account.provider === "GMAIL" ? "G" : account.provider === "OUTLOOK" ? "O" : "M"}
                    </div>
                  )}
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{whatsAppAccountLabel(account.email)}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {account.provider} · {countByAccount[account.id] ?? 0} message{(countByAccount[account.id] ?? 0) === 1 ? "" : "s"} kept · last sync {timeAgo(account.lastSyncAt)}
                    </div>
                  </div>
                </div>
                <ResumeAccountButton accountId={account.id} />
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </main>
  );
}
