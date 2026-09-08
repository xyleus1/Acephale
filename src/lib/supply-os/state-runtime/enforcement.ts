import "server-only";

import { supplyStateRuntimeConfig, type SupplyStateValidationMode } from "./config";
import { incrementSupplyStateMetric } from "./instrumentation";
import type { SupplyStateValidationResult } from "./types";
import { validateSupplyStateRead } from "./validate";

export type SupplyStateActionValidation = {
  mode: SupplyStateValidationMode;
  checked: boolean;
  blocked: boolean;
  result: SupplyStateValidationResult | null;
  errorCode: "not_found" | "invalid_manifest" | "unavailable" | null;
};

export type SupplyStateAssertionValidation = {
  mode: SupplyStateValidationMode;
  checked: true;
  valid: boolean;
  blocked: boolean;
  error: Error | null;
};

/**
 * Applies the same rollout policy to local action-to-packet assertions as the
 * dependency validator. Shadow mode observes the mismatch without blocking;
 * callers must discard the mismatched read so it is not recorded as provenance.
 */
export function validateSupplyStateAssertionForAction(input: {
  officeId: string;
  action: string;
  assertion: () => void;
  environment?: NodeJS.ProcessEnv;
}): SupplyStateAssertionValidation {
  const config = supplyStateRuntimeConfig(input.environment);
  try {
    input.assertion();
    return {
      mode: config.validationMode,
      checked: true,
      valid: true,
      blocked: false,
      error: null,
    };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error("Commercial state action binding failed.");
    const blocked = config.enabled && config.validationMode === "enforce";
    incrementSupplyStateMetric("strict_conflict_count", {
      officeId: input.officeId,
      validationMode: config.validationMode,
      actionType: input.action.slice(0, 120),
    });
    if (blocked) {
      incrementSupplyStateMetric("action_block_count", {
        officeId: input.officeId,
        actionType: input.action.slice(0, 120),
      });
    }
    return {
      mode: config.validationMode,
      checked: true,
      valid: false,
      blocked,
      error: normalized,
    };
  }
}

/**
 * Applies rollout policy without weakening the validator itself. Historical
 * durable rows with no state read remain on their existing approval and hash
 * checks. Shadow mode always checks but never blocks.
 */
export async function validateSupplyStateReadForAction(input: {
  officeId: string;
  stateReadId?: string | null;
  action: string;
  environment?: NodeJS.ProcessEnv;
}): Promise<SupplyStateActionValidation> {
  const config = supplyStateRuntimeConfig(input.environment);
  if (!input.stateReadId || !config.enabled || config.validationMode === "off") {
    return {
      mode: config.validationMode,
      checked: false,
      blocked: false,
      result: null,
      errorCode: null,
    };
  }

  try {
    const result = await validateSupplyStateRead({
      officeId: input.officeId,
      stateReadId: input.stateReadId,
      validationMode: config.validationMode,
    });
    const blocked = config.validationMode === "enforce" && !result.valid;
    if (blocked) {
      incrementSupplyStateMetric("action_block_count", {
        officeId: input.officeId,
        actionType: input.action.slice(0, 120),
      });
    }
    return {
      mode: config.validationMode,
      checked: true,
      blocked,
      result,
      errorCode: null,
    };
  } catch (error) {
    const errorCode = error && typeof error === "object" && "code" in error
      && (error.code === "not_found" || error.code === "invalid_manifest" || error.code === "unavailable")
      ? error.code
      : "unavailable";
    const blocked = config.validationMode === "enforce";
    if (blocked) {
      incrementSupplyStateMetric("action_block_count", {
        officeId: input.officeId,
        actionType: input.action.slice(0, 120),
      });
    }
    return {
      mode: config.validationMode,
      checked: true,
      blocked,
      result: null,
      errorCode,
    };
  }
}

export function summarizeSupplyStateConflict(validation: SupplyStateActionValidation) {
  if (validation.errorCode) {
    return `state validation could not complete (${validation.errorCode})`;
  }
  const changes = validation.result?.changedStrict ?? [];
  if (!changes.length) return "state validation found no strict changes";
  return changes
    .slice(0, 8)
    .map((change) => `${change.key} changed from ${change.oldVersion} to ${change.newVersion}`)
    .join("; ");
}
