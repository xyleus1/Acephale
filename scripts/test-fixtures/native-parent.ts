import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonical, hash } from '../../src/lib/acephale/canonical';
import { INFRA_MODEL_PINS } from '../../src/lib/acephale/infra-manifest';
export function freshSelectionFixture() {
  const directory = resolve("research/acephale/runs", `infra-memory-fit-test-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  const files: Record<string, { sha256: string }> = {};
  const write = (name: string, value: unknown) => {
    const path = join(directory, name);
    writeFileSync(path, name.endsWith(".jsonl") ? (value as unknown[]).map(row => canonical(row) + "\n").join("") : canonical(value) + "\n");
    files[name] = { sha256: createHash("sha256").update(readFileSync(path)).digest("hex") };
  };
  const scope = { tenantId: "fixture", principalId: "fixture", authorizationVersion: "v1", environmentVersion: "fixture", toolSchemaHash: hash("tools") };
  const runtime = ["fitting", "calibration"].map(familyId => ({ id: `run-${familyId}`, familyId, split: "train", scope,
    policyHash: hash("policy"), rawSha256: hash(familyId), success: true, outcomeVerified: true, constraintViolations: 0,
    memoryEligible: true, contrastiveEligible: false, termination: "user_stop",
    messages: [
      { index: 0, role: "user", content: `Read ${familyId}`, calls: [], callId: null, observation: null },
      { index: 1, role: "assistant", content: null, calls: [{ id: "call", tool: familyId === "fitting" ? "FIT_READ" : "CALIBRATION_TOOL_SENTINEL", arguments: { id: familyId } }], callId: null, observation: null },
      { index: 2, role: "tool", content: "found", calls: [], callId: "call", observation: { id: familyId } },
      { index: 3, role: "assistant", content: "Done", calls: [], callId: null, observation: null },
    ] }));
  const split = { families: { fitting: "train", calibration: "train" }, fresh_heldout: false };
  const memory = { frozen: true, split_hash: hash(split), training_families: ["fitting", "calibration"] };
  const receipt = { fixtureOnly: true, closed: true };
  write("cohort-receipt.json", receipt);
  write("split.json", split); write("memory.json", { ...memory, snapshot_hash: hash(memory) });
  write("runtime-runs.jsonl", runtime);
  write("metadata.jsonl", runtime.map(row => ({ episode_id: row.id, family_id: row.familyId,
    scope: { tenant_id: scope.tenantId, principal_id: scope.principalId, authorization_revision: scope.authorizationVersion },
    environment_version: scope.environmentVersion, tool_schema_hash: scope.toolSchemaHash, verification_tier: "native_verified" })));
  for (const name of ["public.jsonl", "labels.jsonl", "trajectories.jsonl", "verdicts.jsonl"]) write(name, []);
  write("lineage.json", { version: "acephale-infra-fresh-native-v1", fresh_qwen_traces: true, fresh_heldout: false,
    actor: INFRA_MODEL_PINS.actor, cohort_receipt_sha256: files["cohort-receipt.json"].sha256, cohort_receipt_hash: hash(receipt),
    all_declared_slots_retained: true, episodes: runtime.length, fresh_sources: Object.fromEntries(runtime.map(row => [row.id,
      { raw_sha256: row.rawSha256, original_tool_schema_hash: scope.toolSchemaHash }])) });
  writeFileSync(join(directory, "manifest.json"), canonical({ schema_version: "acephale-infra-data-v1", files, bundle_hash: hash(files) }));
  const partitions = { weightFitFamilies: ["fitting"], calibrationFamilies: ["calibration"], developmentFamilies: ["development"], testFamilies: ["test"] };
  const proposal = { schemaVersion: 1, kind: "acephale-candidate-only-family-partition-proposal", ...partitions };
  writeFileSync(join(directory, "partition.json"), canonical({ ...proposal, contentHash: hash(proposal) }));
  const review = { schemaVersion: 1, kind: "acephale-source-family-review", reviewer: { kind: "assistant_source_design" },
    humanAnnotationLabelReview: false, historicalAPIGenExcluded: true, partitionProposalHash: hash(proposal) };
  writeFileSync(join(directory, "source-design-review.json"), canonical({ ...review, contentHash: hash(review) }));
  const approved = { schemaVersion: 1, kind: "acephale-candidate-only-family-partition", ...partitions,
    executionAuthorized: true, evaluationEligible: true, efficacyClaimAllowed: false,
    review: { status: "completed", reviewerKind: "assistant_source_design", humanAnnotationLabelReview: false, sourceDesignReviewHash: hash(review) } };
  const partitionPath = join(directory, "partition-approved.json");
  writeFileSync(partitionPath, canonical({ ...approved, contentHash: hash(approved) }));
  return { directory, partitionPath, approved };
}

export function multiCohortFixture(newline = "\n") {
  const { directory } = freshSelectionFixture();
  const read = (name: string) => JSON.parse(readFileSync(join(directory, name), "utf8"));
  const manifest = read("manifest.json"), lineage = read("lineage.json");
  const put = (name: string, value: unknown, text = canonical(value) + "\n") => {
    writeFileSync(join(directory, name), text);
    manifest.files[name] = { sha256: createHash("sha256").update(text).digest("hex") };
  };
  const policy = { fitting: "train", calibration: "development" };
  const metadata = readFileSync(join(directory, "metadata.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  const split = { schema_version: "acephale-infra-data-v1", families: policy, declared_family_policy: policy, fresh_heldout: false,
    episodes: Object.fromEntries(metadata.map(row => [row.episode_id, row.family_id])),
    metadata_hash: hash([...metadata].sort((a, b) => a.episode_id.localeCompare(b.episode_id))) };
  const memory = { frozen: true, split_hash: hash(split), training_families: ["fitting"] };
  put("split.json", split); put("memory.json", { ...memory, snapshot_hash: hash(memory) });
  const publicRows = metadata.flatMap(meta => [0, 1].map(index => ({ schema_version: "acephale-infra-data-v1", episode_id: meta.episode_id,
    checkpoint_id: `${meta.episode_id}:${index}`, family_id: meta.family_id,
    request_revision: "fixture-revision",
    split: policy[meta.family_id as keyof typeof policy], runtime_tool_schema_hash: meta.tool_schema_hash,
    tool_schema_hash: meta.tool_schema_hash, environment_version: meta.environment_version, scope: meta.scope,
    input: { observation: { fraction: 1e-7, name: "caf\u00e9" } }, input_hash: hash({ observation: { fraction: 1e-7, name: "caf\u00e9" } }) })));
  // Match Python's exponent and escaped Unicode forms, both semantically valid
  // JSON that differ from RFC8785 and JavaScript's serialization.
  const lines = publicRows.map(row => JSON.stringify(row).replaceAll("1e-7", "1e-07").replaceAll("\u00e9", "\\u00e9") + newline);
  put("public.jsonl", null, lines.join(""));
  const cohorts = metadata.map((meta, index) => {
    const runs = [{ runId: meta.episode_id, familyId: meta.family_id, domain: "retail", taskId: `task-${index}`, seed: 17, arm: "base" }];
    const configuration = { stage: "collection", runs, taskBundleHash: hash("tasks"),
      ...(index ? { collectionPurpose: "auxiliary-development-validation", hosted: { allocation: "development" } } : {}) };
    const modelManifest = { actor: INFRA_MODEL_PINS.actor, protocol: { scheduleHash: hash(runs) },
      data: { trainingFamilies: ["fitting"], developmentFamilies: ["calibration"], heldoutFamilies: [] } };
    const receipt = { version: 1, stage: "collection", closed: true, completed: true,
      allDeclaredSlotsRetained: true, serviceExitCode: 0, configurationHash: hash(configuration), manifestHash: hash(modelManifest),
      files: [{ path: `${meta.episode_id}.json`, sha256: lineage.fresh_sources[meta.episode_id].raw_sha256 }] };
    const receiptText = canonical(receipt) + "\n", cohortId = hash(receipt);
    lineage.fresh_sources[meta.episode_id].cohort_id = cohortId;
    return { receipt, receiptText, receiptSha256: createHash("sha256").update(receiptText).digest("hex"),
      cohortId, configuration, manifest: modelManifest, runIds: [meta.episode_id],
      purpose: index ? "auxiliary-development-validation" : "original-base-collection" };
  });
  const parentFiles = { "public.jsonl": { sha256: createHash("sha256").update(lines.slice(0, 2).join("")).digest("hex") },
    "split.json": manifest.files["split.json"] };
  const aggregateBody = { version: 2, kind: "acephale-fresh-native-multicohort", closed: true,
    allDeclaredSlotsRetained: true, pairedComparisonSlotsReused: false, cohorts,
    episodeCohorts: Object.fromEntries(cohorts.map(cohort => [cohort.runIds[0], cohort.cohortId])),
    parentDatasets: [{ bundleHash: hash(parentFiles), cohortId: cohorts[0].cohortId,
      manifest: { bundle_hash: hash(parentFiles), files: parentFiles }, split,
      publicCheckpointIds: publicRows.slice(0, 2).map(row => row.checkpoint_id) }] };
  const aggregate = { ...aggregateBody, contentHash: hash(aggregateBody) };
  put("cohort-receipt.json", aggregate);
  Object.assign(lineage, { version: "acephale-infra-fresh-native-v2", cohort_count: 2, cohort_files: null,
    cohort_receipt_sha256: manifest.files["cohort-receipt.json"].sha256, cohort_receipt_hash: hash(aggregate) });
  put("lineage.json", lineage);
  const seal = () => writeFileSync(join(directory, "manifest.json"), canonical({ ...manifest, bundle_hash: hash(manifest.files) }));
  seal();
  return { directory, lines, put, seal, publicRows, parent: aggregate.parentDatasets[0] };
}

