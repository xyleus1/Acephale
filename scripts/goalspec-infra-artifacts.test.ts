import assert from "node:assert/strict";
import test from "node:test";
import { hash } from "../src/lib/goalspec/canonical";
import { validateInfraGoalReliabilityArtifact, wilsonLower } from "../services/goalspec-runtime/infra-artifacts";

test("audited goal reliability cannot be reused across frozen predictor identities", () => {
  const predictor = { model: { repository: "fixture/model", revision: "a".repeat(40) }, memoryHash: hash("memory"),
    predictorContractHash: hash("prompt"), candidateCompilerHash: hash("compiler") };
  const scope = { datasetHash: hash("dataset"), allowedFamilies: ["train"], excludedFamilies: ["test"], predictor };
  const body = { version: 1 as const, sourceDatasetHash: scope.datasetHash, families: ["train"], annotationHash: hash("annotations"),
    auditedCount: 20, acceptedCount: 18, unsupportedBindings: 0, gradedCount: 20, agreedCount: 18, reliability: wilsonLower(18, 20), provenance: predictor };
  const artifact = { ...body, contentHash: hash(body) };
  assert.equal(validateInfraGoalReliabilityArtifact(artifact, scope).reliability, wilsonLower(18, 20));
  for (const change of [{ memoryHash: hash("other") }, { predictorContractHash: hash("other") },
    { candidateCompilerHash: hash("other") }, { model: { ...predictor.model, revision: "b".repeat(40) } }]) {
    assert.throws(() => validateInfraGoalReliabilityArtifact(artifact, { ...scope, predictor: { ...predictor, ...change } }), /not bound/);
  }
  const { provenance: _provenance, ...unbound } = body;
  assert.throws(() => validateInfraGoalReliabilityArtifact({ ...unbound, contentHash: hash(unbound) }, scope), /not bound/);
  assert.throws(() => validateInfraGoalReliabilityArtifact(artifact, { ...scope, allowedFamilies: ["test"] }), /audit/);
});
