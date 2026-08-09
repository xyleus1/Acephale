import type { Metadata } from "next";
import { Suspense } from "react";
import { requireSession } from "@/lib/auth";
import { SupplyOsDecisionIntelligence } from "./supply-os-decision-intelligence";
import { SupplyOsOperatingShell } from "./supply-os-operating-shell";
import styles from "./supply-os-workspace.module.css";

export const metadata: Metadata = {
  title: "Supply OS",
  description: "Map products, inventory, suppliers, scenarios, logistics, and cost in one operating workspace.",
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
        intelligencePanel={(
          <Suspense fallback={null}>
            <SupplyOsDecisionIntelligence officeId={session.officeId} />
          </Suspense>
        )}
      />
    </div>
  );
}
