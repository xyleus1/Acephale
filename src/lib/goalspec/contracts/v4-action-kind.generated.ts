/* Generated from v4-action-kind.schema.json. Do not edit. */

export interface ActionKindArtifact {
  version: "goalspec-action-kind-artifact-v1";
  featureVersion: "goalspec-controller-features-v1";
  goalFeaturePolicy: "public-request-only";
  /**
   * @minItems 5
   * @maxItems 5
   */
  classes: ("read" | "message" | "write" | "compute" | "stop")[];
  /**
   * @minItems 5
   * @maxItems 5
   */
  trained: boolean[];
  /**
   * @minItems 5
   * @maxItems 5
   */
  weights: number[][];
  /**
   * @minItems 5
   * @maxItems 5
   */
  bias: number[];
  temperature: number;
  lineage: {
    datasetHash: string;
    baseOnly: true;
    trainFamilies: string[];
    selectionFamilies: string[];
    calibrationFamilies: string[];
    /**
     * @minItems 5
     * @maxItems 5
     */
    trainLabelCounts: number[];
    seed: number;
    selectedEpoch: number;
    stopLabelPolicy: "unavailable-without-explicit-public-actor-stop";
    roleMapHash: string;
  };
  contentHash: string;
}
