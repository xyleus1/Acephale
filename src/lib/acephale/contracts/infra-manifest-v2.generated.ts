/* Generated from infra-manifest-v2.schema.json. Do not edit. */

/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "GitRevision".
 */
export type GitRevision = string;
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "TrainedPredictorArtifact".
 */
export type TrainedPredictorArtifact = MergedPredictorArtifact | UnmergedLoraPredictorArtifact;
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "Sha256".
 */
export type Sha256 = string;
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "Families".
 */
export type Families = string[];
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "ImageDigest".
 */
export type ImageDigest = string;

export interface InfraExperimentManifestV2 {
  version: 2;
  profile: "acephale-infra-v1";
  experimentId: string;
  createdAt: string;
  sourceCommit: GitRevision;
  actor: ModelIdentity;
  predictor: ModelIdentity;
  runtime: {
    imageDigest: ImageDigest;
    vllm: "0.32.0";
    torch: "2.13.0";
    /**
     * Immutable serving image CUDA release declaration; installed toolkit and Torch compile CUDA remain separately observed in the bound inventory.
     */
    cuda: "13.0.2";
    transformers: string;
    node: "22.23.4";
    python: string;
    dependencyLockHash: Sha256;
    packageInventoryHash: Sha256;
    toolParser: "qwen3_xml";
  };
  hardware: {
    provider: string;
    instanceType: string;
    imageId: string;
    gpu: string;
    gpuCount: number;
    gpuMemoryBytes: number;
    driver: string;
    cpu: string;
    ramBytes: number;
  };
  data: {
    datasetHash: Sha256;
    splitHash: Sha256;
    memoryHash: Sha256;
    calibrationHash: Sha256;
    toolSchemaHash: Sha256;
    environmentRevision: string;
    trainingFamilies: Families;
    developmentFamilies: Families;
    heldoutFamilies: Families;
  };
  /**
   * @minItems 3
   * @maxItems 3
   */
  arms: ("demand-only" | "goal-neutral" | "goal-conditioned")[];
  /**
   * @minItems 1
   */
  seeds: number[];
  budgets: {
    totalCeilingMicrodollars: 500000000 | 1000000000;
    trancheMicrodollars: number;
    infrastructureMicrodollars: number;
    protectedContingencyMicrodollars: 65000000;
    maximumGpuHours: number;
    ledgerCheckpointHash: Sha256;
    budgetPolicyHash?:
      | "2d57f84fe03041b077f965add5ac58c7f51f6a90f06e38a579731a3c740d41de"
      | "c58230aaa05f76984f6b26a5acb509bfea89b67fef9f15db918594039d1e6354";
    budgetAmendmentHash?: Sha256;
  };
  protocol: {
    actorContext: "none";
    exposeEvidence: false;
    frozenMemory: true;
    sameCandidatePool: true;
    lookaheadHops: 1;
    rankedCandidates: 3;
    perRunConcurrency: 2;
    globalConcurrency: 4;
    startsPerRun: 12;
    deadlineMs: 5000;
    cachePolicy: string;
    scheduleHash: Sha256;
  };
}
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "ModelIdentity".
 */
export interface ModelIdentity {
  trainedPredictor?: TrainedPredictorArtifact;
  predictionProtocol?: "rank_marginals_v2" | "rank_binary_v1";
  binaryTokenIds?: BinaryTokenIds;
  repository: string;
  revision: GitRevision;
  servedModel: string;
  weightsHash: Sha256;
  tokenizerHash: Sha256;
  chatTemplateHash: Sha256;
  precision: "bfloat16";
  contextWindow: number;
  inputBudget: number;
  outputCap: number;
  temperature: 0;
  topP: 1;
  thinking: false;
  weightsFrozen: true;
}
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "MergedPredictorArtifact".
 */
export interface MergedPredictorArtifact {
  schemaVersion: 1;
  kind: "acephale-trained-predictor";
  base: Base;
  adapterHash: Sha256;
  mergedWeightsHash: Sha256;
  tokenizerHash: Sha256;
  chatTemplateHash: Sha256;
  trainingManifestHash: Sha256;
  weightFitFamilies: Families;
  calibrationFamilies: Families;
  protocol: "rank_binary_v1";
  binaryTokenIds: BinaryTokenIds;
  servedModel: string;
  contentHash: Sha256;
}
export interface Base {
  repository: "Qwen/Qwen3.5-0.8B";
  revision: "2fc06364715b967f1860aea9cf38778875588b17";
}
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "BinaryTokenIds".
 */
export interface BinaryTokenIds {
  zero: number;
  one: number;
}
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "UnmergedLoraPredictorArtifact".
 */
export interface UnmergedLoraPredictorArtifact {
  schemaVersion: 2;
  kind: "acephale-trained-predictor";
  storageMode: "unmerged_lora";
  base: Base;
  baseReceiptHash: Sha256;
  baseWeightsHash: Sha256;
  adapterHash: Sha256;
  adapterStorageDtype: "float32";
  runtimeLoraDtype: "bfloat16";
  servingWeightsHash: Sha256;
  servingProbeHash: Sha256;
  tokenizerHash: Sha256;
  chatTemplateHash: Sha256;
  trainingManifestHash: Sha256;
  weightFitFamilies: Families;
  calibrationFamilies: Families;
  protocol: "rank_binary_v1";
  binaryTokenIds: BinaryTokenIds;
  servedModel: string;
  contentHash: Sha256;
}
