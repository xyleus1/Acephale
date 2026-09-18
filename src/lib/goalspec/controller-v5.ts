import { copy, hash } from "./canonical";
import type { Candidate } from "./contracts/generated";
import { buildDecisionState } from "./controller-features";
import { validateGoals } from "./compiler";
import { extractV5Features, publicRevision, V5_FEATURE_VERSION, V5_GOAL_DIMENSION, V5_NEUTRAL_DIMENSION, type SpeculationContext } from "./controller-v5-features";
export { buildSpeculationContext, publicRevision } from "./controller-v5-features";
export type { SpeculationContext } from "./controller-v5-features";
export interface ControllerV5Artifact {
  version: "goalspec-controller-v5"; featureVersion: typeof V5_FEATURE_VERSION;
  architecture: "listwise-linear-neutral-plus-goal-residual";
  neutralWeights: number[]; goalWeights: number[];
  calibration: { neutralTemperature: number; goalTemperature: number;
    reliability: { status: "unavailable" | "teacher-calibrated"; bins: { upper: number; probability: number; count: number }[]; sourceHashes: string[] } };
  lineage: { datasetHash: string; trainingFamilies: string[]; selectionFamilies: string[]; calibrationFamilies: string[];
    goalTraining: "none" | "literal-request-proxy" | "teacher-goals"; excludedPriorHeldout: true; sources: { path: string; sha256: string }[] };
  contentHash: string;
}
export interface V5Decision {
  action: "READ" | "NO_READ" | "READ_UNCOVERED";
  noReadProbability: number; uncoveredProbability: number; goalReliability: number;
  goalCorrectionStatus: string; rankedCandidateIds: string[]; elapsedMs: number;
  candidates: { candidateId: string; probability: number; neutralLogit: number; goalCorrection: number }[];
}
export interface V5UtilityEstimate { toolMs: number; validationMs: number; schedulingMs: number; predictionMs: number;
  contentionMs: number; contextMs: number; measuredExposureBenefitMs: number }
export function validateControllerV5Artifact(input: unknown): ControllerV5Artifact {
  if (!input || typeof input !== "object") throw new Error("Invalid v5 controller artifact");
  const artifact = copy(input) as ControllerV5Artifact;
  const { contentHash, ...body } = artifact;
  if (artifact.version !== "goalspec-controller-v5" || artifact.featureVersion !== V5_FEATURE_VERSION
    || artifact.architecture !== "listwise-linear-neutral-plus-goal-residual" || contentHash !== hash(body)
    || !Array.isArray(artifact.neutralWeights) || artifact.neutralWeights.length !== V5_NEUTRAL_DIMENSION
    || !Array.isArray(artifact.goalWeights) || artifact.goalWeights.length !== V5_GOAL_DIMENSION
    || [...artifact.neutralWeights, ...artifact.goalWeights].some(n => !Number.isFinite(n))) throw new Error("Invalid v5 weights or hash");
  const calibration = artifact.calibration, lineage = artifact.lineage;
  if (!calibration || !Number.isFinite(calibration.neutralTemperature) || calibration.neutralTemperature <= 0
    || !Number.isFinite(calibration.goalTemperature) || calibration.goalTemperature <= 0
    || !lineage?.excludedPriorHeldout || !/^[a-f0-9]{64}$/.test(lineage.datasetHash)
    || !["none", "literal-request-proxy", "teacher-goals"].includes(lineage.goalTraining)) throw new Error("Invalid v5 calibration or lineage");
  const sets = [lineage.trainingFamilies, lineage.selectionFamilies, lineage.calibrationFamilies];
  if (sets.some(set => !Array.isArray(set) || !set.length || set.some(id => typeof id !== "string"))) throw new Error("Missing family split");
  const joined = sets.flat();
  if (new Set(joined).size !== joined.length) throw new Error("Controller family split leakage");
  const reliability = calibration.reliability;
  if (!reliability || !["unavailable", "teacher-calibrated"].includes(reliability.status)
    || !Array.isArray(reliability.bins) || !Array.isArray(reliability.sourceHashes)) throw new Error("Invalid reliability calibration");
  if (reliability.status === "unavailable" && reliability.bins.length) throw new Error("Unavailable reliability cannot have probabilities");
  if (reliability.status === "teacher-calibrated" && (lineage.goalTraining !== "teacher-goals" || !reliability.bins.length || !reliability.sourceHashes.length)) throw new Error("Teacher reliability requires independent provenance");
  let previous = 0;
  for (const bin of reliability.bins) {
    if (!Number.isFinite(bin.upper) || bin.upper <= previous || bin.upper > 1 || !Number.isFinite(bin.probability)
      || bin.probability < 0 || bin.probability > 1 || !Number.isSafeInteger(bin.count) || bin.count < 1) throw new Error("Invalid reliability bin");
    previous = bin.upper;
  }
  if (reliability.bins.length && previous !== 1) throw new Error("Reliability bins must cover confidence one");
  return artifact;
}
const dot = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0);
export class LocalControllerV5 {
  readonly artifact: ControllerV5Artifact;
  constructor(artifact: unknown) { this.artifact = validateControllerV5Artifact(artifact); }
  decide(context: SpeculationContext, candidates: Candidate[], options: { goalConditioning?: boolean; experimentalUncalibratedGoalWeight?: number } = {}): V5Decision {
    if (candidates.length > 128 || new Set(candidates.map(candidate => candidate.id)).size !== candidates.length
      || candidates.some(candidate => ["NO_READ", "READ_UNCOVERED"].includes(candidate.id))) throw new Error("Invalid v5 candidate pool");
    const started = performance.now(), calibration = this.artifact.calibration;
    let reliability = 0, status = "goal_conditioning_disabled";
    const experimental = options.experimentalUncalibratedGoalWeight;
    if (experimental !== undefined && (!Number.isFinite(experimental) || experimental < 0 || experimental > 1)) throw new Error("Invalid experimental goal weight");
    if (options.goalConditioning) {
      status = context.goals.rejection ?? "reliability_unavailable";
      let current = context.goals.grounded;
      try {
        validateGoals(context.goals.set, context.frame.sources);
        if (context.requestRevisionHash !== publicRevision(context.frame) || context.goals.sourceRevisionHash !== context.requestRevisionHash
          || !context.goals.set.hypotheses.length || context.goals.set.hypotheses.some(goal => [...goal.sources, ...goal.constraints.flatMap(item => item.sources)]
            .some(ref => !/^(requirement:|request:|current_user_request$)/.test(ref.sourceId)))) current = false;
      } catch { current = false; }
      if (!current && context.goals.grounded) status = "stale_or_unsupported_goal";
      if (current) {
        const confidence = Math.max(...context.goals.set.hypotheses.map(goal => goal.probability));
        if (experimental !== undefined) { reliability = experimental; status = "experimental_uncalibrated"; }
        else if (calibration.reliability.status === "teacher-calibrated" && context.goals.kind === "inferred") {
          reliability = calibration.reliability.bins.find(bin => confidence <= bin.upper)?.probability ?? 0;
          status = "teacher_calibrated";
        } else if (calibration.reliability.status === "teacher-calibrated") status = "reliability_goal_kind_mismatch";
      }
    }
    const preparedState = buildDecisionState(context.frame);
    const entries = [...candidates, "NO_READ" as const, "READ_UNCOVERED" as const].map(candidate => {
      const features = extractV5Features(context, candidate, preparedState), neutralLogit = dot(features.neutral, this.artifact.neutralWeights);
      const goalCorrection = reliability * dot(features.goal, this.artifact.goalWeights);
      const temperature = reliability > 0 ? calibration.goalTemperature : calibration.neutralTemperature;
      return { candidateId: typeof candidate === "string" ? candidate : candidate.id, neutralLogit, goalCorrection, logit: (neutralLogit + goalCorrection) / temperature };
    });
    const maximum = Math.max(...entries.map(entry => entry.logit));
    const denominator = entries.reduce((sum, entry) => sum + Math.exp(entry.logit - maximum), 0);
    const probabilities = entries.map(entry => ({ ...entry, probability: Math.exp(entry.logit - maximum) / denominator }));
    const ranking = probabilities.filter(entry => entry.candidateId !== "NO_READ" && entry.candidateId !== "READ_UNCOVERED")
      .sort((a, b) => b.probability - a.probability || a.candidateId.localeCompare(b.candidateId));
    const best = [...probabilities].sort((a, b) => b.probability - a.probability || a.candidateId.localeCompare(b.candidateId))[0].candidateId;
    return { action: best === "NO_READ" || best === "READ_UNCOVERED" ? best : "READ",
      noReadProbability: probabilities.find(entry => entry.candidateId === "NO_READ")!.probability,
      uncoveredProbability: probabilities.find(entry => entry.candidateId === "READ_UNCOVERED")!.probability,
      goalReliability: reliability, goalCorrectionStatus: status,
      rankedCandidateIds: ranking.slice(0, 3).map(entry => entry.candidateId),
      candidates: ranking.map(({ logit: _logit, ...entry }) => entry), elapsedMs: performance.now() - started };
  }
}
/** Admission is expected measured latency saving, not a product of learned gates.
 * No causal exposure benefit is assumed from imitation labels. */
export function v5ExpectedSaving(probability: number, estimate: V5UtilityEstimate): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || Object.values(estimate).some(n => !Number.isFinite(n) || n < 0)) throw new Error("Invalid v5 utility inputs");
  return probability * estimate.toolMs - estimate.validationMs - estimate.schedulingMs - estimate.predictionMs - estimate.contentionMs - estimate.contextMs;
}
