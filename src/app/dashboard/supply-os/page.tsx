import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { SupplyOsOperatingShell } from "./supply-os-operating-shell";
import styles from "./supply-os-logistics.module.css";

export const metadata: Metadata = {
  title: { absolute: "Derya" },
  description: "Supply planning workspace.",
};

export default async function SupplyOsPage({
  searchParams,
}: {
  searchParams: Promise<{ present?: string; panel?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  return (
    <div className={styles.pageFrame}>
      <SupplyOsOperatingShell
        storageScope={`${session.officeId}:${session.userId}`}
        presentationMode={params.present === "1"}
        initialPanel={params.panel}
        canCreateCompany={session.role === "ADMIN"}
      />
    </div>
  );
}
