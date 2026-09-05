"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./supply-os-logistics.module.css";

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
  const activeRows = useMemo(() => projectRows.filter((project) => project.active), [projectRows]);
  const project = selectedProject
    ? projectRows.find((row) => row.kind === selectedProject.kind && row.key === selectedProject.key)
    : activeRows[0];
  const selectedProjectValue = selectedProject
    ? `${selectedProject.kind}:${selectedProject.key}`
    : "";
  const selectedProjectIsActive = activeRows.some((row) => (
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
  return (
    <section className={styles.projectStatusStrip} aria-label="Project status">
      <div className={styles.projectStatusIdentity}>
        <strong>{project.name}</strong>
        <span>{project.typeLabel}</span>
      </div>
      {facts ? (
        <div className={styles.projectStatusFacts}>
          <span>Leads {facts.leads}</span>
          <span>Mails sent {facts.mailsSent}</span>
          <span>Replies {facts.replies}</span>
          <span>Active threads {facts.activeThreads}</span>
          <span>{facts.successLabel} {facts.succeeded}{facts.goal === null ? "" : ` / ${facts.goal}`}</span>
          {facts.escalations > 0 ? <span>Needs you {facts.escalations}</span> : null}
        </div>
      ) : (
        <span className={styles.projectStatusLoading}>
          {factsState === "unavailable" ? "No status yet" : "Loading"}
        </span>
      )}
      <select
        aria-label="Active project"
        value={selectedProjectIsActive ? selectedProjectValue : ""}
        onChange={(event) => {
          const [kind, ...rest] = event.target.value.split(":");
          const key = rest.join(":");
          if ((kind === "sourcing" || kind === "prospecting") && key) onProjectChange({ kind, key });
        }}
      >
        {!selectedProjectIsActive ? <option value="">Select active project</option> : null}
        {activeRows.map((row) => (
          <option key={`${row.kind}:${row.key}`} value={`${row.kind}:${row.key}`}>
            {row.name} ({row.typeLabel})
          </option>
        ))}
      </select>
    </section>
  );
}
