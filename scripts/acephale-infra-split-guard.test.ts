import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { hash } from "../src/lib/acephale/canonical";
import { nativeSplitGuard, nativeSplitGuardDiagnostic, NativeSplitGuardError } from "../services/acephale-runtime/infra-split-guard";

test("split heartbeat binds exact manifest, endpoints and remote identity, and rejects newest stale status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-split-guard-")), previous = process.env.ACEPHALE_HOST_STATUS_FILE;
  const manifest = { actor: { servedModel: "fixed-actor" }, predictor: { servedModel: "fixed-predictor" }, runtime: {}, hardware: {}, sourceCommit: "a".repeat(40) };
  const configuration = { splitGuardPath: "guard.json", actorBaseUrl: "http://127.0.0.1:18000", predictorBaseUrl: "http://127.0.0.1:18001/v1", otlpBaseUrl: "http://127.0.0.1:14318" };
  const guard = { version: 1, sshDestination: "ubuntu@gpu", sshPort: 22, expectedInstanceId: "i-0123456789abcdef0", localPorts: { actor: 18000, predictor: 18001, otlp: 14318 },
    deploymentPath: "deployment.json", inventoryEvidencePath: "inventory.json" };
  const servingContainers = Object.fromEntries(["actor", "predictor"].map((role, index) => [role, { id: String(index + 1).repeat(64), imageId: "sha256:" + "c".repeat(64), startedAt: "2026-01-01T00:00:00Z" }]));
  const inventory = { provider: { instanceId: guard.expectedInstanceId }, containers: servingContainers };
  const deployment = { ...manifest, observed: true, evidenceHash: hash(inventory) };
  const provenance = { version: 1, manifestHash: hash(manifest), sshDestination: guard.sshDestination, sshPort: guard.sshPort,
    expectedInstanceId: guard.expectedInstanceId, endpoints: { actor: configuration.actorBaseUrl, predictor: "http://127.0.0.1:18001", otlp: configuration.otlpBaseUrl },
    deploymentEvidenceHash: deployment.evidenceHash, servingContainers,
    remotePorts: { actor: 8000, predictor: 8001, otlp: 4318 }, servedModels: { actor: manifest.actor.servedModel, predictor: manifest.predictor.servedModel } };
  try {
    await writeFile(join(directory, "guard.json"), JSON.stringify(guard));
    await writeFile(join(directory, "deployment.json"), JSON.stringify(deployment)); await writeFile(join(directory, "inventory.json"), JSON.stringify(inventory));
    process.env.ACEPHALE_HOST_STATUS_FILE = directory;
    const check = nativeSplitGuard(configuration, manifest, join(directory, "configuration.json"))!;
    let sequence = 0;
    const publish = async (changes = {}) => {
      sequence++;
      await writeFile(join(directory, `${String(sequence).padStart(16, "0")}.json`), JSON.stringify({ healthy: true, state: "healthy", networkConnected: true,
        observedAtUnixMs: Date.now(), maxStatusAgeMs: 3000, heartbeatSequence: sequence, endpointProvenanceHash: hash(provenance),
        manifestHash: hash(manifest), remoteInstanceId: guard.expectedInstanceId, ...changes }));
    };
    await publish(); assert.equal(check().remoteInstanceId, guard.expectedInstanceId);
    await publish({ remoteInstanceId: "i-fedcba98765432100" }); assert.throws(check, { reasonCode: "identity" });
    await publish({ endpointProvenanceHash: "0".repeat(64) }); assert.throws(check, /endpoint set/);
    await publish({ observedAtUnixMs: Date.now() - 3857 }); assert.throws(check, (error: unknown) => {
      const diagnostic = nativeSplitGuardDiagnostic(error);
      assert.equal(diagnostic.reasonCode, "stale"); assert.ok(diagnostic.heartbeatAgeMs! >= 3857);
      assert.equal(diagnostic.maxStatusAgeMs, 3000);
      assert.deepEqual(Object.keys(diagnostic).sort(), ["heartbeatAgeMs", "maxStatusAgeMs", "reasonCode"]); return true;
    });
    await publish({ healthy: false, state: "degraded" }); assert.throws(check, { reasonCode: "degraded" });
    await publish({ maxStatusAgeMs: 100, observedAtUnixMs: Date.now() - 200 }); assert.throws(check, { reasonCode: "stale", maxStatusAgeMs: 100 });
    await publish({ observedAtUnixMs: Date.now() + 2000 }); assert.throws(check, { reasonCode: "stale" });
    await publish({ observedAtUnixMs: "private-invalid-status" }); assert.throws(check, { reasonCode: "degraded" });
    assert.deepEqual(nativeSplitGuardDiagnostic(new Error("private/path/secret")), { reasonCode: "degraded" });
    assert.deepEqual(nativeSplitGuardDiagnostic(new NativeSplitGuardError("degraded", "private payload", NaN, Infinity)), { reasonCode: "degraded" });
    assert.throws(() => nativeSplitGuard({ ...configuration, actorBaseUrl: "http://127.0.0.1:19999" }, manifest, join(directory, "configuration.json")), /tunnels/);
  } finally {
    if (previous === undefined) delete process.env.ACEPHALE_HOST_STATUS_FILE; else process.env.ACEPHALE_HOST_STATUS_FILE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("Lambda guard binds provider receipt, pinned host key and machine identity and fences changed files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-lambda-guard-")), previous = process.env.ACEPHALE_HOST_STATUS_FILE;
  const manifest = { actor: { servedModel: "fixed-actor" }, predictor: { servedModel: "fixed-predictor" }, runtime: {}, hardware: {}, sourceCommit: "a".repeat(40) };
  const configuration = { splitGuardPath: "guard.json", actorBaseUrl: "http://127.0.0.1:18000", predictorBaseUrl: "http://127.0.0.1:18001/v1", otlpBaseUrl: "http://127.0.0.1:14318" };
  const key = Buffer.from("synthetic ssh fixture"), hostKeySha256 = "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
  const instance = { id: "lambda-instance", name: "acephale-infra-lease", ip: "203.0.113.1", status: "active", instance_type: { name: "gpu_1x_a100_sxm4" } };
  const ssh = { host: instance.ip, port: 22, user: "ubuntu", hostKeySha256, machineIdSha256: "e".repeat(64) };
  const body = { version: 1, profile: "acephale-infra-v1", provider: "lambda", leaseId: "lease", leaseName: instance.name,
    hardwareProfile: "a100-40gb-v1", hardwareProfileHash: "d".repeat(64), studyBindingHash: "c".repeat(64), instance, ssh, providerResponseHash: hash(instance) };
  const receipt = { ...body, contentHash: hash(body) };
  const guard = { version: 1, provider: "lambda", sshDestination: `ubuntu@${instance.ip}`, sshPort: 22, expectedInstanceId: instance.id,
    expectedHostKeySha256: hostKeySha256, expectedMachineIdSha256: ssh.machineIdSha256, knownHostsPath: "known_hosts",
    localPorts: { actor: 18000, predictor: 18001, otlp: 14318 }, deploymentPath: "deployment.json", inventoryEvidencePath: "inventory.json" };
  const servingContainers = Object.fromEntries(["actor", "predictor"].map((role, index) => [role, { id: String(index + 1).repeat(64), imageId: "sha256:" + "c".repeat(64), startedAt: "2026-01-01T00:00:00Z" }]));
  const inventory = { provider: { name: "lambda", instanceId: instance.id, identityReceipt: receipt }, containers: servingContainers };
  const knownHosts = `${instance.ip} ssh-ed25519 ${key.toString("base64")}\n`;
  const persist = async () => {
    await writeFile(join(directory, "guard.json"), JSON.stringify(guard));
    await writeFile(join(directory, "inventory.json"), JSON.stringify(inventory));
    await writeFile(join(directory, "deployment.json"), JSON.stringify({ ...manifest, observed: true, evidenceHash: hash(inventory) }));
  };
  try {
    await persist(); await writeFile(join(directory, "known_hosts"), knownHosts);
    process.env.ACEPHALE_HOST_STATUS_FILE = directory;
    const provenance = { version: 1, manifestHash: hash(manifest), sshDestination: guard.sshDestination, sshPort: 22, expectedInstanceId: instance.id,
      endpoints: { actor: configuration.actorBaseUrl, predictor: "http://127.0.0.1:18001", otlp: configuration.otlpBaseUrl },
      remotePorts: { actor: 8000, predictor: 8001, otlp: 4318 }, deploymentEvidenceHash: hash(inventory), servingContainers,
      servedModels: { actor: manifest.actor.servedModel, predictor: manifest.predictor.servedModel }, provider: "lambda", providerReceiptHash: receipt.contentHash,
      hostKeySha256, machineIdSha256: ssh.machineIdSha256, knownHostsHash: createHash("sha256").update(knownHosts).digest("hex"),
      knownHostsPath: join(directory, "known_hosts"), sshHost: instance.ip, identityMethod: "Lambda API IP + pinned SSH host key + local machine-id" };
    await writeFile(join(directory, "0000000000000001.json"), JSON.stringify({ healthy: true, state: "healthy", networkConnected: true, observedAtUnixMs: Date.now(),
      maxStatusAgeMs: 3000, heartbeatSequence: 1, endpointProvenanceHash: hash(provenance), manifestHash: hash(manifest), remoteInstanceId: instance.id }));
    const check = () => nativeSplitGuard(configuration, manifest, join(directory, "configuration.json"))!;
    const running = check(); assert.equal(running().remoteInstanceId, instance.id);
    await writeFile(join(directory, "known_hosts"), knownHosts + "# changed after startup\n");
    assert.throws(running, { reasonCode: "identity", message: "Pinned SSH identity file changed after guard startup" });
    await writeFile(join(directory, "known_hosts"), knownHosts.replace(instance.ip, "203.0.113.2")); assert.throws(check, /known_hosts/);
    await writeFile(join(directory, "known_hosts"), knownHosts);
    guard.expectedMachineIdSha256 = "f".repeat(64); await persist(); assert.throws(check, /identity differ/);
    guard.expectedMachineIdSha256 = ssh.machineIdSha256;
    receipt.instance.status = "terminated"; await persist(); assert.throws(check, /identity differ/);
    receipt.instance.status = "active"; receipt.hardwareProfile = "unapproved"; await persist(); assert.throws(check, /identity differ/);
    receipt.hardwareProfile = "a100-40gb-v1"; guard.provider = "unrecognized"; await persist(); assert.throws(check, /Invalid native/);
  } finally {
    if (previous === undefined) delete process.env.ACEPHALE_HOST_STATUS_FILE; else process.env.ACEPHALE_HOST_STATUS_FILE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
