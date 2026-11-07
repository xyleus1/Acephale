import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hash } from "../src/lib/acephale/canonical";
import { nativeSplitGuard } from "../services/acephale-runtime/infra-split-guard";

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
    await publish({ remoteInstanceId: "i-fedcba98765432100" }); assert.throws(check, /another host/);
    await publish({ endpointProvenanceHash: "0".repeat(64) }); assert.throws(check, /endpoint set/);
    await publish({ observedAtUnixMs: Date.now() - 3100 }); assert.throws(check, /stale/);
    await publish({ healthy: false, state: "degraded" }); assert.throws(check, /degraded/);
    assert.throws(() => nativeSplitGuard({ ...configuration, actorBaseUrl: "http://127.0.0.1:19999" }, manifest, join(directory, "configuration.json")), /tunnels/);
  } finally {
    if (previous === undefined) delete process.env.ACEPHALE_HOST_STATUS_FILE; else process.env.ACEPHALE_HOST_STATUS_FILE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
