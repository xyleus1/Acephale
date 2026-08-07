import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { SupplyOsDashboardWorkspace } from "./supply-os-dashboard";
import styles from "./supply-os-workspace.module.css";

export const metadata: Metadata = {
  title: "Supply OS",
  description: "Open saved customer supply chain dashboards.",
};

export default async function SupplyOsPage({
  searchParams,
}: {
  searchParams: Promise<{ present?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  return (
    <div className={styles.pageFrame}>
      <SupplyOsDashboardWorkspace
        storageScope={`${session.officeId}:${session.userId}`}
        presentationMode={params.present === "1"}
      />
    </div>
  );
}
