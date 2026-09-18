import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, copy, hash } from "../src/lib/goalspec/canonical";
import { LocalControllerV5, type V5Decision } from "../src/lib/goalspec/controller-v5";
import type { SpeculationContext } from "../src/lib/goalspec/controller-v5-features";
import type { Candidate } from "../src/lib/goalspec/contracts/generated";

type Row = { groupId: string; familyId: string; split: string; context: SpeculationContext; candidates: Candidate[];
  actualRead: boolean; targets: number[]; actual: { tool: string; arguments: unknown }[] };
export function v5ReplayMetrics(rows: { source: Row; decision: V5Decision }[]) {
  let reads = 0, nonreads = 0, exactTop1 = 0, exactTop3 = 0, toolTop1 = 0, noRead = 0, joint = 0, nll = 0, covered32 = 0, covered128 = 0;
  for (const { source, decision } of rows) {
    const n = source.candidates.length, ids = source.targets.filter(i => i < n).map(i => source.candidates[i].id);
    const ranked = decision.rankedCandidateIds, first = source.candidates.find(candidate => candidate.id === ranked[0]);
    const tools = new Set(source.actual.map(action => action.tool));
    if (source.actualRead) {
      reads++; exactTop1 += Number(ids.includes(ranked[0])); exactTop3 += Number(ranked.some(id => ids.includes(id)));
      toolTop1 += Number(!!first && tools.has(first.invocation.tool));
      covered128 += Number(ids.length > 0); covered32 += Number(source.targets.some(i => i < Math.min(32, n)));
    } else { nonreads++; noRead += Number(decision.action === "NO_READ"); }
    const p = source.targets.reduce((sum, i) => sum + (i === n ? decision.noReadProbability : i === n + 1 ? decision.uncoveredProbability
      : decision.candidates.find(item => item.candidateId === source.candidates[i].id)?.probability ?? 0), 0);
    nll -= Math.log(Math.max(1e-12, p));
    joint += Number(decision.action === "NO_READ" ? source.targets.includes(n) : decision.action === "READ_UNCOVERED"
      ? source.targets.includes(n + 1) : ids.includes(ranked[0]));
  }
  return { checkpoints: rows.length, reads, nonreads, jointActionAccuracy: joint / Math.max(1, rows.length),
    estimatedActionCrossEntropyNats: nll / Math.max(1, rows.length), readToolTop1: toolTop1 / Math.max(1, reads),
    readArgumentsTop1: exactTop1 / Math.max(1, reads), readArgumentsTop3: exactTop3 / Math.max(1, reads),
    noReadSpecificity: noRead / Math.max(1, nonreads), candidateCoverage32: covered32 / Math.max(1, reads), candidateCoverage128: covered128 / Math.max(1, reads) };
}
export function replayV5(dataset: string, artifactPath: string, output: string) {
  if (existsSync(output)) throw new Error("Replay output must be new");
  const datasetBytes = readFileSync(join(dataset, "dataset.jsonl")), manifest = JSON.parse(readFileSync(join(dataset, "manifest.json"), "utf8"));
  const bytes = readFileSync(artifactPath), model = new LocalControllerV5(JSON.parse(bytes.toString("utf8")));
  if (createHash("sha256").update(datasetBytes).digest("hex") !== manifest.datasetHash) throw new Error("Dataset hash mismatch");
  const rows: Row[] = datasetBytes.toString("utf8").trim().split(/\r?\n/).map(line => JSON.parse(line));
  const arms = ["neutral_no_memory", "active_memory", "goalspec_safe", "goal_dropout", "shuffled_safe", "proxy_experimental", "oracle_next_read_hint_experimental"];
  const scored: { source: Row; arm: string; decision: V5Decision }[] = [];
  for (const [index, row] of rows.entries()) for (const arm of arms) {
    const context = copy(row.context);
    if (arm === "neutral_no_memory") { context.memory = null; context.workflows = []; }
    if (arm === "shuffled_safe") context.goals.set.hypotheses = copy(rows[(index + 1) % rows.length].context.goals.set.hypotheses);
    // A deliberately future-informed upper-bound diagnostic, never a fitting
    // target, runtime input or claim of oracle requested-goal correctness.
    if (arm === "oracle_next_read_hint_experimental") {
      const ref = Object.keys(context.frame.sources).find(id => id.startsWith("requirement:"));
      context.goals.set.hypotheses = ref ? [{ id: "oracle-read-hint", objective: row.actual.map(action => action.tool.replace(/_/g, " ")).join(" ") || "NO READ",
        probability: 1, sources: [{ sourceId: ref, path: [] }], constraints: [] }] : [];
    }
    const decision = model.decide(context, row.candidates, { goalConditioning: !["neutral_no_memory", "active_memory"].includes(arm),
      ...(["proxy_experimental", "oracle_next_read_hint_experimental"].includes(arm) ? { experimentalUncalibratedGoalWeight: 1 }
        : arm === "goal_dropout" ? { experimentalUncalibratedGoalWeight: 0 } : {}) });
    scored.push({ source: row, arm, decision });
  }
  const scores = scored.map(({ source, arm, decision }) => ({ groupId: source.groupId, familyId: source.familyId, split: source.split,
    poolHash: hash(source.candidates), arm, decision }));
  const report = { version: "goalspec-controller-v5-replay", datasetHash: manifest.datasetHash, artifactHash: model.artifact.contentHash,
    rows: rows.length, arms, identicalPool: true, poolCap: 128,
    metrics: Object.fromEntries(["train", "selection", "calibration"].map(split => [split, Object.fromEntries(arms.map(arm =>
      [arm, v5ReplayMetrics(scored.filter(row => row.arm === arm && row.source.split === split))]))])),
    perFamily: Object.fromEntries([...new Set(rows.map(row => row.familyId))].sort().map(family => [family, Object.fromEntries(arms.map(arm =>
      [arm, v5ReplayMetrics(scored.filter(row => row.arm === arm && row.source.familyId === family))]))])),
    caveats: ["Reuse of training/selection/calibration prefixes, not a new held-out benchmark", "Cross-entropy is an action prediction estimate, not true conditional entropy",
      "Memory removal is a frozen-model ablation, not a separately retrained baseline", "Calibration fold has been used to fit temperature",
      "Goal correction remains disabled when semantic reliability is unavailable; literal proxy and oracle next-read hint are explicitly uncalibrated diagnostics",
      "No task-success or live-latency inference is possible from this replay", "Coverage32 is the first32 of the identical128 proposal graph; compare ranking only on identical pools"] };
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "report.json"), canonical(report) + "\n", { flag: "wx" });
  writeFileSync(join(output, "scores.jsonl"), scores.map(score => canonical(score)).join("\n") + "\n", { flag: "wx" });
  writeFileSync(join(output, "manifest.json"), canonical({ version: report.version, inputs: [join(dataset, "dataset.jsonl"), join(dataset, "manifest.json"), artifactPath]
    .map(path => ({ path: resolve(path), sha256: createHash("sha256").update(readFileSync(path)).digest("hex") })),
    outputs: ["report.json", "scores.jsonl"].map(name => ({ path: name, sha256: createHash("sha256").update(readFileSync(join(output, name))).digest("hex") })) }) + "\n", { flag: "wx" });
  return { rows: rows.length, scored: scores.length, output, artifactHash: model.artifact.contentHash };
}
if (process.argv[1]?.endsWith("goalspec-controller-v5-replay.ts")) {
  if (!process.argv[2] || !process.argv[3] || !process.argv[4]) throw new Error("Usage: v5-replay DATASET_DIRECTORY CONTROLLER_JSON NEW_OUTPUT_DIRECTORY");
  console.log(JSON.stringify(replayV5(resolve(process.argv[2]), resolve(process.argv[3]), resolve(process.argv[4])), null, 2));
}
