export function supplyContextEnabled(officeId: string, environment: NodeJS.ProcessEnv = process.env) {
  const configured = String(environment.SUPPLY_CONTEXT_OFFICE_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.includes("*")) return true;
  if (configured.includes(officeId)) return true;
  return environment.NODE_ENV !== "production";
}
