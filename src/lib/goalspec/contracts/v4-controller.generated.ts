/* Generated from v4-controller.schema.json. Do not edit. */

export type GoalSpecControllerV4 =
  DecisionState | CandidateFeatures | ControllerScores | ControllerDecision | ControllerArtifact;
export type Strings = string[];
export type Probability = number;

export interface DecisionState {
  version: "goalspec-decision-state-v1";
  boundary: number;
  requestedObjective: string;
  activeGoals: Strings;
  unresolvedRequirements: Strings;
  recentTools: Strings;
  sourceIds: Strings;
  visibleText: string;
  unknownGoal: Probability;
}
export interface CandidateFeatures {
  version: "goalspec-controller-features-v1";
  candidateId: string;
  /**
   * @minItems 216
   * @maxItems 216
   */
  values: number[];
}
export interface ControllerScores {
  actionRead: Probability;
  /**
   * @maxItems 32
   */
  candidates: CandidateScore[];
  elapsedMs: number;
}
export interface CandidateScore {
  candidateId: string;
  nextAction: Probability;
  usefulWithin2: Probability;
  readiness: Probability;
  exposure: Probability | null;
}
export interface ControllerDecision {
  version: "goalspec-controller-decision-v1";
  action: "read" | "NO_READ" | "defer";
  /**
   * @maxItems 3
   */
  rankedCandidateIds: string[];
  /**
   * @maxItems 2
   */
  exposeCandidateIds: string[];
  scores: ControllerScores;
  artifactHash: string;
}
export interface ControllerArtifact {
  goalFeaturePolicy: "public-request-only";
  version: "goalspec-controller-artifact-v1";
  featureVersion: "goalspec-controller-features-v1";
  inputDimension: 216;
  architecture: "logistic" | "mlp-32-16";
  /**
   * @minItems 1
   * @maxItems 3
   */
  layers: DenseLayer[];
  /**
   * @minItems 5
   * @maxItems 5
   */
  heads: ("actionRead" | "nextAction" | "usefulWithin2" | "readiness" | "exposure")[];
  trainedHeads: {
    actionRead: boolean;
    nextAction: boolean;
    usefulWithin2: boolean;
    readiness: boolean;
    exposure: boolean;
  };
  calibration: {
    /**
     * @minItems 5
     * @maxItems 5
     */
    temperature: number[];
    /**
     * @minItems 5
     * @maxItems 5
     */
    bias: number[];
    method: "family-heldout-temperature-grid";
  };
  thresholds: {
    actionRead: Probability;
    usefulWithin2: Probability;
    readiness: Probability;
    exposure: Probability;
  };
  lineage: {
    datasetHash: string;
    trainFamilies: Strings;
    selectionFamilies: Strings;
    calibrationFamilies: Strings;
    baseOnly: true;
    seed: number;
    selectedCheckpoint: string;
    soupMembers: Strings;
    randomizedExposureDataHash: string | null;
    labelSemantics: "next-action-imitation;within-two-observed-use;readiness-is-not-authorization;exposure-masked";
  };
  contentHash: string;
}
export interface DenseLayer {
  /**
   * @minItems 1
   * @maxItems 128
   */
  weights: number[][];
  /**
   * @minItems 1
   * @maxItems 128
   */
  bias: number[];
  activation: "relu" | "linear";
}
