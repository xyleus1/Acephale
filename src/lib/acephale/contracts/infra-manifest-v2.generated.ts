/* Generated from infra-manifest-v2.schema.json. Do not edit. */

/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "GitRevision".
 */
export type GitRevision = string;
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "Sha256".
 */
export type Sha256 = string;
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "ImageDigest".
 */
export type ImageDigest = string;
/**
 * This interface was referenced by `InfraExperimentManifestV2`'s JSON-Schema
 * via the `definition` "Families".
 */
export type Families = string[];

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
    cuda: "13.0.3";
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
    totalCeilingMicrodollars: 500000000;
    trancheMicrodollars: number;
    infrastructureMicrodollars: number;
    protectedContingencyMicrodollars: 65000000;
    maximumGpuHours: number;
    ledgerCheckpointHash: Sha256;
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
