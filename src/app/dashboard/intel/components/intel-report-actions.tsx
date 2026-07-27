"use client";

import { Icon } from "@/components/icon";
import { useEffect, useRef } from "react";
import styles from "./intel-report.module.css";

export function IntelReportActions() {
  const detailsOpenedForPrint = useRef<HTMLDetailsElement[]>([]);

  useEffect(() => {
    const openReportDetails = () => {
      const report = document.querySelector("[data-intel-report]");
      if (!report || detailsOpenedForPrint.current.length > 0) return;
      detailsOpenedForPrint.current = Array.from(report.querySelectorAll("details:not([open])"));
      for (const details of detailsOpenedForPrint.current) details.open = true;
    };
    const restoreReportDetails = () => {
      for (const details of detailsOpenedForPrint.current) details.open = false;
      detailsOpenedForPrint.current = [];
    };

    window.addEventListener("beforeprint", openReportDetails);
    window.addEventListener("afterprint", restoreReportDetails);
    return () => {
      window.removeEventListener("beforeprint", openReportDetails);
      window.removeEventListener("afterprint", restoreReportDetails);
      restoreReportDetails();
    };
  }, []);

  return (
    <div className={styles.reportActions} aria-label="Report actions">
      <a href="/dashboard/intel/load">
        <Icon name="ship" size={13} />
        Check a China load
      </a>
      <button type="button" onClick={() => window.print()}>
        <Icon name="file" size={13} />
        Print report
      </button>
      <a href="/api/intel/hardware-imports/export" download>
        <Icon name="download" size={13} />
        Download Census snapshot
      </a>
    </div>
  );
}
