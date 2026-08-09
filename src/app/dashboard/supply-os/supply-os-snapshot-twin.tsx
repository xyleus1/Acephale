"use client";

import { Database, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  snapshotResponseToTwinModel,
  type SupplyOsSnapshotTwinModel,
  type SupplyWorkspaceSnapshotResponse,
} from "@/lib/supply-os/snapshot-twin";
import { SupplyOsProductTwin, type SupplyOsPhotoAttribution } from "./supply-os-product-twin";
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
  fallbackImageAttribution,
  view = "materials",
}: {
  workspaceId: string | null;
  fallbackImageUrl?: string | null;
  fallbackImageAttribution?: SupplyOsPhotoAttribution | null;
  view?: "materials" | "scenarios";
}) {
  const [state, setState] = useState<AdapterState>(workspaceId ? "loading" : "fallback");
  const [model, setModel] = useState<SupplyOsSnapshotTwinModel | null>(null);
  const [message, setMessage] = useState(workspaceId ? "Loading snapshot" : "Demo data");

  useEffect(() => {
    if (!workspaceId) {
      setModel(null);
      setState("fallback");
      setMessage("Demo data");
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setModel(null);
    setState("loading");
    setMessage("Loading snapshot");
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
          setMessage("No published BOM. Showing demo data.");
          return;
        }
        setModel(nextModel);
        setState("published");
        setMessage(`Snapshot v${nextModel.snapshotVersion}`);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
        setMessage(`${error instanceof Error ? error.message : "Snapshot loading failed."} Showing demo data.`);
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
      <SupplyOsProductTwin productImageUrl={fallbackImageUrl} productImageAttribution={fallbackImageAttribution} model={model} view={view} />
    </div>
  );
}
