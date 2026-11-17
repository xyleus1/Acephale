import assert from "node:assert/strict";
import test from "node:test";
import { copy, hash } from "../src/lib/acephale/canonical";
import { createNativeSelectionExpansion, validateNativeSelectionExpansion, type NativePublicEligibility,
  type OriginalNativePilot, type SelectionPublicRow } from "../services/acephale-runtime/infra-training-selection";
import { planNativeTrainingExport, type TrainingPartitionPlan } from "../services/acephale-runtime/infra-training-export";

const signed = <T extends Record<string, unknown>>(value: T) => {
  const { contentHash: _old, ...body } = value;
  return { ...body, contentHash: hash(body) };
};
function fixture() {
  const partitions: TrainingPartitionPlan = { weightFitFamilies: Array.from({ length: 24 }, (_, i) => `fit-${i}`),
    calibrationFamilies: ["cal"], developmentFamilies: ["dev"], testFamilies: ["test"] };
  const fit = partitions.weightFitFamilies.flatMap(family => Array.from({ length: 6 }, (_, index) => ({
    checkpoint_id: `${family}-${index}`, input_hash: hash([family, index]), family_id: family, split: "train",
  })));
  const empty = { checkpoint_id: "empty", input_hash: hash("empty"), family_id: "fit-0", split: "train" };
  const rows: SelectionPublicRow[] = [...fit, empty,
    { checkpoint_id: "cal", family_id: "cal", split: "train", input_hash: hash("cal") },
    { checkpoint_id: "dev", family_id: "dev", split: "development", input_hash: hash("dev") },
    { checkpoint_id: "test", family_id: "test", split: "test", input_hash: hash("test") }];
  const eligibility = signed({ schemaVersion: 1, kind: "acephale-public-window-eligibility",
    sourceDatasetHash: hash("original dataset"), partitionsHash: hash(partitions), compilerHash: hash("original compiler"),
    futureLabelsUsed: false, generationCalls: 0, checkpointIds: fit.map(row => row.checkpoint_id),
    rows: [...fit, empty].map(row => ({ checkpointId: row.checkpoint_id, inputHash: row.input_hash, familyId: row.family_id,
      candidateIds: row === empty ? [] : [hash(row.checkpoint_id)], candidatePoolHash: hash([row]), candidateWindowHash: hash(row) })),
  }) as NativePublicEligibility;
  const original = [...fit.filter(row => Number(row.checkpoint_id.split("-").at(-1)) < 4),
    ...fit.filter(row => row.checkpoint_id.endsWith("-4")).slice(0, 4)];
  const pilot: OriginalNativePilot = { selection_version: "native-fit-family-domain-round-robin-v2", pilot_count: 100,
    audit_count: 20, source_dataset_hash: eligibility.sourceDatasetHash, source_split_hash: hash("original split"),
    partitions_hash: hash(partitions), public_eligibility_hash: eligibility.contentHash,
    checkpoints: original.map(row => ({ checkpoint_id: row.checkpoint_id, input_hash: row.input_hash })),
    audit: original.slice(0, 20).map(row => ({ checkpoint_id: row.checkpoint_id, reason: "original audit" })) };
  const receipt = createNativeSelectionExpansion(rows, partitions, eligibility, pilot);
  return { rows, partitions, eligibility, pilot, receipt,
    expansion: { receipt, eligibility, originalPilot: pilot } };
}

test("expanded fitting selection requires every preexisting nonempty public window and retains original audit", () => {
  const { rows, partitions, receipt, expansion, pilot } = fixture();
  assert.equal(receipt.selectedCheckpointCount, 144);
  assert.equal(receipt.originalPilotHash, hash(pilot));
  assert.equal(receipt.labelBasedSelection, false);
  assert.equal(validateNativeSelectionExpansion(rows, partitions, expansion).contentHash, receipt.contentHash);
  const plan = planNativeTrainingExport(rows, partitions, { fittingCheckpointIds: receipt.checkpointIds,
    neutralOnlyPartitions: ["calibration", "development"], expansion });
  assert.equal([...plan.values()].filter(value => value === "multitask").length, 144);
  assert.equal(plan.get("empty"), "unselected_fit");
  assert.equal(plan.get("cal"), "neutral"); assert.equal(plan.get("dev"), "neutral"); assert.equal(plan.get("test"), "heldout_excluded");
});

test("legacy default still requires exactly100 and cannot silently expand", () => {
  const { rows, partitions, receipt, pilot } = fixture();
  assert.throws(() => planNativeTrainingExport(rows, partitions, { fittingCheckpointIds: receipt.checkpointIds,
    neutralOnlyPartitions: ["calibration", "development"] }), /100 declared/);
  assert.equal([...planNativeTrainingExport(rows, partitions, { fittingCheckpointIds: pilot.checkpoints.map(row => row.checkpoint_id),
    neutralOnlyPartitions: ["calibration", "development"] }).values()].filter(value => value === "multitask").length, 100);
});

test("rehashed subset and alternate ordering cannot choose successful targets", () => {
  const { rows, partitions, receipt, expansion } = fixture();
  for (const ids of [receipt.checkpointIds.slice(1), [...receipt.checkpointIds].reverse()]) {
    assert.throws(() => planNativeTrainingExport(rows, partitions, { fittingCheckpointIds: ids,
      neutralOnlyPartitions: ["calibration", "development"], expansion }), /100 declared/);
    const changed = signed({ ...receipt, checkpointIds: ids, selectedCheckpointCount: ids.length });
    assert.throws(() => validateNativeSelectionExpansion(rows, partitions, { ...expansion, receipt: changed as typeof receipt }), /receipt/);
  }
});

test("new source or public prefix bytes cannot inherit an expansion receipt", () => {
  const { rows, partitions, expansion } = fixture();
  const changed = copy(rows); changed[0].input_hash = hash("different public prefix");
  assert.throws(() => validateNativeSelectionExpansion(changed, partitions, expansion), /public fitting/);
  assert.throws(() => validateNativeSelectionExpansion(rows, partitions, { ...expansion,
    originalPilot: { ...expansion.originalPilot, source_dataset_hash: hash("other data") } }), /original100/);
  const withMetadata = rows.map((row, index) => index === 0 ? { ...row, newScope: "other authorization" } : row);
  assert.throws(() => validateNativeSelectionExpansion(withMetadata, partitions, expansion), /receipt/);
});

test("calibration and test families cannot enter the public fitting selection", () => {
  const { rows, partitions, eligibility, pilot } = fixture();
  for (const id of ["cal", "test"]) {
    const original = rows.find(row => row.checkpoint_id === id)!;
    const changed = signed({ ...eligibility, checkpointIds: [...eligibility.checkpointIds, id], rows: [...eligibility.rows,
      { checkpointId: id, inputHash: original.input_hash!, familyId: original.family_id, candidateIds: ["read"],
        candidatePoolHash: hash(id), candidateWindowHash: hash(id) }] }) as NativePublicEligibility;
    assert.throws(() => createNativeSelectionExpansion(rows, partitions, changed, { ...pilot, public_eligibility_hash: changed.contentHash }), /public fitting/);
  }
});

test("the original100 audit must remain an exact unchanged subset", () => {
  const { rows, partitions, eligibility, pilot } = fixture();
  const changed = copy(pilot); changed.checkpoints[0].checkpoint_id = "empty";
  assert.throws(() => createNativeSelectionExpansion(rows, partitions, eligibility, changed), /original100/);
  const lostAudit = copy(pilot); lostAudit.audit[0].checkpoint_id = "unknown";
  assert.throws(() => createNativeSelectionExpansion(rows, partitions, eligibility, lostAudit), /original100/);
});

test("only public eligibility with distinct bounded candidate IDs may drive expansion", () => {
  const { rows, partitions, eligibility, pilot } = fixture();
  const privateSelection = signed({ ...eligibility, futureLabelsUsed: true }) as unknown as NativePublicEligibility;
  assert.throws(() => createNativeSelectionExpansion(rows, partitions, privateSelection,
    { ...pilot, public_eligibility_hash: privateSelection.contentHash }), /public-only/);
  const duplicate = copy(eligibility); duplicate.rows[0].candidateIds.push(duplicate.rows[0].candidateIds[0]);
  const rehashed = signed({ ...duplicate }) as NativePublicEligibility;
  assert.throws(() => createNativeSelectionExpansion(rows, partitions, rehashed,
    { ...pilot, public_eligibility_hash: rehashed.contentHash }), /public fitting/);
});

test("a verified auxiliary cohort may extend the public table without changing original fitting prefixes", () => {
  const { rows, partitions, expansion } = fixture();
  const aggregate = [...rows, { checkpoint_id: "additional-dev", family_id: "dev", input_hash: hash("new dev"), split: "development" }];
  assert.equal(validateNativeSelectionExpansion(aggregate, partitions, expansion).contentHash, expansion.receipt.contentHash);
});
