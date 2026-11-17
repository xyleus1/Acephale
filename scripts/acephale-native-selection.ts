/** Declare every previously eligible public fitting checkpoint without reading target labels. */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { canonical, hash } from "../src/lib/acephale/canonical";
import { createNativeSelectionExpansion, type OriginalNativePilot } from "../services/acephale-runtime/infra-training-selection";
import type { TrainingPartitionPlan } from "../services/acephale-runtime/infra-training-export";
import { verifyInfraPilotBundle } from "./acephale-infra-memory";
import { verifyInfraAnnotationSource } from "./acephale-infra-annotation-source";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
export function declareExpandedNativeSelection(bundleDirectory: string, partitionsPath: string,
  originalPilotDirectory: string, eligibilityPath: string, output: string) {
  const bundle = verifyInfraPilotBundle(bundleDirectory);
  const original = verifyInfraAnnotationSource(originalPilotDirectory, bundleDirectory);
  const raw = json(partitionsPath);
  const partitions: TrainingPartitionPlan = raw.families ? {
    weightFitFamilies: Object.keys(raw.families).filter(family => raw.families[family] === "weight_fit"),
    calibrationFamilies: Object.keys(raw.families).filter(family => raw.families[family] === "calibration"),
    developmentFamilies: Object.keys(raw.families).filter(family => raw.families[family] === "development"),
    testFamilies: Object.keys(raw.families).filter(family => raw.families[family] === "test"),
  } : raw;
  const pilot = original.declaration as unknown as OriginalNativePilot;
  const eligibility = json(eligibilityPath);
  if (pilot.partitions_hash !== hash(raw) || pilot.source_split_hash !== hash(bundle.split)
    || eligibility.sourceDatasetHash !== bundle.manifest.bundle_hash) throw new Error("Original public expansion source differs");
  const publicRows = readFileSync(join(bundleDirectory, "public.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const receipt = createNativeSelectionExpansion(publicRows, partitions, eligibility, pilot);
  writeFileSync(output, canonical(receipt) + "\n", { flag: "wx", mode: 0o600 });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 5) throw new Error("Usage: acephale-native-selection.ts BUNDLE PARTITIONS ORIGINAL_PILOT_DIRECTORY ELIGIBILITY NEW_RECEIPT_JSON");
  const receipt = declareExpandedNativeSelection(...args.map(path => resolve(path)) as [string, string, string, string, string]);
  console.log(JSON.stringify({ contentHash: receipt.contentHash, selectedCheckpointCount: receipt.selectedCheckpointCount,
    originalPilotCount: receipt.originalPilotCount, labelBasedSelection: receipt.labelBasedSelection }));
}
