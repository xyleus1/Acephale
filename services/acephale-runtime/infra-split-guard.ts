import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hash } from "../../src/lib/acephale/canonical";

/** Bind the locally clocked heartbeat to this manifest and the exact private forwards. */
export function nativeSplitGuard(configuration: { splitGuardPath?: string; actorBaseUrl: string; predictorBaseUrl?: string; otlpBaseUrl?: string },
  manifest: { actor: { servedModel: string }; predictor: { servedModel: string } }, configurationPath: string) {
  if (!configuration.splitGuardPath) return undefined;
  const guardPath = resolve(dirname(configurationPath), configuration.splitGuardPath);
  const guard = JSON.parse(readFileSync(guardPath, "utf8"));
  if (guard.version !== 1 || !/^[A-Za-z0-9_.@-]+$/.test(guard.sshDestination) || guard.sshDestination.startsWith("-")
    || !/^i-[0-9a-f]{8,17}$/.test(guard.expectedInstanceId) || !Number.isInteger(guard.sshPort) || guard.sshPort < 1 || guard.sshPort > 65535
    || !guard.localPorts || Object.keys(guard.localPorts).sort().join() !== "actor,otlp,predictor"
    || Object.values(guard.localPorts).some(port => !Number.isInteger(port) || Number(port) < 1024 || Number(port) > 65535)
    || new Set(Object.values(guard.localPorts)).size !== 3) throw new Error("Invalid native split guard provenance");
  const deployment = JSON.parse(readFileSync(resolve(dirname(guardPath), guard.deploymentPath), "utf8"));
  const inventory = JSON.parse(readFileSync(resolve(dirname(guardPath), guard.inventoryEvidencePath), "utf8"));
  if (deployment.observed !== true || deployment.evidenceHash !== hash(inventory) || inventory.provider?.instanceId !== guard.expectedInstanceId
    || deployment.sourceCommit !== (manifest as { sourceCommit?: string }).sourceCommit
    || ["actor", "predictor", "runtime", "hardware"].some(key => hash(deployment[key] ?? null) !== hash((manifest as Record<string, unknown>)[key] ?? null))) throw new Error("Split guard inventory differs from frozen experiment");
  const servingContainers = Object.fromEntries(["actor", "predictor"].map(role => [role, Object.fromEntries(["id", "imageId", "startedAt"].map(key => [key, inventory.containers[role][key]]))]));
  const endpoints = Object.fromEntries(Object.entries(guard.localPorts).map(([role, port]) => [role, `http://127.0.0.1:${port}`]));
  for (const [role, value] of [["actor", configuration.actorBaseUrl], ["predictor", configuration.predictorBaseUrl], ["otlp", configuration.otlpBaseUrl]]) {
    if (!value || value.replace(/\/$/, "").replace(/\/v1$/, "") !== endpoints[role!]) throw new Error("Native model/telemetry endpoints differ from guard-owned tunnels");
  }
  const provenance = { version: 1, manifestHash: hash(manifest), sshDestination: guard.sshDestination,
    sshPort: guard.sshPort, expectedInstanceId: guard.expectedInstanceId, endpoints,
    remotePorts: { actor: 8000, predictor: 8001, otlp: 4318 },
    deploymentEvidenceHash: deployment.evidenceHash, servingContainers,
    servedModels: { actor: manifest.actor.servedModel, predictor: manifest.predictor.servedModel } };
  const expected = hash(provenance);
  return () => {
    const directory = process.env.ACEPHALE_HOST_STATUS_FILE;
    if (!directory) throw new Error("Split execution requires its local heartbeat directory");
    const name = readdirSync(directory).filter(name => /^\d{16}\.json$/.test(name)).sort().at(-1);
    if (!name) throw new Error("Split guard heartbeat missing");
    const status = JSON.parse(readFileSync(join(directory, name), "utf8"));
    const age = Date.now() - status.observedAtUnixMs;
    if (status.healthy !== true || status.state !== "healthy" || status.networkConnected !== true
      || typeof status.observedAtUnixMs !== "number" || !Number.isFinite(status.observedAtUnixMs)
      || typeof status.maxStatusAgeMs !== "number" || !Number.isFinite(status.maxStatusAgeMs) || status.maxStatusAgeMs <= 0
      || age < -1000 || age > Math.min(3000, status.maxStatusAgeMs) || status.heartbeatSequence !== Number(name.slice(0, 16))) throw new Error("Split host heartbeat is degraded or stale");
    if (status.endpointProvenanceHash !== expected || status.manifestHash !== hash(manifest)
      || status.remoteInstanceId !== guard.expectedInstanceId) throw new Error("Split heartbeat belongs to another host, manifest or endpoint set");
    return { endpointProvenanceHash: expected, manifestHash: hash(manifest), remoteInstanceId: guard.expectedInstanceId };
  };
}
