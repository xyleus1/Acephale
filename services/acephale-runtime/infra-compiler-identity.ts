import { readFileSync } from "node:fs";
import { hash } from "../../src/lib/acephale/canonical";

/** Calibration identities include the exact candidate compiler and eligibility code. */
export function infraCandidateCompilerHash(profile: "native" | "documents"): string {
  const files = ["./infra-compiler-identity.ts", "./infra-predictor-input.ts", "./infra-predictors.ts",
    "./infra-predictor-coordinator.ts", "./infra-actor-event.ts", "../../src/lib/acephale/infra-session.ts",
    "../../src/lib/acephale/episodic-retrieval.ts", "../../src/lib/acephale/episodic-postgres.ts",
    "../../src/lib/acephale/postgres-store.ts", "./infra-memory-services.ts", "./provider.ts",
    "./schema.sql", "./migrations/002-episodic-memory.sql",
    "../../src/lib/acephale/experience-memory.ts", "../../src/lib/acephale/infra-model.ts",
    "../../scripts/acephale-infra-predict.ts", "../../scripts/acephale-infra-memory.ts", ...(profile === "native" ? [
    "./infra-native-worker.ts",
    "./infra-candidates.ts", "./native-candidate-graph.ts", "./native-read-policy.ts",
    "../../src/lib/acephale/infra-workflows.ts", "../../src/lib/acephale/patterns.ts",
    "../../src/lib/acephale/workflow-binder.ts",
  ] : ["./document-adapter.ts", "./infra-document-runner.ts", "../../scripts/acephale-infra-document-data.ts"])];
  return hash({ version: "infra-candidate-compiler-v2", profile,
    files: files.map(file => ({ file, source: readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n?/g, "\n") })) });
}
