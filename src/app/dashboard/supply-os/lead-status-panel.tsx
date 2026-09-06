"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sankey,
  Tooltip as ChartTooltip,
  type SankeyLinkProps,
  type SankeyNodeProps,
} from "recharts";
import type { LeadPipelineReport } from "@/lib/research-pipeline";
import type { ResearchRecordStage } from "@/lib/research-record-stages";
import styles from "./supply-os-logistics.module.css";

const flowColors = { muted: "#8b9690", navy: "#29485c", success: "#3f6c55", warm: "#a76b45" };
const stageColors = ["#29485c", "#29485c", "#3f6c55", "#3f6c55", "#a76b45", "#a76b45", "#a76b45"];

function LeadFlowNode({ x, y, width, height, payload }: SankeyNodeProps) {
  const terminal = payload.sourceLinks.length === 0;
  const labelX = terminal ? x - 6 : x + width + 6;
  const anchor: "end" | "start" = terminal ? "end" : "start";
  const count = typeof payload.value === "number" ? payload.value : 0;
  const fill = payload.depth === 0 ? flowColors.navy : flowColors.muted;
  const labelProps = {
    paintOrder: "stroke",
    stroke: "#ffffff",
    strokeWidth: 3,
    strokeLinejoin: "round" as const,
    textAnchor: anchor,
  };
  return <g><rect x={x} y={y} width={width} height={height} fill={fill} rx={2} /><text x={labelX} y={y + height / 2 - 2} fill="#1b1d1c" fontSize={11} {...labelProps}>{payload.name}</text><text x={labelX} y={y + height / 2 + 12} fill="#747c78" fontSize={10} {...labelProps}>{count.toLocaleString()}</text></g>;
}

function LeadFlowLink({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }: SankeyLinkProps) {
  const target = payload.target.name;
  const stroke = target === "Screened target" ? flowColors.success : ["Not a target", "No email", "Not sent", "No reply"].includes(target) ? flowColors.muted : ["Replied", "Positive", "Other reply"].includes(target) ? flowColors.warm : flowColors.navy;
  return <path d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`} fill="none" stroke={stroke} strokeOpacity={0.14} strokeWidth={Math.max(1, linkWidth)} />;
}

function timeAgo(value: string | null) {
  if (!value) return "not yet";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} hr ago`;
}

function stageFilter(key: string): ResearchRecordStage | "all" | null {
  if (key === "found") return "all";
  if (key === "target") return "target";
  if (key === "enriched") return "enriched";
  return null;
}

function operationLabel(kind: string) {
  return ({ pause: "Pause research", resume: "Resume research", purge: "Purge rows", requalify: "Screen rows", enrich: "Find contacts" } as Record<string, string>)[kind] ?? kind;
}

export function LeadStatusPanel({
  projectId,
  listSlug,
  workspaceId,
  onStageSelect,
  onReportChange,
}: {
  projectId: string | null;
  listSlug?: string | null;
  workspaceId?: string;
  onStageSelect(stage: ResearchRecordStage | null): void;
  onReportChange(report: LeadPipelineReport | null): void;
}) {
  const [report, setReport] = useState<LeadPipelineReport | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<ResearchRecordStage | "all">("all");
  const requestIdRef = useRef(0);
  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => current === "ready" ? current : "loading");
    const params = new URLSearchParams({ projectId: projectId ?? "other" });
    if (listSlug) params.set("listSlug", listSlug);
    if (workspaceId) params.set("workspaceId", workspaceId);
    try {
      const response = await fetch(`/api/research/pipeline?${params}`, { cache: "no-store", headers: { accept: "application/json" } });
      const body = await response.json().catch(() => ({})) as LeadPipelineReport & { error?: string };
      if (!response.ok) throw new Error(body.error || "Lead status unavailable.");
      if (requestId !== requestIdRef.current) return;
      setReport(body);
      onReportChange(body);
      setState("ready");
      setError("");
    } catch (loadError) {
      if (requestId !== requestIdRef.current) return;
      setState("error");
      setError(loadError instanceof Error ? loadError.message : "Lead status unavailable.");
    }
  }, [listSlug, onReportChange, projectId, workspaceId]);
  useEffect(() => {
    void load();
    return () => { requestIdRef.current += 1; };
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), report && (report.live.activeJobs > 0 || report.live.pendingOperations > 0) ? 30_000 : 120_000);
    return () => window.clearInterval(timer);
  }, [load, report]);

  async function createOperation(kind: "pause" | "resume" | "purge" | "requalify" | "enrich") {
    if (!workspaceId || projectId === null) return;
    setBusyKind(kind);
    try {
      const response = await fetch(`/api/supply-os/workspaces/${encodeURIComponent(workspaceId)}/context/research-ops`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, projectId, listSlug }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Operation could not be created.");
      await load();
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "Operation could not be created.");
    } finally { setBusyKind(null); }
  }

  async function decideOperation(actionId: string, decision: "run" | "dismiss") {
    if (!workspaceId) return;
    setBusyKind(actionId);
    try {
      const response = await fetch(`/api/supply-os/workspaces/${encodeURIComponent(workspaceId)}/context/research-ops/${encodeURIComponent(actionId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Operation could not be updated.");
      await load();
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "Operation could not be updated.");
    } finally { setBusyKind(null); }
  }

  const chartData = useMemo(() => report ? { nodes: report.sankey.nodes, links: report.sankey.links } : { nodes: [], links: [] }, [report]);
  const countryData = useMemo(() => report?.countries ?? [], [report]);
  const countryColors = ["#29485c", "#3f6c55", "#a76b45", "#8b9690", "#c7ceca", "#5f7a8c"];
  const totalPurgeable = report ? Object.values(report.actions.purgeable).reduce((sum, value) => sum + value, 0) : 0;
  const emptyActive = Boolean(report && report.funnel.found === 0 && report.live.activeJobs > 0);
  const researchIdle = Boolean(report && report.live.activeJobs === 0 && report.live.pausedJobs === 0);
  const cleanupLine = report?.live.cleanup ? (() => {
    const removed = [
      report.live.cleanup.deletedDuplicates ? `${report.live.cleanup.deletedDuplicates.toLocaleString()} duplicates` : "",
      report.live.cleanup.deletedNonCompanies ? `${report.live.cleanup.deletedNonCompanies.toLocaleString()} non-companies` : "",
    ].filter(Boolean).join(" and ");
    return [
      removed ? `removed ${removed}` : "",
      report.live.cleanup.screened ? `screened ${report.live.cleanup.screened.toLocaleString()}` : "",
      report.live.cleanup.enriched ? `found contacts for ${report.live.cleanup.enriched.toLocaleString()}` : "",
    ].filter(Boolean).join(", ");
  })() : "";
  const liveLines = report ? [
    report.live.activeJobs > 0
      ? <>Research running: <b>{report.funnel.found.toLocaleString()}</b> of <b>{report.live.target?.toLocaleString() ?? report.funnel.found.toLocaleString()}</b> rows, last batch <b>{timeAgo(report.live.lastBatchAt)}</b></>
      : report.live.pausedJobs > 0 ? <>Paused: <b>{report.live.pausedJobs}</b> jobs</> : null,
    !emptyActive && report.live.rejectedBeforePersist > 0 ? <>{report.live.rejectedBeforePersist.toLocaleString()} candidates screened out before the list</> : null,
    !emptyActive && report.live.pendingOperations > 0 ? <>{report.live.pendingOperations} operation{report.live.pendingOperations === 1 ? "" : "s"} waiting for approval</> : null,
    cleanupLine ? <>Cleanup {cleanupLine}.</> : null,
  ].filter((line) => line !== null) : [];

  return <section className={styles.leadStatusPanel} aria-label="Lead status">
    {state === "error" ? <p className={styles.prospectsError}>{error}</p> : null}
    {!report && state === "loading" ? <p className={styles.leadStatusEmpty}>Loading</p> : null}
    {report ? <>
      <div className={`${styles.leadStageBar}${emptyActive ? ` ${styles.leadStageShimmer}` : ""}`} aria-label="Lead stages">{report.stages.map((stage, index) => <div key={stage.key} className={styles.leadStageSegment} style={{ width: `${report.funnel.found ? Math.max(1, stage.count / report.funnel.found * 100) : 0}%`, background: stageColors[index] }}><span className={styles.srOnly}>{stage.label} {stage.count}</span></div>)}</div>
      <div className={styles.leadStageRow}>
        <div className={styles.leadStageLabels}>
          {report.stages.map((stage) => {
            const filter = stageFilter(stage.key);
            if (filter === null) {
              return (
                <span key={stage.key}>
                  <b>{stage.count.toLocaleString()}</b>
                  {stage.label}
                </span>
              );
            }
            return (
              <button
                key={stage.key}
                type="button"
                data-selected={selectedStage === filter}
                onClick={() => {
                  setSelectedStage(filter);
                  onStageSelect(filter === "all" ? null : filter);
                }}
              >
                <b>{stage.count.toLocaleString()}</b>
                {stage.label}
              </button>
            );
          })}
          <button
            type="button"
            data-selected={selectedStage === "unscreened"}
            onClick={() => {
              setSelectedStage("unscreened");
              onStageSelect("unscreened");
            }}
          >
            <b>{report.funnel.unscreened.toLocaleString()}</b>
            Unscreened
          </button>
        </div>
        <div className={styles.leadStageMeta}>
          {researchIdle ? <span>No active research</span> : null}
          <button type="button" className={styles.leadRefresh} onClick={() => void load()} disabled={state === "loading"}>Refresh</button>
        </div>
      </div>
      {liveLines.length ? (
        <div className={styles.leadStatusLiveBlock}>
          {liveLines.map((line, index) => <p key={index} className={styles.leadStatusLive}>{line}</p>)}
        </div>
      ) : null}
      {emptyActive ? <p className={styles.leadStatusEmpty}>No rows yet. Next batch within 5 minutes.</p> : <>
        {projectId !== null ? <div className={styles.leadActionRow}>
          {report.actions.unscreened > 0 ? (
            <button
              type="button"
              disabled={Boolean(busyKind)}
              onClick={() => void createOperation("requalify")}
            >
              Screen {report.actions.unscreened} unscreened
            </button>
          ) : null}
          {report.actions.missingContacts > 0 ? (
            <button
              type="button"
              disabled={Boolean(busyKind)}
              onClick={() => void createOperation("enrich")}
            >
              Find contacts for {report.actions.missingContacts}
            </button>
          ) : null}
          {totalPurgeable > 0 ? (
            <button
              type="button"
              disabled={Boolean(busyKind)}
              onClick={() => void createOperation("purge")}
            >
              Remove {totalPurgeable} duplicates and non-companies
            </button>
          ) : null}
          {report.actions.pausable > 0 ? (
            <button
              type="button"
              disabled={Boolean(busyKind)}
              onClick={() => void createOperation("pause")}
            >
              Pause
            </button>
          ) : null}
          {report.actions.resumable > 0 ? (
            <button
              type="button"
              disabled={Boolean(busyKind)}
              onClick={() => void createOperation("resume")}
            >
              Resume
            </button>
          ) : null}
        </div> : null}
        {report.operations.length ? (
          <div className={styles.leadOperations}>
            {report.operations.map((operation) => {
              const previewLine = operation.kind === "purge"
                ? operation.preview.find((line) => line.toLowerCase().includes("delete"))
                  ?? "Deletes rows. Cannot be undone."
                : operation.preview[0] ?? operation.note;
              const extraPreview = operation.preview.filter((line) => line !== previewLine);
              const showDecisionControls = operation.status !== "RUNNING" || operation.stale;
              return (
                <article key={operation.id} className={styles.leadOperation}>
                  <div className={styles.leadOperationMain}>
                    <div>
                      <b>{operationLabel(operation.kind)}</b>
                      <small>{previewLine}</small>
                      {operation.status === "FAILED" && operation.lastError ? <small>{operation.lastError}</small> : null}
                      {extraPreview.length ? (
                        <details>
                          <summary>Details</summary>
                          <ul>
                            {extraPreview.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                      <i>{operation.status.toLowerCase()}</i>
                    </div>
                    {showDecisionControls ? (
                      <div className={styles.leadOperationActions}>
                        <button
                          type="button"
                          disabled={Boolean(busyKind)}
                          onClick={() => void decideOperation(operation.id, "run")}
                        >
                          Run
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(busyKind)}
                          onClick={() => void decideOperation(operation.id, "dismiss")}
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
        <div className={styles.leadCharts}>
          <section className={styles.leadFlowChart}>
            <span className={styles.leadChartLabel}>Lead flow by origin</span>
            {report.funnel.found >= 2 && chartData.nodes.length && chartData.links.length ? (
              <div className={styles.leadSankey}>
                <ResponsiveContainer width="100%" height={180}>
                  <Sankey data={chartData} nodePadding={10} nodeWidth={6} margin={{ top: 6, right: 96, bottom: 6, left: 96 }} link={LeadFlowLink} node={LeadFlowNode}>
                    <ChartTooltip />
                  </Sankey>
                </ResponsiveContainer>
              </div>
            ) : <p className={styles.leadStatusEmpty}>Not enough rows for a flow chart yet</p>}
          </section>
          <section className={styles.leadCountryChart}>
            <span className={styles.leadChartLabel}>Rows by country</span>
            {report.funnel.found >= 2 ? (
              <div className={styles.leadCountryChartBody}>
                <ResponsiveContainer width={124} height={124}>
                  <PieChart>
                    <Pie data={countryData} dataKey="rows" nameKey="label" innerRadius={36} outerRadius={56} paddingAngle={1}>
                      {countryData.map((country, index) => <Cell key={country.label} fill={countryColors[index % countryColors.length]} />)}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <ul>
                  {countryData.map((country, index) => (
                    <li key={country.label}>
                      <i style={{ background: countryColors[index % countryColors.length] }} />
                      <span>{country.label}</span>
                      <b>{country.rows.toLocaleString()}</b>
                    </li>
                  ))}
                </ul>
              </div>
            ) : <p className={styles.leadStatusEmpty}>Not enough rows for a flow chart yet</p>}
          </section>
        </div>
      </>}
    </> : null}
  </section>;
}
