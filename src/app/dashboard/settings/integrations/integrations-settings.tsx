"use client";

import {
  Check,
  CircleAlert,
  DatabaseZap,
  Link2,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { SettingsHeader } from "../settings-header";
import styles from "./integrations-settings.module.css";

type Workspace = {
  id: string;
  name: string;
  company: { name: string; website: string | null } | null;
};

type ConnectorRun = {
  id: string;
  status: string;
  recordCounts: Record<string, number> | null;
  traceId: string | null;
  errorCode: string | null;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
};

type Connector = {
  id: string;
  displayName: string;
  adapterKey: string;
  adapterVersion: string;
  baseUrl: string;
  scheduleMinutes: number;
  status: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastTestedAt: string | null;
  lastSucceededAt: string | null;
  nextSyncAt: string | null;
  importRuns: ConnectorRun[];
};

type Notice = { message: string; error: boolean } | null;

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  if (!response.ok) throw new Error(body.error || body.code || `Request failed with status ${response.status}.`);
  return body;
}

function dateLabel(value: string | null) {
  if (!value) return "Not run";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function IntegrationsSettings({
  canConfigure,
  canReadMailLog,
}: {
  canConfigure: boolean;
  canReadMailLog: boolean;
}) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [secretRef, setSecretRef] = useState("");
  const [tokenUrl, setTokenUrl] = useState("/oauth/token");
  const [scope, setScope] = useState("");

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const body = await jsonResponse<{ workspaces: Workspace[] }>(await fetch("/api/supply-os/workspaces", { cache: "no-store" }));
      setWorkspaces(body.workspaces);
      setWorkspaceId((current) => body.workspaces.some((workspace) => workspace.id === current)
        ? current
        : body.workspaces[0]?.id ?? "");
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Companies could not be loaded.", error: true });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConnectors = useCallback(async (selectedWorkspaceId: string) => {
    if (!selectedWorkspaceId) {
      setConnectors([]);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const body = await jsonResponse<{ connectors: Connector[] }>(await fetch(
        `/api/supply-os/workspaces/${encodeURIComponent(selectedWorkspaceId)}/connectors`,
        { cache: "no-store" },
      ));
      setConnectors(body.connectors);
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Connectors could not be loaded.", error: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);
  useEffect(() => { void loadConnectors(workspaceId); }, [loadConnectors, workspaceId]);

  async function runAction(key: string, action: () => Promise<unknown>, success: string) {
    setWorkingKey(key);
    setNotice(null);
    try {
      await action();
      setNotice({ message: success, error: false });
      await loadConnectors(workspaceId);
    } catch (error) {
      setNotice({ message: error instanceof Error ? error.message : "Request failed.", error: true });
    } finally {
      setWorkingKey("");
    }
  }

  async function createConnector(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction("create", async () => {
      await jsonResponse(await fetch(`/api/supply-os/workspaces/${encodeURIComponent(workspaceId)}/connectors`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          baseUrl,
          secretRef,
          adapterKey: "CUSTOM_REST_V1",
          scheduleMinutes: 60,
          config: { tokenUrl, scope: scope.trim() || null },
        }),
      }));
      setDisplayName("");
      setBaseUrl("");
      setSecretRef("");
      setTokenUrl("/oauth/token");
      setScope("");
      setSetupOpen(false);
    }, "Connector saved. Test it before enabling sync.");
  }

  return (
    <main className={styles.page}>
      <SettingsHeader active="integrations" isAdmin={canConfigure} canReadMailLog={canReadMailLog} />

      <section className={styles.settingsPanel}>
        <header className={styles.panelHeader}>
          <div>
            <h2>Integrations</h2>
            <p>Read-only client connections. Each connection is scoped to one company workspace.</p>
          </div>
          <button type="button" onClick={() => void loadConnectors(workspaceId)} disabled={loading || !workspaceId}>
            <RefreshCw size={15} aria-hidden="true" /> Refresh
          </button>
        </header>

        <div className={styles.workspaceRow}>
          <label htmlFor="integration-workspace">Company</label>
          <select id="integration-workspace" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={loading || workspaces.length === 0}>
            {workspaces.length === 0 ? <option value="">No company workspace</option> : null}
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>{workspace.company?.name || workspace.name}</option>
            ))}
          </select>
          {canConfigure && workspaceId ? (
            <button type="button" onClick={() => setSetupOpen((open) => !open)}>{setupOpen ? "Cancel" : "Add connector"}</button>
          ) : null}
        </div>

        {notice ? (
          <div className={styles.notice} data-error={notice.error} role={notice.error ? "alert" : "status"}>
            {notice.error ? <CircleAlert size={15} /> : <Check size={15} />}{notice.message}
          </div>
        ) : null}

        {setupOpen ? (
          <form className={styles.setupForm} onSubmit={(event) => void createConnector(event)}>
            <label>Connector name<input value={displayName} maxLength={160} required placeholder="Client supply API" onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label>Base URL<input value={baseUrl} type="url" required placeholder="https://api.client.example" onChange={(event) => setBaseUrl(event.target.value)} /></label>
            <label>Secret reference<input value={secretRef} pattern="[A-Z][A-Z0-9_]{2,127}" required placeholder="CLIENT_SUPPLY_OAUTH" onChange={(event) => setSecretRef(event.target.value.toUpperCase())} /></label>
            <label>OAuth token path<input value={tokenUrl} required placeholder="/oauth/token" onChange={(event) => setTokenUrl(event.target.value)} /></label>
            <label>OAuth scope<input value={scope} placeholder="Optional" onChange={(event) => setScope(event.target.value)} /></label>
            <button type="submit" disabled={workingKey === "create"}>
              {workingKey === "create" ? <LoaderCircle className={styles.spin} size={15} /> : <Link2 size={15} />} Save connector
            </button>
            <p>The deployment secret contains the OAuth client ID and secret. Credentials are not stored in Derya records.</p>
          </form>
        ) : null}

        <div className={styles.connectorList} aria-live="polite">
          {loading ? <div className={styles.empty}><LoaderCircle className={styles.spin} size={18} /> Loading connections</div> : null}
          {!loading && !workspaceId ? <div className={styles.empty}>Create a company workspace before adding a connector.</div> : null}
          {!loading && workspaceId && connectors.length === 0 ? <div className={styles.empty}><DatabaseZap size={19} /> No connector configured.</div> : null}
          {!loading ? connectors.map((connector) => (
            <article className={styles.connector} key={connector.id} data-status={connector.status}>
              <span className={styles.statusDot} aria-hidden="true" />
              <div className={styles.connectorIdentity}>
                <strong>{connector.displayName}</strong>
                <small>{connector.baseUrl}</small>
              </div>
              <dl>
                <div><dt>Status</dt><dd>{connector.status}</dd></div>
                <div><dt>Last success</dt><dd>{dateLabel(connector.lastSucceededAt)}</dd></div>
                <div><dt>Next sync</dt><dd>{dateLabel(connector.nextSyncAt)}</dd></div>
              </dl>
              {connector.lastErrorMessage ? (
                <p className={styles.connectorError}>{connector.lastErrorCode}: {connector.lastErrorMessage}</p>
              ) : null}
              {canConfigure ? (
                <div className={styles.connectorActions}>
                  <button type="button" disabled={Boolean(workingKey)} onClick={() => void runAction(
                    `test:${connector.id}`,
                    async () => jsonResponse(await fetch(`/api/supply-os/connectors/${encodeURIComponent(connector.id)}/test`, { method: "POST" })),
                    "Connection verified.",
                  )}>Test</button>
                  <button type="button" disabled={Boolean(workingKey)} onClick={() => void runAction(
                    `enable:${connector.id}`,
                    async () => jsonResponse(await fetch(`/api/supply-os/connectors/${encodeURIComponent(connector.id)}`, {
                      method: "PATCH",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ enabled: connector.status === "DISABLED" }),
                    })),
                    connector.status === "DISABLED" ? "Hourly sync enabled." : "Sync disabled.",
                  )}>{connector.status === "DISABLED" ? "Enable" : "Disable"}</button>
                  <button type="button" disabled={Boolean(workingKey) || connector.status === "DISABLED"} onClick={() => void runAction(
                    `sync:${connector.id}`,
                    async () => jsonResponse(await fetch(`/api/supply-os/connectors/${encodeURIComponent(connector.id)}/sync`, { method: "POST" })),
                    "Snapshot published.",
                  )}>Sync now</button>
                </div>
              ) : null}
            </article>
          )) : null}
        </div>
      </section>
    </main>
  );
}
