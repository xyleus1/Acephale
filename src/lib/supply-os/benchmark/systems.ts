export const BENCHMARK_SYSTEM_NAMES = [
  "CURRENT_KEYWORD",
  "VECTOR_RAG",
  "STRONG_HYBRID_RAG",
  "DERYA_COLD",
  "DERYA_HOT",
] as const;

export type BenchmarkSystemName = (typeof BENCHMARK_SYSTEM_NAMES)[number];

export type BenchmarkSystemDefinition = {
  name: BenchmarkSystemName;
  description: string;
  requiresVector: boolean;
  usesLexical: boolean;
  usesEntityTemporal: boolean;
  usesStateRuntime: boolean;
  projectionMode: "none" | "bypass" | "fresh";
  validationMode: "off" | "semantic";
};

/**
 * These definitions are configuration, not benchmark results. A runner must
 * record a vector-dependent system as skipped when no real vector retriever is
 * available. It must never silently substitute lexical retrieval.
 */
export const BENCHMARK_SYSTEM_DEFINITIONS: Readonly<Record<
  BenchmarkSystemName,
  BenchmarkSystemDefinition
>> = {
  CURRENT_KEYWORD: {
    name: "CURRENT_KEYWORD",
    description: "Existing Company Brain lexical ranking.",
    requiresVector: false,
    usesLexical: true,
    usesEntityTemporal: false,
    usesStateRuntime: false,
    projectionMode: "none",
    validationMode: "off",
  },
  VECTOR_RAG: {
    name: "VECTOR_RAG",
    description: "Vector-ranked canonical Company Brain pointers only.",
    requiresVector: true,
    usesLexical: false,
    usesEntityTemporal: false,
    usesStateRuntime: false,
    projectionMode: "none",
    validationMode: "off",
  },
  STRONG_HYBRID_RAG: {
    name: "STRONG_HYBRID_RAG",
    description: "Lexical and vector lists fused with reciprocal rank fusion.",
    requiresVector: true,
    usesLexical: true,
    usesEntityTemporal: false,
    usesStateRuntime: false,
    projectionMode: "none",
    validationMode: "off",
  },
  DERYA_COLD: {
    name: "DERYA_COLD",
    description: "Live commercial-state compilation with lexical, exact-entity, and temporal evidence.",
    requiresVector: false,
    usesLexical: true,
    usesEntityTemporal: true,
    usesStateRuntime: true,
    projectionMode: "bypass",
    validationMode: "off",
  },
  DERYA_HOT: {
    name: "DERYA_HOT",
    description: "Fresh projections, query evidence, and semantic dependency validation.",
    requiresVector: false,
    usesLexical: true,
    usesEntityTemporal: true,
    usesStateRuntime: true,
    projectionMode: "fresh",
    validationMode: "semantic",
  },
};

export function benchmarkSystemAvailability(input: {
  system: BenchmarkSystemName;
  vectorEnabled: boolean;
  vectorRetrieverAvailable: boolean;
}) {
  const definition = BENCHMARK_SYSTEM_DEFINITIONS[input.system];
  if (!definition.requiresVector) return { runnable: true as const, reason: null };
  if (!input.vectorEnabled) {
    return { runnable: false as const, reason: "vector_retrieval_disabled" };
  }
  if (!input.vectorRetrieverAvailable) {
    return { runnable: false as const, reason: "vector_retriever_unavailable" };
  }
  return { runnable: true as const, reason: null };
}

export function parseBenchmarkSystemNames(value: string | null | undefined) {
  if (!value?.trim()) return [...BENCHMARK_SYSTEM_NAMES];
  const requested = [...new Set(value.split(",").map((entry) => entry.trim().toUpperCase()).filter(Boolean))];
  const invalid = requested.filter((entry) => !BENCHMARK_SYSTEM_NAMES.includes(entry as BenchmarkSystemName));
  if (invalid.length) throw new Error(`Unknown benchmark system: ${invalid.join(", ")}.`);
  return requested as BenchmarkSystemName[];
}
