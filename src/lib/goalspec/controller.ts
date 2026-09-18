import Ajv2020 from "ajv/dist/2020";
import schema from "./contracts/v4-controller.schema.json";
import { hash } from "./canonical";
import type { Candidate } from "./contracts/generated";
import type { ControllerArtifact, ControllerDecision, ControllerScores, DecisionState } from "./contracts/v4-controller.generated";
import { CONTROLLER_FEATURE_DIMENSION, CONTROLLER_FEATURE_VERSION, CONTROLLER_GOAL_FEATURE_POLICY, extractCandidateFeatures } from "./controller-features";
export type { ControllerArtifact, ControllerDecision, ControllerScores, DecisionState, CandidateFeatures } from "./contracts/v4-controller.generated";
const ajv = new Ajv2020({ strict: true, allErrors: true }); ajv.addSchema(schema);
export function validateControllerContract(name: keyof typeof schema.$defs, value: unknown): void {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate?.(value)) throw new Error(`Invalid ${name}: ${ajv.errorsText(validate?.errors)}`);
}
export function loadControllerArtifact(value: unknown): ControllerArtifact {
  validateControllerContract("ControllerArtifact", value);
  const artifact = value as ControllerArtifact, { contentHash, ...body } = artifact;
  if (hash(body) !== contentHash || artifact.featureVersion !== CONTROLLER_FEATURE_VERSION || artifact.goalFeaturePolicy !== CONTROLLER_GOAL_FEATURE_POLICY || artifact.inputDimension !== CONTROLLER_FEATURE_DIMENSION) throw new Error("Controller artifact hash or feature mismatch");
  let width: number = artifact.inputDimension;
  for (const layer of artifact.layers) {
    if (layer.weights.length !== layer.bias.length || layer.weights.some(row => row.length !== width)) throw new Error("Invalid controller matrix shape");
    width = layer.bias.length;
  }
  if (width !== 5 || artifact.layers.at(-1)?.activation !== "linear" || artifact.heads.join(",") !== "actionRead,nextAction,usefulWithin2,readiness,exposure") throw new Error("Invalid controller heads");
  const architecture = artifact.architecture === "logistic" ? [[5, 216, "linear"]] : [[32, 216, "relu"], [16, 32, "relu"], [5, 16, "linear"]];
  if (artifact.layers.length !== architecture.length || artifact.layers.some((layer, i) => layer.weights.length !== architecture[i][0] || layer.weights[0].length !== architecture[i][1] || layer.activation !== architecture[i][2])) throw new Error("Controller architecture declaration mismatch");
  if (new Set(artifact.lineage.trainFamilies).size !== artifact.lineage.trainFamilies.length || artifact.lineage.trainFamilies.some(f => artifact.lineage.selectionFamilies.includes(f) || artifact.lineage.calibrationFamilies.includes(f)) || artifact.lineage.selectionFamilies.some(f => artifact.lineage.calibrationFamilies.includes(f))) throw new Error("Controller family contamination");
  if (artifact.trainedHeads.exposure && !artifact.lineage.randomizedExposureDataHash) throw new Error("Exposure head requires randomized intervention lineage");
  return structuredClone(artifact);
}
const sigmoid = (v: number) => v >= 0 ? 1 / (1 + Math.exp(-v)) : Math.exp(v) / (1 + Math.exp(v));
export class LocalController {
  readonly artifact: ControllerArtifact;
  constructor(artifact: ControllerArtifact | unknown) { this.artifact = loadControllerArtifact(artifact); }
  probabilities(values: number[]): number[] {
    if (values.length !== this.artifact.inputDimension || values.some(v => !Number.isFinite(v))) throw new Error("Invalid controller feature vector");
    let hidden = values;
    for (const layer of this.artifact.layers) hidden = layer.weights.map((row, index) => {
      const sum = row.reduce((total, w, j) => total + w * hidden[j], layer.bias[index]); return layer.activation === "relu" ? Math.max(0, sum) : sum;
    });
    return hidden.map((logit, i) => sigmoid((logit + this.artifact.calibration.bias[i]) / this.artifact.calibration.temperature[i]));
  }
  score(state: DecisionState, candidates: Candidate[]): ControllerScores {
    validateControllerContract("DecisionState", state);
    if (candidates.length > 32 || new Set(candidates.map(c => c.id)).size !== candidates.length) throw new Error("Controller candidate graph exceeds bound or has duplicate IDs");
    const started = performance.now(), actionRead = this.probabilities(extractCandidateFeatures(state, null).values)[0];
    const scores = candidates.map(candidate => {
      const p = this.probabilities(extractCandidateFeatures(state, candidate).values);
      return { candidateId: candidate.id, nextAction: p[1], usefulWithin2: p[2], readiness: p[3], exposure: this.artifact.trainedHeads.exposure ? p[4] : null };
    });
    return { actionRead, candidates: scores, elapsedMs: performance.now() - started };
  }
  decide(state: DecisionState, candidates: Candidate[]): ControllerDecision {
    const scores = this.score(state, candidates), threshold = this.artifact.thresholds;
    const ranked = [...scores.candidates].sort((a, b) => (b.nextAction + b.usefulWithin2) - (a.nextAction + a.usefulWithin2) || a.candidateId.localeCompare(b.candidateId));
    const accepted = ranked.filter(s => s.usefulWithin2 >= threshold.usefulWithin2 && s.readiness >= threshold.readiness);
    const action = scores.actionRead < threshold.actionRead ? "NO_READ" : accepted.length ? "read" : "defer";
    return { version: "goalspec-controller-decision-v1", action, rankedCandidateIds: action === "read" ? accepted.slice(0, 3).map(s => s.candidateId) : [],
      exposeCandidateIds: action === "read" ? accepted.filter(s => s.exposure !== null && s.exposure >= threshold.exposure).slice(0, 2).map(s => s.candidateId) : [], scores, artifactHash: this.artifact.contentHash };
  }
}
