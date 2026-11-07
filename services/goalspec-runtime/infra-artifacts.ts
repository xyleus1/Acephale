import { copy, hash } from "../../src/lib/goalspec/canonical";
import { expectedInfraSaving, type InfraOpportunity } from "../../src/lib/goalspec/infra-session";

export interface InfraOpportunityArtifact {
  version: 2; sourceDatasetHash: string; families: string[]; sampleCount: number;
  profile: InfraOpportunityProfile;
  estimate: InfraOpportunity; contentHash: string;
}
export const INFRA_OPPORTUNITY_PROFILE_KEYS = ["hardwareHash", "servingHash", "modelHash", "memoryHash", "compilerHash", "retrievalHash", "promptHash", "protocolHash"] as const;
export type InfraOpportunityProfile = Record<typeof INFRA_OPPORTUNITY_PROFILE_KEYS[number], string>;
export function validateInfraOpportunityProfile(value: unknown): InfraOpportunityProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || hash(Object.keys(value).sort()) !== hash([...INFRA_OPPORTUNITY_PROFILE_KEYS].sort())
    || Object.values(value).some(digest => typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))) {
    throw new Error("Opportunity requires the complete measured deployment and predictor profile");
  }
  return copy(value as InfraOpportunityProfile);
}
export interface InfraGoalReliabilityArtifact {
  version: 1; sourceDatasetHash: string; families: string[]; annotationHash: string;
  auditedCount: number; acceptedCount: number; unsupportedBindings: number;
  gradedCount: number; agreedCount: number; reliability: number; contentHash: string;
  provenance?: { model: { repository: string; revision: string }; memoryHash: string;
    predictorContractHash: string; candidateCompilerHash: string; retrievalHash: string; [key: string]: unknown };
}
export interface InfraArtifactScope {
  datasetHash: string; allowedFamilies: string[]; excludedFamilies?: string[];
  opportunityProfile?: InfraOpportunityProfile;
  predictor?: { model: { repository: string; revision: string }; memoryHash: string;
    predictorContractHash: string; candidateCompilerHash: string; retrievalHash: string };
}
export function checkedArtifact<T extends { contentHash: string }>(value: T): T {
  if (!value || typeof value !== "object") throw new Error("Missing experiment artifact");
  const { contentHash, ...body } = value;
  if (hash(body) !== contentHash) throw new Error("Experiment artifact hash mismatch");
  return copy(value);
}
export function wilsonLower(agreed: number, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(agreed) || agreed < 0 || agreed > count) throw new Error("Invalid agreement counts");
  const z = 1.959963984540054, p = agreed / count;
  return (p + z * z / (2 * count) - z * Math.sqrt(p * (1 - p) / count + z * z / (4 * count * count))) / (1 + z * z / count);
}
function validFamilies(families: unknown, scope: InfraArtifactScope): boolean {
  return Array.isArray(families) && families.length > 0 && new Set(families).size === families.length
    && families.every(family => typeof family === "string" && scope.allowedFamilies.includes(family) && !scope.excludedFamilies?.includes(family));
}
export function validateInfraOpportunityArtifact(value: InfraOpportunityArtifact, scope: InfraArtifactScope): InfraOpportunityArtifact {
  const artifact = checkedArtifact(value);
  if (artifact.version !== 2 || artifact.sourceDatasetHash !== scope.datasetHash || !/^[a-f0-9]{64}$/.test(scope.datasetHash)
    || !Number.isSafeInteger(artifact.sampleCount) || artifact.sampleCount < 10 || !validFamilies(artifact.families, scope)
    || !artifact.estimate || hash(Object.keys(artifact.estimate).sort()) !== hash(["actorLeadMs", "contentionMs", "predictionMs", "schedulingMs", "toolMs", "validationMs"])) {
    throw new Error("Measured opportunity lacks compatible source/family provenance");
  }
  const measured = validateInfraOpportunityProfile(artifact.profile);
  const expected = validateInfraOpportunityProfile(scope.opportunityProfile);
  if (hash(measured) !== hash(expected)) throw new Error("Measured opportunity profile differs from the current deployment and predictor");
  expectedInfraSaving(1, artifact.estimate);
  return artifact;
}
export function validateInfraGoalReliabilityArtifact(value: InfraGoalReliabilityArtifact, scope: InfraArtifactScope): InfraGoalReliabilityArtifact {
  const artifact = checkedArtifact(value);
  if (artifact.version !== 1 || artifact.sourceDatasetHash !== scope.datasetHash || !/^[a-f0-9]{64}$/.test(scope.datasetHash)
    || !/^[a-f0-9]{64}$/.test(artifact.annotationHash) || !validFamilies(artifact.families, scope)
    || !Number.isSafeInteger(artifact.auditedCount) || artifact.auditedCount < 20
    || !Number.isSafeInteger(artifact.acceptedCount) || artifact.acceptedCount < Math.ceil(0.9 * artifact.auditedCount) || artifact.acceptedCount > artifact.auditedCount
    || artifact.unsupportedBindings !== 0 || !Number.isSafeInteger(artifact.gradedCount) || artifact.gradedCount < 1
    || !Number.isSafeInteger(artifact.agreedCount) || artifact.agreedCount < 0 || artifact.agreedCount > artifact.gradedCount
    || !Number.isFinite(artifact.reliability) || Math.abs(artifact.reliability - wilsonLower(artifact.agreedCount, artifact.gradedCount)) > 1e-12) {
    throw new Error("Goal reliability lacks a valid independent audit/calibration");
  }
  if (scope.predictor && (!artifact.provenance
    || hash(artifact.provenance.model) !== hash(scope.predictor.model)
    || artifact.provenance.memoryHash !== scope.predictor.memoryHash
    || artifact.provenance.predictorContractHash !== scope.predictor.predictorContractHash
    || artifact.provenance.candidateCompilerHash !== scope.predictor.candidateCompilerHash
    || !/^[a-f0-9]{64}$/.test(scope.predictor.retrievalHash)
    || artifact.provenance.retrievalHash !== scope.predictor.retrievalHash)) {
    throw new Error("Goal reliability is not bound to this frozen predictor and memory");
  }
  return artifact;
}
