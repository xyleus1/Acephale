import { requireSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";
import { LangToggle } from "@/components/lang-toggle";
import { getLang } from "@/lib/i18n";
import { LiveEventToast } from "@/components/live-event-toast";
import { LogoMark } from "@/components/logo-mark";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = session.email.slice(0, 2).toUpperCase();
  const lang = await getLang();
  const isEmployee = session.role === "EMPLOYEE";

  return (
    <div className="app-shell app-shell-single-surface">
      <section className="content">
        <header className="topbar">
          <div className="topbar-left">
            <a href="/dashboard/supply-os" className="topbar-brand">
              <LogoMark mini />
              <span className="topbar-brand-text">
                <strong>Derya</strong> Supply OS
              </span>
            </a>
          </div>
          <div className="topbar-center">
            <span className="topbar-product-label">Products, inventory, sourcing, and execution</span>
          </div>
          <div className="topbar-right">
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
                  <>
                    <a href="/dashboard/customer-portal" className="topbar-menu-item">Customer portal</a>
                    <a href="/dashboard/admin" className="topbar-menu-item">Admin</a>
                  </>
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

      {!isEmployee && <LiveEventToast />}
    </div>
  );
}
