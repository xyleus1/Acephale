/** Bridge audited fresh native inputs to frozen runtime memory. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, relative, isAbsolute } from "node:path";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { buildMemoryArtifact, validateMemoryArtifact, type FrozenExperienceMemory, type MemoryMessage, type MemoryRun, type MemoryFamilySelection } from "../src/lib/acephale/experience-memory";
import { INFRA_MODEL_PINS } from "../src/lib/acephale/infra-manifest";
import { extractMemoryEpisodes } from "../src/lib/acephale/trace-extractor";
import { extractCausalMemoryMisses } from "../src/lib/acephale/causal-memory";

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export function verifyInfraPilotBundle(directory: string) {
  const manifest = json(join(directory, "manifest.json"));
  if (manifest.schema_version !== "acephale-infra-data-v1" || manifest.bundle_hash !== hash(manifest.files)) throw new Error("Invalid pilot manifest");
  if (["split.json", "memory.json", "lineage.json", "metadata.jsonl"].some(name => !manifest.files[name])) throw new Error("Incomplete pilot manifest");
  for (const [name, metadata] of Object.entries(manifest.files) as [string, { sha256: string }][]) {
    if (basename(name) !== name || sha(join(directory, name)) !== metadata.sha256) throw new Error("Pilot artifact changed");
  }
  const split = json(join(directory, "split.json"));
  const memory = json(join(directory, "memory.json"));
  const lineage = json(join(directory, "lineage.json"));
  const { snapshot_hash: _snapshotHash, ...memoryBody } = memory;
  if (memory.snapshot_hash !== hash(memoryBody) || memory.split_hash !== hash(split) || memory.frozen !== true
    || split.fresh_heldout !== false || lineage.fresh_heldout !== false) throw new Error("Pilot identity mismatch");
  const expected = Object.entries(split.families).filter(([, partition]) => partition === "train").map(([family]) => family).sort();
  if (lineage.fresh_qwen_traces === true) {
    if (lineage.version !== "acephale-infra-fresh-native-v1" || canonical(lineage.actor) !== canonical(INFRA_MODEL_PINS.actor)
      || lineage.all_declared_slots_retained !== true || !/^[a-f0-9]{64}$/.test(lineage.cohort_receipt_sha256)
      || ["runtime-runs.jsonl", "cohort-receipt.json", "trajectories.jsonl", "public.jsonl", "labels.jsonl", "verdicts.jsonl"].some(name => !manifest.files[name])
      || memory.training_families.some((family: string) => !expected.includes(family))) throw new Error("Fresh pilot lineage mismatch");
    if (hash(json(join(directory, "cohort-receipt.json"))) !== lineage.cohort_receipt_hash) throw new Error("Fresh cohort receipt changed");
  } else if (lineage.fresh_qwen_traces !== false || canonical(expected) !== canonical([...memory.training_families].sort())) throw new Error("Pilot fitting families mismatch");
  const metadata = readFileSync(join(directory, "metadata.jsonl"), "utf8").trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  if (lineage.fresh_qwen_traces === true) {
    const byId = new Map(metadata.map((row: any) => [row.episode_id, row]));
    const rows = readFileSync(join(directory, "public.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    for (const row of rows) {
      const meta: any = byId.get(row.episode_id), source = lineage.fresh_sources?.[row.episode_id];
      if (!meta || !source || row.family_id !== meta.family_id || row.split !== split.families[row.family_id]
        || row.runtime_tool_schema_hash !== source.original_tool_schema_hash || row.tool_schema_hash !== meta.tool_schema_hash
        || row.environment_version !== meta.environment_version || canonical(row.scope) !== canonical(meta.scope)
        || hash(row.input) !== row.input_hash) throw new Error("Fresh public checkpoint scope or source mismatch");
    }
  }
  return { manifest, manifestSha256: sha(join(directory, "manifest.json")), split, memory, lineage, expected, metadata };
}

/** Accept one recorded causal derivation, never an arbitrary snapshot prefix/suffix. */
export function validateFreshInfraMemoryBinding(input: FrozenExperienceMemory,
  bundle: Pick<ReturnType<typeof verifyInfraPilotBundle>, "manifest" | "manifestSha256" | "lineage" | "expected">) {
  const memory = validateMemoryArtifact(input), baseId = `infra-fresh:${bundle.manifest.bundle_hash}`;
  if (bundle.lineage.fresh_qwen_traces !== true) throw new Error("Fresh native dataset provenance required");
  const core = new Map(["manifest.json", "runtime-runs.jsonl", "metadata.jsonl", "lineage.json", "cohort-receipt.json"].map(name =>
    [name, name === "manifest.json" ? bundle.manifestSha256 : bundle.manifest.files[name]?.sha256]));
  const nameOf = (path: string) => path.split(/[\\/]/).at(-1)!;
  for (const [name, digest] of core) {
    if (!/^[a-f0-9]{64}$/.test(digest ?? "") || memory.sourceFiles.filter(file => nameOf(file.path) === name && file.sha256 === digest).length !== 1) {
      throw new Error("Fresh memory is not bound to the frozen dataset source files");
    }
  }
  if (memory.runs.some(run => run.split !== "train" || !bundle.expected.includes(run.familyId))) throw new Error("Fresh memory contains non-training families");
  const additional = memory.sourceFiles.filter(file => core.get(nameOf(file.path)) !== file.sha256);
  if (memory.familySelection) {
    const selection = memory.familySelection;
    if (selection.sourceDatasetHash !== bundle.manifest.bundle_hash
      || selection.weightFitFamilies.some(family => !bundle.expected.includes(family))
      || bundle.expected.some(family => ![...selection.weightFitFamilies, ...selection.calibrationFamilies].includes(family))
      || memory.repositorySnapshotId !== `${baseId}:weight-fit:${selection.contentHash}`
      || additional.length !== 3 || additional.some(file => (({ "weight-fit-partitions.json": selection.partitionSourceSha256,
        "weight-fit-partition-proposal.json": selection.partitionProposalSourceSha256, "weight-fit-source-review.json": selection.sourceDesignReviewSha256 } as Record<string, string>)[nameOf(file.path)] !== file.sha256))
      || memory.misses.length) throw new Error("Weight fitting memory derivation differs from its frozen source partition");
    return { kind: "weight_fit" as const, snapshotId: memory.repositorySnapshotId, selectionHash: selection.contentHash };
  }
  if (memory.repositorySnapshotId === baseId) {
    if (additional.length || memory.misses.length) throw new Error("Base fresh memory contains an undeclared causal derivation");
    return { kind: "base" as const, snapshotId: baseId };
  }
  const inventory = bundle.lineage.cohort_files as Record<string, string> | undefined;
  if (!inventory || additional.length !== 2) throw new Error("Causal memory lacks sealed source provenance");
  const sealed = (file: { path: string; sha256: string }, basename: string) => nameOf(file.path) === basename
    && Object.entries(inventory).some(([name, digest]) => nameOf(name) === basename && digest === file.sha256);
  const events = additional.find(file => sealed(file, "events.jsonl")), publicTrace = additional.find(file => sealed(file, "public-boundaries.jsonl"));
  if (!events || !publicTrace || memory.repositorySnapshotId !== `${baseId}:causal:${hash([events.sha256, publicTrace.sha256])}`
    || memory.misses.some(miss => !miss.beforeActorResponse || canonical(miss.source) !== canonical(events))) throw new Error("Causal memory derivation identity does not match sealed event sources");
  return { kind: "causal" as const, snapshotId: memory.repositorySnapshotId };
}

export function bridgeFreshInfraMemory(bundleDirectory: string, output: string, options: { partitionsPath?: string } = {}) {
  if (existsSync(output)) throw new Error("Runtime memory output must be a new directory");
  const bundle = verifyInfraPilotBundle(bundleDirectory);
  if (bundle.lineage.fresh_qwen_traces !== true) throw new Error("Fresh native bundle required");
  const rows = readFileSync(join(bundleDirectory, "runtime-runs.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const metadata = new Map(bundle.metadata.map((row: any) => [row.episode_id, row]));
  const ids = rows.map(row => row.id);
  if (new Set(ids).size !== ids.length || canonical([...ids].sort()) !== canonical([...metadata.keys()].sort())
    || canonical([...ids].sort()) !== canonical(Object.keys(bundle.lineage.fresh_sources).sort())
    || rows.length !== bundle.lineage.episodes) throw new Error("Fresh declared runs were omitted or repeated");
  const sourceFiles = ["manifest.json", "runtime-runs.jsonl", "metadata.jsonl", "lineage.json", "cohort-receipt.json"].map(name => ({
    path: resolve(bundleDirectory, name), sha256: sha(join(bundleDirectory, name)) }));
  const partitionBytes = options.partitionsPath ? readFileSync(options.partitionsPath) : undefined;
  const partition = partitionBytes ? JSON.parse(partitionBytes.toString("utf8")) : undefined;
  const reviewedSources: { originalPath: string; outputName: string; bytes: Buffer; sha256: string }[] = [];
  let selectionBody: Omit<MemoryFamilySelection, "contentHash" | "eligibleRunIds"> | undefined;
  if (partition) {
    const { contentHash, ...body } = partition;
    if (partition.schemaVersion !== 1 || partition.kind !== "acephale-candidate-only-family-partition"
      || contentHash !== hash(body) || partition.executionAuthorized !== true || partition.evaluationEligible !== true
      || partition.efficacyClaimAllowed !== false || partition.review?.status !== "completed"
      || partition.review?.reviewerKind !== "assistant_source_design" || partition.review?.humanAnnotationLabelReview !== false
      || !/^[a-f0-9]{64}$/.test(partition.review?.sourceDesignReviewHash ?? "")) throw new Error("Fit-only memory requires the completed source-design partition review");
    const loadReviewedSource = (name: string, outputName: string) => {
      const originalPath = resolve(dirname(options.partitionsPath!), name), bytes = readFileSync(originalPath);
      const value = JSON.parse(bytes.toString("utf8")), { contentHash: digest, ...sourceBody } = value;
      if (digest !== hash(sourceBody)) throw new Error("Source-design review artifact hash mismatch");
      const source = { originalPath, outputName, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
      reviewedSources.push(source); return { value, source };
    };
    const review = loadReviewedSource("source-design-review.json", "weight-fit-source-review.json");
    const proposal = loadReviewedSource("partition.json", "weight-fit-partition-proposal.json");
    if (review.value.kind !== "acephale-source-family-review" || review.value.reviewer?.kind !== "assistant_source_design"
      || review.value.humanAnnotationLabelReview !== false || review.value.historicalAPIGenExcluded !== true
      || review.value.contentHash !== partition.review.sourceDesignReviewHash
      || review.value.partitionProposalHash !== proposal.value.contentHash
      || ["weightFitFamilies", "calibrationFamilies", "developmentFamilies", "testFamilies"].some(key => hash(partition[key]) !== hash(proposal.value[key]))) {
      throw new Error("Approved family lists differ from the exact source-reviewed partition proposal");
    }
    const seen = new Set<string>();
    for (const [key, expectedSplit] of [["weightFitFamilies", "train"], ["calibrationFamilies", "train"], ["developmentFamilies", "development"], ["testFamilies", "test"]]) {
      const families = partition[key];
      if (!Array.isArray(families) || !families.length) throw new Error("Explicit nonempty weight fitting and evaluation family lists required");
      for (const family of families) {
        if (typeof family !== "string" || !family || seen.has(family)) throw new Error("Fit-only memory partitions overlap");
        seen.add(family);
        const sourceSplit = bundle.split.families[family];
        if (sourceSplit !== undefined && sourceSplit !== expectedSplit) throw new Error("Fit-only partition reassigns an original source split");
      }
    }
    if (partition.weightFitFamilies.some((family: string) => !bundle.expected.includes(family))
      || bundle.expected.some(family => ![...partition.weightFitFamilies, ...partition.calibrationFamilies].includes(family))) throw new Error("Fit-only partition does not cover the declared source training families");
    selectionBody = { version: 1, kind: "weight_fit", sourceDatasetHash: bundle.manifest.bundle_hash,
      partitionHash: contentHash, partitionSourceSha256: createHash("sha256").update(partitionBytes!).digest("hex"),
      partitionProposalHash: proposal.value.contentHash, partitionProposalSourceSha256: proposal.source.sha256,
      sourceDesignReviewHash: partition.review.sourceDesignReviewHash, sourceDesignReviewSha256: review.source.sha256,
      weightFitFamilies: [...partition.weightFitFamilies].sort(), calibrationFamilies: [...partition.calibrationFamilies].sort(),
      developmentFamilies: [...partition.developmentFamilies].sort(), testFamilies: [...partition.testFamilies].sort(),
      selectedRunIds: rows.filter(row => partition.weightFitFamilies.includes(row.familyId)).map(row => row.id).sort() };
    sourceFiles.push({ path: resolve(output, "weight-fit-partitions.json"), sha256: selectionBody.partitionSourceSha256 });
    sourceFiles.push(...reviewedSources.map(source => ({ path: resolve(output, source.outputName), sha256: source.sha256 })));
  }
  const runs: MemoryRun[] = [], episodes = [], exclusions: { runId: string; reason: string }[] = [];
  for (const row of rows) {
    const meta: any = metadata.get(row.id), source = bundle.lineage.fresh_sources[row.id];
    if (meta.family_id !== row.familyId || bundle.split.families[row.familyId] !== row.split
      || row.scope.tenantId !== meta.scope.tenant_id || row.scope.principalId !== meta.scope.principal_id
      || row.scope.authorizationVersion !== meta.scope.authorization_revision || row.scope.environmentVersion !== meta.environment_version
      || row.scope.toolSchemaHash !== source.original_tool_schema_hash || row.rawSha256 !== source.raw_sha256) throw new Error("Fresh runtime scope or source mismatch");
    const censored = /budget|censor|deadline|timeout|cancel|provider|transport|host|execution_error|not_started/i.test(row.termination);
    const eligible = row.split === "train" && row.success === true && row.outcomeVerified === true && row.constraintViolations === 0 && !censored;
    if (row.memoryEligible !== eligible) throw new Error("Fresh endpoint eligibility mismatch");
    const contrastive = row.split === "train" && row.success === false && row.outcomeVerified === true
      && Number.isSafeInteger(row.constraintViolations) && row.constraintViolations >= 0
      && !censored;
    if (row.contrastiveEligible !== undefined && row.contrastiveEligible !== contrastive) throw new Error("Fresh contrastive eligibility mismatch");
    // Selection is independent of endpoints and happens before episode extraction or statistics.
    if (selectionBody && !selectionBody.weightFitFamilies.includes(row.familyId)) {
      exclusions.push({ runId: row.id, reason: "outside_weight_fitting_partition" }); continue;
    }
    if (!eligible && !contrastive) { exclusions.push({ runId: row.id, reason: row.split !== "train" ? "not_training" : "endpoint_unknown_or_censored" }); continue; }
    if (meta.verification_tier !== "native_verified" || !Array.isArray(row.messages)) throw new Error("Fresh endpoint lacks verified public messages");
    const run: MemoryRun = { id: row.id, familyId: row.familyId, stage: "v5-training", split: "train", scope: row.scope,
      policyHash: row.policyHash, sourceFiles, success: row.success, outcomeVerified: true, constraintViolations: row.constraintViolations,
      verificationTier: "native_verified",
      termination: row.termination, publicMessageCount: row.messages.length, episodeCount: 0 };
    const extracted = extractMemoryEpisodes(run, row.messages as MemoryMessage[]);
    run.episodeCount = extracted.length; runs.push(run); episodes.push(...extracted);
  }
  const selection = selectionBody ? { ...selectionBody, eligibleRunIds: runs.map(run => run.id).sort() } : undefined;
  const familySelection = selection ? { ...selection, contentHash: hash(selection) } : undefined;
  const artifact = buildMemoryArtifact({ repositorySnapshotId: `infra-fresh:${bundle.manifest.bundle_hash}${familySelection ? `:weight-fit:${familySelection.contentHash}` : ""}`,
    sourceFiles, runs, episodes, misses: [], ...(familySelection ? { familySelection } : {}) }, { profile: "v5" });
  const receipt = { version: "acephale-infra-runtime-memory-bridge-v1", pilotBundleHash: bundle.manifest.bundle_hash,
    contentHash: artifact.contentHash, snapshotId: artifact.repositorySnapshotId, runs: runs.length, episodes: episodes.length,
    families: [...new Set(runs.map(run => run.familyId))].sort(), declaredRuns: rows.length, exclusions,
    runtimeArtifactPath: resolve(output, "runtime/artifact.json"), freshHeldout: false, freshQwenTraces: true,
    readyForPrediction: episodes.length > 0, verifiedFailures: runs.filter(run => !run.success).length,
    ...(familySelection ? { familySelectionHash: familySelection.contentHash, partitionHash: familySelection.partitionHash,
      selectionBeforeEpisodeExtraction: true, selectedRuns: familySelection.selectedRunIds.length } : {}),
    label: "Fresh verified training memory; failed endpoints are contrastive examples, not approved workflows" };
  verifyInfraPilotBundle(bundleDirectory);
  const derivedPaths = new Set([resolve(output, "weight-fit-partitions.json"), ...reviewedSources.map(source => resolve(output, source.outputName))]);
  if (sourceFiles.filter(file => !derivedPaths.has(file.path)).some(file => sha(file.path) !== file.sha256)
    || reviewedSources.some(source => sha(source.originalPath) !== source.sha256)
    || options.partitionsPath && sha(options.partitionsPath) !== selectionBody!.partitionSourceSha256) throw new Error("Fresh source changed during memory build");
  mkdirSync(join(output, "runtime"), { recursive: true });
  if (partitionBytes) writeFileSync(join(output, "weight-fit-partitions.json"), partitionBytes, { flag: "wx" });
  for (const source of reviewedSources) writeFileSync(join(output, source.outputName), source.bytes, { flag: "wx" });
  writeFileSync(join(output, "runtime/artifact.json"), canonical(artifact) + "\n", { flag: "wx" });
  writeFileSync(join(output, "bridge-receipt.json"), canonical(receipt) + "\n", { flag: "wx" });
  return receipt;
}

export function bridgeFreshFitInfraMemory(bundleDirectory: string, partitionsPath: string, output: string) {
  return bridgeFreshInfraMemory(bundleDirectory, output, { partitionsPath });
}

/** Attach genuine training predictions from the exact closed cohort already bound by memory provenance. */
export function attachCausalInfraMemory(memoryPath: string, cohortDirectory: string, eventsRelative: string, publicRelative: string, output: string) {
  if (existsSync(output)) throw new Error("Causal memory output must be new");
  const memory = validateMemoryArtifact(json(memoryPath));
  if (!/^infra-fresh:[a-f0-9]{64}$/.test(memory.repositorySnapshotId) || memory.misses.length) throw new Error("Causal attachment requires the original fresh base memory; a causal snapshot cannot be attached again");
  const receiptPath = join(cohortDirectory, "cohort-receipt.json"), receipt = json(receiptPath);
  if (receipt.version !== 1 || receipt.stage !== "collection" || receipt.closed !== true || receipt.completed !== true
    || receipt.allDeclaredSlotsRetained !== true || receipt.serviceExitCode !== 0
    || !memory.sourceFiles.some(source => source.sha256 === sha(receiptPath))) throw new Error("Causal cohort not bound by frozen training memory");
  const source = (name: string) => {
    const path = resolve(cohortDirectory, name), rel = relative(resolve(cohortDirectory), path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel) || name.includes("\\")) throw new Error("Unsafe causal source path");
    const rows = receipt.files.filter((row: { path: string; sha256: string }) => row.path === name);
    if (rows.length !== 1 || sha(path) !== rows[0].sha256) throw new Error("Causal source not sealed in cohort receipt");
    return { path, sha256: rows[0].sha256 };
  };
  const eventSource = source(eventsRelative), publicSource = source(publicRelative);
  const rows = (path: string) => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const additions = extractCausalMemoryMisses(memory, rows(eventSource.path), rows(publicSource.path), eventSource);
  const sourceFiles = [...new Map([...memory.sourceFiles, eventSource, publicSource].map(row => [row.path, row])).values()];
  const artifact = buildMemoryArtifact({ ...memory, sourceFiles, misses: [...memory.misses, ...additions],
    repositorySnapshotId: `${memory.repositorySnapshotId}:causal:${hash([eventSource.sha256, publicSource.sha256])}` }, { profile: "v5" });
  if (sha(eventSource.path) !== eventSource.sha256 || sha(publicSource.path) !== publicSource.sha256) throw new Error("Causal inputs changed during import");
  writeFileSync(output, canonical(artifact) + "\n", { flag: "wx" });
  return { contentHash: artifact.contentHash, sourceMemoryHash: memory.contentHash, predictions: additions.length,
    errors: additions.filter(row => !row.fullMatch).length, label: "Causal training predictions only; no retrospective replay errors" };
}

if (process.argv[1]?.endsWith("acephale-infra-memory.ts")) {
  if (process.argv[2] === "--causal") {
    if (process.argv.length !== 8) throw new Error("Usage: --causal MEMORY COHORT_DIRECTORY EVENTS_RELATIVE PUBLIC_RELATIVE NEW_OUTPUT_FILE");
    console.log(JSON.stringify(attachCausalInfraMemory(resolve(process.argv[3]), resolve(process.argv[4]), process.argv[5], process.argv[6], resolve(process.argv[7])), null, 2));
  } else if (process.argv[2] === "--fresh-fit") {
    if (process.argv.length !== 6) throw new Error("Usage: --fresh-fit PILOT_DIRECTORY APPROVED_PARTITIONS_JSON NEW_OUTPUT_DIRECTORY");
    console.log(JSON.stringify(bridgeFreshFitInfraMemory(resolve(process.argv[3]), resolve(process.argv[4]), resolve(process.argv[5])), null, 2));
  } else {
    if (process.argv[2] !== "--fresh" || process.argv.length !== 5) throw new Error("Usage: acephale-infra-memory.ts --fresh PILOT_DIRECTORY NEW_OUTPUT_DIRECTORY");
    console.log(JSON.stringify(bridgeFreshInfraMemory(resolve(process.argv[3]), resolve(process.argv[4])), null, 2));
  }
}
