import { readFileSync } from "node:fs";
import { hash } from "../../src/lib/goalspec/canonical";

/** Calibration identities include the exact candidate compiler and eligibility code. */
export function infraCandidateCompilerHash(profile: "native" | "documents"): string {
  const files = ["./infra-compiler-identity.ts", "./infra-predictor-input.ts", "./infra-predictors.ts",
    "./infra-predictor-coordinator.ts", "./infra-actor-event.ts", "../../src/lib/goalspec/infra-session.ts",
    "../../src/lib/goalspec/episodic-retrieval.ts", "../../src/lib/goalspec/episodic-postgres.ts",
    "../../src/lib/goalspec/postgres-store.ts", "./infra-memory-services.ts", "./provider.ts",
    "./schema.sql", "./migrations/002-episodic-memory.sql",
    "../../src/lib/goalspec/experience-memory.ts", "../../src/lib/goalspec/infra-model.ts",
    "../../scripts/goalspec-infra-predict.ts", "../../scripts/goalspec-infra-memory.ts", ...(profile === "native" ? [
    "./infra-native-worker.ts",
    "./infra-candidates.ts", "./native-candidate-graph.ts", "./native-read-policy.ts",
    "../../src/lib/goalspec/infra-workflows.ts", "../../src/lib/goalspec/patterns.ts",
    "../../src/lib/goalspec/predictors.ts",
  ] : ["./document-adapter.ts", "./infra-document-runner.ts", "../../scripts/goalspec-infra-document-data.ts"])];
  return hash({ version: "infra-candidate-compiler-v2", profile,
    files: files.map(file => ({ file, source: readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n?/g, "\n") })) });
}
