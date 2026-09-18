import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, hash } from "../src/lib/goalspec/canonical";
import { buildDecisionState, extractCandidateFeatures } from "../src/lib/goalspec/controller-features";
import { nativeCandidateGraph } from "../services/goalspec-runtime/native-candidate-graph";
import { NativeReadPolicy } from "../services/goalspec-runtime/native-read-policy";
import { loadReplayCohort } from "./goalspec-prediction-v3";

const root = resolve("research/goalspec/runs"), target = resolve(process.argv[2] ?? join(root, "local-controller-v4-replay-20260916"));
if (existsSync(target)) throw new Error("Controller replay output must be new");
const planPath = join(root, "local-v3-confirmation-prediction-20260915/dispatch-plan.json");
const plan = JSON.parse(readFileSync(planPath, "utf8"));
const cohort = loadReplayCohort(plan.inputs);
const dataManifestPath = join(root, "local-controller-v4-dataset-20260916-c/manifest.json");
const dataManifest = JSON.parse(readFileSync(dataManifestPath, "utf8"));
const rows = cohort.checkpoints.map(checkpoint => {
  const { frame, tools, ...declaration } = checkpoint;
  if (!frame || checkpoint.unavailableReason) return { ...declaration, split: dataManifest.splits[checkpoint.familyId], state: null, candidates: [], actionFeatures: null, readToolNames: Object.keys(tools) };
  const state = buildDecisionState(frame), policy = new NativeReadPolicy(checkpoint.domain, frame.scope); policy.updateFrame(frame);
  const pool = nativeCandidateGraph(frame, tools, () => true, { maxCandidates: 32 });
  return { ...declaration, split: dataManifest.splits[checkpoint.familyId], state, actionFeatures: extractCandidateFeatures(state, null).values,
    readToolNames: Object.keys(tools), candidates: pool.map(candidate => ({ candidate, eligible: policy.eligible(candidate.invocation), features: extractCandidateFeatures(state, candidate).values })),
    candidatePoolHash: hash(pool) };
});
const bytes = rows.map(row => canonical(row)).join("\n") + "\n";
const sourceFiles = [planPath, dataManifestPath, ...cohort.sourceFiles.map(source => source.path)];
const codeFiles = ["scripts/goalspec-controller-replay.ts", "src/lib/goalspec/controller-features.ts", "services/goalspec-runtime/native-candidate-graph.ts", "services/goalspec-runtime/native-read-policy.ts"];
const manifest = { version: "goalspec-controller-replay-v1", checkpointCount: rows.length, label: "v3 Base tapes reused as development; includes training families", noProviderCalls: true,
  datasetHash: dataManifest.datasetHash, checkpointHash: createHash("sha256").update(bytes).digest("hex"),
  sourceFiles: sourceFiles.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
  codeFiles: codeFiles.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })) };
mkdirSync(target, { recursive: true });
writeFileSync(join(target, "checkpoints.jsonl"), bytes, { flag: "wx" });
writeFileSync(join(target, "manifest.json"), canonical(manifest) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output: target, checkpointCount: rows.length, checkpointHash: manifest.checkpointHash }));
