"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { useSupplyOsHeaderSlot } from "./supply-os-header-slot";
import styles from "./supply-os-operating-shell.module.css";
import { AppSelect } from "@/components/app-select";

type ProjectStatusRow = {
  kind: "sourcing" | "prospecting";
  key: string;
  name: string;
  typeLabel: "Sourcing" | "Prospecting";
  active: boolean;
};

type ProjectSelection = { kind: "sourcing" | "prospecting"; key: string } | null;

type ProjectStatusFacts = {
  kind: "sourcing" | "prospecting";
  key: string;
  leads: number;
  mailsSent: number;
  replies: number;
  activeThreads: number;
  succeeded: number;
  successLabel: string;
  goal: number | null;
  escalations: number;
};

export function ProjectStatusStrip({
  projectRows,
  selectedProject,
  onProjectChange,
}: {
  projectRows: ProjectStatusRow[];
  selectedProject: ProjectSelection;
  onProjectChange: (project: ProjectSelection) => void;
}) {
  const headerSlot = useSupplyOsHeaderSlot();
  const activeRows = useMemo(() => projectRows.filter((project) => project.active), [projectRows]);
  const project = selectedProject
    ? projectRows.find((row) => row.kind === selectedProject.kind && row.key === selectedProject.key)
    : activeRows[0];
  const selectedProjectRow = selectedProject
    ? projectRows.find((row) => row.kind === selectedProject.kind && row.key === selectedProject.key)
    : null;
  const availableRows = selectedProjectRow && !activeRows.some((row) => (
    row.kind === selectedProjectRow.kind && row.key === selectedProjectRow.key
  ))
    ? [selectedProjectRow, ...activeRows]
    : activeRows;
  const selectedProjectValue = selectedProject
    ? `${selectedProject.kind}:${selectedProject.key}`
    : "";
  const selectedProjectIsAvailable = availableRows.some((row) => (
    `${row.kind}:${row.key}` === selectedProjectValue
  ));
  const projectKind = project?.kind;
  const projectKey = project?.key;
  const [facts, setFacts] = useState<ProjectStatusFacts | null>(null);
  const [factsState, setFactsState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    if (!projectKind || !projectKey) {
      setFacts(null);
      setFactsState("loading");
      return;
    }
    const controller = new AbortController();
    setFacts(null);
    setFactsState("loading");
    const load = async () => {
      const params = new URLSearchParams({ kind: projectKind, key: projectKey });
      const response = await fetch(`/api/supply-os/project-status?${params}`, {
        cache: "no-store",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error("Project status unavailable.");
      return await response.json() as ProjectStatusFacts;
    };
    let generation = 0;
    const run = () => {
      const current = ++generation;
      void load()
        .then((nextFacts) => {
          if (current !== generation) return;
          setFacts(nextFacts);
          setFactsState("ready");
        })
        .catch((error: unknown) => {
          if (current !== generation) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          setFacts(null);
          setFactsState("unavailable");
        });
    };
    run();
    const timer = window.setInterval(() => {
      run();
    }, 60_000);
    return () => {
      generation += 1;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [projectKey, projectKind]);

  if (!project || (!activeRows.length && !selectedProject)) return null;
  const content = (
    <section className={styles.headerProjectStatus} aria-label="Project status">
      <div className={styles.headerProjectSwitcher}>
        {!selectedProjectIsAvailable ? <span className={styles.headerProjectName}>{project.name}</span> : null}
        <AppSelect
          className={styles.headerProjectSelect}
          ariaLabel="Active project"
          value={selectedProjectIsAvailable ? selectedProjectValue : ""}
          options={[
            ...(!selectedProjectIsAvailable ? [{ value: "", label: "Select active project" }] : []),
            ...availableRows.map((row) => ({ value: `${row.kind}:${row.key}`, label: row.name })),
          ]}
          onChange={(nextValue) => {
            const [kind, ...rest] = nextValue.split(":");
            const key = rest.join(":");
            if ((kind === "sourcing" || kind === "prospecting") && key) onProjectChange({ kind, key });
          }}
          size="sm"
        />
        <span className={styles.headerProjectKind}>{project.typeLabel}</span>
      </div>
      {facts ? (
        <dl className={styles.headerProjectFacts}>
          <div>
            <dt>Leads</dt>
            <dd>{facts.leads}</dd>
          </div>
          <div>
            <dt>Mails sent</dt>
            <dd>{facts.mailsSent}</dd>
          </div>
          <div>
            <dt>Replies</dt>
            <dd>{facts.replies}</dd>
          </div>
          <div>
            <dt>Active threads</dt>
            <dd>{facts.activeThreads}</dd>
          </div>
          <div>
            <dt>{facts.successLabel.slice(0, 1).toUpperCase() + facts.successLabel.slice(1)}</dt>
            <dd className={styles.headerProjectSuccess}>
              {facts.succeeded}{facts.goal === null ? "" : ` / ${facts.goal}`}
            </dd>
          </div>
          {facts.escalations > 0 ? (
            <div>
              <dt>Needs you</dt>
              <dd className={styles.headerProjectEscalation}>{facts.escalations}</dd>
            </div>
          ) : null}
        </dl>
      ) : (
        <span className={styles.headerProjectLoading}>
          {factsState === "unavailable" ? "No status yet" : "Loading"}
        </span>
      )}
    </section>
  );
  return headerSlot ? createPortal(content, headerSlot) : content;
}
