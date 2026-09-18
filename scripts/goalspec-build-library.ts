import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { minePatterns, type MiningEpisode, type MinedPattern } from "../src/lib/goalspec/miner";
import { resolveBinding, type Expression } from "../src/lib/goalspec/patterns";
import type { WorkflowPattern } from "../src/lib/goalspec/contracts/generated";
import { validateContract } from "../src/lib/goalspec/contracts/validate";
import type { DatasetRecord, EpisodeRecord, VerificationRecord, PublishedExperience, SnapshotPublication, TransitionRecord, ErrorRecord } from "../src/lib/goalspec/postgres-publication";
import { FrozenRepository } from "../src/lib/goalspec/repository";
import { DurableBudget } from "../services/goalspec-runtime/durable-budget";
import { ImmutableEventLog } from "../services/goalspec-runtime/artifacts";
import { researchProvider } from "../services/goalspec-runtime/provider";
import { researchScope, type ResearchManifest } from "../services/goalspec-runtime/research-bootstrap";

export type RepositoryBundle = { dataset: DatasetRecord; episodes: EpisodeRecord[]; verifications: VerificationRecord[] };
const READS: Record<string, Set<string>> = {
  retail: new Set(["find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"]),
  airline: new Set(["get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"]),
};
const COMPILER_VERSION = "goalspec-native-library-v1";
const SNAPSHOT_ID = "native-training-v1-20260915";

function contains(history: string[], context: string[]) {
  let position = 0;
  for (const signature of history.slice(-12)) if (signature === context[position]) position++;
  return position === context.length;
}
function dependencies(expression: Expression): string[] {
  const values = new Set<string>();
  function visit(node: Expression) {
    if (node.reference) values.add(`${node.reference.source}:${node.reference.tool}:${canonical(node.reference.path)}`);
    Object.values(node.fields ?? {}).forEach(visit);
    (node.items ?? []).forEach(visit);
  }
  visit(expression);
  return [...values].sort();
}
function inspect(pattern: MinedPattern, episodes: MiningEpisode[]) {
  const rows: { episode: MiningEpisode; matched: boolean; resolved: boolean; actualTools: string[] }[] = [];
  for (const episode of episodes) {
    if (episode.benchmark !== pattern.benchmark || episode.domain !== pattern.domain || pattern.goal_id && pattern.goal_id !== episode.canonicalGoalId) continue;
    for (const checkpoint of episode.checkpoints) {
      if (!contains(checkpoint.prefix.signatures, pattern.context)) continue;
      let argumentsValue: unknown;
      let resolved = false;
      try { argumentsValue = resolveBinding(pattern.binding!.expression, checkpoint.prefix.events, checkpoint.prefix.throughSeq); resolved = true; }
      catch { /* A current source does not exist at this observed prefix. */ }
      rows.push({ episode, resolved, matched: resolved && checkpoint.targets.some(target => target.tool === pattern.tool && canonical(target.arguments) === canonical(argumentsValue)),
        actualTools: checkpoint.targets.map(target => target.tool) });
    }
  }
  return rows;
}

export async function buildLibrary(episodes: MiningEpisode[], bundle: RepositoryBundle, manifest: ResearchManifest,
  heldoutFamilies: string[], embed: (text: string) => Promise<number[]>, maximumPatterns = 256, snapshotId = SNAPSHOT_ID) {
  if (!Number.isInteger(maximumPatterns) || maximumPatterns < 1 || maximumPatterns > 512) throw new Error("Invalid pattern count bound");
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(snapshotId)) throw new Error("Invalid snapshot identity");
  const metadata = new Map(bundle.episodes.map(episode => [episode.id, episode]));
  const verifications = new Map(bundle.verifications.map(verification => [verification.episodeId, verification]));
  if (episodes.length !== metadata.size || episodes.some(episode => !metadata.has(episode.id)) || manifest.runs.some(run => run.arm !== "base" || run.allocation !== "training")) throw new Error("Expected complete base-arm training export");
  for (const episode of episodes) {
    const source = metadata.get(episode.id)!;
    const verdict = verifications.get(episode.id);
    const unavailableFailure = !verdict && !episode.verifiedSuccess && source.verificationTier === "source_reported" && source.metadata.verifierAvailable === false;
    if (source.split !== "train" || heldoutFamilies.includes(source.familyId) || source.familyId !== episode.family || source.domain !== episode.domain
      || (!unavailableFailure && (!verdict || episode.verifiedSuccess !== verdict.success || episode.verifiedSuccess && !verdict.constraintsSatisfied))) throw new Error("Training provenance or independent endpoint mismatch");
  }
  const mined = minePatterns(episodes, 3, 2, 12, 0.5);
  const eligible = mined.filter(pattern => pattern.binding && pattern.support >= 2 && READS[pattern.domain]?.has(pattern.tool))
    .sort((a, b) => b.support - a.support || b.observations - a.observations || a.context.length - b.context.length || a.pattern_id.localeCompare(b.pattern_id));
  const records: PublishedExperience[] = [], transitions: TransitionRecord[] = [], errors: ErrorRecord[] = [];
  const omitted: { id: string; reason: string }[] = [];
  for (const pattern of eligible) {
    if (records.length >= maximumPatterns) { omitted.push({ id: pattern.pattern_id, reason: "bounded_snapshot_size" }); continue; }
    const observed = inspect(pattern, episodes);
    const support = observed.filter(row => row.matched && row.episode.verifiedSuccess);
    if (new Set(support.map(row => row.episode.family)).size < 2) { omitted.push({ id: pattern.pattern_id, reason: "insufficient_independent_binding_support" }); continue; }
    const sourceIds = [...new Set(support.map(row => row.episode.id))].sort();
    const source = metadata.get(sourceIds[0])!;
    const run = manifest.runs.find(run => run.runId === source.id);
    if (!run || run.domain !== source.domain || source.toolSchemaHash !== hash(run.tools)) throw new Error("Native tool schema provenance changed");
    const id = pattern.pattern_id;
    const workflow: WorkflowPattern = {
      schemaVersion: 1, id, scope: researchScope(run), snapshotId, verificationTier: "native_verified",
      prefix: pattern.context as WorkflowPattern["prefix"], tool: pattern.tool, binding: JSON.parse(canonical(pattern.binding)),
      dataDependencies: dependencies(pattern.binding!.expression), policyPrerequisites: [], observedOrdering: [...pattern.context],
      branches: [...new Set(observed.flatMap(row => row.actualTools))].sort(), successes: support.length,
      failures: observed.length - support.length,
    };
    validateContract("WorkflowPattern", workflow);
    const text = `Native ${pattern.domain} verified workflow. Endpoint class: ${pattern.goal_id ?? "goal neutral"}. Observed prefix: ${pattern.context.join(" then ") || "start"}. Useful next read: ${pattern.tool}. Dependencies: ${workflow.dataDependencies.join(", ")}.`;
    const embedding = await embed(text);
    if (embedding.length !== 1536 || embedding.some(value => !Number.isFinite(value)) || !embedding.some(value => value !== 0)) throw new Error("Invalid real embedding");
    records.push({ id, familyId: source.familyId, text, embedding, pattern: workflow, split: "train", episodeId: source.id, supportingEpisodeIds: sourceIds.slice(1) });
    const allSourceIds = [...new Set(observed.map(row => row.episode.id))].sort();
    transitions.push({ key: id, goal: pattern.goal_id ?? "unknown", opportunities: observed.length, matches: observed.filter(row => row.matched).length,
      independentSupport: new Set(support.map(row => row.episode.family)).size, sourceEpisodeIds: allSourceIds,
      outcomeStrata: { verifiedEndpoint: support.length, other: observed.length - support.length, minFamilySupport: 2, fittedProbability: pattern.probability } });
    const attempts = observed.filter(row => row.resolved);
    if (attempts.length) errors.push({ key: id, tool: pattern.tool, observations: attempts.length, errors: attempts.filter(row => !row.matched).length,
      sourceEpisodeIds: [...new Set(attempts.map(row => row.episode.id))].sort(), details: { kind: "training_symbolic_binding_replay", independentTestEstimate: false,
        failedEndpointEpisodes: [...new Set(attempts.filter(row => !row.episode.verifiedSuccess).map(row => row.episode.id))] } });
  }
  const publication: SnapshotPublication = { id: snapshotId, records, episodeIds: episodes.map(episode => episode.id).sort(), heldoutFamilies: [...heldoutFamilies].sort(),
    transitions, errors, compilerVersion: COMPILER_VERSION, embeddingModelVersion: "text-embedding-3-small", calibration: {
      type: "engineering_defaults_unfitted", patternConfidenceThreshold: 0.8, minSupport: 2, maxContext: 3, maxHistory: 12,
      maximumPatterns, trainingOnly: true, selection: "support then observations then shortest context then stable ID",
    } };
  const experience = records.map(record => ({ id: record.id, familyId: record.familyId, text: record.text,
    embedding: record.embedding, pattern: record.pattern, split: record.split }));
  const repository = new FrozenRepository(snapshotId, experience, heldoutFamilies);
  return { records: experience, publication, mined, omitted, summary: { snapshotId, snapshotHash: repository.digest,
    episodes: episodes.length, verifiedEpisodes: episodes.filter(episode => episode.verifiedSuccess).length, mined: mined.length,
    eligible: eligible.length, published: records.length, omitted: omitted.length,
    nativePatternsOnly: true, calibration: publication.calibration } };
}

function read<T>(path: string): T { return JSON.parse(readFileSync(resolve(path), "utf8")); }
function fileHash(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
async function main() {
  const [miningPath, bundlePath, manifestPath, budgetDirectory, destination] = process.argv.slice(2);
  if (!destination) throw new Error("Usage: goalspec-build-library.ts MINING_JSON REPOSITORY_BUNDLE SERVICE_MANIFEST SHARED_BUDGET_DIRECTORY NEW_OUTPUT_DIRECTORY");
  const episodes = read<MiningEpisode[]>(miningPath), bundle = read<RepositoryBundle>(bundlePath), manifest = read<ResearchManifest>(manifestPath);
  const fixturePath = bundle.dataset.metadata.fixtureManifestUri;
  if (typeof fixturePath !== "string" || fileHash(fixturePath) !== bundle.dataset.metadata.fixtureManifestHash) throw new Error("Fixture family split manifest missing or changed");
  const fixture = read<{ tasks: { familyId: string; split: string }[] }>(fixturePath);
  const heldout = [...new Set(fixture.tasks.filter(task => task.split !== "train").map(task => task.familyId))];
  const output = resolve(destination);
  mkdirSync(output, { recursive: false });
  const budget = new DurableBudget(join(resolve(budgetDirectory), "budget.jsonl"));
  const events = new ImmutableEventLog(join(resolve(budgetDirectory), `events-library-${randomUUID()}.jsonl`));
  try {
    const provider = researchProvider(budget.ledger, "preparation", event => events.append({ operation: "library_embedding", event }));
    const result = await buildLibrary(episodes, bundle, manifest, heldout, provider.embed);
    for (const [name, value] of Object.entries(result)) writeFileSync(join(output, `${name}.json`), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
    events.append({ type: "library_frozen", ...result.summary, inputHashes: { mining: fileHash(miningPath), bundle: fileHash(bundlePath), manifest: fileHash(manifestPath) } });
    process.stdout.write(JSON.stringify(result.summary) + "\n");
  } finally { events.close(); budget.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`Library build failed: ${error instanceof Error ? error.name : "Error"}. Inspect content-free budget/event artifacts.\n`); process.exitCode = 1; });
}
