import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import type { ExecutionFrame, GoalSet } from "../src/lib/goalspec/contracts/generated";
import { buildSpeculationContext, extractV5Features, publicRevision } from "../src/lib/goalspec/controller-v5-features";
import { memoryQuery, retrieveContextualMemory, validateMemoryArtifact } from "../src/lib/goalspec/experience-memory";
import { buildDecisionState } from "../src/lib/goalspec/controller-features";
import { nativeCandidateGraphV5 } from "../services/goalspec-runtime/native-candidate-graph";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { publicPrefixSources, publicReplayMessages } from "./goalspec-prediction-v3";

const COHORTS = ["local-training-v1-20260915", "local-v2-development-1-20260915", "local-v2-development-2-20260915",
  "local-v3-development-1-20260915", "local-v3-development-2-20260915", "local-v3-development-3-20260915"];
const READS: Record<string, string[]> = { retail: ["find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"],
  airline: ["get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"] };
export function v5FamilySplits(allowed: string[]): Record<string, "train" | "selection" | "calibration"> {
  const result: Record<string, "train" | "selection" | "calibration"> = {};
  for (const domain of ["retail", "airline"]) {
    const group = [...new Set(allowed)].filter(id => id.startsWith(`${domain}:`))
      .sort((a, b) => hash(["controller-v5-split-1", a]).localeCompare(hash(["controller-v5-split-1", b])));
    const held = Math.max(1, Math.floor(group.length / 5));
    group.forEach((id, index) => result[id] = index < held ? "calibration" : index < held * 2 ? "selection" : "train");
  }
  return result;
}
export function literalProxyGoals(frame: ExecutionFrame): GoalSet {
  const entries = Object.entries(frame.sources).filter(([id, value]) => id.startsWith("requirement:") && typeof value === "string")
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  const entry = entries.at(-1);
  return { schemaVersion: 1, hypotheses: entry ? [{ id: "literal-request-proxy", objective: String(entry[1]), probability: 1,
    sources: [{ sourceId: entry[0], path: [] }], constraints: [] }] : [], unknown: entry ? 0 : 1, revisionHash: hash(entries) };
}
export function buildV5Dataset(output: string) {
  if (existsSync(output)) throw new Error("V5 dataset output must be new");
  const sources: { path: string; sha256: string }[] = [];
  const read = (path: string): any => { const bytes = readFileSync(path); sources.push({ path: resolve(path), sha256: createHash("sha256").update(bytes).digest("hex") }); return JSON.parse(bytes.toString("utf8")); };
  const root = resolve("research/goalspec/runs");
  const oldManifest = read(join(root, "local-controller-v4-dataset-20260916-c/manifest.json"));
  const permitted = Object.entries(oldManifest.splits).filter(([, split]) => split === "train").map(([family]) => family);
  const splits = v5FamilySplits(permitted), trainingFamilies = permitted.filter(family => splits[family] === "train");
  const memoryPath = join(root, "local-memory-v3-20260915/artifact.json"), memory = validateMemoryArtifact(read(memoryPath));
  const declarations = COHORTS.map(cohort => ({ cohort, directory: join(root, cohort), manifest: read(join(root, cohort, "service-manifest.json")),
    design: read(join(root, cohort, "design.json")), contexts: read(join(root, cohort, "public-contexts.json")) }));
  const rows: unknown[] = [], annotationInputs: unknown[] = [], excluded: unknown[] = [];
  for (const d of declarations) for (const [i, run] of d.manifest.runs.entries()) {
    const trial = d.design.trials[i];
    if (run.arm !== "base" || trial.arm !== "base" || !Object.hasOwn(splits, trial.family)) continue;
    const native = read(join(d.directory, `${run.runId}.json`)), nativeContext = d.contexts[run.runId];
    if (native.record?.runId !== run.runId || native.record?.arm !== "base" || !nativeContext?.capturedBeforeExecution
      || hash(nativeContext.tools) !== hash(run.tools)) throw new Error("V5 Base public provenance mismatch");
    if (!Array.isArray(native.simulation?.messages)) { excluded.push({ runId: run.runId, reason: "missing_messages" }); continue; }
    const messages = publicReplayMessages(native.simulation.messages);
    let userSeen = false;
    const decisions = messages.flatMap((message, index) => { if (message.role === "user") userSeen = true; return userSeen && message.role === "assistant" ? [index] : []; });
    const tools = Object.fromEntries(run.tools.filter((t: any) => READS[run.domain].includes(t.function.name)).map((t: any) => [t.function.name, t.function.parameters]));
    for (const [boundary, index] of decisions.entries()) {
      // The future action is read only after public context, retrieval, binding and features are frozen.
      const prefix = messages.slice(0, index);
      const frame: ExecutionFrame = { schemaVersion: 1, runId: run.runId, boundary,
        scope: { tenantId: `custom-tau-${run.domain}`, principalId: "native-actor", authorizationVersion: "native-v1",
          environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(run.tools) },
        requestedObjective: prefix.filter(message => message.role === "user").map(message => message.content ?? "").join("\n"),
        policy: nativeContext.policy, sources: publicPrefixSources(prefix), goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash([]) },
        snapshotId: memory.repositorySnapshotId };
      const retrieval = retrieveContextualMemory(frame, memoryQuery(frame), memory,
        { allowedFamilies: trainingFamilies, excludeFamilies: [trial.family] });
      const context = buildSpeculationContext(frame, { goals: literalProxyGoals(frame), sourceRevisionHash: publicRevision(frame), goalKind: "literal-proxy", memory: retrieval });
      const candidates = nativeCandidateGraphV5(frame, tools, () => true);
      const choices = [...candidates, "NO_READ" as const, "READ_UNCOVERED" as const];
      const state = buildDecisionState(frame), features = choices.map(candidate => extractV5Features(context, candidate, state));
      const policy = new NativeReadPolicy(run.domain, frame.scope); policy.updateFrame(frame);
      const eligible = candidates.map(candidate => policy.eligible(candidate.invocation));
      const actual = messages[index].calls, actualRead = actual.filter(action => Object.hasOwn(tools, action.tool));
      const key = (action: { tool: string; arguments: unknown }) => canonical([action.tool, action.arguments]);
      const actualKeys = new Set(actualRead.map(key));
      const targets = candidates.flatMap((candidate, position) => actualKeys.has(key(candidate.invocation)) ? [position] : []);
      if (!targets.length) targets.push(candidates.length + (actualRead.length ? 1 : 0));
      const groupId = hash([run.runId, boundary]), prefixHash = hash(prefix);
      const metadata = { groupId, familyId: trial.family, split: splits[trial.family], runId: run.runId, cohort: d.cohort, boundary,
        prefixHash, frameHash: hash(frame), originalSnapshotId: d.manifest.snapshotId };
      rows.push({ ...metadata, context, candidates, features, eligible, targets, actual, actualRead: actualRead.length > 0 });
      annotationInputs.push({ ...metadata, frame, publicInputHash: context.publicInputHash, sourceRevisionHash: context.requestRevisionHash,
        annotationPolicy: "requested goals from this public prefix only; no future action or private evaluator" });
    }
  }
  const content = rows.map(row => canonical(row)).join("\n") + "\n";
  const manifest = { version: "goalspec-controller-dataset-v5", sourcePolicy: "prior-v4-train-families-only-no-confirmation-cohorts",
    splitMethod: "domain-stratified-family-hash-before-traces-v5-1", splits, permittedPriorTrainingFamilies: permitted,
    datasetHash: createHash("sha256").update(content).digest("hex"), rows: rows.length, sources, excluded,
    memoryPath, memoryFamilyPolicy: "new-training-families-only-exclude-current-family", memorySnapshot: memory.repositorySnapshotId,
    goalLabels: "literal-request-proxy, not annotation-teacher agreement", reliabilityLabels: "unavailable",
    retrievalQuery: "memoryQuery-v3-public-prefix", candidateCap: 128,
    codeSources: ["scripts/goalspec-controller-v5-dataset.ts", "src/lib/goalspec/controller-v5-features.ts", "src/lib/goalspec/experience-memory.ts", "services/goalspec-runtime/native-candidate-graph.ts"]
      .map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })) };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "dataset.jsonl"), content, { flag: "wx" });
  writeFileSync(join(output, "annotation-inputs.jsonl"), annotationInputs.map(row => canonical(row)).join("\n") + "\n", { flag: "wx" });
  writeFileSync(join(output, "manifest.json"), canonical(manifest) + "\n", { flag: "wx" });
  return { rows: rows.length, datasetHash: manifest.datasetHash, splits, sourceFiles: sources.length, output };
}
if (process.argv[1]?.endsWith("goalspec-controller-v5-dataset.ts")) console.log(JSON.stringify(buildV5Dataset(resolve(process.argv[2] ?? "research/goalspec/runs/local-controller-v5-dataset-20260916")), null, 2));
