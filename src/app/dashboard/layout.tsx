import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LogoutButton } from "@/components/logout-button";
import { NavLink } from "@/components/nav-link";
import { LangToggle } from "@/components/lang-toggle";
import { getLang } from "@/lib/i18n";
import { getFocusedJob, clearFocusAction } from "@/lib/job-focus";
import { AgentChatWidget } from "@/components/agent-chat-widget";
import { CommandPalette } from "@/components/command-palette";
import { LiveEventToast } from "@/components/live-event-toast";
import { Icon } from "@/components/icon";
import { LogoMark } from "@/components/logo-mark";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = session.email.slice(0, 2).toUpperCase();
  const lang = await getLang();

  // Live pipeline status for the topbar
  const [activeJobs, pendingRFQs, focusedJob] = await Promise.all([
    prisma.job.count({
      where: { officeId: session.officeId, status: { notIn: ["DELIVERED", "CANCELLED"] } },
    }),
    prisma.inquiry.count({
      where: { officeId: session.officeId, status: { in: ["INGESTED", "PARSED", "PRICED"] } },
    }),
    getFocusedJob(session.officeId),
  ]);

  const STATUS_META: Record<string, { label: string; className: string }> = {
    INQUIRY:    { label: "RFQ",       className: "status-inquiry" },
    QUOTED:     { label: "Pricing",   className: "status-quoted" },
    BOOKED:     { label: "Booked",    className: "status-booked" },
    IN_TRANSIT: { label: "En Route",  className: "status-in-transit" },
    CUSTOMS:    { label: "En Route",  className: "status-in-transit" },
    DELIVERED:  { label: "Delivered", className: "status-delivered" },
    CANCELLED:  { label: "Cancelled", className: "status-cancelled" },
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="brand">
            <LogoMark />
            <div>
              <div className="brand-name">Derya</div>
              <div className="brand-sub">Deal Desk</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label with-rule">Commercial Workflow</div>

          <NavLink href="/dashboard/inbox" icon={<Icon name="mail" />}>Inbox</NavLink>

          <NavLink href="/dashboard" icon={<Icon name="grid" />}>Deal Desk</NavLink>

          <NavLink href="/dashboard/pricing" icon={<Icon name="dollar" />}>Pricing</NavLink>

          <NavLink href="/dashboard/domestic-pricing" icon={<Icon name="truck" />}>Domestic Rates</NavLink>

          <NavLink href="/dashboard/intelligence" icon={<Icon name="activity" />}>Intelligence</NavLink>

          <NavLink href="/dashboard/crm" icon={<Icon name="building" />}>Relationships</NavLink>

          {/* ─── SETUP ───────────────────────────────────────────────────── */}
          <div className="nav-section-label with-rule">Setup</div>

          <NavLink href="/dashboard/settings/email" icon={<Icon name="settings" />}>Email</NavLink>

          {(session.role === "ADMIN" || session.role === "MANAGER") && (
            <NavLink href="/dashboard/admin" icon={<Icon name="shield" />}>Admin</NavLink>
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
            <a href="/dashboard" className="topbar-brand">
              <LogoMark mini />
              <span className="topbar-brand-text">
                <strong>Derya Deal Desk</strong>
                <em>Freight Control Tower</em>
              </span>
            </a>
          </div>
          <div className="topbar-center">
            <CommandPalette />
          </div>
          <div className="topbar-right">
            <a href="/dashboard/jobs" className="topbar-stat" title="Active jobs">
              <strong>{activeJobs}</strong> active
            </a>
            {pendingRFQs > 0 && (
              <a href="/dashboard/inbox?view=rfqs" className="topbar-stat topbar-stat-brand" title="RFQs awaiting action">
                <strong>{pendingRFQs}</strong> RFQs
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
                <a href="/dashboard/settings/email" className="topbar-menu-item">Email accounts</a>
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

        {/* Focused-job context strip — travels across pages */}
        {focusedJob && (() => {
          const meta = STATUS_META[focusedJob.status] ?? STATUS_META.INQUIRY;
          const route = focusedJob.origin && focusedJob.destination
            ? `${focusedJob.origin} → ${focusedJob.destination}`
            : focusedJob.origin ?? focusedJob.destination ?? "Route TBD";
          return (
            <div className="job-focus-strip">
              <div className="job-focus-strip-inner">
                <span className="job-focus-icon" aria-hidden>
                  <Icon name="truck" size={14} strokeWidth={2} />
                </span>
                <span className="job-focus-label">FOCUSED</span>
                <a href={`/dashboard/jobs/${focusedJob.id}`} className="job-focus-ref">
                  {focusedJob.reference}
                </a>
                <span className="job-focus-sep">·</span>
                <span className="job-focus-customer">{focusedJob.customerName ?? "No customer"}</span>
                <span className="job-focus-sep">·</span>
                <span className="job-focus-route">{route}</span>
                {focusedJob.mode && (
                  <>
                    <span className="job-focus-sep">·</span>
                    <span className="job-focus-mode">{focusedJob.mode}</span>
                  </>
                )}
                <span className={["job-focus-status", meta.className].join(" ")}>
                  {meta.label}
                </span>

                <div className="job-focus-actions">
                  <a href={`/dashboard/jobs/${focusedJob.id}`} className="job-focus-link">
                    Open
                  </a>
                  {focusedJob.customerId && (
                    <a href={`/dashboard/customers/${focusedJob.customerId}`} className="job-focus-link">
                      Customer
                    </a>
                  )}
                  {focusedJob.inquiryId && (
                    <a href={`/dashboard/rfq/${focusedJob.inquiryId}`} className="job-focus-link">
                      Source RFQ
                    </a>
                  )}
                  <a href={`/api/jobs/${focusedJob.id}/quote-pdf`} target="_blank" className="job-focus-link">
                    Quote PDF
                  </a>
                  <form action={clearFocusAction}>
                    <button type="submit" className="job-focus-clear" aria-label="Clear focus" title="Clear focus">
                      <Icon name="x" size={12} strokeWidth={2.5} />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          );
        })()}

        <div className="page-container">
          {children}
        </div>
      </section>

      <AgentChatWidget />
      <LiveEventToast />
    </div>
  );
}
