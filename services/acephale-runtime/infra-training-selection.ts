import { hash } from "../../src/lib/acephale/canonical";
import type { TrainingPartitionPlan } from "./infra-training-export";

export interface SelectionPublicRow { checkpoint_id: string; input_hash?: string; family_id: string; split: string }
interface EligibilityRow {
  checkpointId: string; inputHash: string; familyId: string; candidateIds: string[];
  candidatePoolHash: string; candidateWindowHash: string;
}
export interface NativePublicEligibility {
  schemaVersion: 1; kind: "acephale-public-window-eligibility"; sourceDatasetHash: string;
  partitionsHash: string; compilerHash: string; futureLabelsUsed: false; generationCalls: 0;
  checkpointIds: string[]; rows: EligibilityRow[]; contentHash: string;
}
export interface OriginalNativePilot {
  selection_version: string; pilot_count: number; audit_count: number; source_dataset_hash: string;
  source_split_hash: string; partitions_hash: string; public_eligibility_hash: string;
  checkpoints: { checkpoint_id: string; input_hash: string }[];
  audit: { checkpoint_id: string; reason: string }[];
}
export interface NativeSelectionExpansionReceipt {
  schemaVersion: 1; kind: "acephale-native-all-public-eligible-selection";
  selectionPolicy: "all_preexisting_nonempty_fitting_windows";
  sourceDatasetHash: string; sourceSplitHash: string; partitionsHash: string; partitionSourceHash: string;
  eligibilityHash: string; eligibilityCompilerHash: string; originalPilotHash: string;
  originalPilotCheckpointIdsHash: string; originalPilotCount: 100; selectedCheckpointCount: number;
  checkpointIds: string[];
  publicCheckpoints: { checkpointId: string; inputHash: string; familyId: string; publicRowHash: string }[];
  weightFitFamilies: string[]; minimumCheckpointsPerFamily: 4; labelBasedSelection: false; contentHash: string;
}
export interface NativeSelectionExpansion {
  receipt: NativeSelectionExpansionReceipt; eligibility: NativePublicEligibility; originalPilot: OriginalNativePilot;
}
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const same = (a: unknown, b: unknown) => hash(a) === hash(b);

/** This declaration uses only a previously frozen public eligibility artifact. */
export function createNativeSelectionExpansion(rows: SelectionPublicRow[], partitions: TrainingPartitionPlan,
  eligibility: NativePublicEligibility, pilot: OriginalNativePilot): NativeSelectionExpansionReceipt {
  const { contentHash, ...body } = eligibility;
  if (eligibility.schemaVersion !== 1 || eligibility.kind !== "acephale-public-window-eligibility"
    || contentHash !== hash(body) || !digest(eligibility.sourceDatasetHash) || !digest(eligibility.compilerHash)
    || eligibility.partitionsHash !== hash(partitions) || eligibility.futureLabelsUsed !== false || eligibility.generationCalls !== 0
    || !Array.isArray(eligibility.rows) || !Array.isArray(eligibility.checkpointIds)
    || eligibility.checkpointIds.length <= 100 || eligibility.checkpointIds.length > 1000
    || new Set(eligibility.rows.map(row => row.checkpointId)).size !== eligibility.rows.length
    || !same(eligibility.checkpointIds, eligibility.rows.filter(row => row.candidateIds.length).map(row => row.checkpointId))) {
    throw new Error("Expansion requires the complete frozen public-only nonempty eligibility selection");
  }
  const byId = new Map(rows.map(row => [row.checkpoint_id, row]));
  const allFamilies = [...partitions.weightFitFamilies, ...partitions.calibrationFamilies, ...partitions.developmentFamilies, ...partitions.testFamilies];
  if (byId.size !== rows.length || partitions.weightFitFamilies.length !== 24 || new Set(allFamilies).size !== allFamilies.length) {
    throw new Error("Expansion requires distinct original family partitions and public checkpoints");
  }
  for (const row of eligibility.rows) {
    const current = byId.get(row.checkpointId);
    if (!current || current.input_hash !== row.inputHash || !digest(row.inputHash) || current.family_id !== row.familyId
      || current.split !== "train" || !partitions.weightFitFamilies.includes(current.family_id)
      || !Array.isArray(row.candidateIds) || row.candidateIds.length > 128 || new Set(row.candidateIds).size !== row.candidateIds.length
      || row.candidateIds.some(id => typeof id !== "string" || !id)
      || !digest(row.candidatePoolHash) || !digest(row.candidateWindowHash)) {
      throw new Error("Expanded eligibility differs from the unchanged public fitting prefixes");
    }
  }
  const selected = new Set(eligibility.checkpointIds);
  if (pilot.selection_version !== "native-fit-family-domain-round-robin-v2" || pilot.pilot_count !== 100 || pilot.audit_count !== 20
    || pilot.source_dataset_hash !== eligibility.sourceDatasetHash || pilot.public_eligibility_hash !== contentHash
    || !digest(pilot.source_split_hash) || !digest(pilot.partitions_hash)
    || !Array.isArray(pilot.checkpoints) || pilot.checkpoints.length !== 100
    || new Set(pilot.checkpoints.map(row => row.checkpoint_id)).size !== 100
    || pilot.checkpoints.some(row => !selected.has(row.checkpoint_id) || byId.get(row.checkpoint_id)?.input_hash !== row.input_hash)
    || !Array.isArray(pilot.audit) || pilot.audit.length !== 20 || new Set(pilot.audit.map(row => row.checkpoint_id)).size !== 20
    || pilot.audit.some(row => !pilot.checkpoints.some(checkpoint => checkpoint.checkpoint_id === row.checkpoint_id))) {
    throw new Error("Expansion must retain the unchanged original100 pilot and twenty audit checkpoints");
  }
  const counts = new Map<string, number>();
  for (const id of selected) {
    const family = byId.get(id)!.family_id;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  if (counts.size !== 24 || [...counts.values()].some(count => count < 4)) {
    throw new Error("Expansion requires all24 fitting families and at least four public checkpoints per family");
  }
  const result: Omit<NativeSelectionExpansionReceipt, "contentHash"> = {
    schemaVersion: 1, kind: "acephale-native-all-public-eligible-selection", selectionPolicy: "all_preexisting_nonempty_fitting_windows",
    sourceDatasetHash: eligibility.sourceDatasetHash, sourceSplitHash: pilot.source_split_hash,
    partitionsHash: hash(partitions), partitionSourceHash: pilot.partitions_hash,
    eligibilityHash: contentHash, eligibilityCompilerHash: eligibility.compilerHash, originalPilotHash: hash(pilot),
    originalPilotCheckpointIdsHash: hash(pilot.checkpoints.map(row => row.checkpoint_id)), originalPilotCount: 100,
    selectedCheckpointCount: selected.size, checkpointIds: [...eligibility.checkpointIds],
    publicCheckpoints: eligibility.checkpointIds.map(id => { const row = byId.get(id)!;
      return { checkpointId: id, inputHash: row.input_hash!, familyId: row.family_id, publicRowHash: hash(row) }; }),
    weightFitFamilies: [...partitions.weightFitFamilies].sort(), minimumCheckpointsPerFamily: 4, labelBasedSelection: false,
  };
  return { ...result, contentHash: hash(result) };
}

export function validateNativeSelectionExpansion(rows: SelectionPublicRow[], partitions: TrainingPartitionPlan,
  expansion: NativeSelectionExpansion): NativeSelectionExpansionReceipt {
  const expected = createNativeSelectionExpansion(rows, partitions, expansion.eligibility, expansion.originalPilot);
  if (!same(expansion.receipt, expected)) throw new Error("Expanded selection receipt or public source projection changed");
  return expected;
}
