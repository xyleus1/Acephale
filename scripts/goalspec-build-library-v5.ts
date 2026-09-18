import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildLibrary, type RepositoryBundle } from "./goalspec-build-library";
import { hash, copy } from "../src/lib/goalspec/canonical";
import type { MiningEpisode } from "../src/lib/goalspec/miner";
import { researchScope, type ResearchManifest } from "../services/goalspec-runtime/research-bootstrap";
import type { SnapshotPublication, PublishedExperience } from "../src/lib/goalspec/postgres-publication";
import { FrozenRepository, type Experience } from "../src/lib/goalspec/repository";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { researchProvider, TrialLedger, assertResearchHostReady } from "../services/goalspec-runtime/provider";
import { ImmutableEventLog } from "../services/goalspec-runtime/artifacts";
import { countTokens } from "../src/lib/goalspec/tokens";
import type { Scope } from "../src/lib/goalspec/contracts/generated";

type Source = { path: string; sha256: string };
type FixtureManifest = { learningFamilySplit: Record<string, "train" | "calibration" | "development">;
  tasks: { taskId: string; familyId: string; split: string; learningSplit: string; fixtureHash: string }[] };
type Eligibility = { version: string; contentHash: string; allowedMemoryFamilies: string[]; excludedMemoryFamilies: string[];
  freshSplits: Record<string, "train" | "selection" | "calibration">; oldObservedFittingFamilies: string[]; inputs: Source[]; source: Source };
type Inputs = { exportDirectory: string; fixtureManifest: string; serviceManifest: string; snapshotId: string; budgetJournal: string; eligibilityReceipt: string;
  prior?: { publication: string; bundle: string; records: string; summary: string } };
type Plan = { version: "native-library-v5.2"; inputs: Inputs; sources: Source[]; snapshotId: string;
  selectedEpisodeIds: string[]; excludedCalibrationEpisodeIds: string[]; excludedSelectionEpisodeIds: string[]; heldoutFamilies: string[];
  freshPatternPlan: { id: string; textHash: string; patternHash: string }[]; maximumEmbeddingMicrodollars: number;
  reservationMicrodollars: 1000000; embeddingModel: "text-embedding-3-small"; dimensions: 1536; hash: string };
const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const source = (path: string): Source => ({ path: resolve(path), sha256: sha(readFileSync(path)) });
const read = <T>(path: string): T => JSON.parse(readFileSync(resolve(path), "utf8"));
const save = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
const errorType = (error: unknown) => error instanceof Error ? error.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 80) || "Error" : "UnknownError";

export function selectV5Training(episodes: MiningEpisode[], bundle: RepositoryBundle, manifest: ResearchManifest, fixtures: FixtureManifest, allowedFamilies?: string[]) {
  const mapping = new Map(fixtures.tasks.map(task => [task.taskId, task]));
  if (episodes.length !== 40 || bundle.episodes.length !== 40 || bundle.verifications.length > 40 || manifest.runs.length !== 40
    || fixtures.tasks.length !== 40 || mapping.size !== 40 || new Set(episodes.map(episode => episode.id)).size !== 40
    || new Set(manifest.runs.map(run => run.runId)).size !== 40 || new Set(bundle.episodes.map(row => row.id)).size !== 40
    || new Set(bundle.episodes.map(row => row.sourceId)).size !== 40 || new Set(bundle.verifications.map(row => row.episodeId)).size !== bundle.verifications.length
    || bundle.verifications.some(row => !episodes.some(episode => episode.id === row.episodeId))) throw new Error("Complete closed forty-run Base training export required");
  const selected = new Set<string>(), excluded = new Set<string>(), selection = new Set<string>();
  for (const episode of episodes) {
    const metadata = bundle.episodes.find(row => row.id === episode.id), verification = bundle.verifications.find(row => row.episodeId === episode.id);
    const run = manifest.runs.find(row => row.runId === episode.id), fixture = metadata && mapping.get(metadata.sourceId);
    const unavailableFailure = !verification && !episode.verifiedSuccess && metadata?.verificationTier === "source_reported" && metadata.metadata.verifierAvailable === false;
    if (!metadata || !run || !fixture || run.arm !== "base" || run.allocation !== "training"
      || run.domain !== episode.domain || metadata.domain !== episode.domain || metadata.familyId !== episode.family || fixture.familyId !== episode.family
      || run.familyId !== undefined && run.familyId !== episode.family || metadata.split !== "train" || fixture.split !== "train"
      || !unavailableFailure && metadata.verificationTier !== "native_verified" || metadata.toolSchemaHash !== hash(run.tools)
      || metadata.environmentVersion !== researchScope(run).environmentVersion || metadata.metadata.fixtureHash !== fixture.fixtureHash
      || !unavailableFailure && (!verification || episode.verifiedSuccess !== verification.success || verification.success && !verification.constraintsSatisfied)
      || fixture.learningSplit !== fixtures.learningFamilySplit[fixture.familyId]
      || !["train", "calibration"].includes(fixture.learningSplit)) throw new Error("Training identity, endpoint or split mismatch");
    (fixture.learningSplit === "calibration" ? excluded : allowedFamilies && !allowedFamilies.includes(episode.family) ? selection : selected).add(episode.id);
  }
  // Unavailable endpoints remain declared failures and snapshot members, but
  // cannot supply independently verified transition/error calibration either.
  const unavailable = new Set(bundle.episodes.filter(row => row.metadata.verifierAvailable === false).map(row => row.id));
  const train = episodes.filter(episode => selected.has(episode.id)).map(episode => unavailable.has(episode.id) ? { ...episode, checkpoints: [] } : episode);
  const familyCounts = new Map<string, number>();
  for (const episode of episodes) familyCounts.set(episode.family, (familyCounts.get(episode.family) ?? 0) + 1);
  if (train.length !== (allowedFamilies ? 24 : 32) || new Set(train.map(episode => episode.family)).size !== (allowedFamilies ? 12 : 16) || excluded.size !== 8 || selection.size !== (allowedFamilies ? 8 : 0)
    || familyCounts.size !== 20 || [...familyCounts.values()].some(count => count !== 2)) throw new Error("Fitting, selection or calibration family counts do not match the declared library split");
  const heldout = Object.entries(fixtures.learningFamilySplit).filter(([family, split]) => split !== "train" || allowedFamilies && !allowedFamilies.includes(family)).map(([family]) => family).sort();
  const datasetId = `${bundle.dataset.id}:learning-train-v5`;
  const filteredBundle: RepositoryBundle = {
    dataset: { ...bundle.dataset, id: datasetId, rawCount: 40, admittedCount: train.length,
      contentHash: hash({ fullExport: bundle.dataset.contentHash, selected: [...selected].sort(), excluded: [...excluded].sort(), selection: [...selection].sort() }),
      metadata: { ...bundle.dataset.metadata, fullExportDatasetId: bundle.dataset.id, fullExportContentHash: bundle.dataset.contentHash,
        excludedCalibrationEpisodeIds: [...excluded].sort(), excludedSelectionEpisodeIds: [...selection].sort(), learningSplit: "train", failedTrialsRetained: true,
        goalLabelSemantics: "Independent offline endpoint labels; requested-goal annotations are separate and never replaced." } },
    episodes: bundle.episodes.filter(episode => selected.has(episode.id)).map(episode => ({ ...episode, datasetId,
      metadata: { ...episode.metadata, learningSplit: "train", ...(unavailable.has(episode.id) ? { libraryMiningExcludedReason: "native_verifier_unavailable" } : {}) } })),
    verifications: bundle.verifications.filter(verification => selected.has(verification.episodeId)),
  };
  return { episodes: train, bundle: filteredBundle, manifest: { ...manifest, runs: manifest.runs.filter(run => selected.has(run.runId)) },
    selectedEpisodeIds: [...selected].sort(), excludedCalibrationEpisodeIds: [...excluded].sort(), excludedSelectionEpisodeIds: [...selection].sort(), heldoutFamilies: heldout };
}
function verifiedSourceFiles(bundle: RepositoryBundle): Source[] {
  const files: Source[] = [];
  for (const episode of bundle.episodes) {
    const transcript = source(episode.transcriptUri), verdict = bundle.verifications.find(row => row.episodeId === episode.id);
    const unavailable = !verdict && episode.verificationTier === "source_reported" && episode.metadata.verifierAvailable === false;
    if (transcript.sha256 !== episode.contentHash || !unavailable && (!verdict || source(verdict.evidenceUri).sha256 !== verdict.evidenceHash)) throw new Error("Native transcript or independent verdict changed");
    const artifact = read<{ record: { runId: string; taskId: string; familyId: string; domain: string; arm: string; success: boolean }; verdict: Record<string, unknown> }>(episode.transcriptUri);
    if (artifact.record.runId !== episode.id || artifact.record.taskId !== episode.sourceId || artifact.record.familyId !== episode.familyId
      || artifact.record.domain !== episode.domain || artifact.record.arm !== "base"
      || (unavailable ? artifact.record.success !== false || artifact.verdict != null : !verdict || artifact.record.success !== verdict.success || hash(artifact.verdict) !== hash(verdict.verdict))) throw new Error("Native run association or verdict mismatch");
    files.push(transcript); if (verdict) files.push(source(verdict.evidenceUri));
  }
  return files;
}
export function mergePriorPublication(fresh: SnapshotPublication, prior: SnapshotPublication, bundle: RepositoryBundle, records: Experience[], priorSummary: { snapshotId: string; snapshotHash: string }, currentScopes: Scope[], allowedFamilies?: string[]) {
  if (prior.id !== "native-training-v1-20260915" || prior.id !== priorSummary.snapshotId || new FrozenRepository(prior.id, records, prior.heldoutFamilies).digest !== priorSummary.snapshotHash
    || prior.embeddingModelVersion !== "text-embedding-3-small" || hash(records) !== hash(prior.records.map(({ episodeId: _episodeId, supportingEpisodeIds: _support, goalEmbedding: _goal, ...record }) => record))) throw new Error("Frozen prior library identity or embedding lineage mismatch");
  const merged = copy(fresh), excluded = new Set(fresh.heldoutFamilies);
  if (!currentScopes.length) throw new Error("Current native compatibility scopes are required");
  if (new Set(prior.episodeIds).size !== prior.episodeIds.length || bundle.episodes.length !== prior.episodeIds.length
    || bundle.verifications.length !== prior.episodeIds.length || new Set(bundle.episodes.map(row => row.id)).size !== prior.episodeIds.length
    || new Set(bundle.verifications.map(row => row.episodeId)).size !== prior.episodeIds.length
    || bundle.episodes.some(row => !prior.episodeIds.includes(row.id) || row.split !== "train" || row.verificationTier !== "native_verified"
      || (!allowedFamilies && excluded.has(row.familyId)) || prior.heldoutFamilies.includes(row.familyId)
      || !bundle.verifications.some(verdict => verdict.episodeId === row.id))
    || [...prior.transitions, ...prior.errors].some(row => row.sourceEpisodeIds.some(id => !prior.episodeIds.includes(id)))) throw new Error("Prior publication contains excluded or unknown training lineage");
  const admitted: string[] = [], omitted: { id: string; reason: string }[] = [];
  const compatibility = new Set(currentScopes.map(scope => hash(scope)));
  const allowedIds = new Set(bundle.episodes.filter(row => !allowedFamilies || allowedFamilies.includes(row.familyId)).map(row => row.id));
  const seen = new Set(fresh.records.map(record => hash({ text: record.text, scope: record.pattern.scope, prefix: record.pattern.prefix, tool: record.pattern.tool, binding: record.pattern.binding })));
  for (const old of prior.records) {
    const supporting = [old.episodeId, ...(old.supportingEpisodeIds ?? [])];
    const statistics = [...prior.transitions, ...prior.errors].filter(row => row.key === old.id);
    if (allowedFamilies && (!allowedFamilies.includes(old.familyId) || supporting.some(id => !allowedIds.has(id))
      || statistics.some(row => row.sourceEpisodeIds.some(id => !allowedIds.has(id))))) {
      omitted.push({ id: old.id, reason: "support_or_statistics_outside_actual_fitting_families" }); continue;
    }
    const supported = supporting.map(id => ({ metadata: bundle.episodes.find(row => row.id === id), verdict: bundle.verifications.find(row => row.episodeId === id) }));
    if (old.split !== "train" || old.pattern.verificationTier !== "native_verified" || old.pattern.snapshotId !== prior.id
      || !supported.length || supported.some(({ metadata, verdict }) => !metadata || !verdict || metadata.split !== "train"
        || metadata.verificationTier !== "native_verified" || excluded.has(metadata.familyId) || !verdict.success || !verdict.constraintsSatisfied
        || metadata.toolSchemaHash !== old.pattern.scope.toolSchemaHash || metadata.environmentVersion !== old.pattern.scope.environmentVersion)
      || new Set(supported.map(row => row.metadata?.familyId)).size < 2) throw new Error("Prior pattern lacks permitted independent native support");
    const key = hash({ text: old.text, scope: old.pattern.scope, prefix: old.pattern.prefix, tool: old.pattern.tool, binding: old.pattern.binding });
    if (seen.has(key)) { omitted.push({ id: old.id, reason: "same_workflow_already_fresh" }); continue; }
    if (!compatibility.has(hash(old.pattern.scope))) { omitted.push({ id: old.id, reason: "incompatible_current_scope_or_tool_schema" }); continue; }
    if (merged.records.length >= 512) { omitted.push({ id: old.id, reason: "bounded_snapshot_size" }); continue; }
    const id = `legacy:${prior.id}:${old.id}`;
    const record: PublishedExperience = { ...copy(old), id, pattern: { ...copy(old.pattern), id, snapshotId: fresh.id } };
    merged.records.push(record); seen.add(key); admitted.push(old.id);
    merged.transitions.push(...prior.transitions.filter(row => row.key === old.id).map(row => ({ ...copy(row), key: id })));
    merged.errors.push(...prior.errors.filter(row => row.key === old.id).map(row => ({ ...copy(row), key: id })));
  }
  // Only actual fitting-family episodes enter the new snapshot. Their failures
  // remain in lineage; successful independent endpoints support patterns.
  merged.episodeIds = [...new Set([...merged.episodeIds, ...prior.episodeIds.filter(id => allowedIds.has(id))])].sort();
  merged.heldoutFamilies = [...new Set([...fresh.heldoutFamilies, ...prior.heldoutFamilies,
    ...bundle.episodes.filter(row => !allowedIds.has(row.id)).map(row => row.familyId)])].sort();
  merged.calibration = { ...merged.calibration, priorSnapshotId: prior.id, priorSnapshotHash: priorSummary.snapshotHash,
    priorEmbeddingsReused: admitted.length, freshEmbeddingModel: "text-embedding-3-small", nativeTrainingOnly: true };
  return { publication: merged, admittedPriorPatternIds: admitted, omittedPriorPatterns: omitted };
}
function load(inputs: Inputs) {
  const episodes = read<MiningEpisode[]>(join(inputs.exportDirectory, "mining-episodes.json"));
  const bundle = read<RepositoryBundle>(join(inputs.exportDirectory, "repository-bundle.json"));
  const fixture = read<FixtureManifest>(inputs.fixtureManifest), manifest = read<ResearchManifest>(inputs.serviceManifest);
  if (bundle.dataset.metadata.fixtureManifestHash !== source(inputs.fixtureManifest).sha256) throw new Error("Pre-execution fixture manifest changed");
  if (!inputs.eligibilityReceipt) throw new Error("Actual fitting-family pipeline receipt required before workflow mining");
  const eligibility = read<Eligibility>(inputs.eligibilityReceipt), { contentHash, ...body } = eligibility;
  const freshFamilies = [...new Set(fixture.tasks.map(task => task.familyId))].sort();
  if (eligibility.version !== "goalspec-v5-post-closure-training-pipeline-v1" || hash(body) !== contentHash
    || eligibility.oldObservedFittingFamilies.length !== 11 || new Set(eligibility.oldObservedFittingFamilies).size !== 11
    || eligibility.allowedMemoryFamilies.length !== 23 || new Set(eligibility.allowedMemoryFamilies).size !== 23
    || hash(Object.keys(eligibility.freshSplits).sort()) !== hash(freshFamilies)
    || eligibility.oldObservedFittingFamilies.some(f => freshFamilies.includes(f))
    || Object.values(eligibility.freshSplits).filter(split => split === "train").length !== 12
    || Object.values(eligibility.freshSplits).filter(split => split === "selection").length !== 4
    || Object.values(eligibility.freshSplits).filter(split => split === "calibration").length !== 4
    || hash([...eligibility.allowedMemoryFamilies].sort()) !== hash([...eligibility.oldObservedFittingFamilies, ...Object.keys(eligibility.freshSplits).filter(f => eligibility.freshSplits[f] === "train")].sort())
    || eligibility.allowedMemoryFamilies.some(f => eligibility.excludedMemoryFamilies.includes(f))
    || fixture.tasks.some(task => !eligibility.freshSplits[task.familyId] || (fixture.learningFamilySplit[task.familyId] === "calibration") !== (eligibility.freshSplits[task.familyId] === "calibration"))) throw new Error("Invalid actual fitting-family pipeline receipt");
  for (const item of [...eligibility.inputs, eligibility.source]) if (source(item.path).sha256 !== item.sha256) throw new Error("Fitting-family receipt source changed");
  for (const path of [inputs.fixtureManifest, inputs.serviceManifest]) if (!eligibility.inputs.some(item => resolve(item.path) === resolve(path) && item.sha256 === source(path).sha256)) throw new Error("Pipeline receipt belongs to another native cohort");
  const selected = selectV5Training(episodes, bundle, manifest, fixture, eligibility.allowedMemoryFamilies);
  selected.heldoutFamilies = [...new Set([...selected.heldoutFamilies, ...eligibility.excludedMemoryFamilies])].sort();
  return { fullBundle: bundle, eligibility, selected };
}
function executionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? executionSourceFiles(path) : /\.(?:ts|json)$/.test(entry.name) ? [path] : [];
  });
}
const scopes = (manifest: ResearchManifest) => [...new Map(manifest.runs.map(run => { const scope = researchScope(run); return [hash(scope), scope] as const; })).values()];
export async function prepareLibraryV5(inputsPath: string, output: string) {
  const inputs = read<Inputs>(inputsPath);
  if (existsSync(output) || !existsSync(inputs.budgetJournal) || !inputs.snapshotId || inputs.snapshotId === "native-training-v1-20260915") throw new Error("New immutable snapshot/output and existing shared ledger required");
  const loaded = load(inputs), selected = loaded.selected;
  const texts: string[] = [];
  // This callback collects the deterministic plan only. Temporary vectors never
  // leave this process; no placeholder records/publication are written.
  const preview = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, selected.heldoutFamilies,
    async text => { texts.push(text); return [1, ...Array(1535).fill(0)]; }, 256, inputs.snapshotId);
  const maximumEmbeddingMicrodollars = texts.reduce((total, text) => {
    const bytes = Buffer.byteLength(text); if (bytes > 8192 || countTokens(text) > 8192) throw new Error("Embedding input too large");
    return total + Math.ceil(bytes * .02);
  }, 0);
  if (maximumEmbeddingMicrodollars > 1000000) throw new Error("Embedding ceiling exceeded");
  const paths = [inputsPath, inputs.fixtureManifest, inputs.serviceManifest, join(inputs.exportDirectory, "mining-episodes.json"), join(inputs.exportDirectory, "repository-bundle.json"),
    join(inputs.exportDirectory, "export-manifest.json"), "scripts/goalspec-build-library-v5.ts", "scripts/goalspec-build-library-v5.test.ts", "scripts/goalspec-build-library.ts",
    "research/goalspec/src/goalspec/training_export.py", "research/goalspec/src/goalspec/fresh_tasks.py", "research/goalspec/src/goalspec/fresh_tasks_v5.py",
    "package.json", "package-lock.json", "tsconfig.json", ...executionSourceFiles("src/lib/goalspec"), ...executionSourceFiles("services/goalspec-runtime")];
  const sources = [...paths.map(source), source(inputs.eligibilityReceipt), ...loaded.eligibility.inputs, loaded.eligibility.source, ...verifiedSourceFiles(selected.bundle)];
  if (inputs.prior) {
    sources.push(...Object.values(inputs.prior).map(source));
    const bundle = read<RepositoryBundle>(inputs.prior.bundle);
    const eligibleIds = new Set(bundle.episodes.filter(row => loaded.eligibility.oldObservedFittingFamilies.includes(row.familyId)).map(row => row.id));
    sources.push(...verifiedSourceFiles({ ...bundle, episodes: bundle.episodes.filter(row => eligibleIds.has(row.id)), verifications: bundle.verifications.filter(row => eligibleIds.has(row.episodeId)) }));
    mergePriorPublication(preview.publication, read(inputs.prior.publication), bundle, read(inputs.prior.records), read(inputs.prior.summary), scopes(selected.manifest), loaded.eligibility.allowedMemoryFamilies);
  }
  const body: Omit<Plan, "hash"> = { version: "native-library-v5.2", inputs, sources: [...new Map(sources.map(entry => [entry.path, entry])).values()], snapshotId: inputs.snapshotId,
    selectedEpisodeIds: selected.selectedEpisodeIds, excludedCalibrationEpisodeIds: selected.excludedCalibrationEpisodeIds, excludedSelectionEpisodeIds: selected.excludedSelectionEpisodeIds, heldoutFamilies: selected.heldoutFamilies,
    freshPatternPlan: preview.records.map(record => ({ id: record.id, textHash: hash(record.text), patternHash: hash(record.pattern) })),
    maximumEmbeddingMicrodollars, reservationMicrodollars: 1000000, embeddingModel: "text-embedding-3-small", dimensions: 1536 };
  mkdirSync(output); const plan = { ...body, hash: hash(body) }; save(join(output, "plan.json"), plan); return plan;
}
export async function dispatchLibraryV5(planPath: string, output: string) {
  const plan = read<Plan>(planPath), { hash: digest, ...body } = plan;
  const verify = () => {
    if (plan.version !== "native-library-v5.2" || hash(body) !== digest || plan.embeddingModel !== "text-embedding-3-small" || plan.dimensions !== 1536
      || plan.reservationMicrodollars !== 1000000 || plan.maximumEmbeddingMicrodollars > plan.reservationMicrodollars) throw new Error("Invalid frozen library plan");
    for (const entry of plan.sources) if (source(entry.path).sha256 !== entry.sha256) throw new Error("Frozen library source changed");
  };
  verify(); if (existsSync(output) || !existsSync(plan.inputs.budgetJournal) || !process.env.GOALSPEC_HOST_STATUS_FILE) throw new Error("Fresh output, shared ledger and host guard required");
  assertResearchHostReady(); mkdirSync(output); save(join(output, "dispatch.json"), { plan: source(planPath), planHash: plan.hash });
  const budget = new DurableBudget(plan.inputs.budgetJournal), events = new ImmutableEventLog(join(output, "events.jsonl"));
  const parentId = `library-v5:${plan.hash}`;
  try {
    verify(); budget.ledger.reserve(parentId, "preparation", plan.reservationMicrodollars);
    const trial = new TrialLedger(budget.ledger, parentId, "preparation"), provider = researchProvider(trial, "preparation", event => events.append(event));
    const { selected, eligibility } = load(plan.inputs);
    assert.deepEqual(selected.selectedEpisodeIds, plan.selectedEpisodeIds); assert.deepEqual(selected.excludedCalibrationEpisodeIds, plan.excludedCalibrationEpisodeIds);
    assert.deepEqual(selected.excludedSelectionEpisodeIds, plan.excludedSelectionEpisodeIds);
    const result = await buildLibrary(selected.episodes, selected.bundle, selected.manifest, selected.heldoutFamilies, async text => {
      verify(); const embedding = await provider.embed(text);
      appendFileSync(join(output, "embeddings.jsonl"), `${JSON.stringify({ textHash: hash(text), text, model: plan.embeddingModel, dimensions: 1536, embedding })}\n`);
      return embedding;
    }, 256, plan.snapshotId);
    assert.deepEqual(result.records.map(record => ({ id: record.id, textHash: hash(record.text), patternHash: hash(record.pattern) })), plan.freshPatternPlan);
    let publication = result.publication, priorSummary: Record<string, unknown> = { admittedPriorPatternIds: [], omittedPriorPatterns: [] };
    if (plan.inputs.prior) {
      const paths = plan.inputs.prior;
      const merged = mergePriorPublication(publication, read(paths.publication), read(paths.bundle), read(paths.records), read(paths.summary), scopes(selected.manifest), eligibility.allowedMemoryFamilies);
      publication = merged.publication; priorSummary = { admittedPriorPatternIds: merged.admittedPriorPatternIds, omittedPriorPatterns: merged.omittedPriorPatterns };
    }
    const records: Experience[] = publication.records.map(({ episodeId: _episodeId, supportingEpisodeIds: _support, goalEmbedding: _goal, ...record }) => record);
    const frozen = new FrozenRepository(plan.snapshotId, records, publication.heldoutFamilies);
    verify();
    for (const [name, value] of Object.entries({ records, publication, "filtered-repository-bundle": selected.bundle, mined: result.mined, omitted: result.omitted,
      summary: { version: plan.version, snapshotId: plan.snapshotId, snapshotHash: frozen.digest, totalSourceEpisodes: 40, freshFittingEpisodes: selected.episodes.length,
        excludedCalibrationEpisodes: selected.excludedCalibrationEpisodeIds, excludedSelectionEpisodes: selected.excludedSelectionEpisodeIds,
        allowedMemoryFamilies: eligibility.allowedMemoryFamilies, eligibilityReceipt: source(plan.inputs.eligibilityReceipt), freshVerifiedEpisodes: selected.episodes.filter(episode => episode.verifiedSuccess).length,
        freshPatterns: result.records.length, totalPatterns: records.length, ...priorSummary, endpointLabelsOffline: true, requestedGoalsReplaced: false,
        embeddingModel: plan.embeddingModel, dimensions: plan.dimensions, plan: source(planPath), sources: plan.sources } })) save(join(output, `${name}.json`), value);
    budget.ledger.finishParent(parentId);
    save(join(output, "accounting.json"), { knownSettledMicrodollars: trial.snapshot().reduce((sum, entry) => sum + (entry.actual ?? 0), 0), unknownRequests: trial.snapshot().filter(entry => entry.actual === undefined).length });
    return { snapshotId: plan.snapshotId, snapshotHash: frozen.digest, freshPatterns: result.records.length, totalPatterns: records.length };
  } catch (error) {
    save(join(output, "failure.json"), { complete: false, errorType: errorType(error), partialEmbeddingsRetained: true }); throw error;
  } finally { events.close(); budget.close(); }
}
async function main() {
  const [mode, first, second] = process.argv.slice(2);
  if (mode === "prepare" && first && second) console.log(JSON.stringify({ plan: join(resolve(second), "plan.json"), hash: (await prepareLibraryV5(first, second)).hash }));
  else if (mode === "run" && first && second) console.log(JSON.stringify(await dispatchLibraryV5(first, second)));
  else throw new Error("Usage: prepare INPUTS_JSON NEW_PLAN_DIR | run PLAN_JSON NEW_OUTPUT_DIR");
}
if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/goalspec-build-library-v5.ts")) main().catch(error => { console.error(JSON.stringify({ failed: true, errorType: errorType(error) })); process.exitCode = 1; });
