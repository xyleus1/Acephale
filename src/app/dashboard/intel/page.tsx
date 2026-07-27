import { Suspense } from "react";
import { LoadCheckPanel } from "./components/load-check-panel";
import { OceanHardwareReportData } from "./components/ocean-hardware-report-data";
import { OceanHardwareReportSkeleton } from "./components/ocean-hardware-report";
import { requireSession } from "@/lib/auth";
import styles from "./components/intel-report.module.css";

export default async function IntelPage() {
  await requireSession();

  return (
    <div className={styles.intelPage}>
      <Suspense fallback={<OceanHardwareReportSkeleton />}>
        <OceanHardwareReportData />
      </Suspense>

      <section className={styles.secondaryTools} aria-labelledby="intel-tools-title">
        <div className={styles.secondaryToolsIntro}>
          <div>
            <span>Separate workflow</span>
            <h2 id="intel-tools-title">Shipment tools</h2>
          </div>
          <p>
            Use these after research has identified a real shipment. They do
            not answer market questions or promise customs clearance.
          </p>
        </div>
        <details className={styles.toolDisclosure}>
          <summary>
            <span>
              <strong>Domestic trucking pre-flight</strong> Check a U.S.
              trucking leg for operational and carrier risk. This does not
              assess ocean customs.
            </span>
            <span>Open tool</span>
          </summary>
          <div className={styles.toolBody}>
            <LoadCheckPanel />
          </div>
        </details>
      </section>
    </div>
  );
}
