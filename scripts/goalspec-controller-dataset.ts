import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import type { Candidate, ExecutionFrame, Json } from "../src/lib/goalspec/contracts/generated";
import { buildDecisionState, extractCandidateFeatures } from "../src/lib/goalspec/controller-features";
import { publicPrefixSources, publicReplayMessages } from "./goalspec-prediction-v3";
import { nativeCandidateGraph } from "../services/goalspec-runtime/native-candidate-graph";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";

const READS: Record<string, string[]> = { retail: ["find_user_id_by_name_zip", "find_user_id_by_email", "get_order_details", "get_product_details", "get_item_details", "get_user_details", "list_all_product_types"], airline: ["get_reservation_details", "get_user_details", "list_all_airports", "search_direct_flight", "search_onestop_flight", "get_flight_status"] };
const key = (a: { tool: string; arguments: unknown }) => canonical([a.tool, a.arguments]);
const ROOT = resolve("research/goalspec/runs");
const COHORTS = ["local-training-v1-20260915", "local-v2-development-1-20260915", "local-v2-development-2-20260915", "local-v3-development-1-20260915", "local-v3-development-2-20260915", "local-v3-development-3-20260915", "local-v3-confirmation-20260915"];
export function familySplits(families: string[]) {
  const result: Record<string, "train" | "selection" | "calibration"> = {};
  for (const domain of ["retail", "airline"]) {
    const group = [...new Set(families)].filter(f => f.startsWith(`${domain}:`)).sort((a, b) => hash(["controller-v4-split-1", a]).localeCompare(hash(["controller-v4-split-1", b])));
    const held = Math.max(1, Math.floor(group.length / 5));
    group.forEach((family, i) => result[family] = i < held ? "calibration" : i < held * 2 ? "selection" : "train");
  }
  return result;
}
export function buildControllerDataset(output: string) {
  if (existsSync(output)) throw new Error("Controller dataset output must be new");
  const sources: { path: string; sha256: string }[] = [];
  const read = (path: string) => { const bytes = readFileSync(path); sources.push({ path: resolve(path), sha256: createHash("sha256").update(bytes).digest("hex") }); return JSON.parse(bytes.toString("utf8")); };
  const declarations = COHORTS.map(cohort => { const directory = join(ROOT, cohort); return { cohort, directory, manifest: read(join(directory, "service-manifest.json")), design: read(join(directory, "design.json")), contexts: read(join(directory, "public-contexts.json")) }; });
  // Split identifiers before any trace, label, candidate, feature or outcome is read.
  const families = declarations.flatMap(d => d.design.trials.filter((t: { arm: string }) => t.arm === "base").map((t: { family: string }) => t.family));
  const splits = familySplits(families), rows: unknown[] = [], checkpointRows: unknown[] = [], excluded: unknown[] = [];
  let baseRuns = 0, readDecisions = 0, coveredNext = 0, candidatesTotal = 0;
  for (const d of declarations) for (const [i, run] of d.manifest.runs.entries()) {
    if (run.arm !== "base") continue;
    const trial = d.design.trials[i];
    if (trial.arm !== "base" || !splits[trial.family] || !READS[run.domain]) throw new Error("Invalid Base family declaration");
    baseRuns++;
    const path = join(d.directory, `${run.runId}.json`);
    if (!existsSync(path)) { excluded.push({ runId: run.runId, reason: "missing_native_trace" }); continue; }
    const native = read(path), context = d.contexts[run.runId];
    if (native.record?.runId !== run.runId || native.record?.arm !== "base" || !context?.capturedBeforeExecution || !context.policy || hash(context.tools) !== hash(run.tools)) throw new Error("Native public context lineage differs");
    if (!Array.isArray(native.simulation?.messages)) { excluded.push({ runId: run.runId, reason: "missing_public_messages" }); continue; }
    const messages = publicReplayMessages(native.simulation.messages);
    let userSeen = false;
    const decisions = messages.flatMap((message, index) => { if (message.role === "user") userSeen = true; return message.role === "assistant" && userSeen ? [index] : []; });
    const tools = Object.fromEntries(run.tools.filter((t: any) => READS[run.domain].includes(t.function.name)).map((t: any) => [t.function.name, t.function.parameters]));
    for (const [boundary, index] of decisions.entries()) {
      const prefix = messages.slice(0, index), actual = messages[index].calls;
      const frame: ExecutionFrame = { schemaVersion: 1, runId: run.runId, boundary,
        scope: { tenantId: `custom-tau-${run.domain}`, principalId: "native-actor", authorizationVersion: "native-v1", environmentVersion: "2174a603f6d014ef94473ffa95957f6ce27100db", toolSchemaHash: hash(run.tools) },
        requestedObjective: prefix.filter(m => m.role === "user").map(m => m.content ?? "").join("\n"), policy: context.policy,
        sources: publicPrefixSources(prefix), goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) }, snapshotId: d.manifest.snapshotId };
      const policy = new NativeReadPolicy(run.domain, frame.scope); policy.updateFrame(frame);
      const candidates = nativeCandidateGraph(frame, tools, () => true, { maxCandidates: 32 });
      const state = buildDecisionState(frame), groupId = hash([run.runId, boundary]), split = splits[trial.family];
      const actualRead = actual.some(a => Object.hasOwn(tools, a.tool)), next = new Set(actual.map(key));
      const within = new Set(decisions.slice(boundary, boundary + 2).flatMap(j => messages[j].calls.map(key)));
      const meta = { familyId: trial.family, split, runId: run.runId, groupId, boundary, cohort: d.cohort };
      rows.push({ ...meta, state, candidate: null, features: extractCandidateFeatures(state, null), labels: [Number(actualRead), null, null, null, null] });
      for (const candidate of candidates) rows.push({ ...meta, state, candidate, features: extractCandidateFeatures(state, candidate),
        labels: [null, Number(next.has(key(candidate.invocation))), Number(within.has(key(candidate.invocation))), Number(policy.eligible(candidate.invocation)), null] });
      if (actualRead) { readDecisions++; if (candidates.some(c => next.has(key(c.invocation)))) coveredNext++; }
      candidatesTotal += candidates.length;
      checkpointRows.push({ ...meta, frameHash: hash(frame), state, candidates, actual: actual as unknown as Json, actualRead,
        withinTwoKeys: [...within], prefixHash: hash(prefix), featureHash: hash(candidates.map(c => extractCandidateFeatures(state, c))) });
    }
  }
  const dataset = rows.map(row => canonical(row)).join("\n") + "\n", datasetHash = createHash("sha256").update(dataset).digest("hex");
  const manifest = { version: "goalspec-controller-dataset-v1", createdAt: new Date().toISOString(), baseOnly: true, labelsUseFutureActionsOnly: true,
    sourceInputsExcludePrivateFields: true, splits, splitMethod: "domain-stratified-family-hash-before-traces-v1", datasetHash, sources,
    codeSources: ["scripts/goalspec-controller-dataset.ts", "src/lib/goalspec/controller-features.ts", "services/goalspec-runtime/native-candidate-graph.ts", "services/goalspec-runtime/native-read-policy.ts", "services/goalspec-runtime/native-bindings.ts", "src/lib/goalspec/current-bindings.ts"].map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
    baseRuns, rows: rows.length, checkpoints: checkpointRows.length, candidatesTotal, readDecisions, coveredNext, excluded,
    exposureLabels: "masked; no randomized interventions in existing tapes", interpretation: "historical v1-v3 development reuse; no fresh held-out performance claim" };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "dataset.jsonl"), dataset, { flag: "wx" });
  writeFileSync(join(output, "checkpoints.jsonl"), checkpointRows.map(row => canonical(row)).join("\n") + "\n", { flag: "wx" });
  writeFileSync(join(output, "manifest.json"), canonical(manifest) + "\n", { flag: "wx" });
  return manifest;
}
if (process.argv[1]?.endsWith("goalspec-controller-dataset.ts")) { const result = buildControllerDataset(resolve(process.argv[2] ?? join(ROOT, "local-controller-v4-dataset-20260916"))); console.log(JSON.stringify({ ...result, sources: `${result.sources.length} source hashes`, codeSources: `${result.codeSources.length} code hashes` }, null, 2)); }
