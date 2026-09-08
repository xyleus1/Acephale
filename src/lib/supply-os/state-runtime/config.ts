export const SUPPLY_STATE_VALIDATION_MODES = ["off", "shadow", "enforce"] as const;

export type SupplyStateValidationMode = (typeof SUPPLY_STATE_VALIDATION_MODES)[number];

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function supplyStateRuntimeConfig(environment: NodeJS.ProcessEnv = process.env) {
  const configuredMode = environment.SUPPLY_STATE_VALIDATION_MODE?.trim().toLowerCase();
  const validationMode = SUPPLY_STATE_VALIDATION_MODES.includes(configuredMode as SupplyStateValidationMode)
    ? configuredMode as SupplyStateValidationMode
    : "off";

  return {
    enabled: enabled(environment.SUPPLY_STATE_RUNTIME_ENABLED),
    projectionsEnabled: enabled(environment.SUPPLY_STATE_PROJECTIONS_ENABLED),
    validationMode,
  } as const;
}

export function shouldEnforceSupplyStateValidation(environment: NodeJS.ProcessEnv = process.env) {
  const config = supplyStateRuntimeConfig(environment);
  return config.enabled && config.validationMode === "enforce";
}
