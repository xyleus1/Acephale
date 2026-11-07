/* Generated from v1.schema.json. Do not edit. */

export type AcephaleV1 =
  | Goal
  | GoalSet
  | ExecutionFrame
  | Invocation
  | Candidate
  | WorkflowPattern
  | EvidenceEnvelope
  | Outcome
  | ExperimentManifest;
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | {
      [k: string]: Json;
    };

export interface Goal {
  id: string;
  objective: string;
  probability: number;
  /**
   * @minItems 1
   */
  sources: [SourceRef, ...SourceRef[]];
  constraints: {
    text: string;
    /**
     * @minItems 1
     */
    sources: [SourceRef, ...SourceRef[]];
  }[];
}
export interface SourceRef {
  sourceId: string;
  /**
   * @maxItems 8
   */
  path:
    | []
    | [string | number]
    | [string | number, string | number]
    | [string | number, string | number, string | number]
    | [string | number, string | number, string | number, string | number]
    | [string | number, string | number, string | number, string | number, string | number]
    | [string | number, string | number, string | number, string | number, string | number, string | number]
    | [
        string | number,
        string | number,
        string | number,
        string | number,
        string | number,
        string | number,
        string | number
      ]
    | [
        string | number,
        string | number,
        string | number,
        string | number,
        string | number,
        string | number,
        string | number,
        string | number
      ];
}
export interface GoalSet {
  schemaVersion: 1;
  /**
   * @maxItems 3
   */
  hypotheses: [] | [Goal] | [Goal, Goal] | [Goal, Goal, Goal];
  unknown: number;
  revisionHash: string;
}
export interface ExecutionFrame {
  schemaVersion: 1;
  runId: string;
  boundary: number;
  scope: Scope;
  requestedObjective: string;
  policy: string;
  sources: {
    [k: string]: Json;
  };
  goals: GoalSet;
  snapshotId: string;
}
export interface Scope {
  tenantId: string;
  principalId: string;
  authorizationVersion: string;
  environmentVersion: string;
  toolSchemaHash: string;
}
export interface Invocation {
  tool: string;
  arguments: {
    [k: string]: Json;
  };
  scope: Scope;
}
export interface Candidate {
  schemaVersion: 1;
  id: string;
  invocation: Invocation;
  probability: number;
  bindings: SourceRef[];
  hop: number;
  patternId: string | null;
}
export interface WorkflowPattern {
  schemaVersion: 1;
  id: string;
  scope: Scope;
  snapshotId: string;
  verificationTier: "source_reported" | "independent_replay" | "native_verified";
  /**
   * @maxItems 6
   */
  prefix:
    | []
    | [string]
    | [string, string]
    | [string, string, string]
    | [string, string, string, string]
    | [string, string, string, string, string]
    | [string, string, string, string, string, string];
  tool: string;
  binding: Json;
  dataDependencies: string[];
  policyPrerequisites: string[];
  observedOrdering: string[];
  branches: string[];
  successes: number;
  failures: number;
}
export interface EvidenceEnvelope {
  schemaVersion: 1;
  id: string;
  invocation: Invocation;
  observation: Json;
  observationHash: string;
  observedAt: number;
  validatedAt: number;
  validation: "fresh" | "replaced";
  physicalCalls: number;
}
export interface Outcome {
  schemaVersion: 1;
  runId: string;
  requestedObjective: string;
  inferredGoals: GoalSet;
  achievedOutcomes: string[];
  independentVerdict: {
    verifierId: string;
    success: boolean;
    constraintsSatisfied: boolean;
    evidenceRefs: string[];
  };
}
export interface ExperimentManifest {
  schemaVersion: 1;
  id: string;
  snapshotId: string;
  datasetHashes: string[];
  sourceRevision: string;
  actorModel: "gpt-5.4-2026-03-05";
  predictorModel: "gpt-4.1-mini-2025-04-14";
  embeddingModel: "text-embedding-3-small";
  embeddingDimensions: 1536;
  actorReasoning: "medium";
  actorOutputCap: 4096;
  predictorOutputCap: 1024;
  actorInputBudget: 32768;
  predictorInputBudget: 8192;
  arms: ["base", "neutral_memory_prefetch", "acephale"];
  /**
   * @minItems 1
   */
  seeds: [number, ...number[]];
  frozen: true;
  totalCeilingUsd: 500;
}
