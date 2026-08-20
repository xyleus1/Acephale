export function supplyContextEnabled(officeId: string, environment: NodeJS.ProcessEnv = process.env) {
  const configured = String(environment.SUPPLY_CONTEXT_OFFICE_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes("*")) return true;
  if (configured.includes(officeId)) return true;
  try {
    const procurementPilots = JSON.parse(String(environment.PROCUREMENT_CUSTOMER_MAP_JSON ?? "{}")) as unknown;
    if (
      procurementPilots
      && typeof procurementPilots === "object"
      && !Array.isArray(procurementPilots)
      && Object.prototype.hasOwnProperty.call(procurementPilots, officeId)
    ) return true;
  } catch {
    // An invalid procurement map must fail closed.
  }
  return environment.NODE_ENV !== "production";
}
