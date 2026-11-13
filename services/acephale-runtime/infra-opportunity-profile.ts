import { readFileSync } from "node:fs";
import { hash } from "../../src/lib/acephale/canonical";
import type { InfraExperimentManifestV2 } from "../../src/lib/acephale/infra-manifest";
import { LEXICAL_MEMORY_RETRIEVAL_HASH } from "../../src/lib/acephale/experience-memory";
import { infraCandidateCompilerHash } from "./infra-compiler-identity";
import { predictorContractHash } from "./infra-predictors";
import { validateInfraOpportunityProfile } from "./infra-artifacts";

export const NATIVE_PROFILE_PROTOCOL = "native-paired-component-profile-v2: same seeded actor input alone versus overlapping one neutral ranking request, then concurrently start background goal refresh and one authorized scheduler-managed native snapshot read with freshness refresh; predictionMs ends when the rank returns; goal refresh has a separate observed span and is fully drained, while concurrent actor duration measures contention; alternate pair order; actual monotonic gateway-inclusive spans; negative paired actor excess remains failed; no proposed actor calls executed; failures retained; not a benchmark or causal speedup estimate";
export const DOCUMENT_PROFILE_PROTOCOL = "document-paired-component-profile-v2: same seeded actor input alone versus overlapping one neutral ranking request, then concurrently start background goal refresh and one authorized immutable HTTP read with validation; predictionMs ends when the rank returns; goal refresh has a separate observed span and is fully drained, while concurrent actor duration measures contention; alternate pair order; actual monotonic spans; negative paired actor excess remains failed; no proposed actor calls executed; failures retained; not a benchmark or causal speedup estimate";

export function infraOpportunityProfile(manifest: InfraExperimentManifestV2, domain: "native" | "documents", options: {
  stream?: boolean; retrievalHash?: string;
} = {}) {
  const compose = JSON.parse(readFileSync(new URL("../../infra/acephale-infra-v1/compose.json", import.meta.url), "utf8"));
  return validateInfraOpportunityProfile({
    hardwareHash: hash(manifest.hardware),
    servingHash: hash({ runtime: manifest.runtime, stream: options.stream ?? true,
      actor: compose.services.actor, predictor: compose.services.predictor,
      concurrency: { perRun: manifest.protocol.perRunConcurrency, global: manifest.protocol.globalConcurrency } }),
    modelHash: hash({ actor: manifest.actor, predictor: manifest.predictor }), memoryHash: manifest.data.memoryHash,
    compilerHash: infraCandidateCompilerHash(domain), retrievalHash: options.retrievalHash ?? LEXICAL_MEMORY_RETRIEVAL_HASH,
    promptHash: predictorContractHash(manifest.predictor),
    protocolHash: hash(domain === "native" ? NATIVE_PROFILE_PROTOCOL : DOCUMENT_PROFILE_PROTOCOL),
  });
}
