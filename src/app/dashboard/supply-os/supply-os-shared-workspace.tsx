"use client";

import {
  Building2,
  Check,
  ChevronDown,
  CloudUpload,
  Database,
  FileSpreadsheet,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./supply-os-shared-workspace.module.css";

const CSV_KINDS = ["locations", "items", "bom", "inventory", "demand"] as const;

type CsvKind = (typeof CSV_KINDS)[number];

type SnapshotCounts = {
  items: number;
  locations: number;
  inventory: number;
  demands: number;
};

type PublishedSnapshot = {
  id: string;
  version: number;
  publishedAt: string | null;
  _count: SnapshotCounts;
};

type SupplyWorkspace = {
  id: string;
  companyId: string | null;
  externalKey: string | null;
  name: string;
  status: string;
  version: number;
  updatedAt: string;
  company: { name: string; website: string | null } | null;
  mediaAssets: Array<{ url: string }>;
  snapshots: PublishedSnapshot[];
};

type ImportIssue = {
  file: CsvKind;
  row: number;
  field?: string;
  message: string;
};

type StagedImport = {
  id: string;
  status: string;
  sourceName: string | null;
  validation?: {
    counts?: Partial<Record<CsvKind, number>>;
  } | null;
  snapshot?: {
    id: string;
    version: number;
    status: string;
  } | null;
};

type ApiErrorBody = {
  error?: string;
  issues?: ImportIssue[];
};

type RequestState = "idle" | "loading" | "success" | "error";

export type SupplyOsWorkspaceSelection = {
  workspaceId: string;
  workspaceName: string;
  snapshotId: string | null;
  snapshotVersion: number | null;
  logoUrl: string | null;
} | null;

const FILE_LABELS: Record<CsvKind, { label: string; hint: string; required: boolean }> = {
  locations: { label: "Locations", hint: "Plants, warehouses, suppliers", required: true },
  items: { label: "Items", hint: "Products, parts, identifiers", required: true },
  bom: { label: "BOM", hint: "Parent and component relationships", required: false },
  inventory: { label: "Inventory", hint: "Position and availability", required: false },
  demand: { label: "Demand", hint: "Requirements and due dates", required: false },
};

const MAX_FILE_BYTES = 2_000_000;
const MAX_BUNDLE_BYTES = 5_500_000;

function formatDate(value: string | null | undefined) {
  if (!value) return "Not published";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

async function responseBody<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = body as ApiErrorBody;
    const error = new Error(details.error || `Request failed with status ${response.status}.`);
    Object.assign(error, { issues: details.issues ?? [] });
    throw error;
  }
  return body as T;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Supply OS request failed.";
}

function errorIssues(error: unknown): ImportIssue[] {
  if (!error || typeof error !== "object" || !("issues" in error)) return [];
  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) ? issues as ImportIssue[] : [];
}

export function SupplyOsSharedWorkspace({
  className,
  onSelectionChange,
}: {
  className?: string;
  onSelectionChange?: (selection: SupplyOsWorkspaceSelection) => void;
}) {
  const instanceId = useId();
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const [workspaces, setWorkspaces] = useState<SupplyWorkspace[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [workspaceState, setWorkspaceState] = useState<RequestState>("loading");
  const [workspaceError, setWorkspaceError] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [createState, setCreateState] = useState<RequestState>("idle");
  const [createError, setCreateError] = useState("");
  const [files, setFiles] = useState<Record<CsvKind, File | null>>({
    locations: null,
    items: null,
    bom: null,
    inventory: null,
    demand: null,
  });
  const [sourceName, setSourceName] = useState("");
  const [importState, setImportState] = useState<RequestState>("idle");
  const [importMessage, setImportMessage] = useState("");
  const [importIssues, setImportIssues] = useState<ImportIssue[]>([]);
  const [stagedImport, setStagedImport] = useState<StagedImport | null>(null);
  const [fileResetKey, setFileResetKey] = useState(0);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedId) ?? null,
    [selectedId, workspaces],
  );
  const latestSnapshot = selectedWorkspace?.snapshots[0] ?? null;
  const canStage = Boolean(selectedId && files.locations && files.items && importState !== "loading");
  const canPublish = Boolean(stagedImport && stagedImport.status === "READY" && importState !== "loading");

  useEffect(() => {
    onSelectionChange?.(selectedWorkspace ? {
      workspaceId: selectedWorkspace.id,
      workspaceName: selectedWorkspace.name,
      snapshotId: latestSnapshot?.id ?? null,
      snapshotVersion: latestSnapshot?.version ?? null,
      logoUrl: selectedWorkspace.mediaAssets[0]?.url ?? null,
    } : null);
  }, [
    latestSnapshot?.id,
    latestSnapshot?.version,
    onSelectionChange,
    selectedWorkspace?.id,
    selectedWorkspace?.name,
  ]);

  const loadWorkspaces = useCallback(async (signal?: AbortSignal, preferredId?: string) => {
    setWorkspaceState("loading");
    setWorkspaceError("");
    try {
      const response = await fetch("/api/supply-os/workspaces", {
        method: "GET",
        cache: "no-store",
        headers: { accept: "application/json" },
        signal,
      });
      const body = await responseBody<{ workspaces: SupplyWorkspace[] }>(response);
      setWorkspaces(body.workspaces);
      setSelectedId((current) => {
        const candidate = preferredId || current;
        if (candidate && body.workspaces.some((workspace) => workspace.id === candidate)) return candidate;
        return body.workspaces[0]?.id ?? "";
      });
      setWorkspaceState("success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setWorkspaceError(errorMessage(error));
      setWorkspaceState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorkspaces(controller.signal);
    return () => controller.abort();
  }, [loadWorkspaces]);

  useEffect(() => {
    setStagedImport(null);
    setImportMessage("");
    setImportIssues([]);
    setImportState("idle");
  }, [selectedId]);

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (name.length < 2) return;
    setCreateState("loading");
    setCreateError("");
    setWorkspaceError("");
    try {
      const response = await fetch("/api/supply-os/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await responseBody<{ workspace: { id: string } }>(response);
      setNewWorkspaceName("");
      createDialogRef.current?.close();
      setCreateState("success");
      await loadWorkspaces(undefined, body.workspace.id);
    } catch (error) {
      setCreateError(errorMessage(error));
      setCreateState("error");
    }
  }

  function setCsvFile(kind: CsvKind, file: File | null) {
    setStagedImport(null);
    setImportMessage("");
    setImportIssues([]);
    if (file && file.size > MAX_FILE_BYTES) {
      setFiles((current) => ({ ...current, [kind]: null }));
      setImportState("error");
      setImportMessage(`${FILE_LABELS[kind].label} must be under 2 MB.`);
      return;
    }
    setFiles((current) => ({ ...current, [kind]: file }));
    setImportState("idle");
  }

  async function stageImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !files.locations || !files.items) return;
    setImportState("loading");
    setImportMessage("Reading local CSV files.");
    setImportIssues([]);
    setStagedImport(null);
    try {
      const bundleBytes = CSV_KINDS.reduce((total, kind) => total + (files[kind]?.size ?? 0), 0);
      if (bundleBytes > MAX_BUNDLE_BYTES) {
        throw new Error("The combined CSV bundle must be under 5.5 MB.");
      }
      const fileEntries = await Promise.all(
        CSV_KINDS.filter((kind) => files[kind]).map(async (kind) => [kind, await files[kind]!.text()] as const),
      );
      setImportMessage("Validating and staging an office-shared draft.");
      const response = await fetch(`/api/supply-os/workspaces/${encodeURIComponent(selectedId)}/imports`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sourceName: sourceName.trim() || `CSV bundle ${new Date().toISOString().slice(0, 10)}`,
          files: Object.fromEntries(fileEntries),
        }),
      });
      const body = await responseBody<{ importRun: StagedImport }>(response);
      setStagedImport(body.importRun);
      setImportState("success");
      if (body.importRun.status === "PUBLISHED") {
        setImportMessage("This exact CSV bundle was already published. No duplicate snapshot was created.");
        await loadWorkspaces(undefined, selectedId);
      } else {
        setImportMessage("Draft validated and staged. Review the counts, then publish it for the office.");
      }
    } catch (error) {
      setImportIssues(errorIssues(error));
      setImportMessage(errorMessage(error));
      setImportState("error");
    }
  }

  async function publishImport() {
    if (!stagedImport || stagedImport.status !== "READY") return;
    setImportState("loading");
    setImportMessage("Publishing the validated snapshot.");
    setImportIssues([]);
    try {
      const response = await fetch(`/api/supply-os/imports/${encodeURIComponent(stagedImport.id)}/publish`, {
        method: "POST",
        headers: { accept: "application/json" },
      });
      const body = await responseBody<{ importRun: StagedImport }>(response);
      setStagedImport(body.importRun);
      setImportState("success");
      setImportMessage("Snapshot published. Office members now read the same version from Postgres.");
      await loadWorkspaces(undefined, selectedId);
    } catch (error) {
      setImportIssues(errorIssues(error));
      setImportMessage(errorMessage(error));
      setImportState("error");
    }
  }

  function clearFiles() {
    setFiles({ locations: null, items: null, bom: null, inventory: null, demand: null });
    setSourceName("");
    setStagedImport(null);
    setImportMessage("");
    setImportIssues([]);
    setImportState("idle");
    setFileResetKey((current) => current + 1);
  }

  return (
    <section className={[styles.workspaceControl, className].filter(Boolean).join(" ")} aria-labelledby={`${instanceId}-title`}>
      <header className={styles.controlHeader}>
        <div className={styles.headerIdentity}>
          <span className={styles.headerIcon}><Database size={18} aria-hidden="true" /></span>
          <div>
            <h2 id={`${instanceId}-title`}>Workspaces</h2>
          </div>
        </div>
        <div className={styles.serverStatus}>
          <span data-state={workspaceState}>
            {workspaceState === "loading" ? <LoaderCircle size={13} className={styles.spin} /> : <LockKeyhole size={13} />}
            {workspaceState === "loading" ? "Loading" : workspaceState === "error" ? "Unavailable" : "Office shared"}
          </span>
          <button type="button" onClick={() => void loadWorkspaces()} disabled={workspaceState === "loading"} aria-label="Refresh shared workspaces">
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className={styles.dataBoundary}>
        <div>
          <Database size={15} aria-hidden="true" />
          <p><strong>Shared:</strong> workspaces and published snapshots are office-scoped.</p>
        </div>
        <div>
          <FileSpreadsheet size={15} aria-hidden="true" />
          <p><strong>Demo:</strong> other panels may use local or illustrative data.</p>
        </div>
      </div>

      {workspaceError ? <div className={styles.errorBanner} role="alert">{workspaceError}</div> : null}

      <div className={styles.workspaceBar}>
        <label htmlFor={`${instanceId}-workspace`}>
          <span>Active workspace</span>
          <div className={styles.selectWrap}>
            <Building2 size={15} aria-hidden="true" />
            <select
              id={`${instanceId}-workspace`}
              value={selectedId}
              disabled={workspaceState === "loading" || workspaces.length === 0}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {workspaces.length === 0 ? <option value="">No shared workspace yet</option> : null}
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </div>
        </label>
        <button type="button" className={styles.createButton} onClick={() => {
          setCreateError("");
          createDialogRef.current?.showModal();
        }}>
          <Plus size={14} aria-hidden="true" /> New
        </button>
      </div>

      <dialog ref={createDialogRef} className={styles.createDialog} aria-labelledby={`${instanceId}-create-title`}>
        <form method="dialog" onSubmit={(event) => void createWorkspace(event)}>
          <h3 id={`${instanceId}-create-title`}>New workspace</h3>
          <label htmlFor={`${instanceId}-workspace-name`}>
            Workspace name
            <input
              id={`${instanceId}-workspace-name`}
              value={newWorkspaceName}
              minLength={2}
              maxLength={160}
              autoComplete="off"
              required
              onChange={(event) => setNewWorkspaceName(event.target.value)}
              placeholder="Atlas Robotics"
            />
          </label>
          {createError ? <div className={styles.dialogError} role="alert">{createError}</div> : null}
          <div className={styles.dialogActions}>
            <button type="button" onClick={() => createDialogRef.current?.close()}>Cancel</button>
            <button type="submit" disabled={createState === "loading" || newWorkspaceName.trim().length < 2}>
              {createState === "loading" ? <LoaderCircle size={14} className={styles.spin} /> : <Plus size={14} />}
              Create
            </button>
          </div>
        </form>
      </dialog>

      {selectedWorkspace ? (
        <div className={styles.workspaceBody}>
          <section className={styles.snapshotPanel} aria-labelledby={`${instanceId}-snapshot-title`}>
            <header>
              <div>
                <h3 id={`${instanceId}-snapshot-title`}>{selectedWorkspace.name}</h3>
                <p>{selectedWorkspace.company?.name || "Independent supply program"}</p>
              </div>
              <span className={styles.versionBadge}>{latestSnapshot ? `Published v${latestSnapshot.version}` : "No published snapshot"}</span>
            </header>

            {latestSnapshot ? (
              <>
                <dl className={styles.snapshotCounts}>
                  <div><dt>Parts and products</dt><dd>{latestSnapshot._count.items.toLocaleString()}</dd></div>
                  <div><dt>Locations</dt><dd>{latestSnapshot._count.locations.toLocaleString()}</dd></div>
                  <div><dt>Inventory positions</dt><dd>{latestSnapshot._count.inventory.toLocaleString()}</dd></div>
                  <div><dt>Demand lines</dt><dd>{latestSnapshot._count.demands.toLocaleString()}</dd></div>
                </dl>
                <div className={styles.snapshotMeta}>
                  <span><Check size={13} aria-hidden="true" /> Published {formatDate(latestSnapshot.publishedAt)}</span>
                  <span><Users size={13} aria-hidden="true" /> Office-shared version {selectedWorkspace.version}</span>
                </div>
              </>
            ) : (
              <div className={styles.emptySnapshot}>
                <Database size={22} aria-hidden="true" />
                <div>
                  <strong>No snapshot</strong>
                  <p>Add CSV files, then publish.</p>
                </div>
              </div>
            )}
          </section>

          <form className={styles.importPanel} onSubmit={(event) => void stageImport(event)} aria-labelledby={`${instanceId}-import-title`}>
            <header>
              <div>
                <h3 id={`${instanceId}-import-title`}>Import</h3>
                <p>Validated and saved as a draft.</p>
              </div>
              <button type="button" className={styles.clearButton} onClick={clearFiles} disabled={!CSV_KINDS.some((kind) => files[kind])}>Clear</button>
            </header>

            <label className={styles.sourceName} htmlFor={`${instanceId}-source-name`}>
              <span>Source label <small>optional</small></span>
              <input
                id={`${instanceId}-source-name`}
                value={sourceName}
                maxLength={160}
                onChange={(event) => setSourceName(event.target.value)}
                placeholder="ERP export, August 8"
              />
            </label>

            <div className={styles.fileGrid} key={fileResetKey}>
              {CSV_KINDS.map((kind) => {
                const meta = FILE_LABELS[kind];
                const file = files[kind];
                return (
                  <label key={kind} className={styles.fileInput} data-selected={Boolean(file)}>
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      required={meta.required}
                      onChange={(event) => setCsvFile(kind, event.target.files?.[0] ?? null)}
                    />
                    <span className={styles.fileIcon}>{file ? <Check size={15} /> : <CloudUpload size={15} />}</span>
                    <span className={styles.fileCopy}>
                      <strong>{meta.label} {meta.required ? <em>required</em> : <em>optional</em>}</strong>
                      <small>{file ? `${file.name} · ${Math.ceil(file.size / 1024).toLocaleString()} KB` : meta.hint}</small>
                    </span>
                  </label>
                );
              })}
            </div>

            {importMessage ? (
              <div className={styles.importStatus} data-state={importState} role={importState === "error" ? "alert" : "status"} aria-live="polite">
                {importState === "loading" ? <LoaderCircle size={15} className={styles.spin} /> : importState === "success" ? <Check size={15} /> : <FileSpreadsheet size={15} />}
                <span>{importMessage}</span>
              </div>
            ) : null}

            {importIssues.length ? (
              <div className={styles.issueList} role="alert">
                <strong>{countLabel(importIssues.length, "validation issue")}</strong>
                <ul>
                  {importIssues.slice(0, 6).map((issue, index) => (
                    <li key={`${issue.file}-${issue.row}-${issue.field || "row"}-${index}`}>
                      <b>{issue.file}.csv, row {issue.row}{issue.field ? `, ${issue.field}` : ""}</b>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
                {importIssues.length > 6 ? <small>{importIssues.length - 6} more issues were returned by validation.</small> : null}
              </div>
            ) : null}

            {stagedImport ? (
              <div className={styles.stagedReview}>
                <div>
                  <span className={styles.eyebrow}>{stagedImport.status === "PUBLISHED" ? "Published snapshot" : "Draft ready"}</span>
                  <strong>{stagedImport.sourceName || "Supply OS CSV import"}</strong>
                  <small>Snapshot v{stagedImport.snapshot?.version ?? "pending"} · import {stagedImport.id.slice(0, 8)}</small>
                </div>
                <dl>
                  {CSV_KINDS.map((kind) => (
                    <div key={kind}><dt>{FILE_LABELS[kind].label}</dt><dd>{stagedImport.validation?.counts?.[kind] ?? 0}</dd></div>
                  ))}
                </dl>
              </div>
            ) : null}

            <div className={styles.importActions}>
              <button type="submit" disabled={!canStage}>
                {importState === "loading" && !stagedImport ? <LoaderCircle size={14} className={styles.spin} /> : <CloudUpload size={14} />}
                Validate and stage
              </button>
              <button type="button" className={styles.publishButton} disabled={!canPublish} onClick={() => void publishImport()}>
                {importState === "loading" && stagedImport ? <LoaderCircle size={14} className={styles.spin} /> : <Send size={14} />}
                Publish for office
              </button>
            </div>
          </form>
        </div>
      ) : workspaceState === "success" ? (
        <div className={styles.zeroState}>
          <Building2 size={28} aria-hidden="true" />
          <h3>No workspace</h3>
          <p>Create one, then import a snapshot.</p>
          <button type="button" onClick={() => {
            setCreateError("");
            createDialogRef.current?.showModal();
          }}><Plus size={14} /> New workspace</button>
        </div>
      ) : (
        <div className={styles.loadingState} aria-live="polite"><LoaderCircle size={18} className={styles.spin} /> Loading</div>
      )}
    </section>
  );
}
