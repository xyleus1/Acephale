import { ExternalLink } from "lucide-react";
import styles from "./integrations/integrations-settings.module.css";

// "email" has no nav entry: the mailbox setup page is only reached from Gmail
// reconnect links.
export type SettingsSection = "customers" | "integrations" | "connected-emails" | "log" | "email";

export function SettingsHeader({
  active,
  isAdmin,
  canReadMailLog,
}: {
  active: SettingsSection;
  isAdmin: boolean;
  // Managers read the mail log without seeing the admin only sections, so this
  // capability is passed separately on every page a manager can reach.
  canReadMailLog: boolean;
}) {
  const action = active === "integrations"
    ? { href: "/integrations", label: "Client page" }
    : active === "customers"
      ? { href: "/portal", label: "Customer sign-in" }
      : null;

  return (
    <>
      <header className={styles.pageHeader}>
        <a href="/dashboard/supply-os">Back to workspace</a>
        <div>
          <h1>Settings</h1>
          {action ? (
            <a href={action.href} target="_blank" rel="noreferrer">
              {action.label} <ExternalLink size={14} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </header>

      <nav className={styles.settingsNav} aria-label="Settings sections">
        {isAdmin ? (
          <a href="/dashboard/settings/customers" aria-current={active === "customers" ? "page" : undefined}>
            Customers
          </a>
        ) : null}
        <a href="/dashboard/settings/integrations" aria-current={active === "integrations" ? "page" : undefined}>
          Integrations
        </a>
        {isAdmin ? (
          <a href="/dashboard/settings/connected-emails" aria-current={active === "connected-emails" ? "page" : undefined}>
            Connected emails
          </a>
        ) : null}
        {canReadMailLog ? (
          <a href="/dashboard/settings/log" aria-current={active === "log" ? "page" : undefined}>
            Log
          </a>
        ) : null}
      </nav>
    </>
  );
}
