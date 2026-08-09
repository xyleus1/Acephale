"use client";

import { Database, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  snapshotResponseToTwinModel,
  type SupplyOsSnapshotTwinModel,
  type SupplyWorkspaceSnapshotResponse,
} from "@/lib/supply-os/snapshot-twin";
import { SupplyOsProductTwin } from "./supply-os-product-twin";
import styles from "./supply-os-snapshot-twin.module.css";

type AdapterState = "fallback" | "loading" | "published" | "error";

async function readWorkspaceResponse(response: Response) {
  const body = await response.json().catch(() => ({})) as Partial<SupplyWorkspaceSnapshotResponse> & { error?: string };
  if (!response.ok) throw new Error(body.error || `Snapshot request failed with status ${response.status}.`);
  if (!body.workspace) throw new Error("The workspace response did not include snapshot data.");
  return body as SupplyWorkspaceSnapshotResponse;
}

export function SupplyOsSnapshotTwin({
  workspaceId,
  fallbackImageUrl,
  view = "materials",
}: {
  workspaceId: string | null;
  fallbackImageUrl?: string | null;
  view?: "materials" | "scenarios";
}) {
  const [state, setState] = useState<AdapterState>(workspaceId ? "loading" : "fallback");
  const [model, setModel] = useState<SupplyOsSnapshotTwinModel | null>(null);
  const [message, setMessage] = useState(workspaceId ? "Reading the selected published snapshot." : "No published snapshot is selected. Showing the clearly labeled demo fixture.");

  useEffect(() => {
    if (!workspaceId) {
      setModel(null);
      setState("fallback");
      setMessage("No published snapshot is selected. Showing the clearly labeled demo fixture.");
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setModel(null);
    setState("loading");
    setMessage("Reading the selected published snapshot.");
    void fetch(`/api/supply-os/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(readWorkspaceResponse)
      .then((body) => {
        if (cancelled) return;
        if (body.workspace.id !== workspaceId) throw new Error("The snapshot response did not match the selected workspace.");
        const nextModel = snapshotResponseToTwinModel(body);
        if (!nextModel) {
          setState("error");
          setMessage("The selected workspace has no published BOM that can drive buildability. Showing the demo fixture instead.");
          return;
        }
        setModel(nextModel);
        setState("published");
        setMessage(`Reading published snapshot v${nextModel.snapshotVersion} from ${nextModel.workspaceName}.`);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
        setMessage(`${error instanceof Error ? error.message : "Snapshot loading failed."} Showing the demo fixture instead.`);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [workspaceId]);

  return (
    <div className={styles.adapter} data-state={state}>
      <div className={styles.status} role={state === "error" ? "alert" : "status"} aria-live="polite">
        {state === "loading" ? <LoaderCircle size={14} className={styles.spin} /> : state === "error" ? <TriangleAlert size={14} /> : <Database size={14} />}
        <span>{message}</span>
      </div>
      <SupplyOsProductTwin productImageUrl={fallbackImageUrl} model={model} view={view} />
    </div>
  );
}
