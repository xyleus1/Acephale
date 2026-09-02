export type VerifiedFacilityBase = {
  label: string;
  city: string | null;
};

const COMPANY_OPERATING_SITE_OBJECT_ID = "processing-site";

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * A saved operating base is operator-entered, so the company operating site on
 * the map should not keep asking for verification. Only that single site object
 * qualifies, and only its address may confirm it: the object label is generated
 * from the company name, so it carries no facility identity.
 */
export function facilityMatchesVerifiedBase(
  object: { id: string; kind: string; location: string },
  base: VerifiedFacilityBase | null,
): boolean {
  if (!base || object.kind !== "factory") return false;
  if (object.id !== COMPANY_OPERATING_SITE_OBJECT_ID) return false;
  const city = base.city ? normalize(base.city) : "";
  if (!city) return false;
  return normalize(object.location).includes(city);
}
