import { Suspense } from "react";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LogoutButton } from "@/components/logout-button";
import { NavLink } from "@/components/nav-link";
import { LangToggle } from "@/components/lang-toggle";
import { getLang } from "@/lib/i18n";
import { AgentChatWidget } from "@/components/agent-chat-widget";
import { CommandPalette } from "@/components/command-palette";
import { LiveEventToast } from "@/components/live-event-toast";
import { Icon } from "@/components/icon";
import { LogoMark } from "@/components/logo-mark";
import { openInquiryStatusFilter } from "@/lib/inquiry-status";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = session.email.slice(0, 2).toUpperCase();
  const lang = await getLang();
  // Loadboard-only accounts: nav shows just the loads surfaces, and the
  // RFQ/WhatsApp/agent chrome stays hidden. Route access is enforced in
  // src/middleware.ts; this only shapes what renders.
  const isEmployee = session.role === "EMPLOYEE";
  const homeHref = isEmployee ? "/dashboard/loads" : "/dashboard";

  // Live pipeline status for the topbar
  const now = new Date();
  const [activeJobs, pendingRFQs, waCandidateThreads] = await Promise.all([
    prisma.job.count({
      where: { officeId: session.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
    }),
    isEmployee ? 0 : prisma.inquiry.count({
      // Matches the default "Open" tab on /dashboard/rfq, where the topbar chip lands.
      where: { officeId: session.officeId, status: openInquiryStatusFilter() },
    }),
    // WhatsApp threads awaiting a reply (same heuristic as the inbox's
    // "Awaiting reply" chip: latest message is inbound).
    isEmployee ? [] : prisma.emailThread.findMany({
      where: {
        officeId: session.officeId,
        hiddenAt: null,
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
        messages: { some: { account: { isActive: true, provider: "WHATSAPP" } } },
      },
      select: { messages: { orderBy: { sentAt: "desc" }, take: 1, select: { direction: true } } },
      // Newest-first + same cap as the inbox's own Awaiting-reply heuristic,
      // so the chip and the click-through count agree.
      orderBy: { lastMessageAt: "desc" },
      take: 500,
    }),
  ]);
  const waAwaitingReply = waCandidateThreads.filter((t) => t.messages[0]?.direction === "INBOUND").length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="brand">
            <LogoMark />
            <div>
              <div className="brand-name">Derya</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {isEmployee ? (
            <>
              <div className="nav-section-label with-rule">Loadboard</div>

              <NavLink href="/dashboard/loads" icon={<Icon name="truck" />}>Loads</NavLink>

              <NavLink href="/dashboard/jobs" icon={<Icon name="box" />}>Pipeline</NavLink>
            </>
          ) : (
            <>
              <div className="nav-section-label with-rule">Commercial Workflow</div>

              <NavLink href="/dashboard" icon={<Icon name="grid" />}>Deal Desk</NavLink>

              <NavLink href="/dashboard/rfq" icon={<Icon name="mail-in" />}>Incoming RFQs</NavLink>

              <NavLink href="/dashboard/loads" icon={<Icon name="truck" />}>Loads</NavLink>

              <NavLink href="/dashboard/crm" icon={<Icon name="building" />}>CRM</NavLink>

              <NavLink href="/dashboard/outreach" icon={<Icon name="activity" />}>Outreach</NavLink>

              <NavLink href="/dashboard/intel" icon={<Icon name="trending-up" />}>Intel</NavLink>

              <NavLink href="/dashboard/supply-os" icon={<Icon name="layers" />}>Supply OS</NavLink>

              <NavLink href="/dashboard/supplier-finder" icon={<Icon name="search" />}>Supplier Finder</NavLink>

              {/* Archived from the nav: /dashboard/pricing, /dashboard/domestic-pricing, /dashboard/intelligence
                  and /dashboard/carriers stay reachable directly (the carrier bench is linked from the
                  Intelligence pre-flight results). */}

              {/* ─── SETUP ───────────────────────────────────────────────────── */}
              <div className="nav-section-label with-rule">Setup</div>

              <NavLink href="/dashboard/settings/email" icon={<Icon name="settings" />}>Channels</NavLink>

              <NavLink href="/dashboard/brain" icon={<Icon name="sparkles" />}>Company Brain</NavLink>

              {(session.role === "ADMIN" || session.role === "MANAGER") && (
                <>
                  <NavLink href="/dashboard/customer-portal" icon={<Icon name="external" />}>Customer Portal</NavLink>
                  <NavLink href="/dashboard/admin" icon={<Icon name="shield" />}>Admin</NavLink>
                </>
              )}

              <NavLink href="/dashboard/inbox" icon={<Icon name="mail" />}>Inbox</NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-block">
            <div className="user-avatar">{initials}</div>
            <div className="user-info">
              <div className="user-name">{session.email.split("@")[0]}</div>
              <div className="user-role capitalized">{session.role.toLowerCase()}</div>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <LogoutButton />
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="topbar-left">
            <a href={homeHref} className="topbar-brand">
              <LogoMark mini />
              <span className="topbar-brand-text">
                <strong>Derya</strong>
              </span>
            </a>
          </div>
          <div className="topbar-center">
            {!isEmployee && <CommandPalette />}
          </div>
          <div className="topbar-right">
            <a href="/dashboard/loads" className="topbar-stat" title="Active jobs">
              <strong>{activeJobs}</strong> active
            </a>
            {pendingRFQs > 0 && (
              <a href="/dashboard/rfq" className="topbar-stat topbar-stat-brand" title="Open RFQs">
                <strong>{pendingRFQs}</strong> RFQs
              </a>
            )}
            {waAwaitingReply > 0 && (
              <a
                href="/dashboard/inbox?channel=whatsapp&filter=_NEEDS_REPLY"
                className="topbar-stat topbar-stat-wa"
                title="WhatsApp conversations awaiting a reply"
              >
                <strong>{waAwaitingReply}</strong> WhatsApp
              </a>
            )}
            <span className="topbar-divider" />
            <details className="topbar-menu">
              <summary aria-label="User menu">
                <span className="topbar-avatar">{initials}</span>
              </summary>
              <div className="topbar-menu-panel">
                <div className="topbar-menu-header">
                  <div className="topbar-menu-user">{session.email.split("@")[0]}</div>
                  <div className="topbar-menu-email">{session.email}</div>
                </div>
                {!isEmployee && (
                  <a href="/dashboard/settings/email" className="topbar-menu-item">Email &amp; WhatsApp</a>
                )}
                {(session.role === "ADMIN" || session.role === "MANAGER") && (
                  <a href="/dashboard/admin" className="topbar-menu-item">Admin</a>
                )}
                <div className="topbar-menu-divider" />
                <div className="topbar-menu-row">
                  <span className="topbar-menu-label">Language</span>
                  <LangToggle current={lang} />
                </div>
                <div className="topbar-menu-divider" />
                <div className="topbar-menu-item topbar-menu-logout">
                  <LogoutButton />
                </div>
              </div>
            </details>
          </div>
        </header>

        <div className="page-container">
          {children}
        </div>
      </section>

      {/* Suspense: the widget reads useSearchParams to stay hidden only on the brain chat view. */}
      {!isEmployee && (
        <Suspense fallback={null}>
          <AgentChatWidget />
        </Suspense>
      )}
      {!isEmployee && <LiveEventToast />}
    </div>
  );
}
