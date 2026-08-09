"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icon";
import type { SupplyCaseDashboard } from "@/lib/supply-os-case-model";
import {
  buildSupplyOptimizationModel,
  type SupplyOptimizationWorkspace,
} from "@/lib/supply-os-optimization-engine";
import { loadSupplyCases } from "./supply-os-storage";
import styles from "./supply-os-workstream.module.css";

function companyName(dashboard: SupplyCaseDashboard | null) {
  return dashboard?.companyName ?? "Customer case";
}

export function SupplyOsWorkstreamShell({
  storageScope,
  workstream,
  caseId,
}: {
  storageScope: string;
  workstream: SupplyOptimizationWorkspace;
  caseId?: string;
}) {
  const [dashboard, setDashboard] = useState<SupplyCaseDashboard | null>(null);
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    const stored = loadSupplyCases(storageScope);
    setDashboard(stored.cases.find((item) => item.id === caseId) ?? stored.selected ?? null);
    setStorageReady(true);
  }, [caseId, storageScope]);

  const action = useMemo(() => {
    if (!dashboard) return null;
    return buildSupplyOptimizationModel(dashboard).actions.find((item) => item.workstreamId === workstream.id) ?? null;
  }, [dashboard, workstream.id]);

  return (
    <div className={styles.workspace}>
      <header className={styles.topBar}>
        <Link href="/dashboard/supply-os?present=1" className={styles.backLink}>
          <Icon name="arrow-left" size={14} /> Supply OS
        </Link>
        <span>{companyName(dashboard)}</span>
      </header>

      <main className={styles.main}>
        {!storageReady ? <p className={styles.loading}>Loading customer case...</p> : dashboard && action ? (
          <>
            <header className={styles.header}>
              <div>
                <span>Workstream {String(action.priority).padStart(2, "0")}</span>
                <h1>{workstream.label}</h1>
                <p>{workstream.description}</p>
              </div>
              <div className={styles.status}>
                <span>Setup status</span>
                <strong>Ready for source data</strong>
                <small>No supplier, booking, filing, or spend action is active.</small>
              </div>
            </header>

            <section className={styles.context} aria-labelledby="workstream-context-title">
              <header>
                <span>Customer-specific starting point</span>
                <h2 id="workstream-context-title">{action.title}</h2>
              </header>
              <div>
                <article>
                  <span>Current condition</span>
                  <p>{action.currentCondition}</p>
                </article>
                <article>
                  <span>Recommended change</span>
                  <p>{action.recommendation}</p>
                </article>
                <article>
                  <span>Decision to make</span>
                  <p>{action.decision}</p>
                </article>
                <article>
                  <span>Input required</span>
                  <p>{action.requiredInput}</p>
                </article>
              </div>
            </section>

            <section className={styles.placeholder}>
              <div>
                <span>{workstream.shortLabel}</span>
                <h2>Execution workspace reserved</h2>
                <p>This route is ready for the live records, comparison tools, approvals, and exception handling for this workstream. It is intentionally not filled with sample operational data.</p>
              </div>
              <Link href={`/dashboard/supply-os?present=1`} className={styles.primaryLink}>
                Return to optimization plan <Icon name="arrow-right" size={14} />
              </Link>
            </section>
          </>
        ) : (
          <section className={styles.missing}>
            <h1>Customer case not available</h1>
            <p>Open this workstream from a saved Supply OS dashboard in the same browser.</p>
            <Link href="/dashboard/supply-os">Open customer dashboards</Link>
          </section>
        )}
      </main>
    </div>
  );
}
