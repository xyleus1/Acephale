/** Compile immutable training examples using the production TypeScript compiler and serving tokenizer. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, copy, hash } from "../src/lib/acephale/canonical";
import type { ExecutionFrame, Json } from "../src/lib/acephale/contracts/generated";
import { LocalChatModelPort } from "../src/lib/acephale/infra-model";
import { PREDICTOR_BASE } from "../src/lib/acephale/predictor-artifact";
import { validateMemoryArtifact } from "../src/lib/acephale/experience-memory";
import { createInfraNativeCandidates } from "../services/acephale-runtime/infra-candidates";
import { infraCandidateCompilerHash } from "../services/acephale-runtime/infra-compiler-identity";
import { NativeReadPolicy } from "../services/acephale-runtime/native-read-policy";
import { documentCandidates } from "../services/acephale-runtime/document-adapter";
import { compileGoalTrainingExample, compileRankTrainingExamples, type GoalDraft, type TrainingExampleV1,
  type TrainingPartitionPlan, type TrainingSource, type ObservedNextBatch } from "../services/acephale-runtime/infra-training-export";
import { publicInfraFrame, type PublicRow } from "./acephale-infra-predict";
import { validateFreshInfraMemoryBinding, verifyInfraPilotBundle } from "./acephale-infra-memory";
import { verifyDocumentBundle } from "./acephale-infra-document-data";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const rows = (path: string): Record<string, any>[] => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const write = (path: string, value: unknown) => writeFileSync(path, canonical(value) + "\n", { flag: "wx", mode: 0o600 });

export function trainingTokenizerIdentity(directory: string) {
  const names = ["tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt", "chat_template.jinja"];
  const files = names.filter(name => existsSync(join(directory, name))).sort().map(path => ({ path, bytes: readFileSync(join(directory, path)).length, sha256: digest(join(directory, path)) }));
  if (!files.some(row => row.path === "tokenizer_config.json") || !files.some(row => row.path === "tokenizer.json" || row.path === "vocab.json")) throw new Error("Actual downloaded tokenizer files required");
  const template = existsSync(join(directory, "chat_template.jinja")) ? readFileSync(join(directory, "chat_template.jinja"), "utf8") : json(join(directory, "tokenizer_config.json")).chat_template;
  if (typeof template !== "string" || !template) throw new Error("Exact serving chat template required");
  return { tokenizerHash: hash(files), chatTemplateHash: hash(template), files };
}
export function historicalGoalSource(queue: Record<string, any>, annotation: Record<string, any>) {
  const prefix = JSON.parse(queue.visible_input_json), original = annotation.originalRow;
  if (queue.split !== "train" || original?.split !== "train" || queue.episode_id !== annotation.checkpoint_id
    || original.episode_id !== queue.episode_id || original.family_id !== queue.family_id
    || annotation.originalHash !== hash(original) || annotation.sourceHash !== hash({ checkpoint: prefix })
    || original.visible_input_hash !== annotation.sourceHash || original.annotation_status !== "validated"
    || original.requested_goals.revisionHash !== annotation.sourceHash) throw new Error("Historical goal annotation source identity differs");
  const { revisionHash: _revisionHash, ...originalDraft } = original.requested_goals;
  if (hash(originalDraft) !== hash(annotation.goalDraft) || !Array.isArray(prefix.messages) || typeof prefix.policy !== "string") throw new Error("Historical annotation draft differs from original");
  const sourceId = "event:historical_public_prefix", draft = copy(annotation.goalDraft) as GoalDraft;
  for (const goal of draft.hypotheses) for (const ref of [...goal.sources, ...goal.constraints.flatMap(constraint => constraint.sources)]) {
    if (ref.sourceId !== "checkpoint") throw new Error("Unsupported historical annotation source namespace");
    ref.sourceId = sourceId;
  }
  const scope = { tenantId: "historical-apigen", principalId: "training-compiler", authorizationVersion: "no-execution",
    environmentVersion: "apigen-source-reported", toolSchemaHash: hash(prefix.tools ?? []) };
  const frame: ExecutionFrame = { schemaVersion: 1, runId: `training:${queue.episode_id}`, boundary: 0, scope,
    snapshotId: "historical-goal-only", requestedObjective: prefix.messages.filter((message: any) => message.role === "user").map((message: any) => message.content).join("\n"),
    policy: prefix.policy, sources: { [sourceId]: prefix as Json }, goals: { schemaVersion: 1, hypotheses: [], unknown: 1, revisionHash: hash({}) } };
  return { frame, draft, annotationHash: hash(annotation), mapping: { checkpoint: sourceId }, originalDraftHash: hash(originalDraft) };
}
export interface TrainingExportConfiguration {
  schemaVersion: 1; mode: "historical_goals" | "native_ranks"; baseUrl: string; tokenizerDirectory: string; output: string;
  partitions: string; reviewArtifact: string; queue?: string; annotations?: string; bundle?: string; memory?: string;
}
export async function exportTraining(configurationPath: string) {
  const config = json(configurationPath) as TrainingExportConfiguration, base = dirname(resolve(configurationPath));
  if (config.schemaVersion !== 1 || !["historical_goals", "native_ranks"].includes(config.mode)) throw new Error("Unknown training export configuration");
  const path = (value: string) => resolve(base, value), output = path(config.output);
  if (existsSync(output)) throw new Error("Training export output must be new");
  const rawPartitions = json(path(config.partitions));
  const partitions: TrainingPartitionPlan = rawPartitions.families ? {
    weightFitFamilies: Object.keys(rawPartitions.families).filter(key => rawPartitions.families[key] === "weight_fit"),
    calibrationFamilies: Object.keys(rawPartitions.families).filter(key => rawPartitions.families[key] === "calibration"),
    developmentFamilies: Object.keys(rawPartitions.families).filter(key => rawPartitions.families[key] === "development"),
    testFamilies: Object.keys(rawPartitions.families).filter(key => rawPartitions.families[key] === "test"),
  } : rawPartitions;
  const tokenizer = trainingTokenizerIdentity(path(config.tokenizerDirectory)), review = json(path(config.reviewArtifact));
  const model = new LocalChatModelPort({ baseUrl: config.baseUrl, model: PREDICTOR_BASE.repository,
    contextWindow: 8192, inputBudget: 7168, maxOutputTokens: 1024 });
  const signal = AbortSignal.timeout(30 * 60 * 1000), examples: TrainingExampleV1[] = [], rejected: { id: string; error: string }[] = [];
  const profile = config.mode === "native_ranks" && json(join(path(config.bundle!), "manifest.json")).files?.["document-lineage.json"] ? "documents" : "native";
  const common = { compilerHash: infraCandidateCompilerHash(profile), tokenizerHash: tokenizer.tokenizerHash,
    chatTemplateHash: tokenizer.chatTemplateHash, reviewHash: hash(review) };
  if (config.mode === "historical_goals") {
    if (!config.queue || !config.annotations) throw new Error("Historical export requires original queue and reviewed annotation wrappers");
    const queue = new Map(rows(path(config.queue)).map(row => [row.episode_id, row]));
    const annotations = rows(path(config.annotations)), sourceDatasetHash = hash({ queue: digest(path(config.queue)), annotations: digest(path(config.annotations)) });
    for (const annotation of annotations) {
      const id = annotation.checkpoint_id;
      try {
        const source = queue.get(id); if (!source) throw new Error("Historical public checkpoint missing");
        const converted = historicalGoalSource(source, annotation);
        const row = await compileGoalTrainingExample({ model, partitions, frame: converted.frame, signal,
          source: { ...common, id, familyId: source.family_id, sourceSplit: source.split, sourceDatasetHash, publicInputHash: annotation.sourceHash },
          readTarget: async () => ({ draft: converted.draft, annotationHash: converted.annotationHash, annotationKind: "historical_requested_goals_v1" }) });
        row.provenance.sourceMapping = converted.mapping; row.provenance.originalDraftHash = converted.originalDraftHash;
        row.provenance.independentReplayVerified = false; examples.push(row);
      } catch (error) { rejected.push({ id, error: error instanceof Error ? error.message : "Compilation failed" }); }
    }
  } else {
    if (!config.bundle || !config.memory) throw new Error("Native export requires verified public bundle and frozen memory");
    const directory = path(config.bundle), bundle = profile === "documents" ? verifyDocumentBundle(directory) : verifyInfraPilotBundle(directory);
    const memory = validateMemoryArtifact(json(path(config.memory)));
    if (profile === "native") validateFreshInfraMemoryBinding(memory, bundle as ReturnType<typeof verifyInfraPilotBundle>);
    else if (memory.repositorySnapshotId !== `infra-documents:${bundle.manifest.bundle_hash}`) throw new Error("Document memory is from another bundle");
    const publicRows = rows(join(directory, "public.jsonl")) as unknown as PublicRow[];
    // Private labels are only joined after each candidate window and prompt have been compiled.
    const labels = new Map(rows(join(directory, "labels.jsonl")).map(row => [row.checkpoint_id, row]));
    const annotations = new Map(config.annotations ? rows(path(config.annotations)).map(row => [row.checkpoint_id, row]) : []);
    for (const row of publicRows) {
      try {
        const frame = publicInfraFrame(row, memory.repositorySnapshotId), policy = profile === "native" ? new NativeReadPolicy(row.domain as "retail" | "airline", frame.scope) : null;
        policy?.updateFrame(frame);
        const source: TrainingSource = { ...common, id: row.checkpoint_id, familyId: row.family_id, sourceSplit: row.split as TrainingSource["sourceSplit"],
          sourceDatasetHash: bundle.manifest.bundle_hash, publicInputHash: row.input_hash };
        const native = profile === "native" ? createInfraNativeCandidates(memory, Object.fromEntries(row.input.tools.map(tool => [tool.name, tool.parameters])),
          invocation => policy!.eligible(invocation), { allowedFamilies: bundle.expected, excludeFamilies: [row.family_id] }) : null;
        const annotation = annotations.get(row.checkpoint_id);
        if (annotation && annotation.input_hash !== row.input_hash) throw new Error("Conditioning annotation belongs to another checkpoint");
        examples.push(...await compileRankTrainingExamples({ model, source, partitions, frame, memory, allowedFamilies: bundle.expected, signal,
          ...(annotation ? { conditioningGoals: annotation.goalDraft, conditioningAnnotationHash: hash(annotation) } : {}),
          publicCandidates: native ? current => native.candidates(current) : documentCandidates,
          readTarget: async () => labels.get(row.checkpoint_id) as unknown as ObservedNextBatch }));
      } catch (error) { rejected.push({ id: row.checkpoint_id, error: error instanceof Error ? error.message : "Compilation failed" }); }
    }
  }
  mkdirSync(output, { recursive: false });
  writeFileSync(join(output, "compiled.jsonl"), examples.map(row => canonical(row) + "\n").join(""), { flag: "wx", mode: 0o600 });
  write(join(output, "rejected.json"), rejected);
  const receipt = { schemaVersion: 1, kind: "acephale-training-export", configurationHash: hash(config), partitionsHash: hash(partitions),
    compilerHash: common.compilerHash, tokenizer, rows: examples.length, rejected: rejected.length, compiledSha256: digest(join(output, "compiled.jsonl")),
    generationCalls: 0, trainingPerformed: false, reviewHash: hash(review), sourceMode: config.mode };
  write(join(output, "receipt.json"), { ...receipt, contentHash: hash(receipt) }); return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error("Usage: acephale-training-export.ts CONFIG_JSON");
  exportTraining(process.argv[2]).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error instanceof Error ? error.message : "Training export failed"); process.exitCode = 1;
  });
}
