import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Icon } from "@/components/icon";
import { SyncAccountButton } from "@/components/sync-account-button";
import { DisconnectAccountButton } from "@/components/disconnect-account-button";
import { ResumeAccountButton } from "@/components/resume-account-button";
import { SyncGoogleSheetButton } from "@/components/sync-google-sheet-button";
import { AppearanceToggle } from "@/components/appearance-toggle";
import { SyncDeryaInboxesButton } from "@/components/sync-derya-inboxes-button";
import { DERYA_LOAD_RFQ_INBOX_EMAILS, DERYA_LOAD_RFQ_INBOXES, gmailConnectHrefForInbox } from "@/lib/derya-inboxes";

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
  const session = await requireSession();
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
  const activeForwarderCount = await prisma.forwarder.count({
    where: { officeId: session.officeId, active: true },
  });
  const countByAccount = Object.fromEntries(messageCounts.map((c) => [c.accountId, c._count]));

  const active = accounts.filter((a) => a.isActive);
  const paused = accounts.filter((a) => !a.isActive);
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
  const oauthConfigured = !!process.env.GOOGLE_CLIENT_ID;
  const whatsAppConfigured = !!(process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  const whatsAppWebhookConfigured = !!process.env.WHATSAPP_VERIFY_TOKEN;
  const sheetId = process.env.DERYA_GOOGLE_SHEET_ID ?? "1CFmfSdFJKOCThss5xzglHb5GihPRlK3pRxLCmpuFUHg";
  const sheetsAuthConfigured = !!process.env.GOOGLE_SHEETS_API_KEY || !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const documentStorageDriver = (process.env.DOCUMENT_STORAGE_DRIVER ?? "local").toLowerCase();
  const productionDocumentStorageConfigured = documentStorageDriver === "s3"
    && !!process.env.DOCUMENT_STORAGE_S3_BUCKET
    && !!process.env.DOCUMENT_STORAGE_S3_ACCESS_KEY_ID
    && !!process.env.DOCUMENT_STORAGE_S3_SECRET_ACCESS_KEY;
  const setupGates = [
    {
      label: "Derya load/RFQ inboxes",
      status: missingAllowedSenderEmails.length === 0 ? "ready" : oauthConfigured ? "setup required" : "blocked",
      detail: missingAllowedSenderEmails.length === 0
        ? `Native load/RFQ inboxes connected: ${connectedAllowedSenderEmails.join(", ")}.`
        : `Connect or resume ${missingAllowedSenderEmails.join(", ")} so inbound load/RFQ mail from both accounts is visible.`,
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
        ? "Webhook and outbound Cloud API credentials are configured."
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
  const needsReauth = active.filter((a) => !a.lastSyncAt || new Date(a.lastSyncAt) < SCOPE_ROLLOUT);

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 16 }}>
        <a href="/dashboard" className="back-link">
          <Icon name="chevron-left" size={14} strokeWidth={2} /> Workbench
        </a>
      </div>

      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Email & WhatsApp</h1>
          <p className="page-subtitle">
            Connect customer channels. Inbound messages get classified and attached to the right RFQ automatically.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body appearance-card-body">
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>Appearance</div>
            <p style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
              Derya uses one warm notebook theme so the deal desk, agent, and pricing brain feel like the same product.
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
                borderLeft: `3px solid ${gate.status === "ready" ? "var(--derya-olive)" : gate.status === "blocked" ? "var(--derya-clay)" : "#9a6b2f"}`,
                borderRadius: "var(--radius)",
                background: gate.status === "ready" ? "#eef0df" : gate.status === "blocked" ? "#f2ddcf" : "#f7e3c8",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <strong style={{ fontSize: 13, color: "var(--text)" }}>{gate.label}</strong>
                  <span style={{
                    color: gate.status === "ready" ? "var(--derya-olive)" : gate.status === "blocked" ? "var(--derya-clay)" : "#7a5521",
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
            We added a Gmail Send permission for AI-drafted replies. Reconnect each inbox below to grant it. Read-only sync still works without this — but the Send button in draft modals will fail until you reconnect.
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
          <div className="section-title" style={{ marginBottom: 12 }}>WhatsApp Cloud API</div>
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
                Status: {whatsAppConfigured ? "ready for inbound and outbound messages" : whatsAppWebhookConfigured ? "webhook can verify; outbound credentials missing" : "not configured"}
              </div>
              <div>
                Callback path: <code>/api/webhooks/whatsapp</code>. Meta will verify this path with <code>hub.challenge</code>, then POST inbound messages into the same inbox/RFQ workflow as email.
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 8 }}>
              {[
                ["WHATSAPP_VERIFY_TOKEN", !!process.env.WHATSAPP_VERIFY_TOKEN],
                ["WHATSAPP_APP_SECRET", !!process.env.WHATSAPP_APP_SECRET],
                ["WHATSAPP_ACCESS_TOKEN", !!process.env.WHATSAPP_ACCESS_TOKEN],
                ["WHATSAPP_PHONE_NUMBER_ID", !!process.env.WHATSAPP_PHONE_NUMBER_ID],
              ].map(([key, present]) => (
                <div key={String(key)} style={{
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
                These configured mailboxes are treated as first-class load/RFQ sources. Sync pulls the last year of Gmail threads, keeps each mailbox separated, and labels freight-related mail as <code>load/rfq</code>, <code>load/customer</code>, <code>load/forwarder</code>, or <code>load/note</code>.
              </p>
            </div>
            <SyncDeryaInboxesButton disabled={connectedAllowedSenderEmails.length === 0} />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
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
          <div className="section-title" style={{ marginBottom: 12 }}>Connect a new inbox</div>
          <div style={{ display: "flex", gap: 10 }}>
            {oauthConfigured ? (
              <a
                href="/api/auth/gmail/start"
                className="btn"
                style={{ flex: 1, justifyContent: "center", gap: 10, padding: "12px 16px", textDecoration: "none", display: "inline-flex", alignItems: "center" }}
              >
                <span style={{ width: 20, height: 20, borderRadius: 4, background: "#EA4335", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800 }}>G</span>
                Connect a Gmail inbox
              </a>
            ) : (
              <div style={{ flex: 1, padding: "12px 16px", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 12.5, color: "var(--text-2)" }}>
                Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, and <code>GOOGLE_REDIRECT_URI</code> in your environment to enable Gmail connect. See <a href="/docs/EMAIL_SETUP.md" target="_blank" style={{ color: "var(--brand)" }}>docs/EMAIL_SETUP.md</a>.
              </div>
            )}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 10, marginBottom: 0 }}>
            You can connect as many inboxes as you want — each one gets its own account record. Google will ask you to choose an account in the consent flow; use the targeted Derya inbox rows above for Mert and Oguzhan.
          </p>
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
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: "var(--surface-3)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, color: "var(--text-2)",
                  }}>
                    {account.provider === "GMAIL" ? "G" : account.provider === "OUTLOOK" ? "O" : account.provider === "WHATSAPP" ? "W" : "M"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{account.email}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {account.provider} · {countByAccount[account.id] ?? 0} message{(countByAccount[account.id] ?? 0) === 1 ? "" : "s"} synced · last sync {timeAgo(account.lastSyncAt)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
            Click <em>Connect a Gmail inbox</em> above to authorize. After that, click <em>Sync now</em> to pull the last year of emails.
          </p>
        </div>
      )}

      {/* Paused accounts */}
      {paused.length > 0 && (
        <div className="card-flush" style={{ marginBottom: 20 }}>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
            <div className="section-title">Paused ({paused.length})</div>
            <p style={{ fontSize: 11.5, color: "var(--text-3)", margin: "4px 0 0" }}>
              Sync is stopped and these inboxes&apos; emails are hidden from the Inbox. Nothing was deleted — resume any time.
            </p>
          </div>
          {paused.map((account) => (
            <div key={account.id} style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", opacity: 0.75 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 8,
                    background: "var(--surface-3)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 700, color: "var(--text-2)",
                  }}>
                    {account.provider === "GMAIL" ? "G" : account.provider === "OUTLOOK" ? "O" : account.provider === "WHATSAPP" ? "W" : "M"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{account.email}</div>
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
  );
}
