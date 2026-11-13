import { canonical, copy, hash } from "../../src/lib/acephale/canonical";
import { validateGoals } from "../../src/lib/acephale/compiler";
import { validateContract } from "../../src/lib/acephale/contracts/validate";
import type { Candidate, ExecutionFrame, GoalSet, Json } from "../../src/lib/acephale/contracts/generated";
import { LocalChatModelPort, type InfraChatMessage } from "../../src/lib/acephale/infra-model";
import { memoryQuery, retrieveContextualMemory, validateMemoryArtifact, type FrozenExperienceMemory } from "../../src/lib/acephale/experience-memory";
import { BINARY_RANKING_INSTRUCTION } from "./infra-binary-ranking";
import { GOAL_DRAFT_INSTRUCTION } from "./infra-predictors";
import { assertSelectedGoalSources, compileInfraCandidateWindow, prepareInfraPredictorInput } from "./infra-predictor-input";
import { annotationGoalDraft, type InfraAnnotationInput } from "./infra-goal-annotation";
import { validateNativeSelectionExpansion, type NativeSelectionExpansion, type SelectionPublicRow } from "./infra-training-selection";

export type TrainingPartition = "weight_fit" | "calibration" | "development" | "test";
export type GoalDraft = Omit<GoalSet, "revisionHash">;
export interface TrainingPartitionPlan { weightFitFamilies: string[]; calibrationFamilies: string[]; developmentFamilies: string[]; testFamilies: string[] }
export interface NativeTrainingSelection {
  fittingCheckpointIds: string[]; neutralOnlyPartitions: ("calibration" | "development")[];
  expansion?: NativeSelectionExpansion;
}
export function planNativeTrainingExport(rows: SelectionPublicRow[],
  partitions: TrainingPartitionPlan, selection: NativeTrainingSelection) {
  const expansion = selection.expansion ? validateNativeSelectionExpansion(rows, partitions, selection.expansion) : null;
  const count = expansion?.selectedCheckpointCount ?? 100;
  if (!Array.isArray(selection.fittingCheckpointIds) || selection.fittingCheckpointIds.length !== count
    || selection.fittingCheckpointIds.some(id => typeof id !== "string" || !id)
    || new Set(selection.fittingCheckpointIds).size !== count || !Array.isArray(selection.neutralOnlyPartitions)
    || expansion && hash(selection.fittingCheckpointIds) !== hash(expansion.checkpointIds)
    || [...selection.neutralOnlyPartitions].sort().join(",") !== "calibration,development") {
    throw new Error("Native multitask export requires 100 declared fitting checkpoints or a verified public expansion, and explicit neutral calibration/development");
  }
  const selected = new Set(selection.fittingCheckpointIds), byId = new Map(rows.map(row => [row.checkpoint_id, row]));
  if (byId.size !== rows.length || [...selected].some(id => !byId.has(id) || byId.get(id)!.split !== "train"
    || !partitions.weightFitFamilies.includes(byId.get(id)!.family_id))) throw new Error("Selected fitting checkpoint is absent or outside weight-fitting families");
  const families = new Map<string, TrainingPartition>();
  for (const [partition, names] of [["weight_fit", partitions.weightFitFamilies], ["calibration", partitions.calibrationFamilies],
    ["development", partitions.developmentFamilies], ["test", partitions.testFamilies]] as const) {
    for (const name of names) {
      if (families.has(name)) throw new Error("Training family partitions overlap");
      families.set(name, partition);
    }
  }
  return new Map(rows.map(row => {
    const partition = families.get(row.family_id);
    if (!partition || row.split !== (["weight_fit", "calibration"].includes(partition) ? "train" : partition)) throw new Error("Original split cannot be reassigned for training export");
    const mode = selected.has(row.checkpoint_id) ? "multitask" : partition === "weight_fit" ? "unselected_fit"
      : partition === "test" ? "heldout_excluded" : "neutral";
    return [row.checkpoint_id, mode] as const;
  }));
}
export interface TrainingSource {
  id: string; familyId: string; sourceSplit: "train" | "development" | "test";
  sourceDatasetHash: string; publicInputHash: string; compilerHash: string; tokenizerHash: string; chatTemplateHash: string;
  reviewHash: string;
}
export interface TrainingExampleV1 {
  schemaVersion: 1; id: string; familyId: string; partition: TrainingPartition; task: "goal" | "rank_binary";
  condition: "neutral" | "conditional" | null; prompt: InfraChatMessage[]; completion: string; promptTokens: number;
  compiledInputHash: string; sourceFrameHash: string; candidateIds: string[]; candidateWindowHash: string | null;
  provenance: Record<string, unknown>;
}
export interface ObservedNextBatch {
  checkpoint_id: string; input_hash: string; source: "observed-authoritative-next-decision";
  next_invocations: { tool: string; arguments: Record<string, Json> }[];
  eligible_reads: { tool: string; arguments: Record<string, Json> }[];
  target_kind: "READ" | "NO_READ";
}
export function trainingPartition(source: TrainingSource, plan: TrainingPartitionPlan): TrainingPartition {
  const seen = new Set<string>(); let found: TrainingPartition | undefined;
  for (const [partition, families] of [["weight_fit", plan.weightFitFamilies], ["calibration", plan.calibrationFamilies],
    ["development", plan.developmentFamilies], ["test", plan.testFamilies]] as const) {
    if (!Array.isArray(families)) throw new Error("Explicit family partition lists required");
    for (const family of families) {
      if (!family || seen.has(family)) throw new Error("Training family partitions overlap");
      seen.add(family); if (family === source.familyId) found = partition;
    }
  }
  if (!found || source.sourceSplit !== (["weight_fit", "calibration"].includes(found) ? "train" : found)) throw new Error("Original split cannot be reassigned for weight fitting");
  for (const key of ["sourceDatasetHash", "publicInputHash", "compilerHash", "tokenizerHash", "chatTemplateHash", "reviewHash"] as const) {
    if (!/^[a-f0-9]{64}$/.test(source[key])) throw new Error(`Missing training provenance: ${key}`);
  }
  return found;
}
function checkedFrame(frame: ExecutionFrame) { validateContract("ExecutionFrame", frame); return copy(frame); }
function checkedDraft(draft: GoalDraft, frame: ExecutionFrame): GoalSet {
  if (!draft || Object.keys(draft).sort().join(",") !== "hypotheses,schemaVersion,unknown") throw new Error("Goal target must omit server-owned metadata");
  const goals = { ...copy(draft), revisionHash: hash({ request: frame.requestedObjective, policy: frame.policy, sources: frame.sources }) };
  validateGoals(goals, frame.sources); return goals;
}
function provenance(source: TrainingSource) {
  const { id: _id, familyId: _family, ...metadata } = source; return metadata;
}
/** The label callback is deliberately invoked only after public input compilation. */
export async function compileGoalTrainingExample(options: {
  model: LocalChatModelPort; source: TrainingSource; partitions: TrainingPartitionPlan; frame: ExecutionFrame;
  readTarget: () => Promise<{ draft: GoalDraft; annotationHash: string; annotationKind: "teacher_goal_annotation_v1" | "historical_requested_goals_v1" }>;
  signal?: AbortSignal;
}): Promise<TrainingExampleV1> {
  const partition = trainingPartition(options.source, options.partitions), frame = checkedFrame(options.frame);
  const input = prepareInfraPredictorInput(frame, { role: "goal", instruction: GOAL_DRAFT_INSTRUCTION });
  const compiled = await options.model.compileInput({ id: `training:${options.source.id}:goal`, messages: input.messages,
    optionalGroups: input.optionalGroups, maxOutputTokens: 1024 }, options.signal);
  const target = await options.readTarget();
  if (!/^[a-f0-9]{64}$/.test(target.annotationHash) || !["teacher_goal_annotation_v1", "historical_requested_goals_v1"].includes(target.annotationKind)) throw new Error("Explicit verified annotation lineage required");
  const goals = checkedDraft(target.draft, frame); assertSelectedGoalSources(goals, input, compiled.selectedMessageIndexes);
  return { schemaVersion: 1, id: `${options.source.id}:goal`, familyId: options.source.familyId, partition, task: "goal", condition: null,
    prompt: compiled.messages, completion: canonical(target.draft), promptTokens: compiled.inputTokens,
    compiledInputHash: hash(compiled.messages), sourceFrameHash: hash(frame), candidateIds: [], candidateWindowHash: null,
    provenance: { ...provenance(options.source), annotationHash: target.annotationHash, annotationKind: target.annotationKind,
      labelHash: hash(target.draft), requestHash: compiled.inputHash, omissions: compiled.omittedGroups } };
}
/** Both conditions use the same public candidate window. No labels participate in candidate generation. */
export async function compileRankTrainingExamples(options: {
  model: LocalChatModelPort; source: TrainingSource; partitions: TrainingPartitionPlan; frame: ExecutionFrame;
  publicCandidates: (frame: ExecutionFrame) => Candidate[]; memory?: FrozenExperienceMemory; allowedFamilies?: string[];
  conditioningGoals?: GoalDraft; conditioningAnnotationHash?: string; readTarget: () => Promise<ObservedNextBatch>; signal?: AbortSignal;
}): Promise<TrainingExampleV1[]> {
  const partition = trainingPartition(options.source, options.partitions), frame = checkedFrame(options.frame);
  if ((options.conditioningGoals === undefined) !== (options.conditioningAnnotationHash === undefined)) {
    throw new Error("Conditional training requires both goals and annotation identity");
  }
  if (options.memory?.runs.some(run => !options.partitions.weightFitFamilies.includes(run.familyId))) throw new Error("Training memory must contain only weight fitting families");
  const pool = options.publicCandidates(copy(frame));
  if (new Set(pool.map(candidate => candidate.id)).size !== pool.length) throw new Error("Duplicate public candidate IDs");
  for (const candidate of pool) validateContract("Candidate", candidate);
  const window = await compileInfraCandidateWindow(frame, pool, BINARY_RANKING_INSTRUCTION, options.model.inputBudget,
    messages => options.model.measureInputTokens(messages, options.signal));
  if (!window.candidates.length) return [];
  const memory = options.memory ? retrieveContextualMemory(frame, memoryQuery(frame), validateMemoryArtifact(options.memory), {
    allowedFamilies: options.allowedFamilies, excludeFamilies: [options.source.familyId], maxEpisodes: 4, maxChars: 16000,
    strictPolicy: true, verifiedOnly: true }) : null;
  const neutral: GoalSet = { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) };
  const conditions: ["neutral" | "conditional", GoalSet][] = [["neutral", neutral]];
  if (options.conditioningGoals) {
    if (!/^[a-f0-9]{64}$/.test(options.conditioningAnnotationHash ?? "")) throw new Error("Conditional training requires annotation identity");
    conditions.push(["conditional", checkedDraft(options.conditioningGoals, frame)]);
  }
  const compiled = [];
  for (const [condition, goals] of conditions) {
    const input = prepareInfraPredictorInput(frame, { role: "candidate", candidates: window.candidates, goals, memory, instruction: BINARY_RANKING_INSTRUCTION });
    const result = await options.model.compileInput({ id: `training:${options.source.id}:${condition}`, messages: input.messages,
      optionalGroups: input.optionalGroups, maxOutputTokens: 1024 }, options.signal);
    assertSelectedGoalSources(goals, input, result.selectedMessageIndexes); compiled.push({ condition, result });
  }
  const label = await options.readTarget();
  if (label.checkpoint_id !== options.source.id || label.input_hash !== options.source.publicInputHash || label.source !== "observed-authoritative-next-decision"
    || !Array.isArray(label.next_invocations) || !Array.isArray(label.eligible_reads)
    || label.eligible_reads.some(read => !label.next_invocations.some(invocation => hash(read) === hash(invocation)))
    || label.target_kind !== (label.eligible_reads.length ? "READ" : "NO_READ")) throw new Error("Next-batch label is not bound to this public checkpoint");
  const hits = window.candidates.map(candidate => label.eligible_reads.some(read => hash(read) === hash({ tool: candidate.invocation.tool, arguments: candidate.invocation.arguments })) ? 1 : 0);
  const target = { action: hits.includes(1) ? "READ" : label.eligible_reads.length ? "READ_UNCOVERED" : "NO_READ", hits };
  return compiled.map(({ condition, result }) => ({ schemaVersion: 1, id: `${options.source.id}:rank:${condition}`, familyId: options.source.familyId,
    partition, task: "rank_binary", condition, prompt: result.messages, completion: canonical(target), promptTokens: result.inputTokens,
    compiledInputHash: hash(result.messages), sourceFrameHash: hash(frame), candidateIds: window.candidates.map(candidate => candidate.id), candidateWindowHash: window.windowHash,
    provenance: { ...provenance(options.source), labelHash: hash(label), candidatePoolHash: window.poolHash,
      observedNextBatch: true, ...(condition === "conditional" ? { annotationHash: options.conditioningAnnotationHash } : {}),
      requestHash: result.inputHash, memoryHash: memory?.artifactHash ?? null,
      omittedCandidateIds: window.omittedCandidateIds, omissions: result.omittedGroups } }));
}

/** Native supervision is one complete group; a missing goal label never becomes a neutral-only row. */
export async function compileNativeTrainingExamples(options: Omit<Parameters<typeof compileRankTrainingExamples>[0], "conditioningGoals" | "conditioningAnnotationHash"> & {
  annotation: unknown; publicInput: InfraAnnotationInput;
}): Promise<TrainingExampleV1[]> {
  if (options.publicInput.checkpoint_id !== options.source.id || options.publicInput.input_hash !== options.source.publicInputHash
    || options.publicInput.input.sources.some(source => hash(options.frame.sources[source.id]) !== hash(source.value))) {
    throw new Error("Annotation sources differ from the compiled public frame");
  }
  const draft = annotationGoalDraft(options.annotation, options.publicInput), annotationHash = hash(options.annotation);
  const goal = await compileGoalTrainingExample({ ...options,
    readTarget: async () => ({ draft, annotationHash, annotationKind: "teacher_goal_annotation_v1" }) });
  const ranks = await compileRankTrainingExamples({ ...options, conditioningGoals: draft, conditioningAnnotationHash: annotationHash });
  if (ranks.length !== 2) throw new Error("Native multitask export requires a nonempty matched candidate window");
  return [...ranks, goal].map(row => ({ ...row, provenance: { ...row.provenance, exportProtocol: "native-multitask-v2" } }));
}
