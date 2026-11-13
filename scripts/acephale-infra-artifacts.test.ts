import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hash } from "../src/lib/acephale/canonical";
import { INFRA_OPPORTUNITY_PROFILE_KEYS, validateInfraGoalReliabilityArtifact, validateInfraOpportunityArtifact, wilsonLower, type InfraOpportunityProfile } from "../services/acephale-runtime/infra-artifacts";
import { infraOpportunityProfile } from "../services/acephale-runtime/infra-opportunity-profile";

test("a streamed profile cannot authorize a nonstreamed native runtime", () => {
  const manifest = JSON.parse(readFileSync(new URL("../research/acephale/examples/infra-manifest-v2.fixture.json", import.meta.url), "utf8"));
  const measured = infraOpportunityProfile(manifest, "native", { stream: true });
  const current = infraOpportunityProfile(manifest, "native", { stream: false });
  assert.notEqual(measured.servingHash, current.servingHash);
  const body = { version: 2 as const, profile: measured, sourceDatasetHash: hash("dataset"), families: ["train"], sampleCount: 10,
    estimate: { actorLeadMs: 100, contentionMs: 1, predictionMs: 10, schedulingMs: 1, toolMs: 50, validationMs: 1 } };
  assert.throws(() => validateInfraOpportunityArtifact({ ...body, contentHash: hash(body) }, {
    datasetHash: body.sourceDatasetHash, allowedFamilies: ["train"], opportunityProfile: current,
  }), /profile differs/);
});

test("measured opportunities bind every deployment and prediction profile component", () => {
  const profile = Object.fromEntries(INFRA_OPPORTUNITY_PROFILE_KEYS.map(key => [key, hash(key)])) as InfraOpportunityProfile;
  const scope = { datasetHash: hash("dataset"), allowedFamilies: ["train"], opportunityProfile: profile };
  const body = { version: 2 as const, profile, sourceDatasetHash: scope.datasetHash, families: ["train"], sampleCount: 10,
    estimate: { actorLeadMs: 100, contentionMs: 1, predictionMs: 10, schedulingMs: 1, toolMs: 50, validationMs: 1 } };
  const artifact = { ...body, contentHash: hash(body) };
  assert.equal(validateInfraOpportunityArtifact(artifact, scope).version, 2);
  for (const key of INFRA_OPPORTUNITY_PROFILE_KEYS) {
    assert.throws(() => validateInfraOpportunityArtifact(artifact, { ...scope, opportunityProfile: { ...profile, [key]: hash("changed") } }), /profile differs/);
  }
  assert.throws(() => validateInfraOpportunityArtifact(artifact, { ...scope, opportunityProfile: undefined }), /complete measured/);
  const legacy = { ...body, version: 1 };
  assert.throws(() => validateInfraOpportunityArtifact({ ...legacy, contentHash: hash(legacy) } as never, scope), /provenance/);
  const malformed = { ...body, profile: { ...profile, hardwareHash: "unknown" } };
  assert.throws(() => validateInfraOpportunityArtifact({ ...malformed, contentHash: hash(malformed) }, scope), /complete measured/);
});

test("audited goal reliability cannot be reused across frozen predictor identities", () => {
  const predictor = { model: { repository: "fixture/model", revision: "a".repeat(40) }, memoryHash: hash("memory"),
    predictorContractHash: hash("prompt"), candidateCompilerHash: hash("compiler"), retrievalHash: hash("retrieval") };
  const scope = { datasetHash: hash("dataset"), allowedFamilies: ["train"], excludedFamilies: ["test"], predictor };
  const body = { version: 1 as const, sourceDatasetHash: scope.datasetHash, families: ["train"], annotationHash: hash("annotations"),
    auditedCount: 20, acceptedCount: 18, unsupportedBindings: 0, gradedCount: 20, agreedCount: 18, reliability: wilsonLower(18, 20), provenance: predictor };
  const artifact = { ...body, contentHash: hash(body) };
  assert.equal(validateInfraGoalReliabilityArtifact(artifact, scope).reliability, wilsonLower(18, 20));
  for (const change of [{ memoryHash: hash("other") }, { predictorContractHash: hash("other") },
    { candidateCompilerHash: hash("other") }, { retrievalHash: hash("other") }, { model: { ...predictor.model, revision: "b".repeat(40) } }]) {
    assert.throws(() => validateInfraGoalReliabilityArtifact(artifact, { ...scope, predictor: { ...predictor, ...change } }), /not bound/);
  }
  const { provenance: _provenance, ...unbound } = body;
  assert.throws(() => validateInfraGoalReliabilityArtifact({ ...unbound, contentHash: hash(unbound) }, scope), /not bound/);
  assert.throws(() => validateInfraGoalReliabilityArtifact(artifact, { ...scope, allowedFamilies: ["test"] }), /audit/);
});

test("machine reliability cannot authorize a human-reviewed or differently audited experiment", () => {
  const review = { reviewProtocol: "machine_audited_exploratory" as const, humanReviewCount: 0 as const, machineReviewCount: 20 as const,
    machineAuditHash: hash("machine-audit"), reviewerModel: "gpt-5.4-2026-03-05" as const,
    reviewIndependence: "separate_request_and_prompt_same_model" as const };
  const predictor = { model: { repository: "fixture/model", revision: "a".repeat(40) }, memoryHash: hash("memory"),
    predictorContractHash: hash("prompt"), candidateCompilerHash: hash("compiler"), retrievalHash: hash("retrieval") };
  const scope = { datasetHash: hash("dataset"), allowedFamilies: ["train"], predictor };
  const body = { version: 1 as const, sourceDatasetHash: scope.datasetHash, families: ["train"], annotationHash: hash("annotations"),
    auditedCount: 20, acceptedCount: 18, unsupportedBindings: 0, gradedCount: 20, agreedCount: 18,
    reliability: wilsonLower(18, 20), provenance: { ...predictor, ...review } };
  const artifact = { ...body, contentHash: hash(body) };
  assert.throws(() => validateInfraGoalReliabilityArtifact(artifact, scope), /review protocol differs/);
  assert.equal(validateInfraGoalReliabilityArtifact(artifact, { ...scope, annotationReview: review }).auditedCount, 20);
  assert.throws(() => validateInfraGoalReliabilityArtifact(artifact, { ...scope,
    annotationReview: { ...review, machineAuditHash: hash("different-audit") } }), /exact declared provenance/);
  const mislabeled = { ...body, provenance: { ...body.provenance, reviewProtocol: "human_reviewed" } };
  assert.throws(() => validateInfraGoalReliabilityArtifact({ ...mislabeled, contentHash: hash(mislabeled) }, scope), /cannot contain machine/);
  for (const field of ["reviewerModel", "reviewIndependence"] as const) {
    const orphaned = { ...body, provenance: { ...predictor, [field]: review[field] } };
    assert.throws(() => validateInfraGoalReliabilityArtifact({ ...orphaned, contentHash: hash(orphaned) }, scope), /cannot contain machine/);
  }
  const unsupported = { ...body, unsupportedBindings: 1 };
  assert.throws(() => validateInfraGoalReliabilityArtifact({ ...unsupported, contentHash: hash(unsupported) },
    { ...scope, annotationReview: review }), /valid independent audit/);
});
