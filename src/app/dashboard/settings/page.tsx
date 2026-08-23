import type { Route } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import styles from "./integrations/integrations-settings.module.css";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const session = await requireSession();
  const query = await searchParams;
  if (session.accessKind === "customer" || query.preview === "customer") {
    return (
      <main className={styles.page}>
        <header className={styles.pageHeader}>
          <a href="/dashboard/supply-os">Back to workspace</a>
          <div><h1>Settings</h1></div>
        </header>
      </main>
    );
  }
  redirect((session.role === "ADMIN"
    ? "/dashboard/settings/customers"
    : "/dashboard/settings/integrations") as Route);
}
