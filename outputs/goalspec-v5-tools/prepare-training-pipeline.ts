import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonical, hash } from "../../src/lib/goalspec/canonical";
import { validateControllerV5Artifact } from "../../src/lib/goalspec/controller-v5";
import { validateMemoryArtifact, type MemoryFile } from "../../src/lib/goalspec/experience-memory";
import { freshV5FamilySplits, type V5FreshDatasetPlan } from "../../scripts/goalspec-controller-v5-fresh-dataset";
import type { V5MemoryBuildPlan } from "../../scripts/goalspec-build-memory-v5";

const ROOT = resolve(__dirname, "../.."), RUNS = join(ROOT, "research/goalspec/runs");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const file = (path: string): MemoryFile => ({ path: resolve(path), sha256: sha(readFileSync(path)) });
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const jsonl = (path: string) => readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const write = (path: string, value: unknown) => writeFileSync(path, canonical(value) + "\n", { flag: "wx" });
const verifyFiles = (files: MemoryFile[]) => { for (const source of files) if (file(source.path).sha256 !== source.sha256) throw new Error("Frozen pipeline input changed"); };
const observedFitFamilies = (rows: any[]) => [...new Set<string>(rows.filter(row => row.split === "train").map(row => row.familyId))].sort();
const sameStrings = (a: string[], b: string[]) => canonical([...a].sort()) === canonical([...b].sort());
const VERSION = "goalspec-v5-post-closure-training-pipeline-v1";

/** Planning only: this command never starts training or any provider request. */
export function prepareMemoryPlan(trainingDirectory: string, fixturePath: string, newDirectory: string) {
  const output = resolve(newDirectory), training = resolve(trainingDirectory);
  if (existsSync(output)) throw new Error("A new pipeline directory is required");
  const priorDirectory = join(RUNS, "local-controller-v5-dataset-20260916-b");
  const priorManifestPath = join(priorDirectory, "manifest.json"), priorDataPath = join(priorDirectory, "dataset.jsonl");
  const permittedPath = join(RUNS, "local-controller-v4-dataset-20260916-c/manifest.json");
  const priorMemoryPath = join(RUNS, "local-memory-v3-20260915/artifact.json");
  const inputs = [priorManifestPath, priorDataPath, permittedPath, priorMemoryPath, resolve(fixturePath),
    ...["service-manifest.json", "design.json", "summary.json", "public-contexts.json", "outcomes.jsonl"].map(name => join(training, name))].map(file);
  const priorManifest = read(priorManifestPath), priorRows = jsonl(priorDataPath), permitted = read(permittedPath);
  const fixture = read(fixturePath), design = read(join(training, "design.json")), summary = read(join(training, "summary.json"));
  const service = read(join(training, "service-manifest.json")), outcomes = jsonl(join(training, "outcomes.jsonl"));
  if (priorManifest.version !== "goalspec-controller-dataset-v5" || priorManifest.sourcePolicy !== "prior-v4-train-families-only-no-confirmation-cohorts"
    || priorManifest.datasetHash !== file(priorDataPath).sha256 || priorRows.length !== 239 || priorManifest.rows !== priorRows.length
    || permitted.version !== "goalspec-controller-dataset-v1") throw new Error("Original permitted 239-prefix lineage required");
  if (fixture.generator !== "fresh-native-v5" || fixture.studyStage !== "training" || design.version !== "goalspec-experiment-v5"
    || design.studyStage !== "training" || summary.serviceExitCode !== 0 || design.trials.length !== 40 || service.runs.length !== 40 || outcomes.length !== 40
    || design.trials.some((trial: any) => trial.arm !== "base")) throw new Error("The complete 40-slot Base training cohort must close first");
  const freshSplits = freshV5FamilySplits(fixture.learningFamilySplit), oldFit = observedFitFamilies(priorRows);
  if (oldFit.length !== 11 || oldFit.some(family => priorManifest.splits[family] !== "train" || permitted.splits[family] !== "train")) throw new Error("Historical fitting-family lineage changed");
  for (const row of priorRows) if (priorManifest.splits[row.familyId] !== row.split || /confirmation/.test(row.cohort)) throw new Error("Historical source split changed");
  const allowedFamilies = [...oldFit, ...Object.keys(freshSplits).filter(family => freshSplits[family] === "train")].sort();
  const heldoutFamilies = [...new Set([...Object.keys(permitted.splits), ...Object.keys(priorManifest.splits), ...Object.keys(fixture.learningFamilySplit)])]
    .filter(family => !allowedFamilies.includes(family)).sort();
  const source = (path: string) => inputs.find(input => input.path === resolve(path))!;
  const cohort: V5MemoryBuildPlan["cohorts"][number] = { directory: training, fixtureManifest: source(fixturePath), files: {
    "service-manifest.json": source(join(training, "service-manifest.json")).sha256,
    "design.json": source(join(training, "design.json")).sha256,
    "summary.json": source(join(training, "summary.json")).sha256,
    "public-contexts.json": source(join(training, "public-contexts.json")).sha256,
    "outcomes.jsonl": source(join(training, "outcomes.jsonl")).sha256,
  } };
  const memoryPlan: V5MemoryBuildPlan = { version: "goalspec-memory-build-v5", snapshotId: "native-training-v5-20260916", heldoutFamilies,
    prior: { artifact: source(priorMemoryPath), permittedManifest: source(permittedPath) }, cohorts: [cohort] };
  const paths = { memory: join(output, "memory"), dataset: join(output, "dataset"), neutral: join(output, "neutral"),
    teacherJoin: join(output, "teacher-join"), conditional: join(output, "conditional"), annotations: join(RUNS, "local-v5-annotations-continuation-c-20260916") };
  const body = { version: VERSION, inputs, prior: { directory: priorDirectory, datasetHash: priorManifest.datasetHash, manifestSha256: source(priorManifestPath).sha256 },
    freshSplits, oldObservedFittingFamilies: oldFit, allowedMemoryFamilies: allowedFamilies, excludedMemoryFamilies: heldoutFamilies,
    memoryPlanHash: hash(memoryPlan), cohort, paths, source: file(__filename),
    policy: "No selection/calibration/development/confirmation episodes in fitted or runtime memory; exact old public frames retained; no unannotated goal labels" };
  verifyFiles(inputs); mkdirSync(output, { recursive: true });
  write(join(output, "pipeline.json"), { ...body, contentHash: hash(body) });
  write(join(output, "memory-plan.json"), memoryPlan);
  return { output, memoryPlan: join(output, "memory-plan.json"), paths, allowedMemoryFamilies: allowedFamilies, freshSplits };
}

function pipeline(directory: string) {
  const value = read(join(directory, "pipeline.json")), { contentHash, ...body } = value;
  if (value.version !== VERSION || hash(body) !== contentHash) throw new Error("Pipeline receipt mismatch");
  verifyFiles(value.inputs); return value;
}

export function prepareFreshPlan(directory: string) {
  const p = pipeline(directory), memoryPath = join(p.paths.memory, "artifact.json");
  if (hash(read(join(directory, "memory-plan.json"))) !== p.memoryPlanHash) throw new Error("Memory build plan changed");
  const memory = validateMemoryArtifact(read(memoryPath));
  if (memory.compilerVersion !== "goalspec-memory-v5" || memory.repositorySnapshotId !== "native-training-v5-20260916"
    || memory.runs.some(run => !p.allowedMemoryFamilies.includes(run.familyId))) throw new Error("Memory contains a non-fitting family");
  const plan: V5FreshDatasetPlan = { version: "goalspec-controller-fresh-dataset-plan-v5", prior: p.prior,
    memory: file(memoryPath), cohort: p.cohort };
  const output = join(directory, "fresh-dataset-plan.json"); write(output, plan);
  return { output, sha256: file(output).sha256, dataset: p.paths.dataset };
}

export function pipelineReceipt(directory: string, configurationPath?: string) {
  const p = pipeline(directory), memoryPath = join(p.paths.memory, "artifact.json"), memory = validateMemoryArtifact(read(memoryPath));
  const datasetManifest = read(join(p.paths.dataset, "manifest.json")), rows = jsonl(join(p.paths.dataset, "dataset.jsonl"));
  const neutralPath = join(p.paths.neutral, "controller.json"), neutral = validateControllerV5Artifact(read(neutralPath));
  const conditionalPath = join(p.paths.conditional, "controller.json"), conditional = validateControllerV5Artifact(read(conditionalPath));
  const joinedManifest = read(join(p.paths.teacherJoin, "manifest.json")), teacherReport = read(join(p.paths.conditional, "report.json"));
  const actualFit = observedFitFamilies(rows);
  if (datasetManifest.datasetHash !== file(join(p.paths.dataset, "dataset.jsonl")).sha256 || neutral.lineage.datasetHash !== datasetManifest.datasetHash
    || joinedManifest.sourceDatasetHash !== datasetManifest.datasetHash || !sameStrings(actualFit, neutral.lineage.trainingFamilies)
    || !sameStrings(neutral.lineage.trainingFamilies, conditional.lineage.trainingFamilies)
    || canonical(neutral.neutralWeights) !== canonical(conditional.neutralWeights)
    || memory.runs.some(run => !actualFit.includes(run.familyId)) || teacherReport.neutralWeightsFrozen !== true
    || joinedManifest.planned !== 100 || !joinedManifest.annotationCohort?.continuation) throw new Error("Final model/memory/teacher lineage mismatch");
  const selectedPaths = [join(directory, "pipeline.json"), join(directory, "memory-plan.json"), join(directory, "fresh-dataset-plan.json"),
    memoryPath, join(p.paths.memory, "report.json"), join(p.paths.dataset, "manifest.json"), join(p.paths.dataset, "dataset.jsonl"),
    neutralPath, join(p.paths.neutral, "report.json"), join(p.paths.teacherJoin, "manifest.json"), join(p.paths.teacherJoin, "dataset.jsonl"),
    conditionalPath, join(p.paths.conditional, "report.json")];
  let configuration: unknown = null;
  if (configurationPath) {
    configuration = read(configurationPath);
    const selected = (configuration as { controllerPath?: string }).controllerPath;
    if (!selected || ![resolve(neutralPath), resolve(conditionalPath)].includes(resolve(selected))) throw new Error("Configuration must select an exact pipeline controller");
    selectedPaths.push(resolve(configurationPath));
  }
  const sources = selectedPaths.map(file);
  const body = { version: "goalspec-v5-post-training-lineage-receipt-v1", sources,
    memory: { contentHash: memory.contentHash, families: [...new Set(memory.runs.map(run => run.familyId))].sort(), fittingOnly: true },
    datasetHash: datasetManifest.datasetHash, neutralArtifactHash: neutral.contentHash, conditionalArtifactHash: conditional.contentHash,
    neutralFittingFamilies: actualFit, neutralSelectionFamilies: neutral.lineage.selectionFamilies, neutralCalibrationFamilies: neutral.lineage.calibrationFamilies,
    teacherFamilies: teacherReport.partition, reliability: teacherReport.reliability,
    originalAnnotationDenominator: joinedManifest.planned, usableTeacherRows: joinedManifest.rows, maskedTeacherRows: joinedManifest.masked.length,
    configuration, pipelineInputPolicy: "Only declared training and annotation sources; no confirmation outcomes read by this pipeline", source: file(__filename) };
  verifyFiles(sources); const path = join(directory, "lineage-receipt.json"); write(path, { ...body, contentHash: hash(body) });
  return { path, sha256: file(path).sha256, neutralArtifactHash: neutral.contentHash, conditionalArtifactHash: conditional.contentHash };
}

if (require.main === module) {
  const [command, first, second, third] = process.argv.slice(2);
  const result = command === "memory-plan" && first && second && third ? prepareMemoryPlan(first, second, third)
    : command === "fresh-plan" && first ? prepareFreshPlan(first)
    : command === "receipt" && first ? pipelineReceipt(first, second) : null;
  if (!result) throw new Error("Use memory-plan CLOSED_TRAINING FIXTURE NEW_PIPELINE_DIR | fresh-plan PIPELINE_DIR | receipt PIPELINE_DIR [CONFIGURATION_JSON]");
  console.log(JSON.stringify(result, null, 2));
}
