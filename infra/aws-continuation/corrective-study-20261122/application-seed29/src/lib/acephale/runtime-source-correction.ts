import { canonical } from "./canonical";
import type { InfraExperimentManifestV2 } from "./contracts/infra-manifest-v2.generated";

/** Trusted input from source-bound correction and independent ROOT source authority validation.
 * Identity validation never supplies numerical qualification.
 */
export interface ExpectedRuntimeCorrection {
  manifestContentHash: string;
  manifestFileSha256: string;
  /** Raw independent source-authority SHA, never the full-qualification authority SHA. */
  authoritySha256: string;
  baseImageId: string;
  predictorImageId: string;
  changedFiles: Readonly<Record<string, string>>;
  unchangedNative: Readonly<Record<string, string>>;
}
export const RUNTIME_SOURCE_CORRECTION_BASE = "vllm/vllm-openai:v0.32.0@sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34";
export const RUNTIME_SOURCE_CORRECTION_NATIVE = {
  "/usr/local/lib/python3.12/dist-packages/vllm/_C_stable_libtorch.abi3.so": "ae9c8a293020e422e0b6b61d1024263dc476a772337f5d39d46d18baa7ce0ad9"
} as const;
const contextKeys = ["manifestContentHash", "manifestFileSha256", "authoritySha256", "baseImageId", "predictorImageId", "changedFiles", "unchangedNative"].sort();
const sha256 = /^[a-f0-9]{64}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
const requireValue = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };

export function validateRuntimeSourceCorrection(runtime: InfraExperimentManifestV2["runtime"], expected?: ExpectedRuntimeCorrection): void {
  const observed = runtime as unknown as Record<string, unknown>;
  if (observed.runtimeIdentitySchema !== "role-images-v1") {
    requireValue(expected === undefined, "Correction authority cannot be silently ignored for a legacy runtime");
    requireValue(observed.imageDigest === RUNTIME_SOURCE_CORRECTION_BASE, "Unexpected original runtime image pin");
    return;
  }
  requireValue(expected !== undefined, "Role images require explicit trusted runtime correction authority");
  const context = expected!;
  canonical(context);
  requireValue(Object.keys(context).sort().join(",") === contextKeys.join(","), "Exact runtime correction authority context required");
  for (const name of ["manifestContentHash", "manifestFileSha256", "authoritySha256"] as const) {
    requireValue(typeof context[name] === "string" && sha256.test(context[name]), "Invalid correction authority hash: " + name);
  }
  requireValue(typeof context.baseImageId === "string" && imageId.test(context.baseImageId)
    && typeof context.predictorImageId === "string" && imageId.test(context.predictorImageId)
    && context.baseImageId !== context.predictorImageId, "Exact distinct observed base and predictor image IDs required");
  requireValue(context.changedFiles !== null && typeof context.changedFiles === "object" && !Array.isArray(context.changedFiles)
    && Object.keys(context.changedFiles).length > 0, "Exact authorized Python source map required");
  for (const [path, digest] of Object.entries(context.changedFiles)) {
    requireValue(/^\/usr\/local\/lib\/python3\.12\/dist-packages\/vllm\/(?:[A-Za-z0-9_]+\/)*[A-Za-z0-9_]+\.py$/.test(path)
      && typeof digest === "string" && sha256.test(digest), "Invalid authorized Python source identity");
  }
  requireValue(canonical(observed.predictorRuntimeCorrectionChangedFiles) === canonical(context.changedFiles),
    "Observed source changes differ from explicit trusted correction context");
  requireValue(canonical(observed.predictorRuntimeCorrectionUnchangedNative) === canonical(context.unchangedNative),
    "Observed native extension differs from explicit trusted correction context");
  requireValue(canonical(context.unchangedNative) === canonical(RUNTIME_SOURCE_CORRECTION_NATIVE), "Native extension must retain original bytes");
  requireValue(observed.baseImageDigest === RUNTIME_SOURCE_CORRECTION_BASE && observed.imageDigest === undefined, "Role runtime must declare explicit base provenance only");
  requireValue(observed.predictorRuntimeCorrectionContentHash === context.manifestContentHash
    && observed.predictorRuntimeCorrectionFileSha256 === context.manifestFileSha256
    && observed.predictorRuntimeCorrectionAuthoritySha256 === context.authoritySha256, "Observed correction and authority identity mismatch");
  const images = observed.images as { actor: Record<string, unknown>; predictor: Record<string, unknown> };
  requireValue(images.actor.imageReference === RUNTIME_SOURCE_CORRECTION_BASE
    && images.actor.identityKind === "registry-manifest-reference" && images.actor.imageId === context.baseImageId,
    "Actor must retain original pinned image identity");
  requireValue(images.predictor.imageReference === context.predictorImageId && images.predictor.imageId === context.predictorImageId
    && (images.predictor.identityKind === "docker-image-config-id" || (images.predictor.identityKind === "container-image-index-digest" && context.predictorImageId === "sha256:6ea449937dbc664891737d6d4618c7e6ce9281ce2997cc61b34905353675c901")) && images.predictor.baseImageDigest === RUNTIME_SOURCE_CORRECTION_BASE,
    "Predictor must use exact source-bound derivative image identity");
}
