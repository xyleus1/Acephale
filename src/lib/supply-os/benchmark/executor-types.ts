import type { SupplyStateScope } from "../state-runtime/types";
import type { BenchmarkSystemName } from "./systems";

export type BenchmarkRuntimeInput = {
  queryText: string;
  scope: SupplyStateScope;
};

export type BenchmarkComponentTimings = Record<string, number>;

export type BenchmarkSystemPreparation = {
  componentTimingsMs: BenchmarkComponentTimings;
  projectionBuilt: boolean;
  projectionPersisted: boolean;
};

export type BenchmarkSystemExecution = {
  retrievedFacts: unknown[];
  retrievedEvidence: unknown[];
  retrievalMs: number;
  hydrationMs: number;
  projectionHit: boolean | null;
  componentTimingsMs: BenchmarkComponentTimings;
};

export type BenchmarkRuntimeValidation = {
  result: {
    valid: boolean;
    checkedAt: string;
    changedStrict: unknown[];
    changedAdvisory: unknown[];
  };
  validationMs: number;
};

export type DeryaBenchmarkExecutor = {
  vectorRetrieverAvailable: boolean;
  vectorRetrieverName: string | null;
  configureSystem(system: BenchmarkSystemName): void;
  prepare(
    system: BenchmarkSystemName,
    input: BenchmarkRuntimeInput,
  ): Promise<BenchmarkSystemPreparation>;
  execute(
    system: BenchmarkSystemName,
    input: BenchmarkRuntimeInput,
    topK: number,
  ): Promise<BenchmarkSystemExecution>;
  validate(input: { officeId: string; stateReadId: string }): Promise<BenchmarkRuntimeValidation>;
};
