import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, hash, type Json } from "../src/lib/goalspec/canonical";
import { buildMemoryArtifact, validateMemoryArtifact, type MemoryFile, type MemoryMessage, type MemoryRun } from "../src/lib/goalspec/experience-memory";
import { extractMemoryEpisodes } from "./goalspec-build-memory-v3";

export interface V5MemoryBuildPlan {
  version: "goalspec-memory-build-v5"; snapshotId: string; heldoutFamilies: string[];
  prior?: { artifact: MemoryFile; permittedManifest: MemoryFile };
  cohorts: { directory: string; fixtureManifest: MemoryFile; files: {
    "service-manifest.json": string; "design.json": string; "summary.json": string;
    "public-contexts.json": string; "outcomes.jsonl": string } }[];
}
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function messages(raw: any[]): MemoryMessage[] {
  return raw.map((message, index) => {
    if (!["assistant", "user", "tool"].includes(message.role)) throw new Error("Unexpected public role");
    let observation: Json = null;
    if (message.role === "tool") { try { observation = JSON.parse(message.content ?? "null"); } catch { observation = message.content ?? null; } }
    return { index, role: message.role, content: message.content ?? null,
      calls: (message.tool_calls ?? []).map((call: any) => ({ id: call.id, tool: call.name, arguments: call.arguments })),
      callId: message.role === "tool" ? message.id ?? null : null, observation };
  });
}
/** Explicit closed inputs only. No directory enumeration, test ingestion or private evaluator prompts. */
export function buildV5Memory(plan: V5MemoryBuildPlan, output: string) {
  if (plan.version !== "goalspec-memory-build-v5" || !plan.snapshotId || !Array.isArray(plan.heldoutFamilies)
    || !Array.isArray(plan.cohorts) || plan.cohorts.length > 4 || existsSync(output)) throw new Error("Invalid/new memory build plan");
  const sources = new Map<string, MemoryFile>(), heldout = new Set(plan.heldoutFamilies);
  const read = (path: string, expected?: string) => {
    const absolute = resolve(path), bytes = readFileSync(absolute), digest = sha(bytes);
    if (expected && digest !== expected) throw new Error("Memory input hash mismatch");
    const previous = sources.get(absolute);
    if (previous && previous.sha256 !== digest) throw new Error("Mutable memory input");
    sources.set(absolute, { path: absolute, sha256: digest }); return bytes;
  };
  const json = (file: MemoryFile) => JSON.parse(read(file.path, file.sha256).toString("utf8"));
  const runs: MemoryRun[] = [], episodes: ReturnType<typeof extractMemoryEpisodes> = [], exclusions: { runId: string; reason: string }[] = [];
  if (plan.prior) {
    const prior = validateMemoryArtifact(json(plan.prior.artifact)), manifest = json(plan.prior.permittedManifest);
    if (manifest.version !== "goalspec-controller-dataset-v1" || !manifest.splits) throw new Error("Missing prior permitted training declaration");
    const eligible = prior.runs.filter(run => run.stage === "v1-training" && run.split === "train"
      && manifest.splits[run.familyId] === "train" && !heldout.has(run.familyId));
    const ids = new Set(eligible.map(run => run.id));
    for (const run of eligible) for (const file of run.sourceFiles) read(file.path, file.sha256);
    // The new registry uses resolved paths. Rebind copied references to those
    // exact verified entries without changing historical bytes or run labels.
    runs.push(...eligible.map(run => ({ ...run, sourceFiles: run.sourceFiles.map(file => sources.get(resolve(file.path))!) })));
    episodes.push(...prior.episodes.filter(episode => ids.has(episode.runId)));
    for (const run of prior.runs.filter(run => !ids.has(run.id))) exclusions.push({ runId: run.id, reason: "prior_not_permitted_training" });
  }
  for (const cohort of plan.cohorts) {
    const files = Object.fromEntries(Object.entries(cohort.files).map(([name, digest]) => [name, read(join(cohort.directory, name), digest).toString("utf8")]));
    const manifest = JSON.parse(files["service-manifest.json"]), design = JSON.parse(files["design.json"]), summary = JSON.parse(files["summary.json"]);
    const contexts = JSON.parse(files["public-contexts.json"]), fixtureManifest = json(cohort.fixtureManifest);
    const outcomes = files["outcomes.jsonl"].trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    if (design.studyStage !== "training" || fixtureManifest.studyStage !== "training" || fixtureManifest.generator !== "fresh-native-v5"
      || summary.serviceExitCode !== 0 || !Array.isArray(manifest.runs) || manifest.runs.length !== outcomes.length
      || design.trials.length !== outcomes.length || design.trials.some((trial: any) => trial.arm !== "base")
      || !fixtureManifest.learningFamilySplit) throw new Error("Only fully closed Base training cohorts are admitted");
    for (const [index, configured] of manifest.runs.entries()) {
      const trial = design.trials[index], row = outcomes[index];
      if (row.runId !== configured.runId || row.arm !== "base" || configured.arm !== "base" || row.familyId !== trial.family
        || row.studyStage !== "training" || !Object.hasOwn(fixtureManifest.learningFamilySplit, trial.family)) throw new Error("Training row declaration mismatch");
      if (fixtureManifest.learningFamilySplit[trial.family] !== "train" || heldout.has(trial.family)) {
        exclusions.push({ runId: row.runId, reason: "calibration_or_heldout_family" }); continue;
      }
      const path = join(cohort.directory, `${configured.runId}.json`), artifact = JSON.parse(read(path).toString("utf8"));
      const context = contexts[configured.runId];
      if (artifact.record?.runId !== row.runId || hash(artifact.record) !== hash(row) || !context?.capturedBeforeExecution
        || hash(context.tools) !== hash(configured.tools)) throw new Error("Native training artifact lineage mismatch");
      const verdict = artifact.verdict;
      if (!verdict || typeof verdict.success !== "boolean" || !Number.isInteger(verdict.constraintViolations)
        || verdict.constraintViolations < 0 || !Array.isArray(artifact.simulation?.messages)) {
        exclusions.push({ runId: row.runId, reason: "no_verified_outcome_or_public_messages" }); continue;
      }
      const publicMessages = messages(artifact.simulation.messages);
      const run: MemoryRun = { id: row.runId, familyId: row.familyId, stage: "v5-training", split: "train",
        scope: { tenantId: `custom-tau-${configured.domain}`, principalId: "native-actor", authorizationVersion: "native-v1",
          environmentVersion: fixtureManifest.nativeCommit, toolSchemaHash: hash(configured.tools) },
        policyHash: hash(context.policy), sourceFiles: [sources.get(resolve(path))!, sources.get(resolve(join(cohort.directory, "outcomes.jsonl")))!,
          sources.get(resolve(join(cohort.directory, "public-contexts.json")))!], success: row.success === true && verdict.success === true,
        outcomeVerified: true, constraintViolations: verdict.constraintViolations, termination: row.termination,
        publicMessageCount: publicMessages.length, episodeCount: 0 };
      const extracted = extractMemoryEpisodes(run, publicMessages); run.episodeCount = extracted.length;
      runs.push(run); episodes.push(...extracted);
    }
  }
  if (new Set(runs.map(run => run.id)).size !== runs.length) throw new Error("Duplicate memory source run");
  for (const file of sources.values()) if (sha(readFileSync(file.path)) !== file.sha256) throw new Error("Memory input changed before freeze");
  const artifact = buildMemoryArtifact({ repositorySnapshotId: plan.snapshotId, sourceFiles: [...sources.values()], runs, episodes, misses: [] }, { profile: "v5" });
  const report = { version: "goalspec-memory-build-v5", contentHash: artifact.contentHash, runs: runs.length, episodes: episodes.length,
    sourceFiles: sources.size, families: [...new Set(runs.map(run => run.familyId))].sort(), exclusions,
    sourcePolicy: artifact.sourcePolicy, calibrationUsedForRetrieval: false, privateEvaluatorInputsExcluded: true,
    misses: "Fresh Base runs have no speculative predictions; unavailable confusion labels are not fabricated" };
  mkdirSync(output, { recursive: true });
  for (const [name, value] of Object.entries({ "artifact.json": artifact, "report.json": report, "plan.json": plan })) writeFileSync(join(output, name), canonical(value) + "\n", { flag: "wx" });
  return report;
}
if (process.argv[1]?.endsWith("goalspec-build-memory-v5.ts")) {
  if (!process.argv[2] || !process.argv[3]) throw new Error("Usage: goalspec-build-memory-v5.ts plan.json NEW_OUTPUT_DIRECTORY");
  console.log(JSON.stringify(buildV5Memory(JSON.parse(readFileSync(resolve(process.argv[2]), "utf8")), resolve(process.argv[3])), null, 2));
}
