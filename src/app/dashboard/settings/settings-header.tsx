import { ExternalLink } from "lucide-react";
import styles from "./integrations/integrations-settings.module.css";

export type SettingsSection = "customers" | "integrations" | "channels";

export function SettingsHeader({
  active,
  isAdmin,
}: {
  active: SettingsSection;
  isAdmin: boolean;
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
        <a href="/dashboard/settings/email" aria-current={active === "channels" ? "page" : undefined}>
          Email accounts
        </a>
      </nav>
    </>
  );
}
