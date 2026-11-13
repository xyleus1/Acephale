import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { hash } from "../../src/lib/acephale/canonical";
import { validateNativeLoraServing } from "../../src/lib/acephale/predictor-serving-qualification";
import { resolvePredictorProfile, type PredictorProfile } from "../../src/lib/acephale/predictor-artifact";
import { validateInfraManifest } from "../../src/lib/acephale/infra-manifest";

const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const hexHash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export class NativeSplitGuardError extends Error {
  constructor(readonly reasonCode: "stale" | "degraded" | "identity", message: string,
    readonly heartbeatAgeMs?: number, readonly maxStatusAgeMs?: number) { super(message); }
}

/** Never put filesystem errors, status contents or host identities in stop diagnostics. */
export function nativeSplitGuardDiagnostic(error: unknown) {
  return error instanceof NativeSplitGuardError ? {
    reasonCode: error.reasonCode,
    ...(Number.isFinite(error.heartbeatAgeMs) ? { heartbeatAgeMs: error.heartbeatAgeMs } : {}),
    ...(Number.isFinite(error.maxStatusAgeMs) ? { maxStatusAgeMs: error.maxStatusAgeMs } : {}),
  } : { reasonCode: "degraded" as const };
}

function verifiedKnownHosts(path: string, host: string, port: number, fingerprint: string) {
  const bytes = readFileSync(path), lines = bytes.toString("utf8").split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith("#")).map(line => line.split(/\s+/));
  const expectedHost = port === 22 ? host : `[${host}]:${port}`, line = lines[0];
  if (lines.length !== 1 || ![3, 4].includes(line.length) || line[0] !== expectedHost || line[1] !== "ssh-ed25519"
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(line[2])) throw new Error("Dedicated known_hosts must pin the observed Lambda ed25519 key");
  const raw = Buffer.from(line[2], "base64");
  if (`SHA256:${createHash("sha256").update(raw).digest("base64").replace(/=+$/, "")}` !== fingerprint) throw new Error("Pinned SSH key differs from Lambda receipt");
  return sha256(bytes);
}

/** Mirror Python lambda_binding, including its exact heartbeat provenance fields. */
function lambdaBinding(guard: Record<string, any>, inventory: Record<string, any>, base: string) {
  const provider = inventory.provider ?? {}, receipt = provider.identityReceipt ?? {}, instance = receipt.instance ?? {}, ssh = receipt.ssh ?? {};
  const { contentHash: _contentHash, ...body } = receipt;
  if (provider.name !== "lambda" || receipt.version !== 1 || receipt.provider !== "lambda" || receipt.profile !== "acephale-infra-v1"
    || receipt.contentHash !== hash(body) || receipt.providerResponseHash !== hash(instance)
    || receipt.hardwareProfile !== "a100-40gb-v1" || !hexHash(receipt.hardwareProfileHash) || !hexHash(receipt.studyBindingHash)
    || receipt.leaseName !== `acephale-infra-${receipt.leaseId ?? ""}` || instance.name !== receipt.leaseName || instance.status !== "active"
    || instance.instance_type?.name !== "gpu_1x_a100_sxm4" || instance.id !== guard.expectedInstanceId || ssh.host !== instance.ip
    || guard.sshDestination !== `${ssh.user}@${ssh.host}` || ssh.port !== guard.sshPort || ssh.user !== "ubuntu"
    || typeof ssh.hostKeySha256 !== "string" || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(ssh.hostKeySha256)
    || ssh.hostKeySha256 !== guard.expectedHostKeySha256 || !hexHash(ssh.machineIdSha256) || ssh.machineIdSha256 !== guard.expectedMachineIdSha256
    || typeof guard.knownHostsPath !== "string" || !guard.knownHostsPath) throw new Error("Lambda API association and pinned SSH/machine identity differ");
  const knownHostsPath = resolve(base, guard.knownHostsPath), knownHostsHash = verifiedKnownHosts(knownHostsPath, ssh.host, ssh.port, ssh.hostKeySha256);
  return { provider: "lambda", providerReceiptHash: receipt.contentHash, hostKeySha256: ssh.hostKeySha256,
    machineIdSha256: ssh.machineIdSha256, knownHostsHash, knownHostsPath, sshHost: ssh.host,
    identityMethod: "Lambda API IP + pinned SSH host key + local machine-id" };
}

/** Bind the locally clocked heartbeat to this manifest and the exact private forwards. */
export function nativeSplitGuard(configuration: { splitGuardPath?: string; actorBaseUrl: string; predictorBaseUrl?: string; otlpBaseUrl?: string },
  manifest: { sourceCommit?: string; actor: { servedModel: string }; predictor: { servedModel: string; trainedPredictor?: { schemaVersion: number; base: { repository: string } } } }, configurationPath: string) {
  if (!configuration.splitGuardPath) {
    if (manifest.predictor.trainedPredictor?.schemaVersion === 2) throw new Error("Native LoRA requires current qualified split-guard serving evidence");
    return undefined;
  }
  const guardPath = resolve(dirname(configurationPath), configuration.splitGuardPath);
  const guard = JSON.parse(readFileSync(guardPath, "utf8"));
  const provider = guard.provider ?? "aws", instancePattern = provider === "aws" ? /^i-[0-9a-f]{8,17}$/ : /^[a-zA-Z0-9_-]{1,100}$/;
  if (guard.version !== 1 || !/^[A-Za-z0-9_.@-]+$/.test(guard.sshDestination) || guard.sshDestination.startsWith("-")
    || !["aws", "lambda"].includes(provider) || !instancePattern.test(guard.expectedInstanceId) || !Number.isInteger(guard.sshPort) || guard.sshPort < 1 || guard.sshPort > 65535
    || !guard.localPorts || Object.keys(guard.localPorts).sort().join() !== "actor,otlp,predictor"
    || Object.values(guard.localPorts).some(port => !Number.isInteger(port) || Number(port) < 1024 || Number(port) > 65535)
    || new Set(Object.values(guard.localPorts)).size !== 3) throw new Error("Invalid native split guard provenance");
  const deployment = JSON.parse(readFileSync(resolve(dirname(guardPath), guard.deploymentPath), "utf8"));
  const inventory = JSON.parse(readFileSync(resolve(dirname(guardPath), guard.inventoryEvidencePath), "utf8"));
  if (deployment.observed !== true || deployment.evidenceHash !== hash(inventory) || inventory.provider?.instanceId !== guard.expectedInstanceId
    || deployment.sourceCommit !== (manifest as { sourceCommit?: string }).sourceCommit
    || ["actor", "predictor", "runtime", "hardware"].some(key => hash(deployment[key] ?? null) !== hash((manifest as Record<string, unknown>)[key] ?? null))) throw new Error("Split guard inventory differs from frozen experiment");
  const providerBinding = provider === "lambda" ? lambdaBinding(guard, inventory, dirname(guardPath)) : undefined;
  const qualificationHash = validateNativeLoraServing(manifest.predictor, inventory, manifest.sourceCommit ?? "");
  const servingContainers = Object.fromEntries(["actor", "predictor"].map(role => [role, Object.fromEntries(["id", "imageId", "startedAt"].map(key => [key, inventory.containers[role][key]]))]));
  if (Object.values(servingContainers).some(container => !hexHash(container.id))) throw new Error("Observed serving container identities required");
  if (qualificationHash) for (const role of ["actor", "predictor"]) servingContainers[role].commandHash = inventory.containers[role].commandHash;
  const endpoints = Object.fromEntries(Object.entries(guard.localPorts).map(([role, port]) => [role, `http://127.0.0.1:${port}`]));
  for (const [role, value] of [["actor", configuration.actorBaseUrl], ["predictor", configuration.predictorBaseUrl], ["otlp", configuration.otlpBaseUrl]]) {
    if (!value || value.replace(/\/$/, "").replace(/\/v1$/, "") !== endpoints[role!]) throw new Error("Native model/telemetry endpoints differ from guard-owned tunnels");
  }
  const provenance = { version: 1, manifestHash: hash(manifest), sshDestination: guard.sshDestination,
    sshPort: guard.sshPort, expectedInstanceId: guard.expectedInstanceId, endpoints,
    remotePorts: { actor: 8000, predictor: 8001, otlp: 4318 },
    deploymentEvidenceHash: deployment.evidenceHash, servingContainers,
    servedModels: { actor: manifest.actor.servedModel, predictor: manifest.predictor.servedModel }, ...providerBinding,
    ...(qualificationHash ? { nativeLoraQualificationHash: qualificationHash,
      predictorBaseServedModel: manifest.predictor.trainedPredictor!.base.repository } : {}) };
  const expected = hash(provenance);
  return () => {
    if (providerBinding) {
      try {
        if (verifiedKnownHosts(providerBinding.knownHostsPath, providerBinding.sshHost, guard.sshPort, providerBinding.hostKeySha256) !== providerBinding.knownHostsHash) throw new Error();
      } catch { throw new NativeSplitGuardError("identity", "Pinned SSH identity file changed after guard startup"); }
    }
    const directory = process.env.ACEPHALE_HOST_STATUS_FILE;
    if (!directory) throw new NativeSplitGuardError("degraded", "Split execution requires its local heartbeat directory");
    let name: string | undefined, status;
    try {
      name = readdirSync(directory).filter(name => /^\d{16}\.json$/.test(name)).sort().at(-1);
      if (!name) throw new Error();
      status = JSON.parse(readFileSync(join(directory, name), "utf8"));
      if (!status || typeof status !== "object" || Array.isArray(status)) throw new Error();
    } catch { throw new NativeSplitGuardError("degraded", "Split guard heartbeat missing or unreadable"); }
    const age = Date.now() - status.observedAtUnixMs;
    const maximumAge = Math.min(3000, status.maxStatusAgeMs);
    if (status.healthy !== true || status.state !== "healthy" || status.networkConnected !== true
      || typeof status.observedAtUnixMs !== "number" || !Number.isFinite(status.observedAtUnixMs)
      || typeof status.maxStatusAgeMs !== "number" || !Number.isFinite(status.maxStatusAgeMs) || status.maxStatusAgeMs <= 0
      || status.heartbeatSequence !== Number(name.slice(0, 16))) throw new NativeSplitGuardError("degraded", "Split host heartbeat is degraded", age, maximumAge);
    if (age < -1000 || age > maximumAge) throw new NativeSplitGuardError("stale", "Split host heartbeat is stale", age, maximumAge);
    if (status.endpointProvenanceHash !== expected || status.manifestHash !== hash(manifest)
      || status.remoteInstanceId !== guard.expectedInstanceId) throw new NativeSplitGuardError("identity", "Split heartbeat belongs to another host, manifest or endpoint set", age, maximumAge);
    return { endpointProvenanceHash: expected, manifestHash: hash(manifest), remoteInstanceId: guard.expectedInstanceId };
  };
}

/** Calibration uses the same active owner and heartbeat as native execution. */
export function predictionSplitGuard(profile: PredictorProfile, baseUrl: string, configurationPath?: string) {
  const resolved = resolvePredictorProfile(profile);
  if (resolved.trainedPredictor?.schemaVersion !== 2) return undefined;
  if (!configurationPath) throw new Error("Native LoRA prediction requires its qualified native serving configuration");
  const path = resolve(configurationPath), configuration = JSON.parse(readFileSync(path, "utf8"));
  const manifest = JSON.parse(readFileSync(resolve(dirname(path), configuration.manifestPath), "utf8"));
  validateInfraManifest(manifest);
  if (hash(resolvePredictorProfile(manifest.predictor)) !== hash(resolved)
    || configuration.predictorBaseUrl?.replace(/\/$/, "").replace(/\/v1$/, "") !== baseUrl.replace(/\/$/, "").replace(/\/v1$/, "")) {
    throw new Error("Prediction model or endpoint differs from its qualified serving configuration");
  }
  const guard = nativeSplitGuard(configuration, manifest, path)!;
  guard();
  return guard;
}
