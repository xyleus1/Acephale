import type { ExpectedRuntimeCorrection } from "./runtime-source-correction";
import { sourceBoundRuntimeCorrection } from "./runtime-source-correction-context.generated";
/** Select the pinned operational context only for the explicit role-image branch.
 * No authority is read from the observed manifest or unverified run configuration.
 */
export function sourceBoundRuntimeCorrectionFor(value: unknown): ExpectedRuntimeCorrection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const runtime = (value as { runtime?: { runtimeIdentitySchema?: unknown } }).runtime;
  return runtime?.runtimeIdentitySchema === "role-images-v1" ? sourceBoundRuntimeCorrection : undefined;
}
