import { requireSession } from "@/lib/auth";
import { LogoutButton } from "@/components/logout-button";
import { LiveEventToast } from "@/components/live-event-toast";
import { LogoMark } from "@/components/logo-mark";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = session.email.slice(0, 2).toUpperCase();
  const isEmployee = session.role === "EMPLOYEE";

  return (
    <div className="app-shell app-shell-single-surface">
      <section className="content">
        <header className="topbar">
          <div className="topbar-left">
            <a href="/dashboard/supply-os" className="topbar-brand">
              <LogoMark mini />
              <span className="topbar-brand-text">
                <strong>Derya</strong>
              </span>
            </a>
          </div>
          <div className="topbar-right">
            <details className="topbar-menu">
              <summary aria-label="User menu">
                <span className="topbar-avatar">{initials}</span>
              </summary>
              <div className="topbar-menu-panel">
                <LogoutButton />
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
