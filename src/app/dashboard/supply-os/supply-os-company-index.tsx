"use client";

import { ArrowRight, Building2, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { SUPPLY_OS_DEMO_COMPANIES } from "@/lib/supply-os/demo-company";
import type { SupplyOsWorkspaceSelection } from "./supply-os-shared-workspace";
import styles from "./supply-os-company-index.module.css";

type Workspace = {
  id: string;
  name: string;
  updatedAt: string;
  company: { name: string; website: string | null } | null;
  mediaAssets: Array<{ url: string }>;
  snapshots: Array<{
    id: string;
    version: number;
    publishedAt: string | null;
    _count: { items: number; locations: number; inventory: number; demands: number };
  }>;
};

function selectionFor(workspace: Workspace): Exclude<SupplyOsWorkspaceSelection, null> {
  const snapshot = workspace.snapshots[0] ?? null;
  return {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    snapshotId: snapshot?.id ?? null,
    snapshotVersion: snapshot?.version ?? null,
    logoUrl: workspace.mediaAssets[0]?.url ?? null,
  };
}

function updatedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Updated recently";
  return `Updated ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)}`;
}

export function SupplyOsCompanyIndex({
  canCreateCompany,
  onOpenWorkspace,
}: {
  canCreateCompany: boolean;
  onOpenWorkspace: (selection: SupplyOsWorkspaceSelection) => void;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyWebsite, setNewCompanyWebsite] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    setError("");
    try {
      const response = await fetch("/api/supply-os/workspaces", { cache: "no-store", headers: { accept: "application/json" } });
      const body = await response.json().catch(() => ({})) as { workspaces?: Workspace[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Companies could not be loaded.");
      setWorkspaces(body.workspaces ?? []);
      setState("ready");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Companies could not be loaded.");
      setState("error");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newCompanyName.trim();
    if (name.length < 2 || creating) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/supply-os/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ name, website: newCompanyWebsite.trim() || null }),
      });
      const body = await response.json().catch(() => ({})) as {
        workspace?: { id: string };
        error?: string;
        warning?: string | null;
      };
      if (!response.ok || !body.workspace) throw new Error(body.error || "Company could not be created.");
      const listResponse = await fetch("/api/supply-os/workspaces", { cache: "no-store", headers: { accept: "application/json" } });
      const listBody = await listResponse.json().catch(() => ({})) as { workspaces?: Workspace[]; error?: string };
      if (!listResponse.ok) throw new Error(listBody.error || "Company was created but the list could not be refreshed.");
      const next = listBody.workspaces ?? [];
      setWorkspaces(next);
      setNewCompanyName("");
      setNewCompanyWebsite("");
      setCreateOpen(false);
      setState("ready");
      const created = next.find((workspace) => workspace.id === body.workspace?.id);
      if (body.warning) setError(body.warning);
      else if (created) onOpenWorkspace(selectionFor(created));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Company could not be created.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className={styles.index} aria-label="Companies">
      <header>
        <span>{workspaces.length + 2} companies</span>
        <div className={styles.headerActions}>
          <button type="button" onClick={() => void load()} aria-label="Refresh companies" disabled={state === "loading"}>
            <RefreshCw size={15} />
          </button>
          {canCreateCompany ? (
            <button type="button" className={styles.newButton} onClick={() => setCreateOpen((open) => !open)}>
              {createOpen ? <X size={15} /> : <Plus size={15} />} {createOpen ? "Cancel" : "New company"}
            </button>
          ) : null}
        </div>
      </header>

      {createOpen ? (
        <form className={styles.createRow} onSubmit={(event) => void createCompany(event)}>
          <label htmlFor="supply-os-new-company">Company name</label>
          <input
            id="supply-os-new-company"
            value={newCompanyName}
            minLength={2}
            maxLength={160}
            autoFocus
            onChange={(event) => setNewCompanyName(event.target.value)}
          />
          <label htmlFor="supply-os-new-company-website">Website</label>
          <input
            id="supply-os-new-company-website"
            value={newCompanyWebsite}
            maxLength={500}
            inputMode="url"
            onChange={(event) => setNewCompanyWebsite(event.target.value)}
          />
          <button type="submit" disabled={creating || newCompanyName.trim().length < 2}>
            {creating ? <LoaderCircle className={styles.spin} size={15} /> : <Plus size={15} />} {creating ? "Building" : "Create"}
          </button>
        </form>
      ) : null}

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.rows} aria-live="polite">
        {Object.values(SUPPLY_OS_DEMO_COMPANIES).map((company) => (
          <button
            key={company.id}
            type="button"
            className={styles.companyRow}
            onClick={() => onOpenWorkspace({
              workspaceId: `demo:${company.id}`,
              workspaceName: company.name,
              snapshotId: null,
              snapshotVersion: null,
              logoUrl: company.logoUrl,
              demoCompanyId: company.id,
            })}
          >
            <span className={styles.companyMark} aria-hidden="true">
              {company.name.slice(0, 2)}
              <img src={company.logoUrl} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
            </span>
            <span className={styles.companyIdentity}><strong>{company.name}</strong><small>{company.summary}</small></span>
            <span className={styles.companyFacts}><b>{company.primaryFact}</b><small>Demo data</small></span>
            <span className={styles.companyFacts}><b>{company.secondaryFact}</b><small>{new URL(company.logoSourceUrl).hostname}</small></span>
            <ArrowRight size={16} />
          </button>
        ))}

        {workspaces.map((workspace) => {
          const snapshot = workspace.snapshots[0] ?? null;
          const initials = workspace.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
          return (
            <button key={workspace.id} type="button" className={styles.companyRow} onClick={() => onOpenWorkspace(selectionFor(workspace))}>
              <span className={styles.companyMark}>{initials || <Building2 size={16} />}</span>
              <span className={styles.companyIdentity}>
                <strong>{workspace.name}</strong>
                <small>{workspace.company?.name || "Office-shared workspace"}</small>
              </span>
              <span className={styles.companyFacts}><b>{snapshot?._count.items ?? 0} items</b><small>{snapshot ? `Snapshot v${snapshot.version}` : "No snapshot"}</small></span>
              <span className={styles.companyFacts}><b>{snapshot?._count.locations ?? 0} locations</b><small>{updatedLabel(workspace.updatedAt)}</small></span>
              <ArrowRight size={16} />
            </button>
          );
        })}

        {state === "loading" ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={17} /> Loading companies</div> : null}
      </div>
    </section>
  );
}
