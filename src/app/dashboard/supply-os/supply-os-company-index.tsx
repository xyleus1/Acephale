"use client";

import {
  ArrowRight,
  Building2,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { SupplyOsWorkspaceSelection } from "./supply-os-shared-workspace";
import styles from "./supply-os-company-index.module.css";

type OfficeSwitchAction = (formData: FormData) => void | Promise<void>;

type Workspace = {
  id: string;
  name: string;
  updatedAt: string;
  company: { name: string; website: string | null } | null;
  mediaAssets: Array<{ url: string }>;
  officeId?: string;
  officeName?: string;
  isCurrent?: boolean;
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
  canCreateOffice = false,
  allowedWorkspaceIds,
  autoOpenFirstWorkspace = false,
  crossOffice = false,
  switchOfficeAction,
  preferredWorkspaceId,
  onPreferredWorkspaceUnavailable,
  onOpenWorkspace,
}: {
  canCreateCompany: boolean;
  canCreateOffice?: boolean;
  allowedWorkspaceIds?: string[];
  autoOpenFirstWorkspace?: boolean;
  crossOffice?: boolean;
  switchOfficeAction?: OfficeSwitchAction;
  preferredWorkspaceId?: string | null;
  onPreferredWorkspaceUnavailable?: () => void;
  onOpenWorkspace: (selection: SupplyOsWorkspaceSelection) => void;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanyWebsite, setNewCompanyWebsite] = useState("");
  const [creating, setCreating] = useState(false);
  const [officeCreateOpen, setOfficeCreateOpen] = useState(false);
  const [newOfficeName, setNewOfficeName] = useState("");
  const [newOfficeUsername, setNewOfficeUsername] = useState("");
  const [newOfficePassword, setNewOfficePassword] = useState("");
  const [creatingOffice, setCreatingOffice] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string; website: string } | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const allowedWorkspaceKey = allowedWorkspaceIds?.slice().sort().join("|") ?? "";
  const allowedWorkspaceSet = useMemo(
    () => allowedWorkspaceIds === undefined ? null : new Set(allowedWorkspaceIds),
    [allowedWorkspaceKey],
  );

  const requestWorkspaces = useCallback(async () => {
    const response = await fetch(
      crossOffice ? "/api/supply-os/offices/workspaces" : "/api/supply-os/workspaces",
      { cache: "no-store", headers: { accept: "application/json" } },
    );
    const body = await response.json().catch(() => ({})) as {
      workspaces?: Workspace[];
      offices?: Array<{
        officeId: string;
        officeName: string;
        isCurrent: boolean;
        workspaces: Workspace[];
      }>;
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || "Companies could not be loaded.");
    const rows = crossOffice
      ? (body.offices ?? []).flatMap((office) => office.workspaces.map((workspace) => ({
          ...workspace,
          officeId: office.officeId,
          officeName: office.officeName,
          isCurrent: office.isCurrent,
        })))
      : (body.workspaces ?? []).map((workspace) => ({ ...workspace, isCurrent: true }));
    return allowedWorkspaceSet
      ? rows.filter((workspace) => workspace.isCurrent !== false && allowedWorkspaceSet.has(workspace.id))
      : rows;
  }, [allowedWorkspaceSet, crossOffice]);

  const load = useCallback(async () => {
    if (preferredWorkspaceId === undefined) return;
    setState("loading");
    setError("");
    try {
      const nextWorkspaces = await requestWorkspaces();
      setWorkspaces(nextWorkspaces);
      setState("ready");
      const preferredWorkspace = preferredWorkspaceId
        ? nextWorkspaces.find((workspace) => workspace.isCurrent !== false && workspace.id === preferredWorkspaceId) ?? null
        : null;
      if (preferredWorkspace) {
        onOpenWorkspace(selectionFor(preferredWorkspace));
        return;
      }
      if (preferredWorkspaceId) onPreferredWorkspaceUnavailable?.();
      const firstCurrentWorkspace = nextWorkspaces.find((workspace) => workspace.isCurrent !== false);
      if (autoOpenFirstWorkspace && firstCurrentWorkspace) {
        onOpenWorkspace(selectionFor(firstCurrentWorkspace));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Companies could not be loaded.");
      setState("error");
    }
  }, [autoOpenFirstWorkspace, onOpenWorkspace, onPreferredWorkspaceUnavailable, preferredWorkspaceId, requestWorkspaces]);

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
      if (!response.ok || !body.workspace) throw new Error(body.error || "Company could not be added.");
      const next = await requestWorkspaces();
      setWorkspaces(next);
      setNewCompanyName("");
      setNewCompanyWebsite("");
      setCreateOpen(false);
      setState("ready");
      const created = next.find((workspace) => workspace.id === body.workspace?.id);
      if (body.warning) setError(body.warning);
      else if (created) onOpenWorkspace(selectionFor(created));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Company could not be added.");
    } finally {
      setCreating(false);
    }
  }

  async function updateCompany(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || updatingId) return;
    const name = editing.name.trim();
    if (name.length < 2) return;
    setUpdatingId(editing.id);
    setError("");
    try {
      const response = await fetch(`/api/supply-os/workspaces/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ name, website: editing.website.trim() || null }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Company could not be updated.");
      setWorkspaces(await requestWorkspaces());
      setEditing(null);
      setState("ready");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Company could not be updated.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function createOffice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const officeName = newOfficeName.trim();
    if (officeName.length < 2 || creatingOffice) return;
    setCreatingOffice(true);
    setError("");
    const payload: {
      officeName: string;
      adminUsername?: string;
      adminPassword?: string;
    } = { officeName };
    const adminUsername = newOfficeUsername.trim();
    if (adminUsername) payload.adminUsername = adminUsername;
    if (newOfficePassword) payload.adminPassword = newOfficePassword;
    try {
      const response = await fetch("/api/supply-os/offices", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Office could not be created.");
      window.location.assign("/dashboard/supply-os");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Office could not be created.");
    } finally {
      setCreatingOffice(false);
    }
  }

  async function archiveCompany(workspace: Workspace) {
    if (archivingId) return;
    const confirmed = window.confirm(
      `Delete ${workspace.name}? This archives the company and removes dashboard access. Its data stays in the database.`,
    );
    if (!confirmed) return;
    setArchivingId(workspace.id);
    setError("");
    try {
      const response = await fetch(`/api/supply-os/workspaces/${encodeURIComponent(workspace.id)}`, {
        method: "DELETE",
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "Company could not be archived.");
      setWorkspaces(await requestWorkspaces());
      if (editing?.id === workspace.id) setEditing(null);
      setState("ready");
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Company could not be archived.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <section className={styles.index} aria-label="Companies">
      <header>
        <span>{workspaces.length} {workspaces.length === 1 ? "company" : "companies"}</span>
        <div className={styles.headerActions}>
          <button type="button" onClick={() => void load()} aria-label="Refresh companies" disabled={state === "loading"}>
            <RefreshCw size={15} />
          </button>
          {canCreateCompany ? (
            <button type="button" className={styles.newButton} onClick={() => setCreateOpen((open) => !open)}>
              {createOpen ? <X size={15} /> : <Plus size={15} />} {createOpen ? "Cancel" : "Add"}
            </button>
          ) : null}
          {canCreateOffice ? (
            <button type="button" className={styles.officeButton} onClick={() => setOfficeCreateOpen((open) => !open)}>
              {officeCreateOpen ? <X size={15} /> : <Plus size={15} />} {officeCreateOpen ? "Cancel" : "New office"}
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
            {creating ? <LoaderCircle className={styles.spin} size={15} /> : <Plus size={15} />} {creating ? "Adding" : "Add"}
          </button>
        </form>
      ) : null}

      {officeCreateOpen ? (
        <form className={styles.officeCreateRow} onSubmit={(event) => void createOffice(event)}>
          <label>
            <span>Office name</span>
            <input
              value={newOfficeName}
              minLength={2}
              maxLength={80}
              autoFocus
              onChange={(event) => setNewOfficeName(event.target.value)}
            />
          </label>
          <label>
            <span>Customer login username</span>
            <input
              value={newOfficeUsername}
              maxLength={31}
              autoComplete="off"
              onChange={(event) => setNewOfficeUsername(event.target.value)}
            />
          </label>
          <label>
            <span>Customer login password <small>Min 12 characters</small></span>
            <input
              type="password"
              value={newOfficePassword}
              minLength={12}
              autoComplete="new-password"
              onChange={(event) => setNewOfficePassword(event.target.value)}
            />
          </label>
          <button type="submit" disabled={creatingOffice || newOfficeName.trim().length < 2}>
            {creatingOffice ? <LoaderCircle className={styles.spin} size={15} /> : <Plus size={15} />} {creatingOffice ? "Creating" : "Create"}
          </button>
        </form>
      ) : null}

      {error ? <div className={styles.error} role="alert">{error}</div> : null}

      <div className={styles.rows} aria-live="polite">
        {workspaces.map((workspace) => {
          const snapshot = workspace.snapshots[0] ?? null;
          const initials = workspace.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
          const rowContent = (
            <>
              <span className={styles.companyMark}>{initials || <Building2 size={16} />}</span>
              <span className={styles.companyIdentity}>
                <strong>{workspace.name}</strong>
                {crossOffice && workspace.officeName ? <span className={styles.officeBadge}>{workspace.officeName}</span> : null}
                <small>{workspace.company?.website || workspace.company?.name || "No website"}</small>
              </span>
              <span className={styles.companyFacts}><b>{snapshot?._count.items ?? 0} items</b><small>{snapshot ? `Snapshot v${snapshot.version}` : "No snapshot"}</small></span>
              <span className={styles.companyFacts}><b>{snapshot?._count.locations ?? 0} locations</b><small>{updatedLabel(workspace.updatedAt)}</small></span>
              <ArrowRight size={16} />
            </>
          );
          return (
            <div className={styles.companyEntry} key={workspace.id}>
              <div className={styles.companyRow}>
                {crossOffice && !workspace.isCurrent && switchOfficeAction ? (
                  <form action={switchOfficeAction} className={styles.companyOpenForm}>
                    <input type="hidden" name="officeId" value={workspace.officeId} />
                    <input type="hidden" name="workspaceId" value={workspace.id} />
                    <button
                      type="submit"
                      className={styles.companyOpen}
                      aria-label={`Open ${workspace.name} in ${workspace.officeName}`}
                    >
                      {rowContent}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className={styles.companyOpen}
                    onClick={() => onOpenWorkspace(selectionFor(workspace))}
                  >
                    {rowContent}
                  </button>
                )}
                {canCreateCompany && (!crossOffice || workspace.isCurrent) ? (
                  <details className={styles.actionMenu}>
                    <summary aria-label={`Actions for ${workspace.name}`}><MoreHorizontal size={18} /></summary>
                    <div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.currentTarget.closest("details")?.removeAttribute("open");
                          setEditing({
                            id: workspace.id,
                            name: workspace.name,
                            website: workspace.company?.website ?? "",
                          });
                        }}
                      >
                        <Pencil size={14} /> Edit
                      </button>
                      <button type="button" className={styles.deleteAction} onClick={() => void archiveCompany(workspace)}>
                        {archivingId === workspace.id ? <LoaderCircle className={styles.spin} size={14} /> : <Trash2 size={14} />} Delete
                      </button>
                    </div>
                  </details>
                ) : null}
              </div>
              {editing?.id === workspace.id ? (
                <form className={styles.editRow} onSubmit={(event) => void updateCompany(event)}>
                  <label>
                    <span>Company name</span>
                    <input
                      value={editing.name}
                      minLength={2}
                      maxLength={160}
                      autoFocus
                      onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                    />
                  </label>
                  <label>
                    <span>Website</span>
                    <input
                      value={editing.website}
                      maxLength={500}
                      inputMode="url"
                      onChange={(event) => setEditing({ ...editing, website: event.target.value })}
                    />
                  </label>
                  <div>
                    <button type="button" onClick={() => setEditing(null)}>Cancel</button>
                    <button type="submit" disabled={updatingId === workspace.id || editing.name.trim().length < 2}>
                      {updatingId === workspace.id ? "Saving" : "Save"}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          );
        })}

        {state === "loading" ? <div className={styles.loading}><LoaderCircle className={styles.spin} size={17} /> Loading companies</div> : null}
        {state === "ready" && workspaces.length === 0 ? <div className={styles.empty}>No companies</div> : null}
      </div>
    </section>
  );
}
