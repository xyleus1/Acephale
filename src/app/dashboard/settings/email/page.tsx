import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Icon } from "@/components/icon";
import { SyncAccountButton } from "@/components/sync-account-button";
import { DisconnectAccountButton } from "@/components/disconnect-account-button";
import { ResumeAccountButton } from "@/components/resume-account-button";

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
  const countByAccount = Object.fromEntries(messageCounts.map((c) => [c.accountId, c._count]));

  const active = accounts.filter((a) => a.isActive);
  const paused = accounts.filter((a) => !a.isActive);
  const oauthConfigured = !!process.env.GOOGLE_CLIENT_ID;
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
          <h1 className="page-title">Email Accounts</h1>
          <p className="page-subtitle">
            Connect inboxes. Inbound messages get classified and attached to the right job automatically.
          </p>
        </div>
      </div>

      {/* Status banners */}
      {sp.oauth_success && (
        <div style={{
          padding: "12px 16px", marginBottom: 16, borderRadius: "var(--radius)",
          background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "3px solid var(--brand)",
          fontSize: 13, color: "var(--text)",
        }}>
          Connected <strong>{sp.oauth_success}</strong>. Click <em>Sync now</em> below to fetch the last 7 days.
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
              { step: "01", title: "Connect inbox", desc: "Authorize Gmail with read-only access. We never send without you." },
              { step: "02", title: "AI classifies", desc: "Each new email is classified as RFQ, carrier reply, customer reply, or other." },
              { step: "03", title: "Auto-attached", desc: "RFQs become Inquiries, carrier rates update CarrierQuote, replies append to threads." },
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

      {/* Connect button(s) */}
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
            You can connect as many inboxes as you want — each one gets its own account record. Each authorization screen will ask for the same Gmail account; switch Google accounts in the consent flow if you want a different one.
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
                    {account.provider === "GMAIL" ? "G" : account.provider === "OUTLOOK" ? "O" : "M"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{account.email}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {account.provider} · {countByAccount[account.id] ?? 0} message{(countByAccount[account.id] ?? 0) === 1 ? "" : "s"} synced · last sync {timeAgo(account.lastSyncAt)}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <SyncAccountButton accountId={account.id} />
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
            Click <em>Connect a Gmail inbox</em> above to authorize. After that, click <em>Sync now</em> to pull the last 7 days of emails.
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
                    {account.provider === "GMAIL" ? "G" : account.provider === "OUTLOOK" ? "O" : "M"}
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
