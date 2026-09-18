import Ajv2020 from "ajv/dist/2020";
import schema from "./contracts/v4-action-kind.schema.json";
import type { ActionKindArtifact } from "./contracts/v4-action-kind.generated";
import type { DecisionState } from "./controller-features";
import { extractCandidateFeatures } from "./controller-features";
import { hash } from "./canonical";
export type { ActionKindArtifact } from "./contracts/v4-action-kind.generated";
export const ACTION_KINDS = ["read", "message", "write", "compute", "stop"] as const;
export type ActionKind = typeof ACTION_KINDS[number];
export interface ActionKindScores { probabilities: Record<ActionKind, number | null>; predicted: ActionKind | null; conditionalOnObservedClasses: true; supportCounts: Record<ActionKind, number>; artifactHash: string; }
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
export class LocalActionKindController {
  readonly artifact: ActionKindArtifact;
  constructor(value: unknown) {
    if (!validate(value)) throw new Error("Invalid action-kind artifact schema");
    const artifact = value as unknown as ActionKindArtifact, { contentHash, ...body } = artifact;
    if (hash(body) !== contentHash || artifact.classes.join(",") !== ACTION_KINDS.join(",") || artifact.trained.some((trained, i) => trained !== (artifact.lineage.trainLabelCounts[i] > 0))) throw new Error("Invalid action-kind hash or class support");
    const splits = [artifact.lineage.trainFamilies, artifact.lineage.selectionFamilies, artifact.lineage.calibrationFamilies];
    if (splits.some((part, i) => part.some(family => splits.some((other, j) => i !== j && other.includes(family))))) throw new Error("Action-kind family contamination");
    this.artifact = structuredClone(artifact);
  }
  score(state: DecisionState): ActionKindScores {
    const x = extractCandidateFeatures(state, null).values, artifact = this.artifact;
    const logits = artifact.weights.map((weights, i) => artifact.trained[i] ? (weights.reduce((sum, w, j) => sum + w * x[j], artifact.bias[i])) / artifact.temperature : -Infinity);
    const max = Math.max(...logits), masses = logits.map((v, i) => artifact.trained[i] ? Math.exp(v - max) : 0), total = masses.reduce((a, b) => a + b, 0);
    const probabilities = Object.fromEntries(ACTION_KINDS.map((kind, i) => [kind, artifact.trained[i] && total > 0 ? masses[i] / total : null])) as ActionKindScores["probabilities"];
    const best = masses.indexOf(Math.max(...masses));
    return { probabilities, predicted: total > 0 ? ACTION_KINDS[best] : null, conditionalOnObservedClasses: true,
      supportCounts: Object.fromEntries(ACTION_KINDS.map((kind, i) => [kind, artifact.lineage.trainLabelCounts[i]])) as ActionKindScores["supportCounts"], artifactHash: artifact.contentHash };
  }
}
